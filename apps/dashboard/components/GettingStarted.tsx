'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import { useWallet } from '@/lib/wallet'

import { useFaucet } from './WalletButton'

const SEEN_KEY = 'pact-guide-seen'
const linkCls = 'underline decoration-escrow underline-offset-2 disabled:no-underline disabled:opacity-50'

/** First-run checklist: five minutes from "what is this?" to an agent paying for verified work on its own. */
export function GettingStarted() {
  const w = useWallet()
  const faucet = useFaucet()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    try {
      if (!localStorage.getItem(SEEN_KEY)) setOpen(true)
    } catch {
      /* ignore */
    }
  }, [])
  const close = () => {
    setOpen(false)
    try {
      localStorage.setItem(SEEN_KEY, '1')
    } catch {
      /* ignore */
    }
  }

  const funded = w.balance != null && Number(w.balance) > 0
  const steps = [
    {
      key: 'connect',
      title: 'Connect a wallet',
      body: 'MetaMask, Rabby or any browser wallet. PACT adds the Tempo testnet for you.',
      done: w.status === 'connected',
      action:
        w.status === 'unavailable' ? (
          <a href="https://metamask.io/download/" target="_blank" rel="noreferrer" className={linkCls}>
            Install a wallet ↗
          </a>
        ) : (
          <button onClick={() => void w.connect()} className={linkCls}>
            Connect
          </button>
        ),
    },
    {
      key: 'funds',
      title: 'Get test funds',
      body: 'Free pathUSD from the Tempo faucet. Play money — nothing here is real.',
      done: funded,
      action: (
        <button onClick={() => void faucet.claim()} disabled={!w.address || faucet.state === 'sending'} className={linkCls}>
          {faucet.state === 'sending' ? 'Sending…' : 'Claim'}
        </button>
      ),
    },
    {
      key: 'pay',
      title: 'Pay for work with your wallet',
      body: 'In the Chaos Lab, escrow $0.50, let a provider misbehave, and watch the money come back to you.',
      done: Boolean(w.progress.pay),
      action: (
        <Link href="/lab?pay=wallet" onClick={close} className={linkCls}>
          Open the Lab
        </Link>
      ),
    },
    {
      key: 'receipt',
      title: 'Read your Work Receipt',
      body: 'Every payment ends in a signed receipt you can verify offline.',
      done: Boolean(w.progress.receipt),
      action: (
        <Link href="/account#pacts" onClick={close} className={linkCls}>
          My pacts
        </Link>
      ),
    },
    {
      key: 'agent',
      title: 'Fund an agent',
      body: 'Give a bot its own wallet and budget, then let it pay for verified work with no prompts.',
      done: Boolean(w.progress.agent),
      action: (
        <Link href="/account#agents" onClick={close} className={linkCls}>
          Fund my agent
        </Link>
      ),
    },
  ]
  const doneCount = steps.filter((s) => s.done).length

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-5 right-5 z-40 flex items-center gap-3 border border-line-strong bg-surface px-4 py-2.5 text-[13px] font-semibold shadow-[0_18px_40px_-18px_rgba(0,0,0,0.7)] transition hover:border-ink"
      >
        Getting started
        <span className="font-mono text-[11px] text-muted">
          {doneCount}/{steps.length}
        </span>
        <span className="relative h-[3px] w-14 bg-line">
          <span className="absolute inset-y-0 left-0 bg-escrow transition-[width] duration-500" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Getting started"
          className="fixed bottom-20 right-5 z-50 w-[min(420px,calc(100vw-40px))] border border-line-strong bg-surface shadow-[0_30px_80px_-24px_rgba(0,0,0,0.75)]"
        >
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div>
              <div className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-escrow">Testnet · play money</div>
              <div className="mt-1 font-serif text-[30px] leading-none">Try PACT in five steps</div>
              <div className="mt-1.5 text-[12.5px] text-muted">Each takes about a minute.</div>
            </div>
            <button onClick={close} aria-label="Close" className="font-mono text-[12px] text-faint hover:text-ink">
              ✕
            </button>
          </div>
          <ol>
            {steps.map((s, i) => (
              <li key={s.key} className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-start gap-3 border-b border-line px-5 py-3.5 last:border-0">
                <span
                  className={`mt-0.5 inline-flex h-[22px] w-[22px] items-center justify-center font-mono text-[11px] font-bold ${s.done ? 'bg-escrow text-[#0c0c0b]' : 'border border-line-strong text-muted'}`}
                >
                  {s.done ? '✓' : i + 1}
                </span>
                <div className="min-w-0">
                  <div className={`text-[14px] font-semibold ${s.done ? 'text-muted line-through decoration-faint' : ''}`}>{s.title}</div>
                  <div className="mt-0.5 text-[12.5px] leading-snug text-muted">{s.body}</div>
                </div>
                <div className="mt-0.5 shrink-0 text-[12.5px]">{s.done ? <span className="font-mono text-[11px] text-faint">done</span> : s.action}</div>
              </li>
            ))}
          </ol>
          {faucet.message && (
            <div className={`border-t border-line px-5 py-2.5 text-[12px] ${faucet.state === 'error' ? 'text-fail' : 'text-muted'}`}>{faucet.message}</div>
          )}
        </div>
      )}
    </>
  )
}
