'use client'

import Link from 'next/link'

import { ButtonLink, Empty, ErrorBox, Hash, Panel, Skeleton, StatePill, Tag } from '@/components/ui'
import { useApi, useEvents, useOnEvent } from '@/lib/api'
import { ago, clock, EVENT_LABELS, eventTone, ms, short, TONE_TEXT, usd } from '@/lib/format'
import type { Metrics, PactSummary, RailInfo } from '@/lib/types'

function LedgerLine({ label, value, sub, signal = false }: { label: string; value: string; sub: string; signal?: boolean }) {
  return (
    <div className="flex items-end justify-between gap-6 border-b border-line py-4">
      <div>
        <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted">{label}</div>
        <div className="mt-0.5 text-[12px] text-faint">{sub}</div>
      </div>
      <div className={`num font-serif text-[40px] leading-none ${signal ? 'text-escrow' : ''}`}>{value}</div>
    </div>
  )
}

function Feed() {
  const { recent, status } = useEvents()
  return (
    <Panel
      kicker="gateway audit stream"
      title="Live events"
      action={
        <span className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.08em] text-faint">
          <span className={`h-[6px] w-[6px] ${status === 'live' ? 'anim-ring bg-escrow text-escrow' : 'bg-faint'}`} />
          {status === 'live' ? 'streaming' : status}
        </span>
      }
      pad={false}
    >
      {recent.length === 0 ? (
        <div className="py-10 text-[13px] text-muted">Waiting for activity. Run a pact in the Chaos Lab.</div>
      ) : (
        <ol className="max-h-[520px] divide-y divide-line overflow-y-auto">
          {recent.slice(0, 60).map((e) => (
            <li key={e.seq} className="anim-in grid grid-cols-[96px_minmax(0,1fr)] gap-3 py-2.5 text-[13px]">
              <span className="whitespace-nowrap font-mono text-[11px] text-faint">{clock(e.at)}</span>
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
  const passRate = m?.passRate == null ? '—' : `${Math.round(m.passRate * 100)}%`

  return (
    <div className="flex flex-col gap-14">
      {offline && <ErrorBox message={`${metrics.error!.message} Start the gateway with npm run dev:api.`} onRetry={() => void metrics.reload()} />}

      <section className="grid grid-cols-1 gap-x-12 gap-y-10 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-7">
          <div className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted">Returned to agents · all time</div>
          {m ? (
            <div
              className="num mt-3 font-serif text-[184px] leading-[0.8] tracking-[-0.02em] max-md:text-[120px] max-sm:text-[88px]"
              style={{ fontStretch: '62%' }}
            >
              ${m.refunded}
            </div>
          ) : (
            <Skeleton className="mt-4 h-36 w-80" />
          )}
          <p className="mt-6 max-w-xl text-[16px] leading-relaxed text-muted">
            Agents authorized <span className="font-semibold text-ink">{usd(m?.authorized)}</span>. Providers whose work passed verification received{' '}
            <span className="font-semibold text-ink">{usd(m?.settled)}</span>. Everything else went back on-chain, in the same transaction that settled
            the escrow.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <ButtonLink href="/lab">Open Chaos Lab →</ButtonLink>
            <ButtonLink href="/docs" variant="ghost">
              SDK docs
            </ButtonLink>
          </div>
        </div>
        <div className="border-t-2 border-ink lg:col-span-5">
          <LedgerLine label="In escrow now" sub="locked, not yet decided" value={usd(m?.inFlight)} signal />
          <LedgerLine label="Authorized" sub="escrowed by agents" value={usd(m?.authorized)} />
          <LedgerLine label="Captured" sub="paid for verified work" value={usd(m?.settled)} />
          <LedgerLine label="Protected" sub="refunded because the work failed" value={usd(m?.protected)} />
          <div className="flex justify-between py-3 font-mono text-[12px] text-muted">
            <span>pass rate {passRate}</span>
            <span>pacts {m?.pacts ?? '—'}</span>
            <span>active {m?.active ?? '—'}</span>
          </div>
        </div>
      </section>

      <Panel
        kicker="most recent first"
        title="Pacts"
        action={
          <Link href="/pacts" className="text-[13px] text-muted hover:text-ink">
            All pacts →
          </Link>
        }
        pad={false}
      >
        {pacts.loading && !pacts.data ? (
          <div className="space-y-2 py-4">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
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
            <table className="w-full min-w-[860px] text-[14px]">
              <thead>
                <tr className="border-b border-line text-left font-mono text-[10.5px] uppercase tracking-[0.08em] text-faint">
                  <th className="py-2.5 pr-4 font-medium">Pact</th>
                  <th className="py-2.5 pr-4 font-medium">Request</th>
                  <th className="py-2.5 pr-6 text-right font-medium">Captured / held</th>
                  <th className="py-2.5 pr-4 font-medium">State</th>
                  <th className="py-2.5 pr-4 font-medium">Settlement</th>
                  <th className="py-2.5 text-right font-medium">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {pacts.data.pacts.map((p) => (
                  <tr key={p.id} className="transition hover:bg-surface">
                    <td className="py-3.5 pr-4">
                      <Link href={`/pacts/${p.id}`} className="font-mono text-[12.5px] text-muted hover:text-ink hover:underline">
                        {short(p.id, 9, 4)}
                      </Link>
                    </td>
                    <td className="py-3.5 pr-4">
                      <span>{p.service?.name}</span> <span className="text-[13px] text-faint">— {p.service?.provider}</span>
                      {p.scenario && p.scenario !== 'normal' && (
                        <span className="ml-2">
                          <Tag tone="fail">{p.scenario}</Tag>
                        </span>
                      )}
                    </td>
                    <td className="num py-3.5 pr-6 text-right font-serif text-[22px] leading-none">
                      <span className={p.state === 'PROTECTED' ? 'text-faint' : ''}>{p.captured ?? '—'}</span>
                      <span className="text-faint"> / {p.authorized ?? p.maxAmount}</span>
                    </td>
                    <td className="py-3.5 pr-4">
                      <StatePill state={p.state} />
                    </td>
                    <td className="py-3.5 pr-4 text-[12.5px]">
                      {p.settlementTxUrl ? (
                        <a
                          href={p.settlementTxUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono underline decoration-escrow/60 underline-offset-[3px] hover:decoration-escrow"
                        >
                          {short(p.settlementTxUrl.split('/').pop(), 8, 6)}
                        </a>
                      ) : (
                        <span className="font-mono text-faint">—</span>
                      )}
                    </td>
                    <td className="py-3.5 text-right font-mono text-[12px] text-muted">{ago(p.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-x-12 gap-y-14 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Feed />
        <div className="flex flex-col gap-14">
          <Panel kicker={rail.data?.kind === 'tempo' ? 'live on Tempo Moderato' : 'local ledger'} title="Parties & balances" pad={false}>
            {!rail.data ? (
              <div className="space-y-2 py-4">
                <Skeleton className="h-8" />
                <Skeleton className="h-8" />
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {rail.data.parties.map((p) => (
                  <li key={p.address} className="flex items-center justify-between gap-4 py-3 text-[13.5px]">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="w-[64px] font-mono text-[10.5px] uppercase tracking-[0.08em] text-faint">{p.role}</span>
                        <span className="font-medium">{p.name}</span>
                      </div>
                      <div className="mt-0.5 pl-[72px] text-[12px] text-muted">
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
              <div className="py-10 text-[13px] text-muted">Reliability builds up from verified outcomes. No verdicts yet.</div>
            ) : (
              <ul className="divide-y divide-line">
                {m.providers.map((p) => {
                  const rate = p.total ? p.passed / p.total : 0
                  return (
                    <li key={p.serviceId} className="py-3 text-[13.5px]">
                      <div className="flex flex-wrap items-baseline justify-between gap-3">
                        <div>
                          <span className="font-medium">{p.provider}</span> <span className="text-faint">· {p.name}</span>
                        </div>
                        <div className="num font-mono text-[12px] text-muted">
                          <span className="text-ink">{p.passed}</span> / {p.total} verified · {ms(p.avgLatencyMs)} avg
                        </div>
                      </div>
                      <div className="mt-2 flex h-[6px] overflow-hidden bg-fail/25">
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
    </div>
  )
}
