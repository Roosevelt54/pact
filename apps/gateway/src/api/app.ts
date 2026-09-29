import { randomUUID } from 'node:crypto'
import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { streamSSE } from 'hono/streaming'
import type { Account } from 'viem'
import { z } from 'zod'

import { formatAmount, parseAmount } from '@pact/core'
import type { Behavior, DemoProvider } from '@pact/demo-provider'
import { verifyReceipt, type WorkReceipt } from '@pact/receipts'
import {
  Headers,
  PactClientError,
  PaymentError,
  receiptHeader,
  serializeChallenge,
  type PactClient,
  type SettlementRail,
} from '@pact/tempo'
import { CHECK_LABELS, type Check, type VerificationPolicy } from '@pact/verifier'

import { SCENARIOS, SCENARIO_IDS } from '../catalog.js'
import type { Config } from '../config.js'
import type { PactRow, Repo } from '../db/repo.js'
import { PactError, type PactEngine } from '../engine/pactEngine.js'
import { toEvent, type EventBus, type PactEvent } from '../events.js'

export type AppDeps = {
  config: Config
  repo: Repo
  engine: PactEngine
  rail: SettlementRail
  bus: EventBus
  provider: DemoProvider
  /** The demo agent: a real PactClient speaking to this gateway over its public API. */
  agent: PactClient
  signer: Account
}

const fmt = (units: string | null | undefined) => (units == null ? null : formatAmount(BigInt(units)))
const iso = (ms: number | null | undefined) => (ms ? new Date(ms).toISOString() : null)

class RateLimiter {
  private readonly hits = new Map<string, number[]>()
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}
  allow(key: string) {
    const now = Date.now()
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs)
    const ok = recent.length < this.limit
    if (ok) recent.push(now)
    this.hits.set(key, recent)
    return ok
  }
}

const clientKey = (c: Context) =>
  c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || 'local'

const createPactSchema = z.object({
  agentId: z.string().min(1).max(64),
  serviceId: z.string().min(1).max(64),
  request: z.record(z.string(), z.unknown()),
  maxAmount: z.string().max(24).optional(),
  retryOf: z.string().max(64).optional(),
  scenario: z.string().max(32).optional(),
  origin: z.string().max(32).optional(),
})

export const ASYNC_BEHAVIORS = ['normal', 'incomplete', 'malformed', 'timeout', 'forged', 'duplicate_callback'] as const

const labRunSchema = z.object({
  scenario: z.union([z.enum(SCENARIO_IDS), z.literal('duplicate_callback')]),
  serviceId: z.string().max(64).default('sec-filings'),
  company: z.string().trim().min(1).max(80).default('NVIDIA'),
  count: z.number().int().min(1).max(12).default(4),
  market: z.string().trim().min(1).max(80).default('Stablecoin payments in West Africa'),
  sections: z.number().int().min(1).max(12).default(5),
  retryOf: z.string().max(64).optional(),
})

const fieldType = z.enum(['string', 'number', 'boolean', 'url', 'date', 'array', 'object'])
const bound = z.union([z.number().int().min(0), z.string().regex(/^request\.[A-Za-z0-9_.]+$/), z.null()])
const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{1,47}$/)

const policySchema = z.object({
  id: slug,
  version: z.number().int().min(1),
  name: z.string().min(1).max(80),
  description: z.string().max(600),
  maxLatencyMs: z.number().int().min(100).max(600_000),
  itemsPath: z.string().max(80).nullable(),
  topLevelFields: z.record(z.string().max(64), fieldType),
  itemFields: z.record(z.string().max(64), fieldType),
  minItems: bound,
  maxItems: bound,
  uniqueItemKey: z.string().max(64).optional(),
  echoFields: z.array(z.string().max(64)).max(16),
  requireProviderSignature: z.boolean(),
  requireRequestBinding: z.boolean(),
}) as z.ZodType<VerificationPolicy>

const serviceSchema = z.object({
  id: slug,
  name: z.string().min(1).max(80),
  description: z.string().max(400),
  providerName: z.string().min(1).max(80),
  providerAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  endpoint: z
    .string()
    .url()
    .refine((u) => /^https?:$/.test(new URL(u).protocol), 'endpoint must be http(s)'),
  mode: z.enum(['sync', 'async']),
  price: z.string().regex(/^\d{1,6}(\.\d{1,6})?$/),
  policyId: slug,
  policyVersion: z.number().int().min(1),
  capability: z.string().min(1).max(64),
  inputSchema: z.record(z.string(), z.unknown()).default({ type: 'object' }),
})

export function createApp(d: AppDeps) {
  const { repo, engine, rail, bus, config } = d
  const app = new Hono()
  const labLimiter = new RateLimiter(30, 60_000)
  const writeLimiter = new RateLimiter(120, 60_000)
  let labInFlight = 0

  app.use('*', secureHeaders())
  app.use(
    '/v1/*',
    cors({
      origin: config.PACT_WEB_ORIGIN.split(',').map((s) => s.trim()),
      allowHeaders: ['content-type', 'authorization', 'idempotency-key', 'last-event-id'],
      exposeHeaders: [Headers.wwwAuthenticate, Headers.paymentReceipt],
    }),
  )

  app.onError((error, c) => {
    if (error instanceof PactError || error instanceof PaymentError)
      return c.json({ error: { code: error.code, message: error.message } }, error.status as 400)
    if (error instanceof z.ZodError)
      return c.json(
        { error: { code: 'invalid_request', message: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') } },
        400,
      )
    if (error instanceof PactClientError) return c.json({ error: { code: error.code, message: error.message } }, 402)
    console.error('[pact] unhandled', error)
    return c.json({ error: { code: 'internal', message: 'internal error' } }, 500)
  })
  app.notFound((c) => c.json({ error: { code: 'not_found', message: 'route not found' } }, 404))

  // ───────────────────────── views ─────────────────────────
  const summary = (p: PactRow) => {
    const service = repo.getService(p.service_id)
    const auth = repo.getAuthorization(p.id)
    const settlement = repo.getSettlement(p.id)
    const confirmed = settlement?.status === 'confirmed'
    return {
      id: p.id,
      state: p.state,
      outcome: p.outcome,
      scenario: p.scenario,
      origin: p.origin,
      rail: p.rail,
      service: service ? { id: service.id, name: service.name, provider: service.provider_name, mode: service.mode } : null,
      price: fmt(p.price),
      maxAmount: fmt(p.max_amount),
      authorized: fmt(auth?.deposit),
      captured: confirmed ? fmt(settlement.capture_amount) : null,
      refunded: confirmed ? fmt(settlement.refund_amount) : null,
      settlementTxUrl: confirmed ? rail.txUrl(settlement.tx_hash) : null,
      retryOf: p.retry_of,
      createdAt: iso(p.created_at),
      updatedAt: iso(p.updated_at),
      completedAt: iso(p.completed_at),
    }
  }

  const detail = (p: PactRow) => {
    const service = repo.getService(p.service_id)!
    const policy = repo.getPolicy(p.policy_id, p.policy_version)!
    const auth = repo.getAuthorization(p.id)
    const work = repo.getWorkItem(p.id)
    const verification = repo.getVerification(p.id)
    const settlement = repo.getSettlement(p.id)
    const receipt = repo.getReceiptByPact(p.id)
    const retries = repo.db.prepare('SELECT id, state, service_id FROM pacts WHERE retry_of = ? ORDER BY created_at').all(p.id)
    return {
      ...summary(p),
      request: JSON.parse(p.request) as unknown,
      requestDigest: p.request_digest,
      deadlineAt: iso(p.deadline_at),
      authorizedAt: iso(p.authorized_at),
      service: {
        id: service.id,
        name: service.name,
        description: service.description,
        provider: service.provider_name,
        providerAddress: service.provider_address,
        endpoint: service.endpoint,
        mode: service.mode,
      },
      policy: {
        id: policy.id,
        version: policy.version,
        name: policy.name,
        description: policy.description,
        digest: policy.digest,
        maxLatencyMs: policy.maxLatencyMs,
      },
      authorization: auth && {
        channelId: auth.channel_id,
        payer: auth.payer,
        deposit: fmt(auth.deposit),
        voucherAmount: fmt(auth.voucher_amount),
        challengeId: auth.challenge_id,
        openTx: auth.open_tx_hash,
        openTxUrl: rail.txUrl(auth.open_tx_hash),
        salt: (JSON.parse(auth.descriptor) as { salt: string }).salt,
        at: iso(auth.created_at),
      },
      work: work && {
        status: work.status,
        jobId: work.provider_job_id,
        dispatchedAt: iso(work.dispatched_at),
        deliveredAt: iso(work.delivered_at),
        latencyMs: work.latency_ms,
        httpStatus: work.http_status,
        contentType: work.content_type,
        bytes: work.body_text?.length ?? 0,
        resultDigest: work.result_digest,
        claimedResultDigest: work.claimed_result_digest,
        transportError: work.transport_error,
        duplicateDeliveries: work.duplicate_deliveries,
        bodyPreview: work.body_text ? work.body_text.slice(0, 6_000) : null,
      },
      verification: verification && {
        verdict: verification.verdict,
        reasons: JSON.parse(verification.reasons) as string[],
        itemCount: verification.item_count,
        checks: (JSON.parse(verification.checks) as Check[]).map((ch) => ({ ...ch, label: CHECK_LABELS[ch.code] })),
        at: iso(verification.created_at),
      },
      settlement: settlement && {
        kind: settlement.kind,
        status: settlement.status,
        capture: fmt(settlement.capture_amount),
        refund: fmt(settlement.refund_amount),
        txHash: settlement.tx_hash,
        txUrl: rail.txUrl(settlement.tx_hash),
        attempts: settlement.attempts,
        lastError: settlement.last_error,
        confirmedAt: iso(settlement.confirmed_at),
      },
      receiptId: receipt?.id ?? null,
      retries,
      timeline: repo.listAudit({ pactId: p.id }).map(toEvent),
      payments: repo.listPaymentEvents(p.id).map((e) => ({
        kind: e.kind,
        amount: fmt(e.amount),
        txHash: e.tx_hash,
        txUrl: rail.txUrl(e.tx_hash),
        detail: e.detail,
        at: iso(e.created_at),
      })),
      failures: repo.listFailures(p.id).map((f) => ({ stage: f.stage, code: f.code, message: f.message, at: iso(f.created_at) })),
    }
  }

  // ───────────────────────── platform ─────────────────────────
  app.get('/health', (c) => c.json({ ok: true, rail: rail.info.kind }))

  let balanceCache: { at: number; value: unknown } | null = null
  app.get('/v1/rail', async (c) => {
    if (!balanceCache || Date.now() - balanceCache.at > 5_000) {
      const services = repo.listServices()
      const parties = [
        { role: 'agent', name: 'ResearchBot', address: d.agent.address as string },
        ...[...new Map(services.map((s) => [s.provider_address, s.provider_name])).entries()].map(([address, name]) => ({
          role: 'provider',
          name,
          address,
        })),
        { role: 'operator', name: 'PACT gateway', address: rail.info.operator as string },
      ]
      const balances = await Promise.all(
        parties.map(async (p) => {
          const bal = await rail.balanceOf(p.address as `0x${string}`).catch(() => null)
          return {
            ...p,
            balance: bal === null ? null : formatAmount(bal),
            url: rail.info.explorerUrl ? `${rail.info.explorerUrl}/address/${p.address}` : null,
          }
        }),
      )
      balanceCache = { at: Date.now(), value: balances }
    }
    return c.json({ ...rail.info, parties: balanceCache.value })
  })

  app.get('/v1/services', (c) =>
    c.json({
      services: repo.listServices().map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        provider: s.provider_name,
        providerAddress: s.provider_address,
        endpoint: s.endpoint,
        mode: s.mode,
        price: fmt(s.price),
        policy: `${s.policy_id}@${s.policy_version}`,
        capability: s.capability,
        inputSchema: JSON.parse(s.input_schema) as Record<string, unknown>,
      })),
    }),
  )
  app.get('/v1/policies', (c) => c.json({ policies: repo.listPolicies() }))
  app.get('/v1/scenarios', (c) => c.json({ scenarios: SCENARIOS, asyncScenarios: ASYNC_BEHAVIORS }))

  app.get('/v1/metrics', (c) => {
    const m = repo.metrics()
    const byState = Object.fromEntries(m.counts.map((r) => [r.state, Number(r.n)])) as Record<string, number>
    const verdicts = Object.fromEntries(m.verdicts.map((r) => [r.verdict, Number(r.n)])) as Record<string, number>
    const verified = Object.values(verdicts).reduce((a, b) => a + b, 0)
    const services = new Map(repo.listServices().map((s) => [s.id, s]))
    return c.json({
      authorized: formatAmount(m.authorized),
      settled: formatAmount(m.settled),
      protected: formatAmount(m.protected),
      refunded: formatAmount(m.refunded),
      inFlight: formatAmount(m.inFlight),
      pacts: Object.values(byState).reduce((a, b) => a + b, 0),
      byState,
      verdicts,
      passRate: verified ? (verdicts.PASS ?? 0) / verified : null,
      active: ['CREATED', 'AUTHORIZED', 'EXECUTING', 'VERIFYING', 'VERIFIED', 'REJECTED', 'SETTLING'].reduce(
        (a, s) => a + (byState[s] ?? 0),
        0,
      ),
      providers: repo.providerStats().map((s) => ({
        serviceId: s.service_id,
        name: services.get(s.service_id)?.name ?? s.service_id,
        provider: services.get(s.service_id)?.provider_name ?? '',
        total: Number(s.total),
        passed: Number(s.passed),
        failed: Number(s.failed),
        avgLatencyMs: s.avg_latency_ms,
      })),
    })
  })

  // ───────────────────────── pacts ─────────────────────────
  app.post('/v1/pacts', bodyLimit({ maxSize: 16 * 1024 }), async (c) => {
    if (!writeLimiter.allow(clientKey(c))) return c.json({ error: { code: 'rate_limited', message: 'slow down' } }, 429)
    const body = createPactSchema.parse(await c.req.json().catch(() => ({})))
    const idempotencyKey = c.req.header('idempotency-key')?.slice(0, 128) || randomUUID()
    const { pact, created } = engine.createPact({ ...body, idempotencyKey })
    return c.json({ pact: summary(pact), created }, created ? 201 : 200)
  })

  app.get('/v1/pacts', (c) => {
    const limit = Number(c.req.query('limit') ?? 50)
    const beforeRaw = c.req.query('before')
    const before = beforeRaw ? Date.parse(beforeRaw) : NaN
    const rows = repo.listPacts({
      limit: Number.isFinite(limit) ? limit : 50,
      before: Number.isFinite(before) ? before : undefined,
      state: c.req.query('state') || undefined,
    })
    return c.json({ pacts: rows.map(summary) })
  })

  app.get('/v1/pacts/:id', (c) => {
    const pact = repo.getPact(c.req.param('id'))
    if (!pact) return c.json({ error: { code: 'not_found', message: 'pact not found' } }, 404)
    return c.json({ pact: detail(pact) })
  })

  /** MPP payment step: 402 with a session challenge, or accept `Authorization: Payment …`. */
  app.post('/v1/pacts/:id/authorize', async (c) => {
    const id = c.req.param('id')
    const credential = c.req.header(Headers.authorization)
    if (!credential) {
      const challenge = engine.challenge(id)
      c.header(Headers.wwwAuthenticate, serializeChallenge(challenge))
      c.header('Cache-Control', 'no-store')
      return c.json(
        {
          error: { code: 'payment_required', message: 'Escrow the pact price in a TIP-1034 channel bound to this pact.' },
          challenge: { id: challenge.id, expires: challenge.expires, request: challenge.request },
        },
        402,
      )
    }
    const result = await engine.authorize(id, credential)
    c.header(Headers.paymentReceipt, receiptHeader({ reference: result.channelId }))
    return c.json({ pact: summary(result.pact), channelId: result.channelId, replay: result.replay })
  })

  /** The delivered result plus verdict, settlement and receipt, once the pact has settled. */
  app.get('/v1/pacts/:id/result', (c) => {
    const pact = repo.getPact(c.req.param('id'))
    if (!pact) return c.json({ error: { code: 'not_found', message: 'pact not found' } }, 404)
    const done = pact.state === 'SETTLED' || pact.state === 'PROTECTED' || pact.state === 'EXPIRED'
    if (!done) return c.json({ error: { code: 'not_settled', message: `pact is ${pact.state}` } }, 409)
    const work = repo.getWorkItem(pact.id)
    const verification = repo.getVerification(pact.id)
    const settlement = repo.getSettlement(pact.id)
    const receipt = repo.getReceiptByPact(pact.id)
    return c.json({
      state: pact.state,
      verdict: verification?.verdict ?? null,
      reasons: verification ? (JSON.parse(verification.reasons) as string[]) : [],
      contentType: work?.content_type ?? null,
      resultDigest: work?.result_digest ?? null,
      body: work?.body_text ?? null,
      settlement:
        settlement?.status === 'confirmed'
          ? {
              captured: fmt(settlement.capture_amount),
              refunded: fmt(settlement.refund_amount),
              txHash: settlement.tx_hash,
              txUrl: rail.txUrl(settlement.tx_hash),
            }
          : null,
      receipt: receipt ? (JSON.parse(receipt.body) as WorkReceipt) : null,
    })
  })

  app.post('/v1/pacts/:id/deliver', bodyLimit({ maxSize: 256 * 1024 }), async (c) => {
    const text = await c.req.text()
    const result = await engine.deliverCallback(c.req.param('id'), { headers: c.req.raw.headers, bodyText: text })
    return c.json(result)
  })

  app.post('/v1/pacts/:id/settlement/retry', (c) => {
    if (!writeLimiter.allow(clientKey(c))) return c.json({ error: { code: 'rate_limited', message: 'slow down' } }, 429)
    engine.retrySettlement(c.req.param('id'))
    return c.json({ ok: true }, 202)
  })

  // ───────────────────────── receipts ─────────────────────────
  app.get('/v1/receipts', (c) => {
    const limit = Number(c.req.query('limit') ?? 50)
    const rows = repo.listReceipts(Number.isFinite(limit) ? limit : 50)
    return c.json({
      signer: rail.info.operator,
      receipts: rows.map((r) => {
        const body = JSON.parse(r.body) as WorkReceipt
        return {
          receiptId: r.id,
          pactId: r.pact_id,
          issuedAt: body.issuedAt,
          service: body.service.name,
          provider: body.provider.name,
          verdict: body.verification.verdict,
          outcome: body.settlement.outcome,
          captureAmount: body.settlement.captureAmount,
          refundAmount: body.settlement.refundAmount,
        }
      }),
    })
  })

  app.get('/v1/receipts/:id', (c) => {
    const row = repo.getReceipt(c.req.param('id'))
    if (!row) return c.json({ error: { code: 'not_found', message: 'receipt not found' } }, 404)
    return c.json({ receipt: JSON.parse(row.body) as WorkReceipt, signer: rail.info.operator })
  })

  app.get('/v1/receipts/:id/verify', async (c) => {
    const row = repo.getReceipt(c.req.param('id'))
    if (!row) return c.json({ error: { code: 'not_found', message: 'receipt not found' } }, 404)
    const receipt = JSON.parse(row.body) as WorkReceipt
    return c.json(await verifyReceipt(receipt, rail.info.operator, receipt))
  })

  /** Verifies any receipt document a third party holds, e.g. one that may have been altered. */
  app.post('/v1/receipts/verify', bodyLimit({ maxSize: 128 * 1024 }), async (c) => {
    const receipt = (await c.req.json().catch(() => null)) as WorkReceipt | null
    if (!receipt || typeof receipt !== 'object' || typeof receipt.receiptDigest !== 'string' || typeof receipt.pactSignature !== 'string')
      return c.json({ error: { code: 'invalid_receipt', message: 'body must be a PACT work receipt' } }, 400)
    const stored = typeof receipt.receiptId === 'string' ? repo.getReceipt(receipt.receiptId) : null
    return c.json(await verifyReceipt(receipt, rail.info.operator, stored ? (JSON.parse(stored.body) as WorkReceipt) : null))
  })

  // ───────────────────────── live events ─────────────────────────
  app.get('/v1/events', (c) => {
    const after = Number(c.req.header('last-event-id') ?? c.req.query('after') ?? NaN)
    const res = streamSSE(c, async (stream) => {
      const queue: PactEvent[] = []
      let wake: (() => void) | null = null
      const unsubscribe = bus.subscribe((e) => {
        queue.push(e)
        wake?.()
      })
      stream.onAbort(() => {
        unsubscribe()
        wake?.()
      })
      const backlog = Number.isFinite(after) ? repo.listAudit({ afterSeq: after, limit: 200 }) : repo.listAudit({ limit: 40 })
      let lastSeq = Number.isFinite(after) ? after : 0
      for (const row of backlog) {
        await stream.writeSSE({ id: String(row.seq), event: 'pact', data: JSON.stringify(toEvent(row)) })
        lastSeq = row.seq
      }
      while (!stream.aborted) {
        if (!queue.length)
          await new Promise<void>((resolve) => {
            wake = resolve
            setTimeout(resolve, 15_000)
          })
        wake = null
        if (stream.aborted) break
        if (!queue.length) {
          await stream.writeSSE({ event: 'ping', data: '{}' })
          continue
        }
        for (const e of queue.splice(0)) {
          if (e.seq <= lastSeq) continue
          lastSeq = e.seq
          await stream.writeSSE({ id: String(e.seq), event: 'pact', data: JSON.stringify(e) })
        }
      }
      unsubscribe()
    })
    // Tell reverse proxies (nginx, Railway) not to buffer the event stream.
    res.headers.set('X-Accel-Buffering', 'no')
    return res
  })

  // ───────────────────────── chaos lab ─────────────────────────
  app.post('/v1/lab/runs', bodyLimit({ maxSize: 8 * 1024 }), async (c) => {
    if (!labLimiter.allow(clientKey(c)))
      return c.json({ error: { code: 'rate_limited', message: 'Chaos Lab is limited to 30 runs per minute' } }, 429)
    if (labInFlight >= 8) return c.json({ error: { code: 'busy', message: 'too many runs in flight; try again shortly' } }, 429)
    const body = labRunSchema.parse(await c.req.json().catch(() => ({})))
    const service = repo.getService(body.serviceId)
    if (!service) return c.json({ error: { code: 'unknown_service', message: 'service not found' } }, 404)
    const isAsync = service.mode === 'async'
    if (isAsync && !(ASYNC_BEHAVIORS as readonly string[]).includes(body.scenario))
      return c.json(
        { error: { code: 'unsupported_scenario', message: `async services support ${ASYNC_BEHAVIORS.join(', ')}` } },
        400,
      )
    if (!isAsync && body.scenario === 'duplicate_callback')
      return c.json({ error: { code: 'unsupported_scenario', message: 'duplicate_callback applies to async services' } }, 400)

    const request = isAsync ? { market: body.market, sections: body.sections } : { company: body.company, count: body.count }
    const price = BigInt(service.price)
    const maxAmount = formatAmount(price + (price * 25n) / 100n)
    const idempotencyKey = c.req.header('idempotency-key')?.slice(0, 128) || randomUUID()
    const pact = await d.agent.create({
      service: service.id,
      input: request,
      maxAmount,
      idempotencyKey,
      retryOf: body.retryOf,
      scenario: body.scenario,
      origin: 'chaos-lab',
    })
    if (pact.state === 'CREATED') {
      d.provider.arm(pact.id, body.scenario as Behavior)
      labInFlight++
      void d.agent
        .authorize(pact.id, maxAmount)
        .catch((error: PactClientError) =>
          bus.record(pact.id, 'agent.payment_failed', 'agent', { code: error.code ?? 'error', message: error.message }),
        )
        .finally(() => labInFlight--)
    }
    return c.json({ pactId: pact.id, state: pact.state, maxAmount }, 202)
  })

  const isAdmin = (c: Context) => !!config.PACT_ADMIN_TOKEN && c.req.header('x-admin-token') === config.PACT_ADMIN_TOKEN
  const forbidden = (c: Context) => c.json({ error: { code: 'forbidden', message: 'admin token required' } }, 403)

  app.post('/v1/admin/recover', (c) => {
    if (!isAdmin(c)) return forbidden(c)
    engine.recover()
    return c.json({ ok: true })
  })

  /** Publishes a verification policy. Policies are immutable per (id, version). */
  app.post('/v1/admin/policies', bodyLimit({ maxSize: 16 * 1024 }), async (c) => {
    if (!isAdmin(c)) return forbidden(c)
    const policy = policySchema.parse(await c.req.json().catch(() => ({})))
    const existing = repo.getPolicy(policy.id, policy.version)
    if (existing) return c.json({ error: { code: 'policy_exists', message: 'policy versions are immutable; bump version' } }, 409)
    repo.upsertPolicy(policy)
    return c.json({ policy: repo.getPolicy(policy.id, policy.version) }, 201)
  })

  /** Registers (or updates) a provider service that PACT can dispatch paid work to. */
  app.post('/v1/admin/services', bodyLimit({ maxSize: 16 * 1024 }), async (c) => {
    if (!isAdmin(c)) return forbidden(c)
    const s = serviceSchema.parse(await c.req.json().catch(() => ({})))
    if (!repo.getPolicy(s.policyId, s.policyVersion))
      return c.json({ error: { code: 'unknown_policy', message: `policy ${s.policyId}@${s.policyVersion} not found` } }, 404)
    repo.upsertService({
      id: s.id,
      name: s.name,
      description: s.description,
      provider_name: s.providerName,
      provider_address: s.providerAddress,
      endpoint: s.endpoint,
      mode: s.mode,
      price: parseAmount(s.price).toString(),
      policy_id: s.policyId,
      policy_version: s.policyVersion,
      capability: s.capability,
      input_schema: JSON.stringify(s.inputSchema),
    })
    balanceCache = null
    return c.json({ service: repo.getService(s.id) }, 201)
  })

  app.route('/provider', d.provider.app)
  return app
}
