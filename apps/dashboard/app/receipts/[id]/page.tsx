'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import type { ReactNode } from 'react'

import { ErrorBox, Hash, Panel, Skeleton, Tag } from '@/components/ui'
import { useApi } from '@/lib/api'
import { short } from '@/lib/format'
import type { RailInfo, ReceiptVerification } from '@/lib/types'

type Receipt = {
  version: string
  receiptId: string
  receiptDigest: string
  pactSignature: string
  pactId: string
  issuedAt: string
  agent: { id: string; address: string }
  service: { id: string; name: string; endpoint: string }
  provider: { name: string; address: string }
  request: { digest: string }
  payment: {
    rail: 'tempo' | 'local'
    chainId: number | null
    token: string
    escrow: string | null
    operator: string
    challengeId: string | null
    channelId: string | null
    channelSalt: string | null
    authorizeTx: string | null
    authorizedAmount: string
    price: string
  }
  result: { digest: string | null; itemCount: number | null; latencyMs: number | null }
  verification: {
    policyId: string
    policyVersion: number
    policyDigest: string
    verdict: string
    reasons: string[]
    checks: { code: string; status: string; detail: string }[]
  }
  settlement: { outcome: string; captureAmount: string; refundAmount: string; txHash: string | null }
}

function Line({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-0.5">
      <span className="shrink-0 text-faint">{k}</span>
      <span className="min-w-0 break-all text-right">{children}</span>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-t border-dashed border-line-strong py-3">
      <div className="mb-1 text-[10.5px] uppercase tracking-[0.2em] text-muted">{title}</div>
      {children}
    </div>
  )
}

export default function ReceiptPage() {
  const { id } = useParams<{ id: string }>()
  const receipt = useApi<{ receipt: Receipt; signer: string }>(`/v1/receipts/${id}`)
  const verify = useApi<ReceiptVerification>(`/v1/receipts/${id}/verify`)
  const rail = useApi<RailInfo>('/v1/rail')

  if (receipt.error && !receipt.data)
    return (
      <ErrorBox
        title={receipt.error.status === 404 ? 'Receipt not found' : 'Could not load receipt'}
        message={receipt.error.status === 404 ? `No receipt ${id} was issued by this gateway.` : receipt.error.message}
      />
    )
  if (!receipt.data) return <Skeleton className="mx-auto h-[640px] max-w-xl" />
  const r = receipt.data.receipt
  const captured = r.settlement.outcome === 'captured'
  const explorer = r.payment.rail === 'tempo' ? rail.data?.explorerUrl : null
  const txHref = explorer && r.settlement.txHash?.startsWith('0x') ? `${explorer}/tx/${r.settlement.txHash}` : null
  const openHref = explorer && r.payment.authorizeTx ? `${explorer}/tx/${r.payment.authorizeTx}` : null

  const download = () => {
    const blob = new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${r.receiptId}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,560px)_minmax(0,1fr)]">
      <article className="anim-in relative mx-auto w-full max-w-[560px] rounded-sm border border-line bg-surface px-7 py-6 font-mono text-[12px] shadow-[0_24px_60px_-30px_rgba(0,0,0,0.5)] max-sm:px-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[15px] font-bold tracking-[0.3em]">PACT</div>
            <div className="text-[10.5px] uppercase tracking-[0.2em] text-faint">work receipt · {r.version}</div>
          </div>
          <div
            className={`rotate-[-6deg] rounded border-2 px-2 py-1 text-[12px] font-bold uppercase tracking-[0.2em] ${captured ? 'border-settle text-settle' : 'border-protect text-protect'}`}
          >
            {captured ? 'verified · paid' : 'protected · refunded'}
          </div>
        </div>
        <div className="mt-4 break-all text-[13px] font-semibold">{r.receiptId}</div>
        <div className="text-faint">{new Date(r.issuedAt).toUTCString()}</div>

        <Section title="request">
          <Line k="pact">
            <Link href={`/pacts/${r.pactId}`} className="text-prove underline">
              {r.pactId}
            </Link>
          </Line>
          <Line k="service">{r.service.name}</Line>
          <Line k="provider">
            {r.provider.name} {short(r.provider.address, 6, 4)}
          </Line>
          <Line k="agent">{short(r.agent.address, 6, 4)}</Line>
          <Line k="request digest">{short(r.request.digest, 14, 6)}</Line>
        </Section>

        <Section title="payment">
          <Line k="rail">{r.payment.rail === 'tempo' ? `tempo · chain ${r.payment.chainId}` : 'local ledger'}</Line>
          <Line k="price">${r.payment.price}</Line>
          <Line k="authorized (escrow)">${r.payment.authorizedAmount}</Line>
          <Line k="channel">{short(r.payment.channelId, 10, 6)}</Line>
          <Line k="channel salt">{short(r.payment.channelSalt, 10, 6)}</Line>
          <Line k="MPP challenge">{short(r.payment.challengeId, 10, 6)}</Line>
          <Line k="open tx">
            {openHref ? (
              <a href={openHref} target="_blank" rel="noreferrer" className="text-prove underline">
                {short(r.payment.authorizeTx, 10, 6)}
              </a>
            ) : (
              short(r.payment.authorizeTx, 10, 6)
            )}
          </Line>
        </Section>

        <Section title="result">
          <Line k="result digest">{short(r.result.digest, 14, 6)}</Line>
          <Line k="items">{r.result.itemCount ?? '—'}</Line>
          <Line k="latency">{r.result.latencyMs == null ? '—' : `${r.result.latencyMs} ms`}</Line>
        </Section>

        <Section title="verification">
          <Line k="policy">
            {r.verification.policyId}@{r.verification.policyVersion}
          </Line>
          <Line k="policy digest">{short(r.verification.policyDigest, 14, 6)}</Line>
          <Line k="verdict">
            <span className={r.verification.verdict === 'PASS' ? 'text-settle' : 'text-fail'}>{r.verification.verdict}</span>
          </Line>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
            {r.verification.checks.map((c) => (
              <span key={c.code} className={c.status === 'pass' ? 'text-settle' : c.status === 'fail' ? 'text-fail' : 'text-faint'}>
                {c.status === 'pass' ? '✓' : c.status === 'fail' ? '✕' : '–'} {c.code}
              </span>
            ))}
          </div>
        </Section>

        <Section title="settlement">
          <div className="flex items-baseline justify-between py-1 text-[14px]">
            <span>captured by provider</span>
            <span className={`num font-bold ${captured ? 'text-settle' : ''}`}>${r.settlement.captureAmount}</span>
          </div>
          <div className="flex items-baseline justify-between py-1 text-[14px]">
            <span>refunded to agent</span>
            <span className="num font-bold text-protect">${r.settlement.refundAmount}</span>
          </div>
          <Line k="settlement tx">
            {txHref ? (
              <a href={txHref} target="_blank" rel="noreferrer" className="text-prove underline">
                {short(r.settlement.txHash, 10, 6)}
              </a>
            ) : (
              short(r.settlement.txHash, 14, 6)
            )}
          </Line>
        </Section>

        <Section title="seal">
          <div className="break-all text-[10.5px] text-muted">{r.receiptDigest}</div>
          <div className="mt-1 break-all text-[10px] text-faint">{r.pactSignature}</div>
          <div className="mt-2 text-faint">signed by operator {short(r.payment.operator, 8, 6)}</div>
        </Section>
      </article>

      <div className="flex flex-col gap-5">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-escrow">
            <Link href="/receipts" className="hover:underline">
              Work Receipts
            </Link>
          </div>
          <h1 className="mt-1 font-serif text-[38px] leading-tight max-sm:text-[30px]">
            One document binds request, payment, result, verdict and settlement.
          </h1>
        </div>

        <Panel kicker="recomputed from the content" title="Independent verification">
          {!verify.data ? (
            <Skeleton className="h-24" />
          ) : (
            <>
              <div className={`font-serif text-[26px] ${verify.data.valid ? 'text-settle' : 'text-fail'}`}>
                {verify.data.valid ? 'Authentic' : 'Invalid'}
              </div>
              <ul className="mt-2 space-y-1 font-mono text-[12.5px]">
                <li className={verify.data.checks.digestMatches ? 'text-settle' : 'text-fail'}>
                  {verify.data.checks.digestMatches ? '✓' : '✕'} digest = sha256(canonical body)
                </li>
                <li className={verify.data.checks.idMatches ? 'text-settle' : 'text-fail'}>
                  {verify.data.checks.idMatches ? '✓' : '✕'} id derived from digest
                </li>
                <li className={verify.data.checks.signatureValid ? 'text-settle' : 'text-fail'}>
                  {verify.data.checks.signatureValid ? '✓' : '✕'} EIP-191 signature recovers to the operator
                </li>
              </ul>
              <div className="mt-3 text-[12.5px]">
                <span className="text-muted">operator </span>
                <Hash value={verify.data.signer} />
              </div>
            </>
          )}
        </Panel>

        <Panel title="Verify it yourself">
          <p className="text-[13px] text-muted">Anyone holding this JSON can check it offline with the SDK — no call to this gateway needed.</p>
          <pre className="mt-3 overflow-x-auto rounded-lg border border-line bg-surface-2 p-3 font-mono text-[11.5px]">{`import { verifyReceipt } from '@pact/receipts'

const r = await verifyReceipt(receipt, '${receipt.data.signer}')
r.valid // → ${verify.data?.valid ?? '…'}`}</pre>
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={download} className="rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-bg hover:opacity-90">
              Download JSON
            </button>
            <Link href={`/pacts/${r.pactId}`} className="rounded-lg border border-line px-3.5 py-2 text-[13px] hover:bg-surface-2">
              Open pact
            </Link>
            {txHref && (
              <a href={txHref} target="_blank" rel="noreferrer" className="rounded-lg border border-line px-3.5 py-2 text-[13px] hover:bg-surface-2">
                Settlement on Tempo ↗
              </a>
            )}
          </div>
          <div className="mt-3">
            <Tag tone={r.payment.rail === 'tempo' ? 'settle' : 'escrow'}>
              {r.payment.rail === 'tempo' ? 'on-chain settlement' : 'local ledger settlement'}
            </Tag>
          </div>
        </Panel>
      </div>
    </div>
  )
}
