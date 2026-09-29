'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'

import { useApi, useEvents } from '@/lib/api'
import { short } from '@/lib/format'
import type { RailInfo } from '@/lib/types'

const NAV = [
  { href: '/', label: 'Control Center', hint: 'live pacts & spend' },
  { href: '/lab', label: 'Chaos Lab', hint: 'break a provider' },
  { href: '/pacts', label: 'Pacts', hint: 'every request' },
  { href: '/receipts', label: 'Work Receipts', hint: 'verify proofs' },
  { href: '/docs', label: 'Developers', hint: 'SDK · MCP · API' },
]

export function Mark({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex flex-col gap-[3px] ${className}`} aria-hidden>
      <span className="h-[3px] w-4 rounded-full bg-escrow" />
      <span className="h-[3px] w-4 rounded-full bg-prove" />
      <span className="h-[3px] w-4 rounded-full bg-settle" />
    </span>
  )
}

function ThemeToggle() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark')
  }, [])
  const flip = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    try {
      localStorage.setItem('pact-theme', next)
    } catch {
      /* storage may be blocked */
    }
    setTheme(next)
  }
  return (
    <button
      onClick={flip}
      className="rounded-md border border-line px-2 py-1 font-mono text-[10.5px] uppercase tracking-wider text-muted hover:text-ink"
    >
      {theme === 'dark' ? 'Light' : 'Dark'}
    </button>
  )
}

function RailStatus() {
  const { data, error } = useApi<RailInfo>('/v1/rail', { refreshMs: 30_000 })
  const { status } = useEvents()
  if (error && !data)
    return (
      <div className="rounded-lg border border-fail/40 px-3 py-2 font-mono text-[11px] text-fail">
        Gateway offline
        <div className="text-faint">start with npm run dev:api</div>
      </div>
    )
  if (!data) return <div className="h-14 animate-pulse rounded-lg bg-surface-2" />
  const live = data.kind === 'tempo'
  return (
    <div className="rounded-lg border border-line bg-surface-2/60 px-3 py-2.5">
      <div className={`flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.12em] ${live ? 'text-settle' : 'text-escrow'}`}>
        <span className={`anim-ring h-1.5 w-1.5 rounded-full ${live ? 'bg-settle' : 'bg-escrow'}`} />
        {live ? 'Tempo Moderato' : 'Local ledger'}
      </div>
      <div className="mt-1 text-[11.5px] text-muted">
        {live ? `chain ${data.chainId} · ${data.tokenSymbol}` : 'simulated settlement, no chain'}
      </div>
      <div className="mt-1 font-mono text-[10.5px] text-faint">operator {short(data.operator, 6, 4)}</div>
      <div className="mt-1.5 flex items-center gap-1.5 font-mono text-[10.5px] text-faint">
        <span className={`h-1.5 w-1.5 rounded-full ${status === 'live' ? 'bg-settle' : status === 'connecting' ? 'bg-escrow' : 'bg-fail'}`} />
        events {status}
      </div>
    </div>
  )
}

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname()
  const active = (href: string) => (href === '/' ? path === '/' : path.startsWith(href))
  return (
    <div className="min-h-screen md:grid md:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-screen flex-col border-r border-line bg-surface/70 px-4 py-5 backdrop-blur md:flex">
        <Link href="/" className="flex items-center gap-2.5 px-2">
          <Mark />
          <span className="font-mono text-[15px] font-bold tracking-[0.2em]">PACT</span>
        </Link>
        <div className="mt-1 px-2 font-mono text-[10px] uppercase tracking-[0.16em] text-faint">Pay · Prove · Settle</div>
        <nav className="mt-7 flex flex-col gap-0.5" aria-label="Primary">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={active(n.href) ? 'page' : undefined}
              className={`group rounded-lg px-2.5 py-2 transition ${active(n.href) ? 'bg-surface-2 ring-1 ring-line' : 'hover:bg-surface-2/60'}`}
            >
              <div className={`text-[13.5px] ${active(n.href) ? 'font-semibold' : 'text-muted group-hover:text-ink'}`}>{n.label}</div>
              <div className="font-mono text-[10.5px] text-faint">{n.hint}</div>
            </Link>
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-3">
          <RailStatus />
          <div className="flex items-center justify-between px-1">
            <span className="font-mono text-[10px] text-faint">trust layer for autonomous commerce</span>
            <ThemeToggle />
          </div>
        </div>
      </aside>

      <header className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur md:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <Link href="/" className="flex items-center gap-2">
            <Mark />
            <span className="font-mono text-[14px] font-bold tracking-[0.2em]">PACT</span>
          </Link>
          <ThemeToggle />
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2" aria-label="Primary">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`shrink-0 rounded-md px-2.5 py-1 text-[12.5px] ${active(n.href) ? 'bg-surface-2 font-semibold ring-1 ring-line' : 'text-muted'}`}
            >
              {n.label}
            </Link>
          ))}
        </nav>
      </header>

      <main className="min-w-0 px-4 py-6 sm:px-6 md:px-10 md:py-9">
        <div className="mx-auto max-w-[1320px]">{children}</div>
      </main>
    </div>
  )
}
