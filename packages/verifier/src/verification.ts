/**
 * Deterministic verification engine. The verdict it returns is the only input
 * that decides how much of an authorized payment is captured on-chain.
 */
import { digest, type Digest } from '@pact/core'

export type FieldType = 'string' | 'number' | 'boolean' | 'url' | 'date' | 'array' | 'object'

/** `request.<field>` resolves the bound from the pact's own request (e.g. requested count). */
export type Bound = number | `request.${string}` | null

export type VerificationPolicy = {
  id: string
  version: number
  name: string
  description: string
  maxLatencyMs: number
  /** Dot path to the array of result items, or null for single-object results. */
  itemsPath: string | null
  topLevelFields: Record<string, FieldType>
  itemFields: Record<string, FieldType>
  minItems: Bound
  maxItems: Bound
  uniqueItemKey?: string | undefined
  /** Result fields that must equal the same field in the request (catches wrong results). */
  echoFields: string[]
  requireProviderSignature: boolean
  requireRequestBinding: boolean
}

export type Delivery = {
  transportError: 'timeout' | 'network' | null
  httpStatus: number | null
  contentType: string | null
  bodyText: string | null
  latencyMs: number
  receivedAt: number
  echoedPactId: string | null
  echoedRequestDigest: string | null
  claimedResultDigest: string | null
  signature: string | null
}

export type SignatureCheck = (args: { message: string; signature: string; address: string }) => Promise<boolean>

export type VerificationContext = {
  pactId: string
  request: Record<string, unknown>
  requestDigest: string
  deadlineAt: number
  providerAddress: string
  /** Results already delivered anywhere on this gateway, for replay detection. */
  priorResults: { resultDigest: string; requestDigest: string }[]
  checkSignature: SignatureCheck
}

export type CheckCode =
  | 'delivered'
  | 'http_ok'
  | 'deadline'
  | 'content_type'
  | 'non_empty'
  | 'json_parse'
  | 'pact_bound'
  | 'request_bound'
  | 'result_digest'
  | 'provider_signature'
  | 'fresh_result'
  | 'schema_valid'
  | 'echo_fields'
  | 'min_items'
  | 'max_items'
  | 'unique_items'

export type CheckStatus = 'pass' | 'fail' | 'skip'
export type Check = { code: CheckCode; status: CheckStatus; detail: string }
export type Verdict = 'PASS' | 'FAIL' | 'PENDING' | 'EXPIRED'

export type VerificationResult = {
  verdict: Verdict
  checks: Check[]
  reasons: CheckCode[]
  resultDigest: Digest | null
  itemCount: number | null
}

export const CHECK_LABELS: Record<CheckCode, string> = {
  delivered: 'Result delivered',
  http_ok: 'HTTP success',
  deadline: 'Deadline met',
  content_type: 'JSON content type',
  non_empty: 'Non-empty response',
  json_parse: 'Well-formed JSON',
  pact_bound: 'Bound to this pact',
  request_bound: 'Bound to this request',
  result_digest: 'Result digest matches',
  provider_signature: 'Provider signature valid',
  fresh_result: 'Not a replayed result',
  schema_valid: 'Schema valid',
  echo_fields: 'Answers the requested subject',
  min_items: 'Minimum items',
  max_items: 'Maximum items',
  unique_items: 'No duplicate items',
}

/** Message a provider signs (EIP-191) to attest a result for one pact and request. */
export const providerMessage = (pactId: string, requestDigest: string, resultDigest: string) =>
  `pact:v1:${pactId}:${requestDigest}:${resultDigest}`

export function policyDigest(policy: VerificationPolicy): Digest {
  return digest(policy)
}

export function expiredVerdict(policy: VerificationPolicy): VerificationResult {
  return {
    verdict: 'EXPIRED',
    checks: [{ code: 'deadline', status: 'fail', detail: `no result within ${policy.maxLatencyMs} ms` }],
    reasons: ['deadline'],
    resultDigest: null,
    itemCount: null,
  }
}

function getPath(value: unknown, path: string): unknown {
  let cur: unknown = value
  for (const key of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[key]
  }
  return cur
}

function resolveBound(bound: Bound, request: Record<string, unknown>): number | null {
  if (bound === null) return null
  if (typeof bound === 'number') return bound
  const v = getPath(request, bound.slice('request.'.length))
  if (Array.isArray(v)) return v.length
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null
}

function typeError(value: unknown, type: FieldType): string | null {
  switch (type) {
    case 'string':
      return typeof value === 'string' && value.trim().length > 0 ? null : 'expected non-empty string'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? null : 'expected number'
    case 'boolean':
      return typeof value === 'boolean' ? null : 'expected boolean'
    case 'array':
      return Array.isArray(value) ? null : 'expected array'
    case 'object':
      return value !== null && typeof value === 'object' && !Array.isArray(value) ? null : 'expected object'
    case 'url':
      try {
        if (typeof value !== 'string') return 'expected http(s) URL'
        const u = new URL(value)
        return u.protocol === 'https:' || u.protocol === 'http:' ? null : 'expected http(s) URL'
      } catch {
        return 'expected http(s) URL'
      }
    case 'date':
      return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) && !Number.isNaN(Date.parse(value))
        ? null
        : 'expected ISO date'
  }
}

function fieldErrors(obj: unknown, fields: Record<string, FieldType>, prefix: string): string[] {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return [`${prefix || 'result'}: expected object`]
  const errors: string[] = []
  for (const [field, type] of Object.entries(fields)) {
    const v = (obj as Record<string, unknown>)[field]
    if (v === undefined || v === null) errors.push(`${prefix}${field}: missing`)
    else {
      const err = typeError(v, type)
      if (err) errors.push(`${prefix}${field}: ${err}`)
    }
  }
  return errors
}

const canonicalKey = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : JSON.stringify(v))

export async function verifyDelivery(
  policy: VerificationPolicy,
  delivery: Delivery,
  ctx: VerificationContext,
): Promise<VerificationResult> {
  const checks: Check[] = []
  const add = (code: CheckCode, ok: boolean, detail: string) =>
    checks.push({ code, status: ok ? 'pass' : 'fail', detail })
  const skip = (code: CheckCode, detail = 'skipped: prerequisite failed') =>
    checks.push({ code, status: 'skip', detail })

  const finish = (resultDigest: Digest | null, itemCount: number | null): VerificationResult => {
    const reasons = checks.filter((c) => c.status === 'fail').map((c) => c.code)
    return { verdict: reasons.length ? 'FAIL' : 'PASS', checks, reasons, resultDigest, itemCount }
  }

  if (delivery.transportError) {
    add('delivered', false, delivery.transportError === 'timeout' ? 'provider timed out' : 'provider unreachable')
    return finish(null, null)
  }
  add('delivered', true, `received after ${delivery.latencyMs} ms`)

  const status = delivery.httpStatus ?? 0
  add('http_ok', status >= 200 && status < 300, `HTTP ${status}`)
  const onTime = delivery.latencyMs <= policy.maxLatencyMs && delivery.receivedAt <= ctx.deadlineAt
  add('deadline', onTime, `${delivery.latencyMs} ms (limit ${policy.maxLatencyMs} ms)`)
  add(
    'content_type',
    (delivery.contentType ?? '').toLowerCase().startsWith('application/json'),
    delivery.contentType ?? 'none',
  )

  const text = delivery.bodyText ?? ''
  add('non_empty', text.trim().length > 0, `${text.length} bytes`)
  const resultDigest = text.length ? digest(text) : null

  let parsed: unknown
  let parsedOk = false
  if (text.trim().length) {
    try {
      parsed = JSON.parse(text)
      parsedOk = true
      add('json_parse', true, 'valid JSON')
    } catch (error) {
      add('json_parse', false, (error as Error).message.slice(0, 120))
    }
  } else skip('json_parse')

  if (policy.requireRequestBinding) {
    add('pact_bound', delivery.echoedPactId === ctx.pactId, `provider echoed ${delivery.echoedPactId ?? 'nothing'}`)
    add(
      'request_bound',
      delivery.echoedRequestDigest === ctx.requestDigest,
      delivery.echoedRequestDigest === ctx.requestDigest
        ? 'request digest matches'
        : `expected ${ctx.requestDigest.slice(0, 19)}…, got ${delivery.echoedRequestDigest?.slice(0, 19) ?? 'nothing'}`,
    )
  }

  if (resultDigest) {
    const claimed = delivery.claimedResultDigest
    add(
      'result_digest',
      claimed === resultDigest,
      claimed === resultDigest ? 'body matches signed digest' : 'body does not match the digest the provider signed',
    )
    const replay = ctx.priorResults.find(
      (p) => p.resultDigest === resultDigest && p.requestDigest !== ctx.requestDigest,
    )
    add('fresh_result', !replay, replay ? 'identical result was delivered for a different request' : 'first delivery')
  } else {
    skip('result_digest')
    skip('fresh_result')
  }

  if (policy.requireProviderSignature) {
    if (!delivery.signature || !resultDigest) add('provider_signature', false, 'missing provider signature')
    else {
      const ok = await ctx
        .checkSignature({
          message: providerMessage(ctx.pactId, ctx.requestDigest, resultDigest),
          signature: delivery.signature,
          address: ctx.providerAddress,
        })
        .catch(() => false)
      add('provider_signature', ok, ok ? `signed by ${ctx.providerAddress}` : 'signature does not recover to provider')
    }
  }

  if (!parsedOk) {
    for (const code of ['schema_valid', 'echo_fields', 'min_items', 'max_items', 'unique_items'] as const) skip(code)
    return finish(resultDigest, null)
  }

  const items = policy.itemsPath ? getPath(parsed, policy.itemsPath) : null
  const itemList = Array.isArray(items) ? items : null
  const errors = fieldErrors(parsed, policy.topLevelFields, '')
  if (policy.itemsPath && itemList) {
    itemList.forEach((item, i) => errors.push(...fieldErrors(item, policy.itemFields, `${policy.itemsPath}[${i}].`)))
  }
  add('schema_valid', errors.length === 0, errors.length ? errors.slice(0, 6).join('; ') : 'all fields valid')

  if (policy.echoFields.length) {
    const mismatched = policy.echoFields.filter((f) => getPath(parsed, f) !== getPath(ctx.request, f))
    add(
      'echo_fields',
      mismatched.length === 0,
      mismatched.length
        ? mismatched
            .map((f) => `${f}: asked "${String(getPath(ctx.request, f))}", got "${String(getPath(parsed, f))}"`)
            .join('; ')
        : `matches ${policy.echoFields.join(', ')}`,
    )
  }

  const count = itemList?.length ?? null
  const min = resolveBound(policy.minItems, ctx.request)
  const max = resolveBound(policy.maxItems, ctx.request)
  if (min !== null) add('min_items', count !== null && count >= min, `${count ?? 0} of ≥${min}`)
  if (max !== null) add('max_items', count !== null && count <= max, `${count ?? 0} of ≤${max}`)

  if (policy.uniqueItemKey && itemList) {
    const key = policy.uniqueItemKey
    const keys = itemList.map((it) => canonicalKey((it as Record<string, unknown> | null)?.[key]))
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i)
    add('unique_items', dupes.length === 0, dupes.length ? `duplicate ${key}: ${dupes[0]}` : 'all unique')
  }

  return finish(resultDigest, count)
}
