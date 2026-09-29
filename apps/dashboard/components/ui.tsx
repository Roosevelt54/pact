'use client'

import Link from 'next/link'
import { useState, type ReactNode } from 'react'

import { STATE_META, TONE_BG, TONE_TEXT, short, type Tone } from '@/lib/format'
import type { PactState } from '@/lib/types'

export function Panel({
  title,
  kicker,
  action,
  children,
  className = '',
  pad = true,
}: {
  title?: ReactNode
  kicker?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  pad?: boolean
}) {
  return (
    <section className={`min-w-0 rounded-xl border border-line bg-surface/90 backdrop-blur-[2px] ${className}`}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-3.5">
          <div>
            {kicker && <div className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-faint">{kicker}</div>}
            {title && <h2 className="text-[14px] font-semibold tracking-tight">{title}</h2>}
          </div>
          {action}
        </header>
      )}
      <div className={pad ? 'p-5' : ''}>{children}</div>
    </section>
  )
}

export function Dot({ tone, live = false }: { tone: Tone; live?: boolean }) {
  return (
    <span className={`relative inline-flex h-2 w-2 shrink-0 rounded-full ${TONE_BG[tone]} ${TONE_TEXT[tone]} ${live ? 'anim-ring' : ''}`} />
  )
}

export function StatePill({ state }: { state: PactState }) {
  const meta = STATE_META[state]
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-current/25 px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider ${TONE_TEXT[meta.tone]}`}
    >
      <Dot tone={meta.tone} live={meta.live} />
      {meta.label}
    </span>
  )
}

export function Tag({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  return (
    <span className={`inline-flex items-center rounded-md border border-current/20 px-1.5 py-px font-mono text-[10.5px] uppercase tracking-wider ${TONE_TEXT[tone]}`}>
      {children}
    </span>
  )
}

export function Hash({ value, href, head = 8, tail = 6 }: { value: string | null | undefined; href?: string | null; head?: number; tail?: number }) {
  const [copied, setCopied] = useState(false)
  if (!value) return <span className="font-mono text-faint">—</span>
  const text = <span className="font-mono">{short(value, head, tail)}</span>
  return (
    <span className="inline-flex items-center gap-1.5">
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className="text-prove underline decoration-prove/30 underline-offset-2 hover:decoration-prove">
          {text}
        </a>
      ) : (
        text
      )}
      <button
        type="button"
        title="Copy"
        aria-label={`Copy ${value}`}
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1200)
          })
        }}
        className="rounded px-1 font-mono text-[10px] text-faint transition hover:bg-surface-2 hover:text-ink"
      >
        {copied ? 'copied' : 'copy'}
      </button>
    </span>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 py-1.5 text-[13px] max-sm:grid-cols-1 max-sm:gap-0.5">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  )
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-surface-2 ${className}`} />
}

export function ErrorBox({ title = 'Could not reach the PACT gateway', message, onRetry }: { title?: string; message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-start justify-between gap-4 rounded-lg border border-fail/40 bg-fail/5 px-4 py-3 text-[13px]">
      <div>
        <div className="font-semibold text-fail">{title}</div>
        <div className="mt-0.5 text-muted">{message}</div>
      </div>
      {onRetry && (
        <button onClick={onRetry} className="shrink-0 rounded-md border border-line px-2.5 py-1 text-[12px] hover:bg-surface-2">
          Retry
        </button>
      )}
    </div>
  )
}

export function Empty({ title, body, action }: { title: string; body: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <div className="font-serif text-2xl italic">{title}</div>
      <div className="max-w-sm text-[13px] text-muted">{body}</div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function ButtonLink({ href, children, variant = 'primary' }: { href: string; children: ReactNode; variant?: 'primary' | 'ghost' }) {
  return (
    <Link
      href={href}
      className={
        variant === 'primary'
          ? 'inline-flex items-center gap-2 rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-bg transition hover:opacity-90'
          : 'inline-flex items-center gap-2 rounded-lg border border-line px-3.5 py-2 text-[13px] font-medium transition hover:bg-surface-2'
      }
    >
      {children}
    </Link>
  )
}

export function PageHeader({ kicker, title, children }: { kicker: string; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-escrow">{kicker}</div>
        <h1 className="mt-1 font-serif text-[40px] leading-[1.05] tracking-tight max-sm:text-[32px]">{title}</h1>
      </div>
      {children}
    </div>
  )
}
