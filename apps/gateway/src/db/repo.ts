import { randomBytes } from 'node:crypto'

import type { PactState } from '@pact/core'
import type { VerificationPolicy } from '@pact/verifier'
import { policyDigest } from '@pact/verifier'
import type { Db } from './index.js'

export const newId = (prefix: string) => `${prefix}_${randomBytes(10).toString('hex')}`

type Row = Record<string, unknown>

export type AgentRow = { id: string; name: string; address: string; budget: string; created_at: number }

export type ServiceRow = {
  id: string
  name: string
  description: string
  provider_name: string
  provider_address: string
  endpoint: string
  mode: 'sync' | 'async'
  price: string
  policy_id: string
  policy_version: number
  capability: string
  /** JSON Schema for the request input (used by API clients and MCP tool listings). */
  input_schema: string
  created_at: number
}

export type PactRow = {
  id: string
  agent_id: string
  service_id: string
  policy_id: string
  policy_version: number
  request: string
  request_digest: string
  price: string
  max_amount: string
  rail: 'tempo' | 'local'
  state: PactState
  outcome: 'pass' | 'fail' | 'expired' | null
  challenge_id: string | null
  channel_id: string | null
  deadline_at: number
  idempotency_key: string
  retry_of: string | null
  scenario: string | null
  origin: string
  created_at: number
  updated_at: number
  authorized_at: number | null
  completed_at: number | null
}

export type AuthorizationRow = {
  pact_id: string
  channel_id: string
  descriptor: string
  payer: string
  deposit: string
  voucher_amount: string
  voucher_sig: string
  open_tx_hash: string | null
  challenge_id: string
  created_at: number
}

export type WorkItemRow = {
  id: string
  pact_id: string
  status: 'dispatched' | 'accepted' | 'delivered' | 'failed'
  provider_job_id: string | null
  dispatched_at: number
  delivered_at: number | null
  http_status: number | null
  content_type: string | null
  body_text: string | null
  latency_ms: number | null
  transport_error: 'timeout' | 'network' | null
  echoed_pact_id: string | null
  echoed_request_digest: string | null
  claimed_result_digest: string | null
  signature: string | null
  result_digest: string | null
  duplicate_deliveries: number
}

export type VerificationRow = {
  id: string
  pact_id: string
  policy_id: string
  policy_version: number
  verdict: string
  checks: string
  reasons: string
  result_digest: string | null
  item_count: number | null
  semantic: string | null
  created_at: number
}

export type SettlementRow = {
  id: string
  pact_id: string
  kind: 'capture' | 'refund'
  capture_amount: string
  refund_amount: string | null
  status: 'pending' | 'confirmed' | 'failed'
  tx_hash: string | null
  attempts: number
  last_error: string | null
  created_at: number
  confirmed_at: number | null
}

export type ReceiptRow = {
  id: string
  pact_id: string
  body: string
  receipt_digest: string
  signature: string
  created_at: number
}

export type AuditRow = {
  seq: number
  pact_id: string | null
  type: string
  actor: string
  data: string
  created_at: number
}

export type PaymentEventRow = {
  id: string
  pact_id: string
  kind: string
  amount: string | null
  tx_hash: string | null
  detail: string | null
  created_at: number
}

export type FailureRow = { id: string; pact_id: string | null; stage: string; code: string; message: string; created_at: number }

function insert(db: Db, table: string, values: Row) {
  const keys = Object.keys(values)
  db.prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(
    ...(keys.map((k) => values[k] ?? null) as never[]),
  )
}

const one = <T>(db: Db, sql: string, ...params: unknown[]) =>
  (db.prepare(sql).get(...(params as never[])) as T | undefined) ?? null
const many = <T>(db: Db, sql: string, ...params: unknown[]) => db.prepare(sql).all(...(params as never[])) as T[]

export class Repo {
  constructor(readonly db: Db) {}

  // settings
  getSetting(key: string): string | null {
    return one<{ value: string }>(this.db, 'SELECT value FROM settings WHERE key = ?', key)?.value ?? null
  }
  setSetting(key: string, value: string) {
    this.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value)
  }

  // agents
  upsertAgent(a: Omit<AgentRow, 'created_at'>) {
    this.db
      .prepare(
        `INSERT INTO agents (id, name, address, budget, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, address = excluded.address, budget = excluded.budget`,
      )
      .run(a.id, a.name, a.address, a.budget, Date.now())
  }
  getAgent(id: string) {
    return one<AgentRow>(this.db, 'SELECT * FROM agents WHERE id = ?', id)
  }
  listAgents() {
    return many<AgentRow>(this.db, 'SELECT * FROM agents ORDER BY created_at')
  }

  // policies
  upsertPolicy(p: VerificationPolicy) {
    this.db
      .prepare(
        `INSERT INTO verification_policies (id, version, name, definition, digest, created_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id, version) DO NOTHING`,
      )
      .run(p.id, p.version, p.name, JSON.stringify(p), policyDigest(p), Date.now())
  }
  getPolicy(id: string, version: number): (VerificationPolicy & { digest: string }) | null {
    const row = one<{ definition: string; digest: string }>(
      this.db,
      'SELECT definition, digest FROM verification_policies WHERE id = ? AND version = ?',
      id,
      version,
    )
    return row ? { ...(JSON.parse(row.definition) as VerificationPolicy), digest: row.digest } : null
  }
  listPolicies() {
    return many<{ definition: string; digest: string }>(
      this.db,
      'SELECT definition, digest FROM verification_policies ORDER BY id, version',
    ).map((r) => ({ ...(JSON.parse(r.definition) as VerificationPolicy), digest: r.digest }))
  }

  // services
  upsertService(s: Omit<ServiceRow, 'created_at'>) {
    this.db
      .prepare(
        `INSERT INTO services (id, name, description, provider_name, provider_address, endpoint, mode, price, policy_id, policy_version, capability, input_schema, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description,
           provider_name = excluded.provider_name, provider_address = excluded.provider_address,
           endpoint = excluded.endpoint, mode = excluded.mode, price = excluded.price,
           policy_id = excluded.policy_id, policy_version = excluded.policy_version, capability = excluded.capability,
           input_schema = excluded.input_schema`,
      )
      .run(
        s.id,
        s.name,
        s.description,
        s.provider_name,
        s.provider_address,
        s.endpoint,
        s.mode,
        s.price,
        s.policy_id,
        s.policy_version,
        s.capability,
        s.input_schema,
        Date.now(),
      )
  }
  getService(id: string) {
    return one<ServiceRow>(this.db, 'SELECT * FROM services WHERE id = ?', id)
  }
  listServices() {
    return many<ServiceRow>(this.db, 'SELECT * FROM services ORDER BY created_at, id')
  }

  // pacts
  insertPact(p: PactRow) {
    insert(this.db, 'pacts', p)
  }
  getPact(id: string) {
    return one<PactRow>(this.db, 'SELECT * FROM pacts WHERE id = ?', id)
  }
  getPactByIdempotency(agentId: string, key: string) {
    return one<PactRow>(this.db, 'SELECT * FROM pacts WHERE agent_id = ? AND idempotency_key = ?', agentId, key)
  }
  listPacts(opts: { limit?: number; before?: number; state?: string } = {}) {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200)
    const where: string[] = []
    const params: unknown[] = []
    if (opts.before) {
      where.push('created_at < ?')
      params.push(opts.before)
    }
    if (opts.state) {
      where.push('state = ?')
      params.push(opts.state)
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    return many<PactRow>(this.db, `SELECT * FROM pacts ${clause} ORDER BY created_at DESC LIMIT ${limit}`, ...params)
  }
  pactsInStates(states: readonly PactState[]) {
    return many<PactRow>(
      this.db,
      `SELECT * FROM pacts WHERE state IN (${states.map(() => '?').join(', ')}) ORDER BY created_at`,
      ...states,
    )
  }
  /** Compare-and-swap state transition. Returns false if another writer moved the pact first. */
  casState(id: string, from: PactState, to: PactState, patch: Partial<PactRow> = {}): boolean {
    const sets = ['state = ?', 'updated_at = ?', ...Object.keys(patch).map((k) => `${k} = ?`)]
    const values = [to, Date.now(), ...Object.values(patch).map((v) => v ?? null)]
    const res = this.db
      .prepare(`UPDATE pacts SET ${sets.join(', ')} WHERE id = ? AND state = ?`)
      .run(...(values as never[]), id, from)
    return Number(res.changes) === 1
  }

  // authorizations
  insertAuthorization(a: AuthorizationRow) {
    insert(this.db, 'authorizations', a)
  }
  getAuthorization(pactId: string) {
    return one<AuthorizationRow>(this.db, 'SELECT * FROM authorizations WHERE pact_id = ?', pactId)
  }

  // payment events
  addPaymentEvent(e: Omit<PaymentEventRow, 'id' | 'created_at'>) {
    insert(this.db, 'payment_events', { id: newId('pay'), created_at: Date.now(), ...e })
  }
  listPaymentEvents(pactId: string) {
    return many<PaymentEventRow>(this.db, 'SELECT * FROM payment_events WHERE pact_id = ? ORDER BY created_at', pactId)
  }

  // work items
  insertWorkItem(w: Pick<WorkItemRow, 'id' | 'pact_id' | 'status' | 'dispatched_at'>) {
    insert(this.db, 'work_items', w)
  }
  getWorkItem(pactId: string) {
    return one<WorkItemRow>(this.db, 'SELECT * FROM work_items WHERE pact_id = ?', pactId)
  }
  markWorkAccepted(pactId: string, jobId: string) {
    this.db
      .prepare(`UPDATE work_items SET status = 'accepted', provider_job_id = ? WHERE pact_id = ? AND status = 'dispatched'`)
      .run(jobId, pactId)
  }
  /** Records the first delivery only; returns false for duplicates. */
  recordDelivery(pactId: string, d: Partial<WorkItemRow>): boolean {
    const keys = Object.keys(d)
    const res = this.db
      .prepare(
        `UPDATE work_items SET status = 'delivered', ${keys.map((k) => `${k} = ?`).join(', ')}
         WHERE pact_id = ? AND status IN ('dispatched', 'accepted')`,
      )
      .run(...(Object.values(d).map((v) => v ?? null) as never[]), pactId)
    return Number(res.changes) === 1
  }
  markWorkFailed(pactId: string, error: 'timeout' | 'network') {
    const res = this.db
      .prepare(
        `UPDATE work_items SET status = 'failed', transport_error = ?, delivered_at = ?
         WHERE pact_id = ? AND status IN ('dispatched','accepted')`,
      )
      .run(error, Date.now(), pactId)
    return Number(res.changes) === 1
  }
  incrementDuplicate(pactId: string) {
    this.db.prepare('UPDATE work_items SET duplicate_deliveries = duplicate_deliveries + 1 WHERE pact_id = ?').run(pactId)
  }
  /**
   * Earlier deliveries of the same bytes by the same provider. Independent providers
   * returning identical public data is not a replay, so other providers are excluded.
   */
  priorResults(resultDigest: string, excludePactId: string, providerAddress: string) {
    return many<{ resultDigest: string; requestDigest: string }>(
      this.db,
      `SELECT w.result_digest AS resultDigest, p.request_digest AS requestDigest
       FROM work_items w
       JOIN pacts p ON p.id = w.pact_id
       JOIN services s ON s.id = p.service_id
       WHERE w.result_digest = ? AND w.pact_id <> ? AND lower(s.provider_address) = lower(?)`,
      resultDigest,
      excludePactId,
      providerAddress,
    )
  }

  // verification
  insertVerification(v: VerificationRow) {
    insert(this.db, 'verification_runs', v)
  }
  getVerification(pactId: string) {
    return one<VerificationRow>(this.db, 'SELECT * FROM verification_runs WHERE pact_id = ?', pactId)
  }

  // settlements
  insertSettlement(s: Pick<SettlementRow, 'id' | 'pact_id' | 'kind' | 'capture_amount' | 'status' | 'created_at'>) {
    insert(this.db, 'settlements', s)
  }
  getSettlement(pactId: string) {
    return one<SettlementRow>(this.db, 'SELECT * FROM settlements WHERE pact_id = ?', pactId)
  }
  bumpSettlementAttempt(pactId: string) {
    this.db.prepare('UPDATE settlements SET attempts = attempts + 1 WHERE pact_id = ?').run(pactId)
  }
  confirmSettlement(pactId: string, txHash: string | null, refund: string) {
    this.db
      .prepare(
        `UPDATE settlements SET status = 'confirmed', tx_hash = ?, refund_amount = ?, confirmed_at = ?, last_error = NULL
         WHERE pact_id = ? AND status <> 'confirmed'`,
      )
      .run(txHash, refund, Date.now(), pactId)
  }
  failSettlementAttempt(pactId: string, error: string) {
    this.db
      .prepare(`UPDATE settlements SET status = 'failed', last_error = ? WHERE pact_id = ? AND status <> 'confirmed'`)
      .run(error.slice(0, 500), pactId)
  }

  // receipts
  insertReceipt(r: ReceiptRow) {
    insert(this.db, 'work_receipts', r)
  }
  getReceipt(id: string) {
    return one<ReceiptRow>(this.db, 'SELECT * FROM work_receipts WHERE id = ?', id)
  }
  getReceiptByPact(pactId: string) {
    return one<ReceiptRow>(this.db, 'SELECT * FROM work_receipts WHERE pact_id = ?', pactId)
  }
  listReceipts(limit = 50) {
    return many<ReceiptRow>(
      this.db,
      `SELECT * FROM work_receipts ORDER BY created_at DESC LIMIT ${Math.min(Math.max(limit, 1), 200)}`,
    )
  }

  // failures & audit
  addFailure(f: Omit<FailureRow, 'id' | 'created_at'>) {
    insert(this.db, 'failures', { id: newId('fail'), created_at: Date.now(), ...f })
  }
  listFailures(pactId: string) {
    return many<FailureRow>(this.db, 'SELECT * FROM failures WHERE pact_id = ? ORDER BY created_at', pactId)
  }
  addAudit(e: { pact_id: string | null; type: string; actor: string; data: unknown }): AuditRow {
    const created_at = Date.now()
    const data = JSON.stringify(e.data ?? {})
    const res = this.db
      .prepare('INSERT INTO audit_events (pact_id, type, actor, data, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(e.pact_id, e.type, e.actor, data, created_at)
    return { seq: Number(res.lastInsertRowid), pact_id: e.pact_id, type: e.type, actor: e.actor, data, created_at }
  }
  listAudit(opts: { pactId?: string; afterSeq?: number; limit?: number } = {}) {
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500)
    if (opts.pactId)
      return many<AuditRow>(this.db, 'SELECT * FROM audit_events WHERE pact_id = ? ORDER BY seq', opts.pactId)
    if (opts.afterSeq !== undefined)
      return many<AuditRow>(this.db, `SELECT * FROM audit_events WHERE seq > ? ORDER BY seq LIMIT ${limit}`, opts.afterSeq)
    return many<AuditRow>(this.db, `SELECT * FROM audit_events ORDER BY seq DESC LIMIT ${limit}`).reverse()
  }

  // metrics — all derived from recorded facts; nothing synthetic
  metrics() {
    const sum = (sql: string) => many<{ v: string | null }>(this.db, sql).reduce((acc, r) => acc + BigInt(r.v ?? '0'), 0n)
    const authorized = sum(`SELECT deposit AS v FROM authorizations`)
    const settled = sum(`SELECT capture_amount AS v FROM settlements WHERE status = 'confirmed' AND kind = 'capture'`)
    const protectedAmt = sum(
      `SELECT a.voucher_amount AS v FROM settlements s JOIN authorizations a ON a.pact_id = s.pact_id
       WHERE s.status = 'confirmed' AND s.kind = 'refund'`,
    )
    const refunded = sum(`SELECT refund_amount AS v FROM settlements WHERE status = 'confirmed'`)
    const inFlight = sum(
      `SELECT a.deposit AS v FROM authorizations a JOIN pacts p ON p.id = a.pact_id
       WHERE p.state IN ('AUTHORIZED','EXECUTING','VERIFYING','VERIFIED','REJECTED','EXPIRED','SETTLING')`,
    )
    const counts = many<{ state: string; n: number }>(this.db, 'SELECT state, COUNT(*) AS n FROM pacts GROUP BY state')
    const verdicts = many<{ verdict: string; n: number }>(
      this.db,
      'SELECT verdict, COUNT(*) AS n FROM verification_runs GROUP BY verdict',
    )
    return { authorized, settled, protected: protectedAmt, refunded, inFlight, counts, verdicts }
  }

  providerStats() {
    return many<{
      service_id: string
      total: number
      passed: number
      failed: number
      avg_latency_ms: number | null
    }>(
      this.db,
      `SELECT p.service_id,
              COUNT(v.id) AS total,
              SUM(CASE WHEN v.verdict = 'PASS' THEN 1 ELSE 0 END) AS passed,
              SUM(CASE WHEN v.verdict <> 'PASS' THEN 1 ELSE 0 END) AS failed,
              CAST(AVG(w.latency_ms) AS INTEGER) AS avg_latency_ms
       FROM pacts p
       JOIN verification_runs v ON v.pact_id = p.id
       LEFT JOIN work_items w ON w.pact_id = p.id
       GROUP BY p.service_id`,
    )
  }
}
