'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'

import { Wordmark } from '@/components/Logo'
import { useApi, useEvents } from '@/lib/api'
import { short } from '@/lib/format'
import type { RailInfo } from '@/lib/types'

const NAV = [
  { href: '/control', label: 'Control Center' },
  { href: '/lab', label: 'Chaos Lab' },
  { href: '/pacts', label: 'Pacts' },
  { href: '/receipts', label: 'Work Receipts' },
  { href: '/docs', label: 'Developers' },
]

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
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
      className="border border-line px-2 py-1 font-mono text-[10.5px] uppercase tracking-wider text-muted transition hover:border-line-strong hover:text-ink"
    >
      {theme === 'dark' ? 'Light' : 'Dark'}
    </button>
  )
}

function RailStatus() {
  const { data, error } = useApi<RailInfo>('/v1/rail', { refreshMs: 30_000 })
  const { status } = useEvents()
  if (error && !data) return <span className="font-mono text-[11px] text-fail">■ gateway offline</span>
  if (!data) return <span className="inline-block h-3 w-40 animate-pulse bg-surface-2" />
  const live = data.kind === 'tempo'
  return (
    <span className="flex items-center gap-3 font-mono text-[11px] text-muted" title={`operator ${data.operator}`}>
      <span className="flex items-center gap-2">
        <span className={`h-[7px] w-[7px] ${live ? 'bg-escrow' : 'bg-faint'} ${status === 'live' ? 'anim-ring text-escrow' : ''}`} />
        {live ? `Tempo Moderato · ${data.chainId}` : 'Local ledger · no chain'}
      </span>
      <span className="text-faint max-xl:hidden">op {short(data.operator, 6, 4)}</span>
    </span>
  )
}

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname()
  const active = (href: string) => path === href || path.startsWith(`${href}/`)
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-[1440px] items-center gap-8 px-4 sm:px-6 md:px-10">
          <Link href="/" aria-label="PACT home" className="shrink-0">
            <Wordmark size={19} />
          </Link>
          <nav className="flex min-w-0 gap-6 overflow-x-auto text-[13.5px] max-md:hidden" aria-label="Primary">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active(n.href) ? 'page' : undefined}
                className={`relative shrink-0 py-4 transition ${active(n.href) ? 'font-semibold text-ink' : 'text-muted hover:text-ink'}`}
              >
                {n.label}
                {active(n.href) && <span className="absolute inset-x-0 -bottom-px h-[2px] bg-escrow" />}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-4">
            <span className="max-sm:hidden">
              <RailStatus />
            </span>
            <ThemeToggle />
          </div>
        </div>
        <nav className="flex gap-5 overflow-x-auto px-4 pb-2.5 text-[13px] md:hidden" aria-label="Primary">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`shrink-0 ${active(n.href) ? 'font-semibold text-ink underline decoration-escrow decoration-2 underline-offset-[6px]' : 'text-muted'}`}
            >
              {n.label}
            </Link>
          ))}
        </nav>
      </header>

      <main className="w-full min-w-0 flex-1 px-4 py-8 sm:px-6 md:px-10 md:py-12">
        <div className="mx-auto max-w-[1360px]">{children}</div>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-4 py-5 font-mono text-[11px] text-faint sm:px-6 md:px-10">
          <span>PACT · the trust layer for autonomous commerce on Tempo</span>
          <span>escrow · TIP-1034 · MPP</span>
        </div>
      </footer>
    </div>
  )
}
