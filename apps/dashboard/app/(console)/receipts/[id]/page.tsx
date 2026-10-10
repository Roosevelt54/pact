'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect } from 'react'

import { ThermalReceipt } from '@/components/Receipt'
import { ErrorBox, Hash, Panel, Skeleton, Tag } from '@/components/ui'
import { useApi } from '@/lib/api'
import type { RailInfo, ReceiptBody, ReceiptVerification } from '@/lib/types'
import { useWallet } from '@/lib/wallet'

function Check({ ok, children }: { ok: boolean; children: string }) {
  return (
    <li className="flex items-baseline gap-3 border-b border-line py-2 last:border-0">
      <span className={`font-mono text-[12px] font-bold ${ok ? 'text-settle' : 'text-fail'}`}>{ok ? 'PASS' : 'FAIL'}</span>
      <span className="text-[13px]">{children}</span>
    </li>
  )
}

export default function ReceiptPage() {
  const { id } = useParams<{ id: string }>()
  const receipt = useApi<{ receipt: ReceiptBody; signer: string }>(`/v1/receipts/${id}`)
  const verify = useApi<ReceiptVerification>(`/v1/receipts/${id}/verify`)
  const rail = useApi<RailInfo>('/v1/rail')
  const { markDone } = useWallet()
  useEffect(() => {
    if (receipt.data) markDone('receipt')
  }, [receipt.data, markDone])

  if (receipt.error && !receipt.data)
    return (
      <ErrorBox
        title={receipt.error.status === 404 ? 'Receipt not found' : 'Could not load receipt'}
        message={receipt.error.status === 404 ? `No receipt ${id} was issued by this gateway.` : receipt.error.message}
      />
    )
  if (!receipt.data) return <Skeleton className="mx-auto h-[640px] max-w-md" />
  const r = receipt.data.receipt
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
    <div className="grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)]">
      <ThermalReceipt r={r} txHref={txHref} openHref={openHref} full className="mx-auto w-full max-w-[440px]" />

      <div className="flex min-w-0 flex-col gap-10">
        <div>
          <Link href="/receipts" className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted hover:text-ink">
            ← Work Receipts
          </Link>
          <h1 className="mt-2 font-serif text-[56px] leading-[0.94] max-sm:text-[40px]">
            One document binds the request, the payment, the result, the verdict and the settlement.
          </h1>
        </div>

        <Panel kicker="recomputed from the content, not trusted from the document" title="Independent verification">
          {!verify.data ? (
            <Skeleton className="h-24" />
          ) : (
            <>
              <div className={`font-serif text-[40px] leading-none ${verify.data.valid ? 'text-settle' : 'text-fail'}`}>
                {verify.data.valid ? 'Authentic' : 'Invalid'}
              </div>
              <ul className="mt-4">
                <Check ok={verify.data.checks.digestMatches}>digest = sha256(canonical body)</Check>
                <Check ok={verify.data.checks.idMatches}>receipt id is derived from the digest</Check>
                <Check ok={verify.data.checks.signatureValid}>EIP-191 signature recovers to the operator</Check>
              </ul>
              <div className="mt-3 text-[12.5px]">
                <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-faint">operator </span>
                <Hash value={verify.data.signer} />
              </div>
            </>
          )}
        </Panel>

        <Panel title="Verify it yourself" kicker="offline · no call to this gateway">
          <pre className="overflow-x-auto border-l-2 border-escrow bg-surface py-3 pl-4 pr-3 font-mono text-[12px] leading-relaxed">{`import { verifyReceipt } from '@pactpayment/receipts'

const r = await verifyReceipt(receipt, '${receipt.data.signer}')
r.valid // → ${verify.data?.valid ?? '…'}`}</pre>
          <div className="mt-4 flex flex-wrap gap-2">
            <button onClick={download} className="bg-ink px-4 py-2.5 text-[13.5px] font-semibold text-bg transition hover:bg-escrow hover:text-[#0c0c0b]">
              Download JSON
            </button>
            <Link href={`/pacts/${r.pactId}`} className="border border-line-strong px-4 py-2.5 text-[13.5px] transition hover:border-ink">
              Open pact
            </Link>
            {txHref && (
              <a href={txHref} target="_blank" rel="noreferrer" className="border border-line-strong px-4 py-2.5 text-[13.5px] transition hover:border-ink">
                Settlement on Tempo ↗
              </a>
            )}
          </div>
          <div className="mt-4">
            <Tag tone={r.payment.rail === 'tempo' ? 'escrow' : 'neutral'}>
              {r.payment.rail === 'tempo' ? 'on-chain settlement · Tempo' : 'local ledger settlement'}
            </Tag>
          </div>
        </Panel>
      </div>
    </div>
  )
}
