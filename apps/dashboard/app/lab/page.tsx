'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

import { ChecksList, LifecycleRail, MoneyFlow, type FlowStatus } from '@/components/pact'
import { ErrorBox, Hash, Panel, StatePill, Tag } from '@/components/ui'
import { api, ApiError, useApi, useOnEvent } from '@/lib/api'
import { clock } from '@/lib/format'
import { deriveLifecycle, outcomeOf } from '@/lib/lifecycle'
import type { PactDetail, Scenario, Service } from '@/lib/types'

type Mode = 'sync' | 'async'
type Run = { pactId: string; scenario: string; serviceId: string; at: string }

const ASYNC_SCENARIOS: Scenario[] = [
  { id: 'normal', label: 'Normal job', expect: 'PASS', description: 'Report delivered by signed callback.' },
  { id: 'incomplete', label: 'Incomplete report', expect: 'FAIL', description: 'Fewer sections than requested.' },
  { id: 'malformed', label: 'Malformed report', expect: 'FAIL', description: 'Truncated JSON in the callback.' },
  { id: 'duplicate_callback', label: 'Duplicate callback', expect: 'PASS', description: 'Same result delivered twice; settles once.' },
  { id: 'forged', label: 'Forged callback', expect: 'FAIL', description: 'Callback signed by the wrong key is rejected.' },
  { id: 'timeout', label: 'Never delivers', expect: 'FAIL', description: 'Refunded when the 45 s job deadline passes.' },
]

const HISTORY_KEY = 'pact-lab-runs'
const inputCls =
  'mt-1 w-full rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-prove'

function loadHistory(): Run[] {
  try {
    return JSON.parse(sessionStorage.getItem(HISTORY_KEY) ?? '[]') as Run[]
  } catch {
    return []
  }
}

function Banner({ pact }: { pact: PactDetail }) {
  const outcome = outcomeOf(pact.timeline)
  if (outcome === 'settled')
    return (
      <div className="anim-in rounded-xl border border-settle/40 bg-settle/10 px-5 py-4">
        <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-settle">
          Payment authorized → work verified → receipt → settlement
        </div>
        <div className="mt-1 font-serif text-[30px] leading-tight text-settle">Verified. ${pact.captured} settled to the provider.</div>
        <div className="mt-1 text-[13px] text-muted">
          The unused ${pact.refunded} of the authorization went back to the agent in the same settlement transaction.
        </div>
      </div>
    )
  if (outcome === 'protected')
    return (
      <div className="anim-in rounded-xl border border-protect/40 bg-protect/10 px-5 py-4">
        <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-fail">Payment authorized → work verification failed</div>
        <div className="mt-1 font-serif text-[30px] leading-tight text-protect">Settlement protected. Nothing released.</div>
        <div className="mt-1 text-[13px] text-muted">
          {pact.verification?.reasons.length ? `Failed: ${pact.verification.reasons.join(', ')}. ` : 'No valid result arrived before the deadline. '}
          The full ${pact.refunded} authorization was refunded to the agent.
        </div>
      </div>
    )
  if (outcome === 'failed_payment')
    return (
      <div className="rounded-xl border border-fail/40 bg-fail/10 px-5 py-4">
        <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-fail">Payment not authorized</div>
        <div className="mt-1 text-[14px]">The agent could not escrow funds, so no work was dispatched.</div>
      </div>
    )
  const phase = pact.authorization
    ? pact.work?.deliveredAt
      ? 'Verifying the delivered work…'
      : 'Payment authorized. Provider is working…'
    : 'Escrowing the budget on Tempo…'
  return (
    <div className="rounded-xl border border-escrow/40 bg-escrow/5 px-5 py-4">
      <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-escrow">
        <span className="anim-ring h-1.5 w-1.5 rounded-full bg-escrow text-escrow" /> in flight
      </div>
      <div className="mt-1 font-serif text-[28px] leading-tight">{phase}</div>
      <div className="mt-1 text-[13px] text-muted">Funds are locked in escrow and cannot reach the provider until verification passes.</div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-2 py-1 text-[12.5px]">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  )
}

function Stage({ pactId, onRetry, retrying }: { pactId: string; onRetry: (pact: PactDetail) => void; retrying: boolean }) {
  const { data, error, reload } = useApi<{ pact: PactDetail }>(`/v1/pacts/${pactId}`, { refreshMs: 4_000 })
  useOnEvent(() => void reload(), (e) => e.pactId === pactId, 60)
  const pact = data?.pact
  const steps = useMemo(() => deriveLifecycle(pact?.timeline ?? []), [pact?.timeline])
  if (error && !pact) return <ErrorBox message={error.message} onRetry={() => void reload()} />
  if (!pact) return <div className="h-[420px] animate-pulse rounded-xl bg-surface-2" />

  const flow: FlowStatus =
    pact.state === 'SETTLED' ? 'settled' : pact.state === 'PROTECTED' ? 'protected' : pact.authorization ? 'escrowed' : 'none'
  const canRetry = pact.state === 'PROTECTED' && pact.service.id === 'sec-filings' && pact.retries.length === 0

  return (
    <div className="flex flex-col gap-5">
      <Banner pact={pact} />

      <Panel
        kicker={`${pact.service.name} · ${pact.service.provider} · policy ${pact.policy.id}@${pact.policy.version}`}
        title={
          <span className="flex flex-wrap items-center gap-2">
            <Link href={`/pacts/${pact.id}`} className="font-mono text-[13px] hover:underline">
              {pact.id}
            </Link>
            <StatePill state={pact.state} />
            {pact.scenario && (
              <Tag tone={pact.scenario === 'normal' || pact.scenario === 'duplicate_callback' ? 'settle' : 'fail'}>{pact.scenario}</Tag>
            )}
          </span>
        }
      >
        <LifecycleRail steps={steps} />
      </Panel>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        <Panel kicker="where the money went" title="Payment ↔ work">
          <MoneyFlow
            authorized={pact.authorization?.deposit ?? null}
            price={pact.price}
            captured={pact.captured}
            refunded={pact.refunded}
            status={flow}
          />
          <dl className="mt-5 border-t border-line pt-3">
            <Row label={pact.authorization?.openTx ? 'Escrow tx' : 'Channel'}>
              {pact.authorization ? (
                <Hash value={pact.authorization.openTx ?? pact.authorization.channelId} href={pact.authorization.openTxUrl} />
              ) : (
                '—'
              )}
            </Row>
            <Row label="Channel salt">
              <Hash value={pact.authorization?.salt} />
              <div className="font-mono text-[10.5px] text-faint">keccak256(&quot;pact:v1:&quot; + pactId)</div>
            </Row>
            <Row label="Settlement tx">
              {pact.settlement?.txHash ? (
                <Hash value={pact.settlement.txHash} href={pact.settlement.txUrl} />
              ) : (
                <span className="text-faint">pending</span>
              )}
            </Row>
            <Row label="Work receipt">
              {pact.receiptId ? (
                <Link href={`/receipts/${pact.receiptId}`} className="font-mono text-prove underline underline-offset-2">
                  {pact.receiptId}
                </Link>
              ) : (
                <span className="text-faint">issued after settlement</span>
              )}
            </Row>
          </dl>
          {canRetry && (
            <button
              onClick={() => onRetry(pact)}
              disabled={retrying}
              className="mt-4 w-full rounded-lg border border-settle/50 bg-settle/10 px-4 py-2.5 text-[13px] font-semibold text-settle transition hover:bg-settle/20 disabled:opacity-50"
            >
              {retrying ? 'Starting retry…' : 'Retry with Atlas Research ($0.42) →'}
            </button>
          )}
          {pact.retries.length > 0 && (
            <div className="mt-4 text-[12.5px] text-muted">
              Retried as{' '}
              <Link href={`/pacts/${pact.retries[0]!.id}`} className="font-mono text-prove underline">
                {pact.retries[0]!.id}
              </Link>
            </div>
          )}
        </Panel>

        <Panel
          kicker={pact.policy.name}
          title="Verification"
          action={pact.verification && <Tag tone={pact.verification.verdict === 'PASS' ? 'settle' : 'fail'}>{pact.verification.verdict}</Tag>}
        >
          {pact.verification ? (
            <ChecksList checks={pact.verification.checks} />
          ) : (
            <div className="py-6 text-center text-[13px] text-muted">
              {pact.work?.status === 'accepted'
                ? `Async job ${pact.work.jobId} accepted — waiting for the provider's signed callback.`
                : 'Checks run the moment a result (or a timeout) arrives.'}
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}

export default function ChaosLab() {
  const services = useApi<{ services: Service[] }>('/v1/services')
  const scenarios = useApi<{ scenarios: Scenario[] }>('/v1/scenarios')
  const [mode, setMode] = useState<Mode>('sync')
  const [scenario, setScenario] = useState('incomplete')
  const [company, setCompany] = useState('NVIDIA')
  const [count, setCount] = useState(4)
  const [market, setMarket] = useState('Stablecoin payments in West Africa')
  const [sections, setSections] = useState(5)
  const [runs, setRuns] = useState<Run[]>([])
  const [current, setCurrent] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)

  useEffect(() => {
    const h = loadHistory()
    setRuns(h)
    if (h[0]) setCurrent(h[0].pactId)
  }, [])

  const remember = (run: Run) => {
    setRuns((prev) => {
      const next = [run, ...prev.filter((r) => r.pactId !== run.pactId)].slice(0, 20)
      try {
        sessionStorage.setItem(HISTORY_KEY, JSON.stringify(next))
      } catch {
        /* ignore */
      }
      return next
    })
    setCurrent(run.pactId)
  }

  const list = mode === 'sync' ? (scenarios.data?.scenarios ?? []) : ASYNC_SCENARIOS
  const serviceId = mode === 'sync' ? 'sec-filings' : 'market-report'
  const service = services.data?.services.find((s) => s.id === serviceId)

  const launch = async (body: Record<string, unknown>) => {
    setSubmitting(true)
    setRunError(null)
    try {
      const res = await api<{ pactId: string }>('/v1/lab/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify(body),
      })
      remember({ pactId: res.pactId, scenario: String(body.scenario), serviceId: String(body.serviceId), at: new Date().toISOString() })
    } catch (e) {
      setRunError((e as ApiError).message)
    } finally {
      setSubmitting(false)
    }
  }

  const run = () => launch(mode === 'sync' ? { scenario, serviceId, company, count } : { scenario, serviceId, market, sections })

  const retry = (pact: PactDetail) =>
    launch({
      scenario: 'normal',
      serviceId: 'sec-filings-atlas',
      company: typeof pact.request.company === 'string' ? pact.request.company : company,
      count: typeof pact.request.count === 'number' ? pact.request.count : count,
      retryOf: pact.id,
    })

  return (
    <div>
      <div className="mb-6">
        <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-fail">PACT Chaos Lab</div>
        <h1 className="mt-1 font-serif text-[44px] leading-[1.04] tracking-tight max-sm:text-[32px]">Break the provider. Watch the money.</h1>
        <p className="mt-2 max-w-2xl text-[14px] text-muted">
          A real agent pays a real provider through PACT. Pick how the provider misbehaves, run it, and watch the escrow either settle to the
          provider or come back to the agent.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-6 lg:self-start">
          <Panel kicker="1 · configure" title="Request">
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-surface-2 p-1 text-[12.5px]" role="tablist">
              {(['sync', 'async'] as const).map((m) => (
                <button
                  key={m}
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => {
                    setMode(m)
                    setScenario(m === 'sync' ? 'incomplete' : 'normal')
                  }}
                  className={`rounded-md px-2 py-1.5 font-medium transition ${mode === m ? 'bg-surface shadow-sm ring-1 ring-line' : 'text-muted'}`}
                >
                  {m === 'sync' ? 'Paid API call' : 'Async job'}
                </button>
              ))}
            </div>
            <div className="mt-3 text-[12.5px] text-muted">
              {service ? (
                <>
                  <span className="text-ink">{service.name}</span> · {service.provider} ·{' '}
                  <span className="font-mono text-escrow">${service.price}</span>
                </>
              ) : (
                '…'
              )}
            </div>

            {mode === 'sync' ? (
              <div className="mt-3 grid grid-cols-[1fr_84px] gap-2">
                <label className="text-[11.5px] text-muted">
                  Company
                  <input value={company} onChange={(e) => setCompany(e.target.value)} maxLength={80} className={inputCls} />
                </label>
                <label className="text-[11.5px] text-muted">
                  Filings
                  <input
                    type="number"
                    min={1}
                    max={12}
                    value={count}
                    onChange={(e) => setCount(Math.min(12, Math.max(1, Number(e.target.value) || 1)))}
                    className={inputCls}
                  />
                </label>
              </div>
            ) : (
              <div className="mt-3 grid grid-cols-[1fr_84px] gap-2">
                <label className="text-[11.5px] text-muted">
                  Market
                  <input value={market} onChange={(e) => setMarket(e.target.value)} maxLength={80} className={inputCls} />
                </label>
                <label className="text-[11.5px] text-muted">
                  Sections
                  <input
                    type="number"
                    min={1}
                    max={12}
                    value={sections}
                    onChange={(e) => setSections(Math.min(12, Math.max(1, Number(e.target.value) || 1)))}
                    className={inputCls}
                  />
                </label>
              </div>
            )}

            <div className="mt-5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-faint">2 · provider behaviour</div>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              {list.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setScenario(s.id)}
                  aria-pressed={scenario === s.id}
                  className={`rounded-lg border px-2.5 py-2 text-left transition ${
                    scenario === s.id
                      ? s.expect === 'PASS'
                        ? 'border-settle bg-settle/10'
                        : 'border-fail bg-fail/10'
                      : 'border-line hover:bg-surface-2'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[12.5px] font-semibold leading-tight">{s.label}</span>
                    <span className={`font-mono text-[9.5px] ${s.expect === 'PASS' ? 'text-settle' : 'text-fail'}`}>{s.expect}</span>
                  </div>
                  <div className="mt-0.5 text-[11px] leading-snug text-muted">{s.description}</div>
                </button>
              ))}
            </div>

            <button
              onClick={() => void run()}
              disabled={submitting || !service || (mode === 'sync' ? !company.trim() : !market.trim())}
              className="mt-5 w-full rounded-lg bg-ink px-4 py-3 text-[14px] font-semibold text-bg transition hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? 'Starting…' : '3 · Run paid request'}
            </button>
            {runError && <div className="mt-3 text-[12.5px] text-fail">{runError}</div>}
          </Panel>

          {runs.length > 0 && (
            <Panel kicker="this session" title="Runs" className="mt-4" pad={false}>
              <ul className="max-h-64 divide-y divide-line overflow-y-auto">
                {runs.map((r) => (
                  <li key={r.pactId}>
                    <button
                      onClick={() => setCurrent(r.pactId)}
                      className={`flex w-full items-center justify-between gap-2 px-4 py-2 text-left text-[12px] ${current === r.pactId ? 'bg-surface-2' : 'hover:bg-surface-2/60'}`}
                    >
                      <span className="font-mono">{r.scenario}</span>
                      <span className="font-mono text-[10.5px] text-faint">
                        {r.serviceId === 'sec-filings-atlas' ? 'atlas' : r.serviceId} · {clock(r.at)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>

        <div className="min-w-0">
          {services.error && !services.data && (
            <div className="mb-4">
              <ErrorBox message={`${services.error.message} Start the gateway with npm run dev:api.`} onRetry={() => void services.reload()} />
            </div>
          )}
          {current ? (
            <Stage key={current} pactId={current} onRetry={(p) => void retry(p)} retrying={submitting} />
          ) : (
            <div className="rounded-xl border border-dashed border-line-strong p-10">
              <div className="font-serif text-[30px] italic">Nothing running yet.</div>
              <ol className="mt-4 space-y-2 text-[13.5px] text-muted">
                <li>
                  <span className="font-mono text-escrow">PAY</span> — the agent answers a 402 by escrowing its budget in a Tempo channel bound to
                  this exact request.
                </li>
                <li>
                  <span className="font-mono text-prove">PROVE</span> — the provider&apos;s signed result is checked against a published,
                  deterministic policy.
                </li>
                <li>
                  <span className="font-mono text-settle">SETTLE</span> — PACT closes the channel: the price goes to the provider only on PASS;
                  otherwise every cent returns to the agent.
                </li>
              </ol>
              <div className="mt-5 text-[13px]">
                Try <span className="font-semibold">Incomplete response</span> first, then <span className="font-semibold">Normal</span>.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
