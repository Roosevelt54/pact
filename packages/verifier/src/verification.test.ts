import { describe, expect, it } from 'vitest'

import { digest } from '@pact/core'
import {
  expiredVerdict,
  providerMessage,
  verifyDelivery,
  type Delivery,
  type VerificationContext,
  type VerificationPolicy,
} from './verification.js'

const policy: VerificationPolicy = {
  id: 'company-research',
  version: 1,
  name: 'Company research',
  description: 'test policy',
  maxLatencyMs: 5_000,
  itemsPath: 'results',
  topLevelFields: { company: 'string', results: 'array' },
  itemFields: { name: 'string', revenue: 'number', filedAt: 'date', source: 'url' },
  minItems: 'request.count',
  maxItems: 'request.count',
  uniqueItemKey: 'name',
  echoFields: ['company'],
  requireProviderSignature: true,
  requireRequestBinding: true,
}

const request = { company: 'NVIDIA', count: 3 }
const pactId = 'pact_test'
const requestDigest = digest({ serviceId: 'svc', request })
const PROVIDER = '0x2664E59dcC86ab21fa33247025Cc46B9Bd881636'

function body(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    company: 'NVIDIA',
    results: [1, 2, 3].map((i) => ({
      name: `Filing ${i}`,
      revenue: 1000 * i,
      filedAt: '2026-08-2' + i,
      source: `https://sec.example/filing/${i}`,
    })),
    ...overrides,
  })
}

function delivery(bodyText: string | null, extra: Partial<Delivery> = {}): Delivery {
  const resultDigest = bodyText === null ? null : digest(bodyText)
  return {
    transportError: null,
    httpStatus: 200,
    contentType: 'application/json; charset=utf-8',
    bodyText,
    latencyMs: 120,
    receivedAt: 1_000,
    echoedPactId: pactId,
    echoedRequestDigest: requestDigest,
    claimedResultDigest: resultDigest,
    signature: '0xsig',
    ...extra,
  }
}

const ctx = (over: Partial<VerificationContext> = {}): VerificationContext => ({
  pactId,
  request,
  requestDigest,
  deadlineAt: 10_000,
  providerAddress: PROVIDER,
  priorResults: [],
  checkSignature: async ({ message, signature, address }) =>
    signature === '0xsig' && address === PROVIDER && message.startsWith('pact:v1:'),
  ...over,
})

const failing = (r: Awaited<ReturnType<typeof verifyDelivery>>) =>
  r.checks.filter((c) => c.status === 'fail').map((c) => c.code)

describe('verifyDelivery', () => {
  it('passes a correct, bound, signed result', async () => {
    const r = await verifyDelivery(policy, delivery(body()), ctx())
    expect(failing(r)).toEqual([])
    expect(r.verdict).toBe('PASS')
    expect(r.itemCount).toBe(3)
    expect(r.resultDigest).toBe(digest(body()))
  })

  it('fails incomplete results (fewer items than requested)', async () => {
    const b = JSON.stringify({ ...JSON.parse(body()), results: JSON.parse(body()).results.slice(0, 1) })
    const r = await verifyDelivery(policy, delivery(b), ctx())
    expect(r.verdict).toBe('FAIL')
    expect(r.reasons).toContain('min_items')
  })

  it('fails malformed JSON and skips dependent checks', async () => {
    const r = await verifyDelivery(policy, delivery('{"company": "NVIDIA", results: ['), ctx())
    expect(r.verdict).toBe('FAIL')
    expect(r.reasons).toContain('json_parse')
    expect(r.checks.find((c) => c.code === 'schema_valid')?.status).toBe('skip')
  })

  it('fails schema violations with field-level detail', async () => {
    const b = body({ results: [{ name: 'x', revenue: 'lots', filedAt: 'nope', source: 'ftp//bad' }] })
    const r = await verifyDelivery(policy, delivery(b), ctx({ request: { company: 'NVIDIA', count: 1 } }))
    expect(r.reasons).toContain('schema_valid')
    const detail = r.checks.find((c) => c.code === 'schema_valid')?.detail ?? ''
    expect(detail).toMatch(/revenue/)
    expect(detail).toMatch(/filedAt/)
    expect(detail).toMatch(/source/)
  })

  it('fails a wrong result for a different company', async () => {
    const r = await verifyDelivery(policy, delivery(body({ company: 'AMD' })), ctx())
    expect(r.reasons).toContain('echo_fields')
  })

  it('fails when the provider binds the result to a different request or pact', async () => {
    const r1 = await verifyDelivery(policy, delivery(body(), { echoedRequestDigest: digest('other') }), ctx())
    expect(r1.reasons).toContain('request_bound')
    const r2 = await verifyDelivery(policy, delivery(body(), { echoedPactId: 'pact_other' }), ctx())
    expect(r2.reasons).toContain('pact_bound')
  })

  it('fails a tampered body whose digest no longer matches the signed digest', async () => {
    const d = delivery(body())
    const r = await verifyDelivery(policy, { ...d, bodyText: body({ company: 'NVIDIA ' }) }, ctx())
    expect(r.reasons).toContain('result_digest')
  })

  it('fails a missing or invalid provider signature', async () => {
    const r1 = await verifyDelivery(policy, delivery(body(), { signature: null }), ctx())
    expect(r1.reasons).toContain('provider_signature')
    const r2 = await verifyDelivery(policy, delivery(body(), { signature: '0xforged' }), ctx())
    expect(r2.reasons).toContain('provider_signature')
  })

  it('fails duplicate items inside a result', async () => {
    const dupe = JSON.parse(body()).results
    dupe[2] = dupe[0]
    const r = await verifyDelivery(policy, delivery(body({ results: dupe })), ctx())
    expect(r.reasons).toContain('unique_items')
  })

  it('fails a replayed result previously delivered for a different request', async () => {
    const b = body()
    const r = await verifyDelivery(
      policy,
      delivery(b),
      ctx({ priorResults: [{ resultDigest: digest(b), requestDigest: digest('another request') }] }),
    )
    expect(r.reasons).toContain('fresh_result')
  })

  it('fails late deliveries and timeouts', async () => {
    const late = await verifyDelivery(policy, delivery(body(), { latencyMs: 9_000 }), ctx())
    expect(late.reasons).toContain('deadline')
    const timeout = await verifyDelivery(
      policy,
      delivery(null, { transportError: 'timeout', httpStatus: null, contentType: null }),
      ctx(),
    )
    expect(timeout.verdict).toBe('FAIL')
    expect(timeout.reasons).toEqual(['delivered'])
  })

  it('fails non-2xx, wrong content type and empty bodies', async () => {
    expect((await verifyDelivery(policy, delivery(body(), { httpStatus: 503 }), ctx())).reasons).toContain('http_ok')
    expect(
      (await verifyDelivery(policy, delivery(body(), { contentType: 'text/html' }), ctx())).reasons,
    ).toContain('content_type')
    expect((await verifyDelivery(policy, delivery(''), ctx())).reasons).toContain('non_empty')
  })

  it('resolves an array-valued request bound to its length', async () => {
    const r = await verifyDelivery(
      { ...policy, minItems: 'request.periods', maxItems: 'request.periods' },
      delivery(body()),
      ctx({ request: { company: 'NVIDIA', periods: ['a', 'b'] } }),
    )
    expect(r.reasons).toEqual(['max_items'])
  })

  it('reports EXPIRED when nothing was delivered before the deadline', () => {
    const r = expiredVerdict(policy)
    expect(r.verdict).toBe('EXPIRED')
    expect(r.reasons).toEqual(['deadline'])
  })

  it('builds the provider attestation message deterministically', () => {
    expect(providerMessage('p', 'sha256:a', 'sha256:b')).toBe('pact:v1:p:sha256:a:sha256:b')
  })
})
