import type { PactState } from './types'

export const short = (value: string | null | undefined, head = 6, tail = 4) =>
  !value ? '—' : value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`

export const usd = (amount: string | null | undefined) => (amount == null ? '—' : `$${amount}`)

export function ago(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return '—'
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return new Date(iso).toLocaleDateString()
}

export const clock = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'

export const ms = (n: number | null | undefined) => (n == null ? '—' : n < 1000 ? `${n} ms` : `${(n / 1000).toFixed(2)} s`)

export type Tone = 'neutral' | 'escrow' | 'prove' | 'settle' | 'protect' | 'fail'

export const STATE_META: Record<PactState, { label: string; tone: Tone; live?: boolean }> = {
  CREATED: { label: 'Created', tone: 'neutral' },
  AUTHORIZED: { label: 'Authorized', tone: 'escrow', live: true },
  EXECUTING: { label: 'Executing', tone: 'prove', live: true },
  VERIFYING: { label: 'Verifying', tone: 'prove', live: true },
  VERIFIED: { label: 'Verified', tone: 'settle', live: true },
  REJECTED: { label: 'Rejected', tone: 'fail', live: true },
  EXPIRED: { label: 'Expired', tone: 'fail' },
  SETTLING: { label: 'Settling', tone: 'escrow', live: true },
  SETTLED: { label: 'Settled', tone: 'settle' },
  PROTECTED: { label: 'Protected', tone: 'protect' },
}

export const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-muted',
  escrow: 'text-escrow',
  prove: 'text-prove',
  settle: 'text-settle',
  protect: 'text-protect',
  fail: 'text-fail',
}

export const TONE_BG: Record<Tone, string> = {
  neutral: 'bg-faint',
  escrow: 'bg-escrow',
  prove: 'bg-prove',
  settle: 'bg-settle',
  protect: 'bg-protect',
  fail: 'bg-fail',
}

export const EVENT_LABELS: Record<string, string> = {
  'pact.created': 'Pact created',
  'payment.challenge_issued': '402 challenge issued',
  'payment.authorized': 'Payment authorized · escrowed',
  'payment.authorization_rejected': 'Authorization rejected',
  'payment.late_authorization_refunded': 'Late authorization refunded',
  'payment.late_authorization_rejected': 'Late authorization rejected',
  'agent.payment_failed': 'Agent payment failed',
  'work.dispatched': 'Work dispatched to provider',
  'work.accepted': 'Async job accepted',
  'work.delivered': 'Result received',
  'work.timeout': 'Provider timed out',
  'work.network_error': 'Provider unreachable',
  'work.duplicate_delivery': 'Duplicate delivery ignored',
  'work.callback_rejected': 'Forged callback rejected',
  'verification.completed': 'Verification completed',
  'settlement.started': 'Settlement started',
  'settlement.retry_scheduled': 'Settlement retry scheduled',
  'settlement.confirmed': 'Settlement confirmed',
  'receipt.issued': 'Work Receipt issued',
  'pact.expired': 'Pact expired',
  'engine.error': 'Engine error',
}

export function eventTone(e: { type: string; data: Record<string, unknown> }): Tone {
  if (e.type === 'verification.completed') return e.data.verdict === 'PASS' ? 'settle' : 'fail'
  if (e.type === 'settlement.confirmed') return e.data.captured !== '0.00' ? 'settle' : 'protect'
  if (e.type.startsWith('payment.authorized')) return 'escrow'
  if (/rejected|failed|timeout|error|expired/.test(e.type)) return 'fail'
  if (e.type.startsWith('work.')) return 'prove'
  if (e.type === 'receipt.issued') return 'settle'
  return 'neutral'
}
