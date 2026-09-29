/**
 * PactEngine — the prepare/commit layer over a settlement rail.
 *
 *   PAY     challenge → escrowed authorization (voucher for the price)
 *   PROVE   dispatch → delivery → deterministic verification
 *   SETTLE  operator close: capture price on PASS, capture 0 (full refund) otherwise
 *
 * Every state change is a compare-and-swap on `pacts.state`, so duplicate
 * callbacks, concurrent retries, browser refreshes and process restarts can
 * never apply a transition twice or settle twice.
 */
import { isAddressEqual, verifyMessage, type Account, type Address, type Hex } from 'viem'

import { digest } from '@pact/core'
import { formatAmount, parseAmount } from '@pact/core'
import { EXPIRABLE_STATES, type PactState } from '@pact/core'
import {
  expiredVerdict,
  providerMessage,
  verifyDelivery,
  type Delivery,
  type VerificationPolicy,
  type VerificationResult,
} from '@pact/verifier'
import { isUniqueViolation, transaction } from '../db/index.js'
import { newId, type PactRow, type Repo } from '../db/repo.js'
import type { EventBus } from '../events.js'
import { issueChallenge, parseCredential, PaymentError, type SessionChallengeRequest } from '@pact/tempo'
import { RailError, type CloseResult, type SettlementRail } from '@pact/tempo'
import { pactSalt } from '@pact/tempo'
import { issueReceipt } from './receipts.js'

export class PactError extends Error {
  override readonly name = 'PactError'
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message)
  }
}

export type EngineDeps = {
  repo: Repo
  rail: SettlementRail
  bus: EventBus
  signer: Account
  secretKey: string
  realm: string
  publicUrl: string
  fetchProvider: (url: string, init: RequestInit) => Promise<Response>
  authorizationWindowMs?: number
  settleRetryDelaysMs?: number[]
}

export type CreatePactInput = {
  agentId: string
  serviceId: string
  request: Record<string, unknown>
  maxAmount?: string | undefined
  idempotencyKey: string
  retryOf?: string | undefined
  scenario?: string | undefined
  origin?: string | undefined
}

const MAX_REQUEST_BYTES = 8 * 1024
const MAX_BODY_BYTES = 256 * 1024
const ZERO = '0x0000000000000000000000000000000000000000'
const header = (h: Headers, name: string) => h.get(name)?.slice(0, 512) ?? null
const errorMessage = (error: unknown) => String((error as Error)?.message ?? error)

export class PactEngine {
  private readonly inflight = new Set<Promise<unknown>>()
  private readonly retryTimers = new Map<string, NodeJS.Timeout>()
  private sweeper: NodeJS.Timeout | null = null
  private readonly authWindow: number
  private readonly retryDelays: number[]

  constructor(private readonly d: EngineDeps) {
    this.authWindow = d.authorizationWindowMs ?? 10 * 60_000
    this.retryDelays = d.settleRetryDelaysMs ?? [1_000, 3_000, 10_000, 30_000]
  }

  get rail() {
    return this.d.rail
  }

  // ───────────────────────── lifecycle helpers ─────────────────────────

  /** Tracks background work so tests and shutdown can await quiescence. */
  private background(stage: string, pactId: string, fn: () => Promise<unknown>) {
    const p: Promise<unknown> = fn()
      .catch((error: unknown) => {
        this.d.repo.addFailure({ pact_id: pactId, stage, code: 'unexpected', message: errorMessage(error) })
        this.d.bus.record(pactId, 'engine.error', 'pact', { stage, message: errorMessage(error) })
      })
      .finally(() => this.inflight.delete(p))
    this.inflight.add(p)
  }

  async idle() {
    while (this.inflight.size) await Promise.allSettled([...this.inflight])
  }

  start() {
    if (this.sweeper) return
    this.sweeper = setInterval(() => this.sweepExpired(), 1_000)
    this.sweeper.unref()
    this.recover()
  }

  stop() {
    if (this.sweeper) clearInterval(this.sweeper)
    this.sweeper = null
    for (const t of this.retryTimers.values()) clearTimeout(t)
    this.retryTimers.clear()
  }

  private policyFor(p: PactRow): VerificationPolicy {
    const policy = this.d.repo.getPolicy(p.policy_id, p.policy_version)
    if (!policy) throw new PactError('policy_missing', `policy ${p.policy_id}@${p.policy_version} missing`, 500)
    return policy
  }

  private must(pactId: string) {
    const pact = this.d.repo.getPact(pactId)
    if (!pact) throw new PactError('not_found', 'pact not found', 404)
    return pact
  }

  // ───────────────────────────── create ─────────────────────────────

  createPact(input: CreatePactInput): { pact: PactRow; created: boolean } {
    const { repo, bus } = this.d
    const agent = repo.getAgent(input.agentId)
    if (!agent) throw new PactError('unknown_agent', 'agent not registered', 404)
    const service = repo.getService(input.serviceId)
    if (!service) throw new PactError('unknown_service', 'service not found', 404)
    const requestJson = JSON.stringify(input.request)
    if (requestJson.length > MAX_REQUEST_BYTES) throw new PactError('request_too_large', 'request exceeds 8 KiB')

    const requestDigest = digest({ serviceId: service.id, request: input.request })
    const price = BigInt(service.price)
    let maxAmount = price
    if (input.maxAmount !== undefined) {
      try {
        maxAmount = parseAmount(input.maxAmount)
      } catch {
        throw new PactError('invalid_amount', 'maxAmount must be a decimal with at most 6 places')
      }
    }
    if (maxAmount < price)
      throw new PactError('budget_too_low', `service price ${formatAmount(price)} exceeds maxAmount ${formatAmount(maxAmount)}`)

    const existing = repo.getPactByIdempotency(agent.id, input.idempotencyKey)
    if (existing) {
      if (existing.service_id !== service.id || existing.request_digest !== requestDigest)
        throw new PactError('idempotency_conflict', 'idempotency key already used for a different request', 409)
      return { pact: existing, created: false }
    }
    if (input.retryOf && !repo.getPact(input.retryOf)) throw new PactError('unknown_retry', 'retryOf pact not found', 404)

    const now = Date.now()
    const pact: PactRow = {
      id: newId('pact'),
      agent_id: agent.id,
      service_id: service.id,
      policy_id: service.policy_id,
      policy_version: service.policy_version,
      request: requestJson,
      request_digest: requestDigest,
      price: price.toString(),
      max_amount: maxAmount.toString(),
      rail: this.d.rail.info.kind,
      state: 'CREATED',
      outcome: null,
      challenge_id: null,
      channel_id: null,
      deadline_at: now + this.authWindow,
      idempotency_key: input.idempotencyKey,
      retry_of: input.retryOf ?? null,
      scenario: input.scenario ?? null,
      origin: input.origin ?? 'api',
      created_at: now,
      updated_at: now,
      authorized_at: null,
      completed_at: null,
    }
    try {
      repo.insertPact(pact)
    } catch (error) {
      if (isUniqueViolation(error)) return this.createPact(input)
      throw error
    }
    bus.record(pact.id, 'pact.created', 'agent', {
      service: service.id,
      provider: service.provider_name,
      price: formatAmount(price),
      maxAmount: formatAmount(maxAmount),
      requestDigest,
      retryOf: pact.retry_of,
    })
    return { pact, created: true }
  }

  // ───────────────────────────── PAY ─────────────────────────────

  challenge(pactId: string) {
    const pact = this.must(pactId)
    if (pact.state !== 'CREATED') throw new PactError('not_payable', `pact is ${pact.state}; no payment is required`, 409)
    if (pact.deadline_at < Date.now()) throw new PactError('expired', 'pact expired before authorization', 410)
    const service = this.d.repo.getService(pact.service_id)!
    const info = this.d.rail.info
    const request: SessionChallengeRequest = {
      amount: pact.price,
      currency: info.token,
      recipient: service.provider_address,
      unitType: 'request',
      methodDetails: {
        chainId: info.chainId,
        escrowContract: info.escrow,
        operator: info.operator,
        rail: info.kind,
        pact: pact.id,
      },
    }
    const challenge = issueChallenge({
      secretKey: this.d.secretKey,
      realm: this.d.realm,
      pactId: pact.id,
      request,
      expiresAt: new Date(Math.min(pact.deadline_at, Date.now() + 5 * 60_000)),
      description: `${service.name} · ${service.provider_name} · verified by ${pact.policy_id}@${pact.policy_version}`,
    })
    this.d.repo.db
      .prepare('UPDATE pacts SET challenge_id = ?, updated_at = ? WHERE id = ? AND state = ?')
      .run(challenge.id, Date.now(), pact.id, 'CREATED')
    this.d.repo.addPaymentEvent({ pact_id: pact.id, kind: 'challenge_issued', amount: pact.price, tx_hash: null, detail: challenge.id })
    this.d.bus.record(pact.id, 'payment.challenge_issued', 'pact', {
      challengeId: challenge.id,
      amount: formatAmount(BigInt(pact.price)),
      recipient: service.provider_address,
      operator: info.operator,
    })
    return challenge
  }

  /**
   * Accepts an MPP credential whose payload proves an escrowed TIP-1034 channel
   * bound to this pact plus a voucher for the price. Never trusts client claims:
   * the channel is read from the rail and the voucher signature is verified.
   */
  async authorize(pactId: string, authorizationHeader: string | null | undefined) {
    const { repo, bus, rail } = this.d
    const pact = this.must(pactId)

    if (pact.state !== 'CREATED') {
      const existing = repo.getAuthorization(pact.id)
      if (pact.state === 'EXPIRED' && !existing) return this.lateAuthorizationRefund(pact, authorizationHeader)
      if (existing) {
        const parsed = this.tryParse(pact, authorizationHeader)
        if (parsed && parsed.payload.channelId.toLowerCase() === existing.channel_id)
          return { pact: repo.getPact(pact.id)!, channelId: existing.channel_id, replay: true }
      }
      throw new PactError('already_authorized', `pact is ${pact.state}`, 409)
    }
    if (pact.deadline_at < Date.now()) throw new PactError('expired', 'pact expired before authorization', 410)

    const service = repo.getService(pact.service_id)!
    const agent = repo.getAgent(pact.agent_id)!
    const reject = (code: string, message: string, status = 402): never => {
      repo.addPaymentEvent({ pact_id: pact.id, kind: 'authorization_rejected', amount: null, tx_hash: null, detail: code })
      repo.addFailure({ pact_id: pact.id, stage: 'authorize', code, message })
      bus.record(pact.id, 'payment.authorization_rejected', 'pact', { code, message })
      throw new PaymentError(code, message, status)
    }

    let parsed: ReturnType<typeof parseCredential>
    try {
      parsed = parseCredential(authorizationHeader, {
        secretKey: this.d.secretKey,
        pactId: pact.id,
        expectedChallengeId: pact.challenge_id,
        now: Date.now(),
      })
    } catch (error) {
      if (error instanceof PaymentError) return reject(error.code, error.message, error.status)
      throw error
    }

    const { payload, challengeId, challengeRequest } = parsed
    const d = payload.descriptor
    if (
      challengeRequest.amount !== pact.price ||
      !isAddressEqual(challengeRequest.recipient as Address, service.provider_address as Address)
    )
      reject('challenge_terms_mismatch', 'challenge terms do not match the pact')
    if (d.salt.toLowerCase() !== pactSalt(pact.id).toLowerCase()) reject('channel_not_bound', 'channel salt does not commit to this pact')
    if (!isAddressEqual(d.payer, agent.address as Address)) reject('wrong_payer', 'channel payer is not the registered agent')
    const voucherAmount = BigInt(payload.voucher.cumulativeAmount)
    if (voucherAmount !== BigInt(pact.price)) reject('voucher_amount', 'voucher must authorize exactly the pact price')

    let facts: { deposit: bigint; payer: Address }
    try {
      facts = await rail.verifyChannel({
        descriptor: d,
        channelId: payload.channelId,
        expectedPayee: service.provider_address as Address,
        minDeposit: BigInt(pact.price),
      })
    } catch (error) {
      if (error instanceof RailError) return reject(error.code, error.message, error.retryable ? 503 : 402)
      throw error
    }
    if (facts.deposit > BigInt(pact.max_amount)) reject('deposit_exceeds_max', 'escrowed deposit exceeds the pact maxAmount')
    const signer = isAddressEqual(d.authorizedSigner, ZERO) ? d.payer : d.authorizedSigner
    if (!rail.verifyVoucher({ channelId: payload.channelId, amount: voucherAmount, signature: payload.voucher.signature, signer }))
      reject('invalid_voucher', 'voucher signature does not recover to the channel signer')

    const now = Date.now()
    const channelId = payload.channelId.toLowerCase()
    const accepted = transaction(repo.db, () => {
      if (repo.getPact(pact.id)!.state !== 'CREATED') return false
      try {
        repo.insertAuthorization({
          pact_id: pact.id,
          channel_id: channelId,
          descriptor: JSON.stringify(d),
          payer: d.payer,
          deposit: facts.deposit.toString(),
          voucher_amount: voucherAmount.toString(),
          voucher_sig: payload.voucher.signature,
          open_tx_hash: payload.txHash,
          challenge_id: challengeId,
          created_at: now,
        })
      } catch (error) {
        if (isUniqueViolation(error)) throw new PaymentError('channel_reused', 'this channel already authorizes another pact', 409)
        throw error
      }
      repo.casState(pact.id, 'CREATED', 'AUTHORIZED', { channel_id: channelId, authorized_at: now })
      repo.addPaymentEvent({
        pact_id: pact.id,
        kind: 'authorized',
        amount: facts.deposit.toString(),
        tx_hash: payload.txHash,
        detail: channelId,
      })
      return true
    })
    if (!accepted) {
      const existing = repo.getAuthorization(pact.id)
      if (existing?.channel_id === channelId) return { pact: repo.getPact(pact.id)!, channelId, replay: true }
      throw new PactError('already_authorized', 'pact was authorized concurrently', 409)
    }

    bus.record(pact.id, 'payment.authorized', 'agent', {
      channelId,
      deposit: formatAmount(facts.deposit),
      voucher: formatAmount(voucherAmount),
      openTx: payload.txHash,
      openTxUrl: rail.txUrl(payload.txHash),
    })
    this.background('dispatch', pact.id, () => this.dispatch(pact.id))
    return { pact: repo.getPact(pact.id)!, channelId, replay: false }
  }

  private tryParse(pact: PactRow, authorizationHeader: string | null | undefined) {
    try {
      return parseCredential(authorizationHeader, {
        secretKey: this.d.secretKey,
        pactId: pact.id,
        expectedChallengeId: null,
        now: 0,
      })
    } catch {
      return null
    }
  }

  /** A channel that arrives after the pact expired is closed immediately with a zero capture. */
  private async lateAuthorizationRefund(pact: PactRow, authorizationHeader: string | null | undefined): Promise<never> {
    const parsed = this.tryParse(pact, authorizationHeader)
    if (parsed && parsed.payload.descriptor.salt.toLowerCase() === pactSalt(pact.id).toLowerCase()) {
      const { payload } = parsed
      const service = this.d.repo.getService(pact.service_id)!
      try {
        await this.d.rail.verifyChannel({
          descriptor: payload.descriptor,
          channelId: payload.channelId,
          expectedPayee: service.provider_address as Address,
          minDeposit: 0n,
        })
        const closed = await this.d.rail.close({
          descriptor: payload.descriptor,
          channelId: payload.channelId,
          voucherAmount: BigInt(payload.voucher.cumulativeAmount),
          signature: payload.voucher.signature,
          captureAmount: 0n,
          openTxHash: payload.txHash,
        })
        this.d.bus.record(pact.id, 'payment.late_authorization_refunded', 'pact', {
          channelId: payload.channelId,
          refunded: formatAmount(closed.refundedToPayer),
          txHash: closed.txHash,
          txUrl: this.d.rail.txUrl(closed.txHash),
        })
        throw new PactError('expired', 'pact expired before authorization; the escrowed deposit was refunded', 410)
      } catch (error) {
        if (error instanceof PactError) throw error
        this.d.bus.record(pact.id, 'payment.late_authorization_rejected', 'pact', { message: errorMessage(error) })
      }
    }
    throw new PactError('expired', 'pact expired before authorization', 410)
  }

  // ───────────────────────────── PROVE ─────────────────────────────

  private async dispatch(pactId: string) {
    const { repo, bus } = this.d
    const pact = this.must(pactId)
    const service = repo.getService(pact.service_id)!
    const policy = this.policyFor(pact)
    const transportTimeout = service.mode === 'sync' ? policy.maxLatencyMs + 2_000 : 15_000
    const dispatchedAt = Date.now()
    const workDeadline = dispatchedAt + (service.mode === 'sync' ? transportTimeout + 1_000 : policy.maxLatencyMs)

    const moved = transaction(repo.db, () => {
      if (!repo.casState(pact.id, 'AUTHORIZED', 'EXECUTING', { deadline_at: workDeadline })) return false
      repo.insertWorkItem({ id: newId('work'), pact_id: pact.id, status: 'dispatched', dispatched_at: dispatchedAt })
      return true
    })
    if (!moved) return

    bus.record(pact.id, 'work.dispatched', 'pact', {
      endpoint: service.endpoint,
      provider: service.provider_name,
      mode: service.mode,
      deadline: new Date(workDeadline).toISOString(),
    })

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), transportTimeout)
    let res: Response
    try {
      res = await this.d.fetchProvider(service.endpoint, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          'x-pact-id': pact.id,
          'x-pact-request-digest': pact.request_digest,
          'x-pact-deadline': new Date(workDeadline).toISOString(),
          ...(service.mode === 'async' ? { 'x-pact-callback': `${this.d.publicUrl}/v1/pacts/${pact.id}/deliver` } : {}),
        },
        body: JSON.stringify({ pactId: pact.id, request: JSON.parse(pact.request) }),
      })
    } catch (error) {
      clearTimeout(timer)
      const kind = controller.signal.aborted ? 'timeout' : 'network'
      if (repo.markWorkFailed(pact.id, kind)) {
        bus.record(pact.id, kind === 'timeout' ? 'work.timeout' : 'work.network_error', 'provider', {
          afterMs: Date.now() - dispatchedAt,
          message: errorMessage(error),
        })
        await this.verify(pact.id)
      }
      return
    }

    if (service.mode === 'async' && res.status === 202) {
      clearTimeout(timer)
      const body = (await res.json().catch(() => ({}))) as { jobId?: unknown }
      const jobId = typeof body.jobId === 'string' ? body.jobId.slice(0, 128) : 'unknown'
      repo.markWorkAccepted(pact.id, jobId)
      bus.record(pact.id, 'work.accepted', 'provider', { jobId, callback: `/v1/pacts/${pact.id}/deliver` })
      return
    }

    let text = ''
    try {
      text = await readLimited(res, MAX_BODY_BYTES)
    } catch (error) {
      if (controller.signal.aborted) {
        clearTimeout(timer)
        if (repo.markWorkFailed(pact.id, 'timeout')) {
          bus.record(pact.id, 'work.timeout', 'provider', { afterMs: Date.now() - dispatchedAt, message: errorMessage(error) })
          await this.verify(pact.id)
        }
        return
      }
    } finally {
      clearTimeout(timer)
    }
    await this.acceptDelivery(pact.id, { headers: res.headers, status: res.status, bodyText: text, receivedAt: Date.now(), via: 'response' })
  }

  /**
   * Async provider callback. The provider must sign (pact, request, result);
   * unsigned or forged callbacks are rejected without touching pact state, so a
   * third party cannot force a refund.
   */
  async deliverCallback(pactId: string, p: { headers: Headers; bodyText: string }) {
    const { repo, bus } = this.d
    const pact = this.must(pactId)
    const service = repo.getService(pact.service_id)!
    const claimed = header(p.headers, 'x-pact-result-digest')
    const signature = header(p.headers, 'x-pact-signature')
    const actual = digest(p.bodyText)
    const authentic =
      !!signature &&
      claimed === actual &&
      (await verifyMessage({
        address: service.provider_address as Hex,
        message: providerMessage(pact.id, pact.request_digest, actual),
        signature: signature as Hex,
      }).catch(() => false))
    if (!authentic) {
      bus.record(pact.id, 'work.callback_rejected', 'unknown', { reason: 'signature does not authenticate the provider' })
      throw new PactError('unauthenticated_callback', 'callback must be signed by the service provider', 401)
    }

    const work = repo.getWorkItem(pact.id)
    if (work?.status === 'delivered') {
      repo.incrementDuplicate(pact.id)
      bus.record(pact.id, 'work.duplicate_delivery', 'provider', { sameResult: work.result_digest === actual, via: 'callback' })
      return { duplicate: true, state: repo.getPact(pact.id)!.state }
    }
    if (pact.state !== 'EXECUTING' || !work) throw new PactError('not_executing', `pact is ${pact.state}; delivery not accepted`, 409)

    await this.acceptDelivery(pact.id, { headers: p.headers, status: 200, bodyText: p.bodyText, receivedAt: Date.now(), via: 'callback' })
    return { duplicate: false, state: repo.getPact(pact.id)!.state }
  }

  private async acceptDelivery(
    pactId: string,
    p: { headers: Headers; status: number; bodyText: string; receivedAt: number; via: 'response' | 'callback' },
  ) {
    const { repo, bus } = this.d
    const work = repo.getWorkItem(pactId)!
    const recorded = repo.recordDelivery(pactId, {
      delivered_at: p.receivedAt,
      http_status: p.status,
      content_type: header(p.headers, 'content-type'),
      body_text: p.bodyText,
      latency_ms: p.receivedAt - work.dispatched_at,
      echoed_pact_id: header(p.headers, 'x-pact-id'),
      echoed_request_digest: header(p.headers, 'x-pact-request-digest'),
      claimed_result_digest: header(p.headers, 'x-pact-result-digest'),
      signature: header(p.headers, 'x-pact-signature'),
      result_digest: p.bodyText.length ? digest(p.bodyText) : null,
    })
    if (!recorded) {
      repo.incrementDuplicate(pactId)
      bus.record(pactId, 'work.duplicate_delivery', 'provider', { via: p.via })
      return
    }
    bus.record(pactId, 'work.delivered', 'provider', {
      via: p.via,
      httpStatus: p.status,
      bytes: p.bodyText.length,
      latencyMs: p.receivedAt - work.dispatched_at,
    })
    await this.verify(pactId)
  }

  async verify(pactId: string): Promise<VerificationResult | null> {
    const { repo, bus } = this.d
    const pact = this.must(pactId)
    if (pact.state === 'EXECUTING') {
      if (!repo.casState(pact.id, 'EXECUTING', 'VERIFYING')) return null
    } else if (pact.state !== 'VERIFYING') return null

    const service = repo.getService(pact.service_id)!
    const policy = this.policyFor(pact)
    const work = repo.getWorkItem(pact.id)!
    const existing = repo.getVerification(pact.id)
    let result: VerificationResult
    if (existing) {
      result = {
        verdict: existing.verdict as VerificationResult['verdict'],
        checks: JSON.parse(existing.checks),
        reasons: JSON.parse(existing.reasons),
        resultDigest: existing.result_digest as VerificationResult['resultDigest'],
        itemCount: existing.item_count,
      }
    } else {
      const delivery: Delivery = {
        transportError: work.transport_error,
        httpStatus: work.http_status,
        contentType: work.content_type,
        bodyText: work.body_text,
        latencyMs: work.latency_ms ?? (work.delivered_at ?? Date.now()) - work.dispatched_at,
        receivedAt: work.delivered_at ?? Date.now(),
        echoedPactId: work.echoed_pact_id,
        echoedRequestDigest: work.echoed_request_digest,
        claimedResultDigest: work.claimed_result_digest,
        signature: work.signature,
      }
      result = await verifyDelivery(policy, delivery, {
        pactId: pact.id,
        request: JSON.parse(pact.request) as Record<string, unknown>,
        requestDigest: pact.request_digest,
        deadlineAt: work.dispatched_at + policy.maxLatencyMs,
        providerAddress: service.provider_address,
        priorResults: work.result_digest ? repo.priorResults(work.result_digest, pact.id, service.provider_address) : [],
        checkSignature: ({ message, signature, address }) =>
          verifyMessage({ address: address as Hex, message, signature: signature as Hex }),
      })
      try {
        repo.insertVerification({
          id: newId('ver'),
          pact_id: pact.id,
          policy_id: policy.id,
          policy_version: policy.version,
          verdict: result.verdict,
          checks: JSON.stringify(result.checks),
          reasons: JSON.stringify(result.reasons),
          result_digest: result.resultDigest,
          item_count: result.itemCount,
          semantic: null,
          created_at: Date.now(),
        })
      } catch (error) {
        if (!isUniqueViolation(error)) throw error
      }
    }

    const to: PactState = result.verdict === 'PASS' ? 'VERIFIED' : 'REJECTED'
    if (!repo.casState(pact.id, 'VERIFYING', to, { outcome: result.verdict === 'PASS' ? 'pass' : 'fail' })) return result
    bus.record(pact.id, 'verification.completed', 'verifier', {
      verdict: result.verdict,
      reasons: result.reasons,
      passed: result.checks.filter((c) => c.status === 'pass').length,
      failed: result.checks.filter((c) => c.status === 'fail').length,
      policy: `${policy.id}@${policy.version}`,
    })
    await this.settle(pact.id)
    return result
  }

  // ───────────────────────────── expiry ─────────────────────────────

  sweepExpired(now = Date.now()) {
    const { repo, bus } = this.d
    for (const pact of repo.pactsInStates(EXPIRABLE_STATES)) {
      if (pact.deadline_at > now) continue
      const from = pact.state
      if (!repo.casState(pact.id, from, 'EXPIRED', { outcome: 'expired' })) continue
      if (from === 'EXECUTING') repo.markWorkFailed(pact.id, 'timeout')
      const authorized = !!repo.getAuthorization(pact.id)
      if (authorized) {
        const v = expiredVerdict(this.policyFor(pact))
        try {
          repo.insertVerification({
            id: newId('ver'),
            pact_id: pact.id,
            policy_id: pact.policy_id,
            policy_version: pact.policy_version,
            verdict: v.verdict,
            checks: JSON.stringify(v.checks),
            reasons: JSON.stringify(v.reasons),
            result_digest: null,
            item_count: null,
            semantic: null,
            created_at: now,
          })
        } catch (error) {
          if (!isUniqueViolation(error)) throw error
        }
      } else {
        repo.db.prepare('UPDATE pacts SET completed_at = ? WHERE id = ?').run(now, pact.id)
      }
      bus.record(pact.id, 'pact.expired', 'pact', { from, fundsLocked: authorized })
      if (authorized) this.background('settle', pact.id, () => this.settle(pact.id))
    }
  }

  // ───────────────────────────── SETTLE ─────────────────────────────

  async settle(pactId: string): Promise<void> {
    const { repo, bus, rail } = this.d
    const pact = this.must(pactId)
    const auth = repo.getAuthorization(pact.id)
    if (!auth) return
    if (pact.state === 'SETTLED' || pact.state === 'PROTECTED') return

    if (pact.state === 'VERIFIED' || pact.state === 'REJECTED' || pact.state === 'EXPIRED') {
      const from = pact.state
      const capture = from === 'VERIFIED' ? BigInt(auth.voucher_amount) : 0n
      const moved = transaction(repo.db, () => {
        if (!repo.getSettlement(pact.id))
          repo.insertSettlement({
            id: newId('stl'),
            pact_id: pact.id,
            kind: capture > 0n ? 'capture' : 'refund',
            capture_amount: capture.toString(),
            status: 'pending',
            created_at: Date.now(),
          })
        return repo.casState(pact.id, from, 'SETTLING')
      })
      if (!moved) return
      bus.record(pact.id, 'settlement.started', 'pact', {
        kind: capture > 0n ? 'capture' : 'refund',
        capture: formatAmount(capture),
        refund: formatAmount(BigInt(auth.deposit) - capture),
      })
    } else if (pact.state !== 'SETTLING') return

    const settlement = repo.getSettlement(pact.id)!
    if (settlement.status === 'confirmed') return this.finish(pact.id)
    const captureAmount = BigInt(settlement.capture_amount)
    repo.bumpSettlementAttempt(pact.id)

    let result: CloseResult
    try {
      result = await rail.close({
        descriptor: JSON.parse(auth.descriptor),
        channelId: auth.channel_id as Hex,
        voucherAmount: BigInt(auth.voucher_amount),
        signature: auth.voucher_sig as Hex,
        captureAmount,
        openTxHash: auth.open_tx_hash,
      })
    } catch (error) {
      const found = await rail.findClose({ channelId: auth.channel_id as Hex, openTxHash: auth.open_tx_hash }).catch(() => null)
      if (!found) {
        const message = errorMessage(error)
        repo.failSettlementAttempt(pact.id, message)
        repo.addFailure({ pact_id: pact.id, stage: 'settle', code: (error as RailError).code ?? 'close_failed', message })
        const attempt = repo.getSettlement(pact.id)!.attempts
        const delay = this.retryDelays[attempt - 1]
        bus.record(pact.id, 'settlement.retry_scheduled', 'pact', { attempt, message, retryInMs: delay ?? null })
        if (delay !== undefined) this.scheduleSettleRetry(pact.id, delay)
        return
      }
      result = found
    }

    if (result.settledToPayee !== captureAmount)
      repo.addFailure({
        pact_id: pact.id,
        stage: 'settle',
        code: 'capture_mismatch',
        message: `on-chain capture ${result.settledToPayee} differs from intended ${captureAmount}`,
      })
    transaction(repo.db, () => {
      repo.confirmSettlement(pact.id, result.txHash, result.refundedToPayer.toString())
      if (result.settledToPayee > 0n)
        repo.addPaymentEvent({ pact_id: pact.id, kind: 'captured', amount: result.settledToPayee.toString(), tx_hash: result.txHash, detail: null })
      if (result.refundedToPayer > 0n)
        repo.addPaymentEvent({ pact_id: pact.id, kind: 'refunded', amount: result.refundedToPayer.toString(), tx_hash: result.txHash, detail: null })
    })
    bus.record(pact.id, 'settlement.confirmed', 'rail', {
      captured: formatAmount(result.settledToPayee),
      refunded: formatAmount(result.refundedToPayer),
      txHash: result.txHash,
      txUrl: rail.txUrl(result.txHash),
    })
    await this.finish(pact.id)
  }

  private async finish(pactId: string) {
    const { repo, bus } = this.d
    const settlement = repo.getSettlement(pactId)!
    const to: PactState = BigInt(settlement.capture_amount) > 0n ? 'SETTLED' : 'PROTECTED'
    repo.casState(pactId, 'SETTLING', to, { completed_at: Date.now() })
    if (repo.getReceiptByPact(pactId)) return
    const receipt = await issueReceipt(repo, this.d.rail, this.d.signer, pactId)
    bus.record(pactId, 'receipt.issued', 'pact', { receiptId: receipt.receiptId, state: to })
  }

  private scheduleSettleRetry(pactId: string, delay: number) {
    if (this.retryTimers.has(pactId)) return
    const t = setTimeout(() => {
      this.retryTimers.delete(pactId)
      this.background('settle', pactId, () => this.settle(pactId))
    }, delay)
    t.unref()
    this.retryTimers.set(pactId, t)
  }

  /** Operator retry for a pact stuck in SETTLING (e.g. after an RPC outage). */
  retrySettlement(pactId: string) {
    const pact = this.must(pactId)
    if (pact.state !== 'SETTLING') throw new PactError('not_settling', `pact is ${pact.state}`, 409)
    this.background('settle', pact.id, () => this.settle(pact.id))
  }

  /** Resumes every non-terminal pact after a restart. Safe to call repeatedly. */
  recover() {
    const { repo } = this.d
    for (const pact of repo.pactsInStates(['AUTHORIZED', 'VERIFYING', 'VERIFIED', 'REJECTED', 'SETTLING', 'EXPIRED'])) {
      if (pact.state === 'AUTHORIZED') this.background('dispatch', pact.id, () => this.dispatch(pact.id))
      else if (pact.state === 'VERIFYING') this.background('verify', pact.id, () => this.verify(pact.id))
      else if (pact.state === 'EXPIRED') {
        if (repo.getAuthorization(pact.id)) this.background('settle', pact.id, () => this.settle(pact.id))
      } else this.background('settle', pact.id, () => this.settle(pact.id))
    }
    for (const pact of repo.pactsInStates(['EXECUTING'])) {
      const work = repo.getWorkItem(pact.id)
      if (work?.status === 'delivered' || work?.status === 'failed') this.background('verify', pact.id, () => this.verify(pact.id))
    }
  }
}

async function readLimited(res: Response, limit: number): Promise<string> {
  const reader = res.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      await reader.cancel()
      break
    }
    chunks.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}
