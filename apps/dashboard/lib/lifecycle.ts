import type { PactEvent } from './types'

export type StepStatus = 'pending' | 'active' | 'done' | 'failed' | 'protected'
export type Step = { key: string; title: string; caption: string; status: StepStatus; at: string | null; detail: string | null }

const STEPS: { key: string; title: string; caption: string }[] = [
  { key: 'request', title: 'Request', caption: 'digest committed' },
  { key: 'authorize', title: 'Payment authorized', caption: 'escrowed on Tempo' },
  { key: 'execute', title: 'Service executing', caption: 'dispatched to provider' },
  { key: 'result', title: 'Result received', caption: 'signed by provider' },
  { key: 'verify', title: 'Verification', caption: 'deterministic policy' },
  { key: 'receipt', title: 'Work receipt', caption: 'sealed & signed' },
  { key: 'settle', title: 'Settlement', caption: 'operator close' },
]

const find = (events: PactEvent[], ...types: string[]) => events.find((e) => types.includes(e.type)) ?? null
const s = (v: unknown) => String(v ?? '')

/**
 * Derives the seven-stage PAY → PROVE → SETTLE rail purely from a pact's audit
 * events, so the Chaos Lab (live SSE) and pact detail (stored timeline) render
 * the same truth.
 */
export function deriveLifecycle(events: PactEvent[]): Step[] {
  const ordered = [...events].sort((a, b) => a.seq - b.seq)
  const created = find(ordered, 'pact.created')
  const authorized = find(ordered, 'payment.authorized')
  const authFailed = find(ordered, 'payment.authorization_rejected', 'agent.payment_failed')
  const dispatched = find(ordered, 'work.dispatched')
  const accepted = find(ordered, 'work.accepted')
  const delivered = find(ordered, 'work.delivered')
  const transportFail = find(ordered, 'work.timeout', 'work.network_error')
  const verified = find(ordered, 'verification.completed')
  const expired = find(ordered, 'pact.expired')
  const receipt = find(ordered, 'receipt.issued')
  const settleStart = find(ordered, 'settlement.started')
  const settled = find(ordered, 'settlement.confirmed')
  const retry = [...ordered].reverse().find((e) => e.type === 'settlement.retry_scheduled') ?? null

  const out: Record<string, Omit<Step, 'key' | 'title' | 'caption'>> = {
    request: created
      ? { status: 'done', at: created.at, detail: `$${s(created.data.price)} · ${s(created.data.provider)}` }
      : { status: 'active', at: null, detail: null },
    authorize: authorized
      ? { status: 'done', at: authorized.at, detail: `$${s(authorized.data.deposit)} locked · voucher $${s(authorized.data.voucher)}` }
      : authFailed
        ? { status: 'failed', at: authFailed.at, detail: s(authFailed.data.code) || 'rejected' }
        : { status: created ? 'active' : 'pending', at: null, detail: null },
    execute: dispatched
      ? { status: 'done', at: dispatched.at, detail: accepted ? `async job ${s(accepted.data.jobId)}` : s(dispatched.data.provider) }
      : { status: authorized ? 'active' : 'pending', at: null, detail: null },
    result: delivered
      ? { status: 'done', at: delivered.at, detail: `HTTP ${s(delivered.data.httpStatus)} · ${s(delivered.data.latencyMs)} ms` }
      : transportFail
        ? { status: 'failed', at: transportFail.at, detail: transportFail.type === 'work.timeout' ? 'timed out' : 'unreachable' }
        : expired && dispatched
          ? { status: 'failed', at: expired.at, detail: 'no delivery before deadline' }
          : { status: dispatched ? 'active' : 'pending', at: null, detail: null },
    verify: verified
      ? verified.data.verdict === 'PASS'
        ? { status: 'done', at: verified.at, detail: `PASS · ${s(verified.data.passed)} checks` }
        : { status: 'failed', at: verified.at, detail: `FAIL · ${((verified.data.reasons as string[]) ?? []).slice(0, 3).join(', ')}` }
      : expired && authorized
        ? { status: 'failed', at: expired.at, detail: 'EXPIRED · deadline' }
        : { status: delivered || transportFail ? 'active' : 'pending', at: null, detail: null },
    receipt: receipt
      ? { status: 'done', at: receipt.at, detail: s(receipt.data.receiptId) }
      : { status: settled ? 'active' : 'pending', at: null, detail: null },
    settle: settled
      ? settled.data.captured !== '0.00'
        ? { status: 'done', at: settled.at, detail: `$${s(settled.data.captured)} → provider · $${s(settled.data.refunded)} back` }
        : { status: 'protected', at: settled.at, detail: `$0.00 captured · $${s(settled.data.refunded)} refunded` }
      : retry
        ? { status: 'active', at: retry.at, detail: `retry #${s(retry.data.attempt)}` }
        : settleStart
          ? { status: 'active', at: settleStart.at, detail: `${s(settleStart.data.kind)} in flight` }
          : { status: 'pending', at: null, detail: null },
  }

  return STEPS.map((step) => ({ ...step, ...out[step.key]! }))
}

export type Outcome = 'running' | 'settled' | 'protected' | 'failed_payment'

export function outcomeOf(events: PactEvent[]): Outcome {
  const settled = events.find((e) => e.type === 'settlement.confirmed')
  if (settled) return settled.data.captured !== '0.00' ? 'settled' : 'protected'
  if (events.some((e) => e.type === 'payment.authorization_rejected' || e.type === 'agent.payment_failed')) return 'failed_payment'
  return 'running'
}
