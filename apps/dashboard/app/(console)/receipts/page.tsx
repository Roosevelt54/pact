'use client'

import Link from 'next/link'
import { useState } from 'react'

import { ButtonLink, Empty, ErrorBox, PageHeader, Panel, Skeleton, Tag } from '@/components/ui'
import { api, ApiError, useApi, useOnEvent } from '@/lib/api'
import { ago, short } from '@/lib/format'
import type { ReceiptVerification, WorkReceipt } from '@/lib/types'

type Row = {
  receiptId: string
  pactId: string
  issuedAt: string
  service: string
  provider: string
  verdict: string
  outcome: 'captured' | 'refunded' | 'none'
  captureAmount: string
  refundAmount: string
}

function VerifyBox({ latest }: { latest: string | null }) {
  const [text, setText] = useState('')
  const [result, setResult] = useState<ReceiptVerification | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const verify = async () => {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      JSON.parse(text)
    } catch {
      setError('That is not valid JSON.')
      setBusy(false)
      return
    }
    try {
      setResult(
        await api<ReceiptVerification>('/v1/receipts/verify', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: text,
        }),
      )
    } catch (e) {
      setError((e as ApiError).message)
    } finally {
      setBusy(false)
    }
  }

  const load = async (tamper: boolean) => {
    if (!latest) return
    try {
      const { receipt } = await api<{ receipt: WorkReceipt }>(`/v1/receipts/${latest}`)
      const settlement = receipt.settlement as { captureAmount: string }
      const doc = tamper
        ? { ...receipt, settlement: { ...settlement, captureAmount: settlement.captureAmount === '0.00' ? '0.40' : '0.00' } }
        : receipt
      setText(JSON.stringify(doc, null, 2))
      setResult(null)
      setError(null)
    } catch (e) {
      setError((e as ApiError).message)
    }
  }

  return (
    <Panel kicker="never trust the document" title="Verify any receipt">
      <p className="text-[13px] text-muted">
        Paste a Work Receipt. The gateway recomputes its digest from the content, derives the id, and recovers the operator signature. Change a
        single character and it fails.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          disabled={!latest}
          onClick={() => void load(false)}
          className="rounded-md border border-line px-2.5 py-1 text-[12px] hover:bg-surface-2 disabled:opacity-40"
        >
          Load latest receipt
        </button>
        <button
          disabled={!latest}
          onClick={() => void load(true)}
          className="rounded-md border border-fail/40 px-2.5 py-1 text-[12px] text-fail hover:bg-fail/10 disabled:opacity-40"
        >
          Load a tampered copy
        </button>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        placeholder='{ "version": "pact.receipt/v1", … }'
        className="mt-3 h-56 w-full resize-y rounded-lg border border-line bg-surface-2 p-3 font-mono text-[11.5px] text-ink outline-none focus:border-prove"
        aria-label="Receipt JSON"
      />
      <button
        onClick={() => void verify()}
        disabled={busy || !text.trim()}
        className="mt-3 rounded-lg bg-ink px-4 py-2 text-[13px] font-semibold text-bg hover:opacity-90 disabled:opacity-50"
      >
        {busy ? 'Verifying…' : 'Verify'}
      </button>
      {error && <div className="mt-3 text-[13px] text-fail">{error}</div>}
      {result && (
        <div className={`anim-in mt-4 rounded-lg border px-4 py-3 ${result.valid ? 'border-settle/40 bg-settle/10' : 'border-fail/40 bg-fail/10'}`}>
          <div className={`font-serif text-[24px] ${result.valid ? 'text-settle' : 'text-fail'}`}>
            {result.valid ? 'Authentic receipt' : 'Receipt rejected'}
          </div>
          <ul className="mt-2 grid grid-cols-1 gap-1 font-mono text-[12px] sm:grid-cols-2">
            {Object.entries(result.checks).map(([k, v]) => (
              <li key={k} className={v ? 'text-settle' : 'text-fail'}>
                {v ? '✓' : '✕'} {k}
              </li>
            ))}
          </ul>
          <div className="mt-2 font-mono text-[11px] text-muted">signer {short(result.signer, 8, 6)}</div>
        </div>
      )}
    </Panel>
  )
}

export default function ReceiptsPage() {
  const { data, error, loading, reload } = useApi<{ receipts: Row[]; signer: string }>('/v1/receipts?limit=60', { refreshMs: 30_000 })
  useOnEvent(() => void reload(), (e) => e.type === 'receipt.issued', 200)

  return (
    <div>
      <PageHeader kicker="proof of paid work" title="Work Receipts" />
      {error && !data && (
        <div className="mb-4">
          <ErrorBox message={error.message} onRetry={() => void reload()} />
        </div>
      )}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Panel
          kicker={data ? `signed by operator ${short(data.signer, 6, 4)}` : 'signed by the PACT operator'}
          title="Issued receipts"
          pad={false}
        >
          {loading && !data ? (
            <div className="space-y-2 p-5">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : !data?.receipts.length ? (
            <Empty
              title="No receipts yet"
              body="A receipt is sealed after every settlement — captured or refunded."
              action={<ButtonLink href="/lab">Run a pact</ButtonLink>}
            />
          ) : (
            <ul className="divide-y divide-line">
              {data.receipts.map((r) => (
                <li key={r.receiptId}>
                  <Link
                    href={`/receipts/${r.receiptId}`}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-5 py-3 hover:bg-surface-2/60"
                  >
                    <div className="min-w-0">
                      <div className="font-mono text-[12.5px]">{r.receiptId}</div>
                      <div className="truncate text-[12px] text-muted">
                        {r.service} · {r.provider} · {ago(r.issuedAt)}
                      </div>
                    </div>
                    <div className="text-right">
                      <Tag tone={r.outcome === 'captured' ? 'settle' : 'protect'}>{r.outcome}</Tag>
                      <div className="num mt-1 font-mono text-[12px]">
                        {r.outcome === 'captured' ? `$${r.captureAmount} paid` : `$${r.refundAmount} back`}
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <VerifyBox latest={data?.receipts[0]?.receiptId ?? null} />
      </div>
    </div>
  )
}
