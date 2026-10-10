'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

import { api, ApiError } from '@/lib/api'
import { short } from '@/lib/format'
import { TEMPO_EXPLORER } from '@/lib/tempo'
import { useWallet } from '@/lib/wallet'

/** Asks the gateway's testnet faucet for play money. Shared by the header menu, the guide and the account page. */
export function useFaucet() {
  const w = useWallet()
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const claim = async () => {
    if (!w.address) return
    setState('sending')
    setMessage(null)
    try {
      await api('/v1/faucet', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: w.address }) })
      setState('sent')
      setMessage('Test funds are on the way. They land within a few seconds.')
      setTimeout(() => void w.refreshBalance(), 3000)
      setTimeout(() => void w.refreshBalance(), 8000)
    } catch (e) {
      setState('error')
      setMessage((e as ApiError).message)
    }
  }
  return { claim, state, message }
}

export function WalletButton() {
  const w = useWallet()
  const faucet = useFaucet()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  if (w.status === 'unavailable')
    return (
      <a
        href="https://metamask.io/download/"
        target="_blank"
        rel="noreferrer"
        className="border border-line-strong px-3 py-1.5 text-[12.5px] font-medium transition hover:border-ink"
        title="PACT needs a browser wallet such as MetaMask, Rabby or Coinbase Wallet"
      >
        Get a wallet ↗
      </a>
    )

  if (w.status !== 'connected' || !w.address)
    return (
      <button
        onClick={() => void w.connect()}
        disabled={w.status === 'connecting'}
        className="bg-ink px-3.5 py-1.5 text-[12.5px] font-semibold text-bg transition hover:bg-escrow hover:text-[#0c0c0b] disabled:opacity-60"
      >
        {w.status === 'connecting' ? 'Connecting…' : 'Connect wallet'}
      </button>
    )

  if (!w.onTempo)
    return (
      <button
        onClick={() => void w.switchToTempo()}
        className="bg-escrow px-3.5 py-1.5 text-[12.5px] font-bold text-[#0c0c0b] transition hover:brightness-110"
      >
        Switch to Tempo
      </button>
    )

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-3 border border-line-strong px-3 py-1.5 font-mono text-[12px] transition hover:border-ink"
      >
        <span className="text-ink">{w.balance ?? '…'}</span>
        <span className="text-faint max-lg:hidden">pathUSD</span>
        <span className="h-3 w-px bg-line-strong" />
        <span>{short(w.address, 6, 4)}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-50 w-[280px] border border-line-strong bg-surface shadow-[0_24px_60px_-20px_rgba(0,0,0,0.6)]">
          <div className="border-b border-line px-4 py-3">
            <div className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-faint">Tempo Moderato · testnet</div>
            <div className="mt-1 font-serif text-[30px] leading-none">{w.balance ?? '—'}</div>
            <div className="mt-1 font-mono text-[11px] text-muted">pathUSD · {short(w.address, 8, 6)}</div>
          </div>
          <div className="flex flex-col py-1 text-[13px]">
            <Link href="/account" onClick={() => setOpen(false)} className="px-4 py-2 hover:bg-surface-2">
              My account · pacts & agents
            </Link>
            <button
              onClick={() => void faucet.claim()}
              disabled={faucet.state === 'sending'}
              className="px-4 py-2 text-left hover:bg-surface-2 disabled:opacity-60"
            >
              {faucet.state === 'sending' ? 'Requesting test funds…' : 'Get test funds'}
            </button>
            <a href={`${TEMPO_EXPLORER}/address/${w.address}`} target="_blank" rel="noreferrer" className="px-4 py-2 hover:bg-surface-2">
              View on Tempo explorer ↗
            </a>
            <button onClick={() => void navigator.clipboard?.writeText(w.address!)} className="px-4 py-2 text-left hover:bg-surface-2">
              Copy address
            </button>
            <button
              onClick={() => {
                w.disconnect()
                setOpen(false)
              }}
              className="border-t border-line px-4 py-2 text-left text-muted hover:bg-surface-2 hover:text-ink"
            >
              Disconnect
            </button>
          </div>
          {faucet.message && (
            <div className={`border-t border-line px-4 py-2.5 text-[12px] ${faucet.state === 'error' ? 'text-fail' : 'text-muted'}`}>{faucet.message}</div>
          )}
        </div>
      )}
    </div>
  )
}
