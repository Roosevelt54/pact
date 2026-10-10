'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'

import { short } from '@/lib/format'
import type { ReceiptBody } from '@/lib/types'

/** Thermal printers have a second ink; PACT spends it only on a refund. */
const RED = '#c8203f'

function L({ k, v, dim = false }: { k: ReactNode; v: ReactNode; dim?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 ${dim ? 'opacity-60' : ''}`}>
      <span className="shrink-0 whitespace-pre">{k}</span>
      <span className="min-w-0 truncate text-right">{v}</span>
    </div>
  )
}

const Rule = () => <div className="thermal-rule my-3" />

/**
 * A Work Receipt printed as a till slip: PAY, PROVE and SETTLE line by line, the verdict at the foot.
 * `full` adds the seal (digest + operator signature) and every check.
 */
export function ThermalReceipt({
  r,
  txHref,
  openHref,
  full = false,
  animate = true,
  className = '',
}: {
  r: ReceiptBody
  txHref?: string | null
  openHref?: string | null
  full?: boolean
  animate?: boolean
  className?: string
}) {
  const captured = r.settlement.outcome === 'captured'
  const passed = r.verification.checks.filter((c) => c.status === 'pass').length
  const failed = r.verification.checks.filter((c) => c.status === 'fail')
  const link = (href: string | null | undefined, text: string) =>
    href ? (
      <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2">
        {text}
      </a>
    ) : (
      text
    )

  return (
    <div className={`thermal-shadow ${className}`}>
      <article
        className={`thermal relative px-6 pb-9 pt-8 font-mono text-[12px] leading-[1.75] ${animate ? 'anim-print' : ''}`}
        aria-label={`Work Receipt ${r.receiptId}`}
      >
        <div className="text-center">
          <div className="text-[13px] font-bold tracking-[0.28em]">PACT · WORK RECEIPT</div>
          <div className="text-[10.5px] opacity-60">
            {r.receiptId} · {new Date(r.issuedAt).toISOString().replace('T', ' ').slice(0, 19)} UTC
          </div>
        </div>
        <Rule />
        <L k={r.service.name} v={r.provider.name} />
        <L
          k="pact"
          v={
            <Link href={`/pacts/${r.pactId}`} className="underline underline-offset-2">
              {short(r.pactId, 9, 4)}
            </Link>
          }
          dim
        />
        <L k="agent" v={short(r.agent.address, 6, 4)} dim />
        <Rule />
        <L k="PAY    escrow" v={r.payment.authorizedAmount} />
        <L k="       price" v={r.payment.price} dim />
        {full && <L k="       open tx" v={link(openHref, short(r.payment.authorizeTx, 6, 4))} dim />}
        <L k="PROVE  checks" v={`${passed}/${r.verification.checks.length}`} />
        {failed.map((c) => (
          <L key={c.code} k={<span style={{ color: RED }}>{`  x ${c.code}`}</span>} v={<span style={{ color: RED }}>fail</span>} />
        ))}
        <L k="       policy" v={`${r.verification.policyId}@${r.verification.policyVersion}`} dim />
        <L k="SETTLE capture" v={r.settlement.captureAmount} />
        <L k="       refund" v={r.settlement.refundAmount} />
        <Rule />
        <div
          className="text-center text-[30px] font-extrabold leading-none tracking-[0.06em]"
          style={{ fontFamily: 'var(--font-archivo)', fontStretch: '112%', color: captured ? undefined : RED }}
        >
          {captured ? 'VERIFIED' : 'REFUNDED'}
        </div>
        <div className="mt-2 text-center text-[11px] opacity-70">
          {captured ? 'provider paid for verified work' : 'nothing released · agent made whole'}
        </div>
        <div className="mt-1 text-center text-[11px]">tx {link(txHref, short(r.settlement.txHash, 8, 6))}</div>
        {full && (
          <>
            <Rule />
            <div className="text-[10px] uppercase tracking-[0.2em] opacity-60">checks</div>
            <div className="mt-1 flex flex-wrap gap-x-3 text-[11px]">
              {r.verification.checks.map((c) => (
                <span key={c.code} style={c.status === 'fail' ? { color: RED } : undefined} className={c.status === 'skip' ? 'opacity-40' : ''}>
                  {c.status === 'pass' ? '+' : c.status === 'fail' ? 'x' : '-'} {c.code}
                </span>
              ))}
            </div>
            <Rule />
            <div className="text-[10px] uppercase tracking-[0.2em] opacity-60">seal</div>
            <div className="break-all text-[10.5px]">{r.receiptDigest}</div>
            <div className="mt-1 break-all text-[9.5px] opacity-60">{r.pactSignature}</div>
            <div className="mt-2 text-center text-[10.5px] opacity-70">signed by operator {short(r.payment.operator, 8, 6)}</div>
          </>
        )}
      </article>
    </div>
  )
}
