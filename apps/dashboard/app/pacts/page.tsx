'use client'

import Link from 'next/link'
import { useState } from 'react'

import { ButtonLink, Empty, ErrorBox, PageHeader, Panel, Skeleton, StatePill, Tag } from '@/components/ui'
import { useApi, useOnEvent } from '@/lib/api'
import { ago, usd } from '@/lib/format'
import type { PactSummary } from '@/lib/types'

const FILTERS = ['', 'SETTLED', 'PROTECTED', 'EXECUTING', 'SETTLING', 'EXPIRED'] as const

export default function PactsPage() {
  const [state, setState] = useState<(typeof FILTERS)[number]>('')
  const path = `/v1/pacts?limit=100${state ? `&state=${state}` : ''}`
  const { data, error, loading, reload } = useApi<{ pacts: PactSummary[] }>(path, { refreshMs: 20_000 })
  useOnEvent(() => void reload(), undefined, 400)

  return (
    <div>
      <PageHeader kicker="ledger" title="Pacts">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by state">
          {FILTERS.map((f) => (
            <button
              key={f || 'all'}
              onClick={() => setState(f)}
              aria-pressed={state === f}
              className={`rounded-md border px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider ${state === f ? 'border-ink bg-ink text-bg' : 'border-line text-muted hover:text-ink'}`}
            >
              {f || 'all'}
            </button>
          ))}
        </div>
      </PageHeader>

      {error && !data && (
        <div className="mb-4">
          <ErrorBox message={error.message} onRetry={() => void reload()} />
        </div>
      )}

      <Panel pad={false}>
        {loading && !data ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : !data?.pacts.length ? (
          <Empty
            title={state ? `No ${state.toLowerCase()} pacts` : 'No pacts yet'}
            body="Pacts appear here the moment an agent registers a paid request."
            action={<ButtonLink href="/lab">Run one in the Chaos Lab</ButtonLink>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-[13px]">
              <thead>
                <tr className="border-b border-line text-left font-mono text-[10.5px] uppercase tracking-wider text-faint">
                  <th className="px-5 py-2.5 font-medium">Pact</th>
                  <th className="px-3 py-2.5 font-medium">Service · provider</th>
                  <th className="px-3 py-2.5 font-medium">Origin</th>
                  <th className="px-3 py-2.5 font-medium">State</th>
                  <th className="px-3 py-2.5 text-right font-medium">Price</th>
                  <th className="px-3 py-2.5 text-right font-medium">Authorized</th>
                  <th className="px-3 py-2.5 text-right font-medium">Captured</th>
                  <th className="px-3 py-2.5 text-right font-medium">Refunded</th>
                  <th className="px-5 py-2.5 text-right font-medium">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.pacts.map((p) => (
                  <tr key={p.id} className="hover:bg-surface-2/60">
                    <td className="px-5 py-2.5">
                      <Link href={`/pacts/${p.id}`} className="font-mono text-[12px] hover:underline">
                        {p.id}
                      </Link>
                      {p.retryOf && <div className="font-mono text-[10.5px] text-faint">retry of {p.retryOf.slice(0, 12)}…</div>}
                    </td>
                    <td className="px-3 py-2.5">
                      {p.service?.name} <span className="text-muted">· {p.service?.provider}</span>
                    </td>
                    <td className="space-x-1 px-3 py-2.5">
                      <Tag>{p.origin}</Tag>
                      {p.scenario && p.scenario !== 'normal' && <Tag tone="fail">{p.scenario}</Tag>}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatePill state={p.state} />
                    </td>
                    <td className="num px-3 py-2.5 text-right font-mono">{usd(p.price)}</td>
                    <td className="num px-3 py-2.5 text-right font-mono text-escrow">{usd(p.authorized)}</td>
                    <td className="num px-3 py-2.5 text-right font-mono text-settle">{usd(p.captured)}</td>
                    <td className="num px-3 py-2.5 text-right font-mono text-protect">{usd(p.refunded)}</td>
                    <td className="px-5 py-2.5 text-right font-mono text-[11.5px] text-muted">{ago(p.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}
