/**
 * PactGateway — a wallet-less client for a PACT gateway's public API.
 * Used by PactClient (agents), the MCP server and dashboards. Holds no keys.
 */
import type { WorkReceipt } from '@pact/receipts'

import { challengeFromResponse, Headers } from './mpp.js'

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>
export type PactChallenge = ReturnType<typeof challengeFromResponse>

export class PactClientError extends Error {
  override readonly name = 'PactClientError'
  constructor(
    readonly code: string,
    message: string,
    readonly pactId?: string,
  ) {
    super(message)
  }
}

export type PactState =
  | 'CREATED'
  | 'AUTHORIZED'
  | 'EXECUTING'
  | 'VERIFYING'
  | 'VERIFIED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'SETTLING'
  | 'SETTLED'
  | 'PROTECTED'

export type PactSummary = {
  id: string
  state: PactState
  price: string
  maxAmount: string
  authorized: string | null
}

export type ServiceInfo = {
  id: string
  name: string
  description: string
  provider: string
  providerAddress: string
  mode: 'sync' | 'async'
  price: string
  policy: string
  capability: string
  inputSchema: Record<string, unknown>
}

export type PactResult<T = unknown> = {
  pactId: string
  state: PactState
  /** True only when the work passed verification and the price was captured. */
  verified: boolean
  verdict: 'PASS' | 'FAIL' | 'EXPIRED' | null
  reasons: string[]
  /** The provider's delivered result, parsed as JSON when possible. */
  data: T | null
  settlement: { captured: string; refunded: string; txHash: string | null; txUrl: string | null } | null
  receipt: WorkReceipt | null
}

export type CreatePactParams = {
  agentId: string
  service: string
  input: Record<string, unknown>
  maxAmount: string
  idempotencyKey?: string | undefined
  retryOf?: string | undefined
  scenario?: string | undefined
  origin?: string | undefined
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
export const isSettled = (p: PactSummary) =>
  p.state === 'SETTLED' || p.state === 'PROTECTED' || (p.state === 'EXPIRED' && !p.authorized)

export class PactGateway {
  readonly base: string
  private readonly http: FetchLike

  constructor(url: string, fetchImpl?: FetchLike) {
    this.base = url.replace(/\/$/, '')
    this.http = fetchImpl ?? ((u, init) => fetch(u, init))
  }

  private async call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.http(`${this.base}${path}`, init)
    const body = (await res.json().catch(() => ({}))) as T & { error?: { code: string; message: string } }
    if (!res.ok) throw new PactClientError(body.error?.code ?? `http_${res.status}`, body.error?.message ?? `HTTP ${res.status}`)
    return body
  }

  async services(): Promise<ServiceInfo[]> {
    return (await this.call<{ services: ServiceInfo[] }>('/v1/services')).services
  }

  async operator(): Promise<string> {
    return (await this.call<{ operator: string }>('/v1/rail')).operator
  }

  /** Registers a request and its budget. Idempotent per key. */
  async create(p: CreatePactParams): Promise<PactSummary> {
    const { pact } = await this.call<{ pact: PactSummary }>('/v1/pacts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': p.idempotencyKey ?? crypto.randomUUID() },
      body: JSON.stringify({
        agentId: p.agentId,
        serviceId: p.service,
        request: p.input,
        maxAmount: p.maxAmount,
        retryOf: p.retryOf,
        scenario: p.scenario,
        origin: p.origin,
      }),
    })
    return pact
  }

  /** Requests the MPP 402 session challenge for a pact. */
  async challenge(pactId: string): Promise<PactChallenge> {
    const res = await this.http(`${this.base}/v1/pacts/${pactId}/authorize`, { method: 'POST' })
    if (res.status !== 402) {
      const body = (await res.json().catch(() => ({}))) as { error?: { code: string; message: string } }
      throw new PactClientError(body.error?.code ?? 'no_challenge', body.error?.message ?? `expected 402, got ${res.status}`, pactId)
    }
    return challengeFromResponse(res)
  }

  /** Submits an `Authorization: Payment …` credential. Returns the Payment-Receipt header. */
  async submit(pactId: string, authorizationHeader: string): Promise<{ paymentReceipt: string | null }> {
    const res = await this.http(`${this.base}/v1/pacts/${pactId}/authorize`, {
      method: 'POST',
      headers: { [Headers.authorization]: authorizationHeader },
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { code: string; message: string } }
      throw new PactClientError(body.error?.code ?? 'authorization_failed', body.error?.message ?? `HTTP ${res.status}`, pactId)
    }
    return { paymentReceipt: res.headers.get(Headers.paymentReceipt) }
  }

  async get(pactId: string): Promise<PactSummary> {
    return (await this.call<{ pact: PactSummary }>(`/v1/pacts/${pactId}`)).pact
  }

  /** Waits for PROVE and SETTLE to finish and returns the verified outcome. */
  async wait<T = unknown>(pactId: string, o: { timeoutMs?: number | undefined; intervalMs?: number } = {}): Promise<PactResult<T>> {
    const deadline = Date.now() + (o.timeoutMs ?? 120_000)
    for (;;) {
      const pact = await this.get(pactId)
      if (isSettled(pact)) break
      if (Date.now() > deadline) throw new PactClientError('timeout', `pact still ${pact.state}`, pactId)
      await sleep(o.intervalMs ?? 400)
    }
    return this.outcome<T>(pactId)
  }

  async outcome<T = unknown>(pactId: string): Promise<PactResult<T>> {
    const r = await this.call<{
      state: PactState
      verdict: PactResult['verdict']
      reasons: string[]
      body: string | null
      settlement: PactResult['settlement']
      receipt: WorkReceipt | null
    }>(`/v1/pacts/${pactId}/result`)
    let data: T | null = null
    if (r.body) {
      try {
        data = JSON.parse(r.body) as T
      } catch {
        data = r.body as unknown as T
      }
    }
    return {
      pactId,
      state: r.state,
      verified: r.state === 'SETTLED' && r.verdict === 'PASS',
      verdict: r.verdict,
      reasons: r.reasons,
      data,
      settlement: r.settlement,
      receipt: r.receipt,
    }
  }
}
