'use client'

import Link from 'next/link'
import { useState, type ReactNode } from 'react'

import { STATE_META, TONE_BG, TONE_TEXT, short, type Tone } from '@/lib/format'
import type { PactState } from '@/lib/types'

/** A ruled section: a heavy top rule and a header line, never a floating card. */
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
    <section className={`min-w-0 border-t-2 border-ink ${className}`}>
      {(title || action) && (
        <header className="flex items-end justify-between gap-4 border-b border-line py-3">
          <div className="min-w-0">
            {kicker && <div className="truncate font-mono text-[10.5px] uppercase tracking-[0.1em] text-faint">{kicker}</div>}
            {title && <h2 className="mt-0.5 text-[16px] font-semibold tracking-tight">{title}</h2>}
          </div>
          {action}
        </header>
      )}
      <div className={pad ? 'py-4' : ''}>{children}</div>
    </section>
  )
}

export function Dot({ tone, live = false }: { tone: Tone; live?: boolean }) {
  return <span className={`relative inline-flex h-[7px] w-[7px] shrink-0 ${TONE_BG[tone]} ${TONE_TEXT[tone]} ${live ? 'anim-ring' : ''}`} />
}

export function StatePill({ state }: { state: PactState }) {
  const meta = STATE_META[state]
  return (
    <span className={`inline-flex items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[0.06em] ${TONE_TEXT[meta.tone]}`}>
      <Dot tone={meta.tone} live={meta.live} />
      {meta.label}
    </span>
  )
}

export function Tag({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  return (
    <span className={`inline-flex items-center border border-current/30 px-1.5 py-px font-mono text-[10.5px] uppercase tracking-wider ${TONE_TEXT[tone]}`}>
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
        <a href={href} target="_blank" rel="noreferrer" className="underline decoration-escrow/60 underline-offset-[3px] hover:decoration-escrow">
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
        className="px-1 font-mono text-[10px] text-faint transition hover:bg-surface-2 hover:text-ink"
      >
        {copied ? 'copied' : 'copy'}
      </button>
    </span>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 border-b border-line py-2 text-[13px] last:border-0 max-sm:grid-cols-1 max-sm:gap-0.5">
      <dt className="font-mono text-[11px] uppercase tracking-[0.06em] text-faint">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  )
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse bg-surface-2 ${className}`} />
}

export function ErrorBox({ title = 'Could not reach the PACT gateway', message, onRetry }: { title?: string; message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-start justify-between gap-4 border-l-2 border-fail bg-fail/5 px-4 py-3 text-[13px]">
      <div>
        <div className="font-semibold text-fail">{title}</div>
        <div className="mt-0.5 text-muted">{message}</div>
      </div>
      {onRetry && (
        <button onClick={onRetry} className="shrink-0 border border-line px-2.5 py-1 text-[12px] hover:bg-surface-2">
          Retry
        </button>
      )}
    </div>
  )
}

export function Empty({ title, body, action }: { title: string; body: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 py-12">
      <div className="font-serif text-[30px] leading-none">{title}</div>
      <div className="max-w-md text-[13.5px] text-muted">{body}</div>
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

export function ButtonLink({ href, children, variant = 'primary' }: { href: string; children: ReactNode; variant?: 'primary' | 'ghost' }) {
  return (
    <Link
      href={href}
      className={
        variant === 'primary'
          ? 'inline-flex items-center gap-2 bg-ink px-4 py-2.5 text-[13.5px] font-semibold text-bg transition hover:bg-escrow hover:text-[#0c0c0b]'
          : 'inline-flex items-center gap-2 border border-line-strong px-4 py-2.5 text-[13.5px] font-medium transition hover:border-ink'
      }
    >
      {children}
    </Link>
  )
}

export function PageHeader({ kicker, title, children }: { kicker: string; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-10 flex flex-wrap items-end justify-between gap-6">
      <div className="min-w-0">
        <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">{kicker}</div>
        <h1 className="mt-2 font-serif text-[64px] leading-[0.92] max-sm:text-[44px]">{title}</h1>
      </div>
      {children}
    </div>
  )
}
