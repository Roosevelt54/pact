'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useMemo, useState } from 'react'

import { ChecksList, LifecycleRail, MoneyFlow, type FlowStatus } from '@/components/pact'
import { ErrorBox, Field, Hash, Panel, Skeleton, StatePill, Tag } from '@/components/ui'
import { api, ApiError, useApi, useOnEvent } from '@/lib/api'
import { clock, EVENT_LABELS, eventTone, ms, TONE_TEXT } from '@/lib/format'
import { deriveLifecycle } from '@/lib/lifecycle'
import type { PactDetail } from '@/lib/types'

function pretty(text: string | null) {
  if (!text) return ''
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

export default function PactPage() {
  const { id } = useParams<{ id: string }>()
  const { data, error, reload } = useApi<{ pact: PactDetail }>(`/v1/pacts/${id}`, { refreshMs: 5_000 })
  useOnEvent(() => void reload(), (e) => e.pactId === id, 80)
  const [retrying, setRetrying] = useState(false)
  const [retryMsg, setRetryMsg] = useState<string | null>(null)
  const pact = data?.pact
  const steps = useMemo(() => deriveLifecycle(pact?.timeline ?? []), [pact?.timeline])

  if (error && !pact)
    return (
      <ErrorBox
        title={error.status === 404 ? 'Pact not found' : 'Could not load pact'}
        message={error.status === 404 ? `No pact with id ${id} exists on this gateway.` : error.message}
        onRetry={error.status === 404 ? undefined : () => void reload()}
      />
    )
  if (!pact)
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-2/3" />
        <Skeleton className="h-40" />
        <Skeleton className="h-72" />
      </div>
    )

  const flow: FlowStatus =
    pact.state === 'SETTLED' ? 'settled' : pact.state === 'PROTECTED' ? 'protected' : pact.authorization ? 'escrowed' : 'none'

  const retrySettlement = async () => {
    setRetrying(true)
    setRetryMsg(null)
    try {
      await api(`/v1/pacts/${pact.id}/settlement/retry`, { method: 'POST' })
      setRetryMsg('Settlement retry queued.')
    } catch (e) {
      setRetryMsg((e as ApiError).message)
    } finally {
      setRetrying(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-escrow">
            <Link href="/pacts" className="hover:underline">
              Pacts
            </Link>{' '}
            / {pact.service.name}
          </div>
          <h1 className="mt-1 break-all font-mono text-[24px] font-semibold tracking-tight">{pact.id}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatePill state={pact.state} />
            <Tag>{pact.origin}</Tag>
            {pact.scenario && <Tag tone={pact.scenario === 'normal' ? 'settle' : 'fail'}>{pact.scenario}</Tag>}
            <Tag tone={pact.rail === 'tempo' ? 'settle' : 'escrow'}>{pact.rail === 'tempo' ? 'tempo moderato' : 'local ledger'}</Tag>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {pact.receiptId && (
            <Link href={`/receipts/${pact.receiptId}`} className="rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-bg hover:opacity-90">
              Work Receipt →
            </Link>
          )}
          {pact.state === 'SETTLING' && (
            <button
              onClick={() => void retrySettlement()}
              disabled={retrying}
              className="rounded-lg border border-escrow/50 px-3.5 py-2 text-[13px] font-medium text-escrow hover:bg-escrow/10 disabled:opacity-50"
            >
              {retrying ? 'Queuing…' : 'Retry settlement'}
            </button>
          )}
        </div>
      </div>
      {retryMsg && <div className="text-[13px] text-muted">{retryMsg}</div>}

      <Panel kicker="request → payment authorized → service executing → result → verification → work receipt → settlement" title="Lifecycle">
        <LifecycleRail steps={steps} />
      </Panel>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel kicker="PAY" title="Payment">
          <MoneyFlow
            authorized={pact.authorization?.deposit ?? null}
            price={pact.price}
            captured={pact.captured}
            refunded={pact.refunded}
            status={flow}
          />
          <dl className="mt-5 border-t border-line pt-3">
            <Field label="Budget (maxAmount)">${pact.maxAmount}</Field>
            <Field label="Payer (agent)">
              <Hash value={pact.authorization?.payer} />
            </Field>
            <Field label="Payee (provider)">
              <Hash value={pact.service.providerAddress} />
            </Field>
            <Field label="Channel">
              <Hash value={pact.authorization?.channelId} />
            </Field>
            <Field label="Channel salt">
              <Hash value={pact.authorization?.salt} />
            </Field>
            <Field label="MPP challenge">
              <Hash value={pact.authorization?.challengeId} />
            </Field>
            <Field label="Escrow open tx">
              <Hash value={pact.authorization?.openTx} href={pact.authorization?.openTxUrl} />
            </Field>
            <Field label="Settlement tx">
              <Hash value={pact.settlement?.txHash} href={pact.settlement?.txUrl} />
            </Field>
            {pact.settlement && (
              <Field label="Settlement">
                <span className="font-mono text-[12px]">
                  {pact.settlement.kind} · {pact.settlement.status} · {pact.settlement.attempts} attempt
                  {pact.settlement.attempts === 1 ? '' : 's'}
                </span>
                {pact.settlement.lastError && <div className="font-mono text-[11.5px] text-fail">{pact.settlement.lastError}</div>}
              </Field>
            )}
          </dl>
        </Panel>

        <Panel
          kicker="PROVE"
          title={`Verification · ${pact.policy.name}`}
          action={pact.verification && <Tag tone={pact.verification.verdict === 'PASS' ? 'settle' : 'fail'}>{pact.verification.verdict}</Tag>}
        >
          <p className="mb-3 text-[12.5px] text-muted">{pact.policy.description}</p>
          <div className="mb-3 text-[12px]">
            <span className="text-muted">policy digest </span>
            <Hash value={pact.policy.digest} head={14} tail={6} />
          </div>
          {pact.verification ? (
            <ChecksList checks={pact.verification.checks} />
          ) : (
            <div className="py-6 text-center text-[13px] text-muted">Verification runs as soon as a result or a timeout is recorded.</div>
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel kicker="what the agent paid for" title="Request">
          <dl>
            <Field label="Service">
              {pact.service.name} · {pact.service.provider} <span className="text-muted">({pact.service.mode})</span>
            </Field>
            <Field label="Endpoint">
              <span className="break-all font-mono text-[12px]">{pact.service.endpoint}</span>
            </Field>
            <Field label="Request digest">
              <Hash value={pact.requestDigest} head={14} tail={6} />
            </Field>
          </dl>
          <pre className="mt-3 max-h-64 overflow-auto rounded-lg border border-line bg-surface-2 p-3 font-mono text-[12px]">
            {JSON.stringify(pact.request, null, 2)}
          </pre>
        </Panel>

        <Panel kicker="what the provider delivered" title="Result">
          {pact.work ? (
            <>
              <dl>
                <Field label="Status">
                  <span className="font-mono text-[12px]">
                    {pact.work.status}
                    {pact.work.transportError && <span className="text-fail"> · {pact.work.transportError}</span>}
                    {pact.work.duplicateDeliveries > 0 && (
                      <span className="text-escrow"> · {pact.work.duplicateDeliveries} duplicate(s) ignored</span>
                    )}
                  </span>
                </Field>
                <Field label="HTTP · latency">
                  <span className="font-mono text-[12px]">
                    {pact.work.httpStatus ?? '—'} · {ms(pact.work.latencyMs)} · {pact.work.bytes} bytes
                  </span>
                </Field>
                <Field label="Result digest">
                  <Hash value={pact.work.resultDigest} head={14} tail={6} />
                </Field>
                {pact.work.claimedResultDigest && pact.work.claimedResultDigest !== pact.work.resultDigest && (
                  <Field label="Provider claimed">
                    <span className="text-fail">
                      <Hash value={pact.work.claimedResultDigest} head={14} tail={6} />
                    </span>
                  </Field>
                )}
              </dl>
              {pact.work.bodyPreview ? (
                <pre className="mt-3 max-h-64 overflow-auto rounded-lg border border-line bg-surface-2 p-3 font-mono text-[12px]">
                  {pretty(pact.work.bodyPreview)}
                </pre>
              ) : (
                <div className="mt-3 text-[13px] text-muted">No body received.</div>
              )}
            </>
          ) : (
            <div className="py-6 text-center text-[13px] text-muted">Work is dispatched only after payment is authorized.</div>
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Panel kicker="append-only audit log" title="Timeline" pad={false}>
          <ol className="divide-y divide-line">
            {pact.timeline.map((e) => (
              <li key={e.seq} className="grid grid-cols-[70px_minmax(0,1fr)] gap-3 px-5 py-2.5 text-[12.5px]">
                <span className="font-mono text-[10.5px] text-faint">{clock(e.at)}</span>
                <div className="min-w-0">
                  <div className={`font-medium ${TONE_TEXT[eventTone(e)]}`}>
                    {EVENT_LABELS[e.type] ?? e.type} <span className="font-mono text-[10.5px] font-normal text-faint">· {e.actor}</span>
                  </div>
                  <div className="mt-0.5 break-words font-mono text-[11px] text-muted">
                    {Object.entries(e.data)
                      .filter(([, v]) => v !== null && v !== undefined && v !== '')
                      .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(',') : String(v)}`)
                      .join('  ')}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </Panel>

        <div className="flex flex-col gap-6">
          <Panel kicker="money movements" title="Payment events" pad={false}>
            <ul className="divide-y divide-line">
              {pact.payments.map((p, i) => (
                <li key={i} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-5 py-2.5 text-[12.5px]">
                  <span className="font-mono">{p.kind.replace(/_/g, ' ')}</span>
                  <span className="num font-mono">{p.amount ? `$${p.amount}` : ''}</span>
                  <span className="font-mono text-[10.5px] text-faint">{clock(p.at)}</span>
                </li>
              ))}
            </ul>
          </Panel>
          {pact.failures.length > 0 && (
            <Panel kicker="recorded, never swallowed" title="Failures" pad={false}>
              <ul className="divide-y divide-line">
                {pact.failures.map((f, i) => (
                  <li key={i} className="px-5 py-2.5 text-[12.5px]">
                    <span className="font-mono text-fail">
                      {f.stage}/{f.code}
                    </span>
                    <div className="text-muted">{f.message}</div>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {(pact.retryOf || pact.retries.length > 0) && (
            <Panel title="Related pacts">
              {pact.retryOf && (
                <div className="text-[13px]">
                  Retry of{' '}
                  <Link className="font-mono text-prove underline" href={`/pacts/${pact.retryOf}`}>
                    {pact.retryOf}
                  </Link>
                </div>
              )}
              {pact.retries.map((r) => (
                <div key={r.id} className="mt-1 flex flex-wrap items-center gap-2 text-[13px]">
                  Retried as
                  <Link className="font-mono text-prove underline" href={`/pacts/${r.id}`}>
                    {r.id}
                  </Link>
                  <StatePill state={r.state} />
                </div>
              ))}
            </Panel>
          )}
        </div>
      </div>
    </div>
  )
}
