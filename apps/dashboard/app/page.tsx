'use client'

import Link from 'next/link'

import { ButtonLink, Empty, ErrorBox, Hash, Panel, Skeleton, StatePill, Tag } from '@/components/ui'
import { useApi, useEvents, useOnEvent } from '@/lib/api'
import { ago, clock, EVENT_LABELS, eventTone, ms, TONE_TEXT, usd } from '@/lib/format'
import type { Metrics, PactSummary, RailInfo } from '@/lib/types'

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: string }) {
  return (
    <div className="border-line px-5 py-4 [&:not(:first-child)]:border-l">
      <div className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-faint">{label}</div>
      <div className={`num mt-1 font-serif text-[30px] leading-none ${tone}`}>{value}</div>
      <div className="mt-1.5 text-[12px] text-muted">{sub}</div>
    </div>
  )
}

function Feed() {
  const { recent, status } = useEvents()
  return (
    <Panel
      kicker="gateway audit stream"
      title="Live events"
      action={<span className="font-mono text-[10.5px] text-faint">{status === 'live' ? '● streaming' : status}</span>}
      pad={false}
    >
      {recent.length === 0 ? (
        <div className="px-5 py-10 text-center text-[13px] text-muted">Waiting for activity. Run a pact in the Chaos Lab.</div>
      ) : (
        <ol className="max-h-[520px] divide-y divide-line overflow-y-auto">
          {recent.slice(0, 60).map((e) => (
            <li key={e.seq} className="anim-in grid grid-cols-[64px_minmax(0,1fr)] gap-3 px-5 py-2.5 text-[12.5px]">
              <span className="font-mono text-[10.5px] text-faint">{clock(e.at)}</span>
              <div className="min-w-0">
                <div className={`font-medium ${TONE_TEXT[eventTone(e)]}`}>{EVENT_LABELS[e.type] ?? e.type}</div>
                {e.pactId && (
                  <Link href={`/pacts/${e.pactId}`} className="font-mono text-[10.5px] text-faint hover:text-ink">
                    {e.pactId}
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  )
}

export default function ControlCenter() {
  const metrics = useApi<Metrics>('/v1/metrics', { refreshMs: 15_000 })
  const pacts = useApi<{ pacts: PactSummary[] }>('/v1/pacts?limit=14', { refreshMs: 15_000 })
  const rail = useApi<RailInfo>('/v1/rail', { refreshMs: 20_000 })
  useOnEvent(() => {
    void metrics.reload()
    void pacts.reload()
  })
  useOnEvent(() => void rail.reload(), (e) => e.type === 'settlement.confirmed', 1500)

  const m = metrics.data
  const offline = metrics.error && !m

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-escrow">Control Center</div>
          <h1 className="mt-1 font-serif text-[46px] leading-[1.02] tracking-tight max-sm:text-[34px]">
            Pay<span className="text-escrow">.</span> Prove<span className="text-prove">.</span> Settle<span className="text-settle">.</span>
          </h1>
          <p className="mt-2 max-w-xl text-[14px] text-muted">
            Every agent payment on this gateway is escrowed on Tempo, bound to its request, and captured only when the delivered work passes a
            published verification policy. Everything else goes back to the agent.
          </p>
        </div>
        <div className="flex gap-2">
          <ButtonLink href="/lab">Open Chaos Lab →</ButtonLink>
          <ButtonLink href="/docs" variant="ghost">
            SDK docs
          </ButtonLink>
        </div>
      </div>

      {offline && (
        <ErrorBox message={`${metrics.error!.message} Start the gateway with npm run dev:api.`} onRetry={() => void metrics.reload()} />
      )}

      <section className="grid grid-cols-1 overflow-hidden rounded-xl border border-line bg-surface/90 lg:grid-cols-[1.35fr_1fr]">
        <div className="relative border-line p-6 max-lg:border-b lg:border-r">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-faint">Protected spend</div>
          {m ? (
            <div className="num mt-2 font-serif text-[72px] leading-none text-protect max-sm:text-[54px]">${m.protected}</div>
          ) : (
            <Skeleton className="mt-3 h-16 w-48" />
          )}
          <p className="mt-3 max-w-md text-[13px] text-muted">
            Authorized by agents, then returned on-chain because the provider&apos;s work failed verification or never arrived. Each refund is a
            settlement transaction, not a promise.
          </p>
          <div className="mt-5 flex flex-wrap gap-6 font-mono text-[12px]">
            <span>
              <span className="text-faint">pass rate </span>
              <span className="text-settle">{m?.passRate == null ? '—' : `${Math.round(m.passRate * 100)}%`}</span>
            </span>
            <span>
              <span className="text-faint">pacts </span>
              {m?.pacts ?? '—'}
            </span>
            <span>
              <span className="text-faint">active </span>
              <span className="text-prove">{m?.active ?? '—'}</span>
            </span>
          </div>
        </div>
        <div className="grid grid-cols-2">
          <Kpi label="Authorized" value={usd(m?.authorized)} sub="escrowed by agents" tone="text-escrow" />
          <Kpi label="Settled" value={usd(m?.settled)} sub="captured for verified work" tone="text-settle" />
          <div className="col-span-2 grid grid-cols-2 border-t border-line">
            <Kpi label="In flight" value={usd(m?.inFlight)} sub="locked, not yet decided" tone="text-prove" />
            <Kpi label="Refunded" value={usd(m?.refunded)} sub="unused authorization returned" tone="text-ink" />
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Panel
          kicker="most recent first"
          title="Pacts"
          action={
            <Link href="/pacts" className="text-[12.5px] text-muted hover:text-ink">
              All pacts →
            </Link>
          }
          pad={false}
        >
          {pacts.loading && !pacts.data ? (
            <div className="space-y-2 p-5">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : !pacts.data?.pacts.length ? (
            <Empty
              title="No pacts yet"
              body="Nothing has been paid for on this gateway. Run a successful and a failing request to see both outcomes."
              action={<ButtonLink href="/lab">Run the Chaos Lab</ButtonLink>}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-[13px]">
                <thead>
                  <tr className="text-left font-mono text-[10.5px] uppercase tracking-wider text-faint">
                    <th className="px-5 py-2 font-medium">Pact</th>
                    <th className="px-3 py-2 font-medium">Service</th>
                    <th className="px-3 py-2 font-medium">State</th>
                    <th className="px-3 py-2 text-right font-medium">Authorized</th>
                    <th className="px-3 py-2 text-right font-medium">Captured</th>
                    <th className="px-5 py-2 text-right font-medium">When</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {pacts.data.pacts.map((p) => (
                    <tr key={p.id} className="hover:bg-surface-2/60">
                      <td className="px-5 py-2.5">
                        <Link href={`/pacts/${p.id}`} className="font-mono text-[12px] hover:underline">
                          {p.id.slice(0, 13)}…
                        </Link>
                        {p.scenario && p.scenario !== 'normal' && (
                          <span className="ml-2">
                            <Tag tone="fail">{p.scenario}</Tag>
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <div>{p.service?.name}</div>
                        <div className="text-[11.5px] text-muted">{p.service?.provider}</div>
                      </td>
                      <td className="px-3 py-2.5">
                        <StatePill state={p.state} />
                      </td>
                      <td className="num px-3 py-2.5 text-right font-mono">{usd(p.authorized)}</td>
                      <td
                        className={`num px-3 py-2.5 text-right font-mono ${p.state === 'PROTECTED' ? 'text-protect' : p.captured ? 'text-settle' : 'text-faint'}`}
                      >
                        {usd(p.captured)}
                      </td>
                      <td className="px-5 py-2.5 text-right font-mono text-[11.5px] text-muted">{ago(p.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        <Feed />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel kicker={rail.data?.kind === 'tempo' ? 'live on Tempo Moderato' : 'local ledger'} title="Parties & balances" pad={false}>
          {!rail.data ? (
            <div className="space-y-2 p-5">
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {rail.data.parties.map((p) => (
                <li key={p.address} className="flex items-center justify-between gap-4 px-5 py-3 text-[13px]">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Tag tone={p.role === 'agent' ? 'escrow' : p.role === 'provider' ? 'settle' : 'prove'}>{p.role}</Tag>
                      <span className="font-medium">{p.name}</span>
                    </div>
                    <div className="mt-0.5 text-[12px]">
                      <Hash value={p.address} href={p.url} />
                    </div>
                  </div>
                  <div className="num text-right font-mono text-[13px]">
                    {p.balance ?? '—'} <span className="text-faint">{rail.data!.tokenSymbol}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel kicker="from verified work receipts" title="Provider reliability" pad={false}>
          {!m?.providers.length ? (
            <div className="px-5 py-10 text-center text-[13px] text-muted">Reliability builds up from verified outcomes. No verdicts yet.</div>
          ) : (
            <ul className="divide-y divide-line">
              {m.providers.map((p) => {
                const rate = p.total ? p.passed / p.total : 0
                return (
                  <li key={p.serviceId} className="px-5 py-3 text-[13px]">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <span className="font-medium">{p.provider}</span> <span className="text-muted">· {p.name}</span>
                      </div>
                      <div className="num font-mono text-[12px]">
                        <span className="text-settle">{p.passed}</span>
                        <span className="text-faint"> / {p.total} verified · </span>
                        <span className="text-muted">{ms(p.avgLatencyMs)} avg</span>
                      </div>
                    </div>
                    <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-fail/30">
                      <div className="h-full bg-settle" style={{ width: `${rate * 100}%` }} />
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  )
}
