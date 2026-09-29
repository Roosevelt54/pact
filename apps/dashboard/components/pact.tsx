'use client'

import { clock, type Tone, TONE_BG, TONE_TEXT } from '@/lib/format'
import type { Step, StepStatus } from '@/lib/lifecycle'
import type { Check } from '@/lib/types'

const stepTone = (step: Step): Tone => {
  if (step.status === 'failed') return 'fail'
  if (step.status === 'protected') return 'protect'
  if (step.status === 'active') return 'prove'
  if (step.status === 'pending') return 'neutral'
  if (step.key === 'authorize') return 'escrow'
  if (step.key === 'verify' || step.key === 'receipt' || step.key === 'settle') return 'settle'
  return 'prove'
}

const GLYPH: Record<StepStatus, string> = { pending: '', active: '', done: '✓', failed: '✕', protected: '↺' }

function Node({ step }: { step: Step }) {
  const tone = stepTone(step)
  const filled = step.status !== 'pending' && step.status !== 'active'
  return (
    <span
      key={step.status}
      className={`relative z-10 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 font-mono text-[12px] font-bold ${
        filled
          ? `${TONE_BG[tone]} anim-pop border-transparent text-bg`
          : step.status === 'active'
            ? `anim-ring border-current bg-surface ${TONE_TEXT[tone]}`
            : 'border-line-strong bg-surface text-faint'
      }`}
    >
      {GLYPH[step.status]}
    </span>
  )
}

/** The seven-stage PAY → PROVE → SETTLE rail. Horizontal on desktop, vertical on mobile. */
export function LifecycleRail({ steps, compact = false }: { steps: Step[]; compact?: boolean }) {
  // Laid out by its own width (container query), so it stays vertical wherever seven columns would collide.
  return (
    <div className="@container">
    <ol className="grid grid-cols-1 gap-0 @3xl:grid-cols-7" aria-label="Pact lifecycle">
      {steps.map((step, i) => {
        const next = steps[i + 1]
        const tone = stepTone(step)
        const connectorOn = next && next.status !== 'pending'
        const line =
          'absolute left-[13px] top-7 h-[calc(100%-28px)] w-[2px] @3xl:left-7 @3xl:top-[13px] @3xl:h-[2px] @3xl:w-[calc(100%-28px)]'
        return (
          <li key={step.key} className="relative flex gap-3 pb-5 @3xl:flex-col @3xl:gap-2 @3xl:pb-0 @3xl:pr-2">
            {next && <span className={`${line} bg-line`} />}
            {next && connectorOn && <span key={next.status} className={`${line} anim-fill ${TONE_BG[stepTone(next)]}`} />}
            <Node step={step} />
            <div className="min-w-0 @3xl:pr-1">
              <div className={`text-[12.5px] font-semibold uppercase tracking-wide ${step.status === 'pending' ? 'text-faint' : ''}`}>
                {step.title}
              </div>
              {!compact && <div className="font-mono text-[10.5px] text-faint">{step.caption}</div>}
              {step.detail && <div className={`mt-1 break-words font-mono text-[11.5px] leading-snug ${TONE_TEXT[tone]}`}>{step.detail}</div>}
              {step.at && <div className="mt-0.5 font-mono text-[10.5px] text-faint">{clock(step.at)}</div>}
            </div>
          </li>
        )
      })}
    </ol>
    </div>
  )
}

export type FlowStatus = 'none' | 'escrowed' | 'settled' | 'protected'

/** Where the agent's money went: authorized → captured by provider / refunded to agent. */
export function MoneyFlow({
  authorized,
  price,
  captured,
  refunded,
  status,
}: {
  authorized: string | null
  price: string
  captured: string | null
  refunded: string | null
  status: FlowStatus
}) {
  const total = Number(authorized ?? 0)
  const cap = Number(captured ?? 0)
  const capPct = total > 0 ? Math.min(100, (cap / total) * 100) : 0
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-faint">Authorized</div>
          <div className="num font-serif text-[34px] leading-none">${authorized ?? '0.00'}</div>
        </div>
        <div className="text-right font-mono text-[11.5px] text-muted">
          price ${price}
          <br />
          {status === 'none' && 'awaiting authorization'}
          {status === 'escrowed' && <span className="text-escrow">escrowed · not paid</span>}
          {status === 'settled' && <span className="text-settle">verified · captured</span>}
          {status === 'protected' && <span className="text-protect">protected · refunded</span>}
        </div>
      </div>
      <div className="mt-3 flex h-3 w-full overflow-hidden rounded-full bg-surface-2 ring-1 ring-line">
        {status === 'escrowed' && <div className="hatch h-full w-full" />}
        {status === 'settled' && (
          <>
            <div className="anim-fill h-full bg-settle" style={{ width: `${capPct}%` }} />
            <div className="anim-fill h-full bg-protect/70" style={{ width: `${100 - capPct}%` }} />
          </>
        )}
        {status === 'protected' && <div className="anim-fill h-full w-full bg-protect" />}
      </div>
      <div className="mt-2 flex flex-wrap justify-between gap-2 font-mono text-[11.5px]">
        <span className={status === 'settled' ? 'text-settle' : 'text-faint'}>● captured by provider {captured ? `$${captured}` : '—'}</span>
        <span className={status === 'settled' || status === 'protected' ? 'text-protect' : 'text-faint'}>
          ● refunded to agent {refunded ? `$${refunded}` : '—'}
        </span>
      </div>
    </div>
  )
}

export function ChecksList({ checks }: { checks: Check[] }) {
  return (
    <ul className="divide-y divide-line">
      {checks.map((c) => (
        <li key={c.code} className="grid grid-cols-[22px_minmax(0,1fr)] gap-x-2 py-2 text-[13px] sm:grid-cols-[22px_220px_minmax(0,1fr)]">
          <span
            className={`mt-px font-mono font-bold ${c.status === 'pass' ? 'text-settle' : c.status === 'fail' ? 'text-fail' : 'text-faint'}`}
            aria-label={c.status}
          >
            {c.status === 'pass' ? '✓' : c.status === 'fail' ? '✕' : '–'}
          </span>
          <span className={c.status === 'skip' ? 'text-faint' : ''}>
            {c.label}
            <span className="ml-2 font-mono text-[10.5px] text-faint">{c.code}</span>
          </span>
          <span className={`col-start-2 break-words font-mono text-[11.5px] sm:col-start-3 ${c.status === 'fail' ? 'text-fail' : 'text-muted'}`}>
            {c.detail}
          </span>
        </li>
      ))}
    </ul>
  )
}
