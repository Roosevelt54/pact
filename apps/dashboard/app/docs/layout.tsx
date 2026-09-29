import Link from 'next/link'
import type { ReactNode } from 'react'

import { DOCS } from '@/lib/docs'

const GROUPS = ['Start', 'Concepts', 'Guides', 'Reference'] as const

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-10 lg:grid-cols-[210px_minmax(0,1fr)]">
      <aside className="min-w-0 lg:sticky lg:top-8 lg:self-start">
        <Link href="/docs" className="font-mono text-[11px] uppercase tracking-[0.18em] text-escrow hover:underline">
          Developers
        </Link>
        <nav className="mt-4 flex gap-6 overflow-x-auto lg:flex-col lg:gap-5" aria-label="Documentation">
          {GROUPS.map((g) => (
            <div key={g} className="shrink-0">
              <div className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-faint">{g}</div>
              <ul className="mt-1.5 space-y-0.5">
                {DOCS.filter((d) => d.group === g).map((d) => (
                  <li key={d.slug}>
                    <Link href={`/docs/${d.slug}`} className="block whitespace-nowrap py-0.5 text-[13px] text-muted hover:text-ink">
                      {d.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  )
}
