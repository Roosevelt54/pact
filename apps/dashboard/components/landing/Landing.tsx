'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import { Mark, Wordmark } from '@/components/Logo'
import { useApi } from '@/lib/api'
import { short } from '@/lib/format'
import type { Metrics, PactSummary } from '@/lib/types'

import { EscrowScene, PHASES, phaseOf } from './EscrowScene'

const NPM = 'https://www.npmjs.com/package/@pactpayment/tempo'

function Reveal({ children, className = '', delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          setShown(true)
          io.disconnect()
        }
      },
      { rootMargin: '0px 0px -12% 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return (
    <div ref={ref} data-shown={shown} className={`reveal ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  )
}

/** A headline word that condenses into place on load and widens under the cursor (Archivo's width axis). */
function Word({ children, delay, signal = false }: { children: string; delay: number; signal?: boolean }) {
  return (
    <span className="kinetic block" style={{ animationDelay: `${delay}ms` }}>
      <span className="inline-block transition-[font-stretch] duration-500 ease-out hover:[font-stretch:100%]">
        {children}
        <span className={`ml-[0.04em] inline-block h-[0.16em] w-[0.16em] align-baseline ${signal ? 'bg-escrow' : 'bg-ink'}`} />
      </span>
    </span>
  )
}

function CopyCommand({ cmd }: { cmd: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => {
        void navigator.clipboard?.writeText(cmd).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1400)
        })
      }}
      className="group flex w-full items-center justify-between gap-4 border border-line-strong px-4 py-3 text-left font-mono text-[13px] transition hover:border-ink"
    >
      <span className="min-w-0 truncate">
        <span className="text-escrow">$ </span>
        {cmd}
      </span>
      <span className="text-[11px] uppercase tracking-[0.1em] text-faint group-hover:text-ink">{copied ? 'copied' : 'copy'}</span>
    </button>
  )
}

function PhaseRail({ step }: { step: number }) {
  const phase = phaseOf(step)
  const lines = [
    'The agent answers a 402 by escrowing its budget in a Tempo channel bound to this exact request.',
    "The provider's signed result is checked against a published, deterministic policy. No LLM decides money.",
    'PACT closes the channel: the price to the provider only on PASS. Every other cent returns to the agent.',
  ]
  return (
    <div className="grid grid-cols-3 gap-6 max-md:gap-3">
      {PHASES.map((p, i) => (
        <div key={p} className="min-w-0">
          <div className="relative h-[3px] bg-line">
            <div
              className="absolute inset-y-0 left-0 bg-escrow transition-[width] duration-700 ease-out"
              style={{ width: i < phase ? '100%' : i === phase ? '55%' : '0%' }}
            />
          </div>
          <div className={`mt-3 flex items-baseline gap-3 transition-colors duration-300 ${i === phase ? 'text-ink' : 'text-faint'}`}>
            <span className="font-mono text-[12px]">0{i + 1}</span>
            <span className="font-serif text-[30px] uppercase leading-none max-sm:text-[22px]">{p}</span>
          </div>
          <p className={`mt-2 text-[13.5px] leading-snug transition-opacity duration-300 max-md:hidden ${i === phase ? 'text-muted opacity-100' : 'opacity-40'}`}>
            {lines[i]}
          </p>
        </div>
      ))}
    </div>
  )
}

function LiveStrip() {
  const metrics = useApi<Metrics>('/v1/metrics', { refreshMs: 20_000 })
  const pacts = useApi<{ pacts: PactSummary[] }>('/v1/pacts?limit=16', { refreshMs: 20_000 })
  const m = metrics.data
  const settled = (pacts.data?.pacts ?? []).filter((p) => p.state === 'SETTLED' || p.state === 'PROTECTED')
  if (!m) return null
  const stats = [
    { k: 'authorized by agents', v: `$${m.authorized}` },
    { k: 'paid for verified work', v: `$${m.settled}` },
    { k: 'returned to agents', v: `$${m.refunded}` },
    { k: 'pacts on this gateway', v: String(m.pacts) },
  ]
  return (
    <section className="border-y border-line">
      <div className="mx-auto grid max-w-[1440px] grid-cols-2 px-4 sm:px-6 md:grid-cols-4 md:px-10">
        {stats.map((s, i) => (
          <div key={s.k} className={`py-6 ${i > 0 ? 'md:border-l md:border-line md:pl-6' : ''}`}>
            <div className="num font-serif text-[48px] leading-none">{s.v}</div>
            <div className="mt-2 font-mono text-[11px] uppercase tracking-[0.08em] text-muted">{s.k}</div>
          </div>
        ))}
      </div>
      {settled.length > 0 && (
        <div className="overflow-hidden border-t border-line py-3" aria-label="Recent settlements on Tempo Moderato">
          <div className="marquee flex w-max gap-12 whitespace-nowrap font-mono text-[12px] text-muted">
            {[...settled, ...settled].map((p, i) => (
              <a key={`${p.id}-${i}`} href={p.settlementTxUrl ?? '#'} target="_blank" rel="noreferrer" className="flex items-center gap-3 hover:text-ink">
                <span className={`h-[7px] w-[7px] ${p.state === 'SETTLED' ? 'bg-ink' : 'bg-protect'}`} />
                <span>{p.state === 'SETTLED' ? 'SETTLED' : 'REFUNDED'}</span>
                <span className="text-ink">{p.state === 'SETTLED' ? `$${p.captured} paid` : `$${p.refunded} back`}</span>
                <span>{p.service?.provider}</span>
                <span className="text-faint">tx {short(p.settlementTxUrl?.split('/').pop(), 6, 4)}</span>
              </a>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

const AGENT_CODE = `import { PactClient } from '@pactpayment/tempo'

const pact = PactClient.tempo({ gateway, agentId, privateKey, trustedOperator })

const res = await pact.fetch({
  service: 'sec-filings',
  input: { company: 'NVIDIA', count: 4 },
  maxAmount: '0.50',
})

res.verified    // true only if the result passed the policy
res.settlement  // { captured: '0.40', refunded: '0.10', txUrl }`

const PROVIDER_CODE = `import { pactProvider } from '@pactpayment/tempo'

const provider = pactProvider({ account })

app.post('/filings', (c) =>
  provider.protect(async (input) => lookup(input))(c.req.raw),
)
// signs every result: pact:v1:{pactId}:{requestDigest}:{resultDigest}`

const STEPS = [
  {
    n: '01',
    t: 'Pay',
    b: 'The agent answers a standard MPP 402 by opening a TIP-1034 escrow channel. The channel salt is derived from the pact, so the money is bound to this exact request — not to the provider in general.',
    spec: ['salt = keccak256("pact:v1:" + pactId)', 'payee = provider · operator = PACT', 'voucher = exactly the price'],
  },
  {
    n: '02',
    t: 'Prove',
    b: 'The provider signs what it delivered. PACT runs sixteen deterministic checks against a published policy: bound to the pact, bound to the request, fresh, complete, on time, well-formed.',
    spec: ['EIP-191: pact:v1:{id}:{req}:{result}', '16 checks · reproducible verdict', 'replays and forgeries rejected'],
  },
  {
    n: '03',
    t: 'Settle',
    b: 'PACT closes the channel in one transaction. On PASS the provider is paid the price; on FAIL it gets nothing. The rest returns to the agent, and a signed Work Receipt records why.',
    spec: ['close(captureAmount) on Tempo', 'refund = deposit − capture', 'Work Receipt · verifiable offline'],
  },
]

export function Landing() {
  const [step, setStep] = useState(0)
  const onStep = useCallback((s: number) => setStep(s), [])

  return (
    <div className="overflow-x-clip">
      <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-8 px-4 sm:px-6 md:px-10">
          <Link href="/" aria-label="PACT home">
            <Wordmark size={21} />
          </Link>
          <nav className="flex gap-7 text-[14px] text-muted max-md:hidden">
            <a href="#how" className="hover:text-ink">
              How it works
            </a>
            <Link href="/lab" className="hover:text-ink">
              Chaos Lab
            </Link>
            <Link href="/docs" className="hover:text-ink">
              Developers
            </Link>
            <a href={NPM} target="_blank" rel="noreferrer" className="hover:text-ink">
              npm
            </a>
          </nav>
          <Link
            href="/control"
            className="ml-auto inline-flex shrink-0 items-center gap-2 bg-ink px-4 py-2.5 text-[13.5px] font-semibold text-bg transition hover:bg-escrow hover:text-[#0c0c0b]"
          >
            Enter Control Center <span aria-hidden>→</span>
          </Link>
        </div>
      </header>

      <section className="relative">
        <div aria-hidden className="pointer-events-none absolute inset-0 mx-auto grid max-w-[1440px] grid-cols-12 px-4 sm:px-6 md:px-10">
          {Array.from({ length: 12 }, (_, i) => (
            <div key={i} className="border-l border-line/50 last:border-r" />
          ))}
        </div>
        <div className="relative mx-auto grid max-w-[1440px] grid-cols-1 gap-10 px-4 pb-12 pt-16 sm:px-6 md:px-10 lg:grid-cols-12 lg:pt-24">
          <div className="lg:col-span-8">
            <div className="flex items-center gap-3 font-mono text-[12px] uppercase tracking-[0.1em] text-muted">
              <span className="anim-ring h-[7px] w-[7px] bg-escrow text-escrow" />
              Payment assurance for autonomous agents · live on Tempo
            </div>
            <h1 className="mt-6 font-serif text-[clamp(84px,14vw,208px)] font-bold uppercase leading-[0.8] tracking-[-0.02em]">
              <Word delay={80}>Pay</Word>
              <Word delay={260}>Prove</Word>
              <Word delay={440} signal>
                Settle
              </Word>
            </h1>
          </div>
          <div className="flex flex-col justify-end gap-6 lg:col-span-4">
            <Reveal delay={500}>
              <p className="text-[19px] leading-[1.5]">
                Agents can pay for any API in one line with MPP. Nothing proves the work they paid for arrived.{' '}
                <span className="text-muted">
                  PACT escrows every payment on Tempo, checks the delivered result against a published policy, and releases money only for work
                  that passes. Everything else goes back to the agent, on-chain.
                </span>
              </p>
            </Reveal>
            <Reveal delay={650} className="flex flex-col gap-3">
              <CopyCommand cmd="npm install @pactpayment/tempo viem" />
              <div className="flex flex-wrap gap-2">
                <Link
                  href="/lab"
                  className="inline-flex items-center gap-2 bg-escrow px-4 py-3 text-[14px] font-bold text-[#0c0c0b] transition hover:brightness-110"
                >
                  Break a provider in the Chaos Lab →
                </Link>
                <Link href="/docs" className="inline-flex items-center border border-line-strong px-4 py-3 text-[14px] transition hover:border-ink">
                  Read the docs
                </Link>
              </div>
            </Reveal>
          </div>
        </div>

        <div className="relative mx-auto max-w-[1440px] px-4 pb-20 sm:px-6 md:px-10">
          <div className="border-t-2 border-ink pt-6">
            <PhaseRail step={step} />
          </div>
          <div className="mt-6 overflow-x-auto bg-bg">
            <EscrowScene onStep={onStep} />
          </div>
        </div>
      </section>

      <LiveStrip />

      <section className="mx-auto max-w-[1440px] px-4 py-28 sm:px-6 md:px-10">
        <Reveal>
          <p className="max-w-[1100px] font-serif text-[clamp(44px,6.4vw,96px)] leading-[0.95]">
            An MPP receipt proves money moved.
            <br />
            <span className="text-faint">It does not prove the work arrived.</span>
          </p>
        </Reveal>
        <Reveal delay={150}>
          <p className="mt-8 max-w-xl text-[17px] leading-relaxed text-muted">
            Autonomous agents now spend money without a human reviewing each call. When a provider returns a truncated file, the wrong company or
            nothing at all, the agent has already paid. PACT makes payment conditional on proof — without a new protocol, a custom contract, or an
            LLM in the money path.
          </p>
        </Reveal>
      </section>

      <section id="how" className="mx-auto max-w-[1440px] scroll-mt-20 px-4 pb-28 sm:px-6 md:px-10">
        <div className="grid grid-cols-1 gap-12 md:grid-cols-3 md:gap-8">
          {STEPS.map((s, i) => (
            <Reveal key={s.n} delay={i * 120} className="border-t-2 border-ink pt-5">
              <div className="flex items-baseline justify-between">
                <span className="font-serif text-[64px] uppercase leading-none">{s.t}</span>
                <span className="font-mono text-[13px] text-faint">{s.n}</span>
              </div>
              <p className="mt-5 text-[15px] leading-relaxed text-muted">{s.b}</p>
              <ul className="mt-6 space-y-1.5 border-t border-line pt-4 font-mono text-[12px]">
                {s.spec.map((l) => (
                  <li key={l} className="flex gap-2">
                    <span className="text-escrow">■</span>
                    {l}
                  </li>
                ))}
              </ul>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="border-t border-line bg-surface">
        <div className="mx-auto grid max-w-[1440px] grid-cols-1 gap-12 px-4 py-24 sm:px-6 md:px-10 lg:grid-cols-12">
          <Reveal className="lg:col-span-4">
            <div className="font-mono text-[12px] uppercase tracking-[0.1em] text-muted">For developers</div>
            <h2 className="mt-3 font-serif text-[64px] leading-[0.9]">Two lines on each side of the wire.</h2>
            <p className="mt-5 text-[15px] leading-relaxed text-muted">
              Agents swap <code className="font-mono text-ink">fetch</code> for <code className="font-mono text-ink">pact.fetch</code>. Providers wrap a
              handler. Paid MCP tools work the same way, settling only when the tool output verifies.
            </p>
            <div className="mt-6 flex flex-col gap-2">
              <CopyCommand cmd="npm install @pactpayment/tempo viem" />
              <CopyCommand cmd="npx -p @pactpayment/mcp pact-mcp" />
            </div>
          </Reveal>
          <div className="grid min-w-0 grid-cols-1 gap-8 lg:col-span-8 xl:grid-cols-2">
            {[
              { k: 'agent', code: AGENT_CODE },
              { k: 'provider', code: PROVIDER_CODE },
            ].map((c, i) => (
              <Reveal key={c.k} delay={i * 120} className="min-w-0">
                <div className="flex items-center justify-between border-t-2 border-ink py-2 font-mono text-[11px] uppercase tracking-[0.1em] text-muted">
                  <span>{c.k}</span>
                  <span>typescript</span>
                </div>
                <pre className="overflow-x-auto border-l-2 border-escrow py-4 pl-4 pr-2 font-mono text-[12.5px] leading-[1.7]">{c.code}</pre>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1440px] px-4 py-28 sm:px-6 md:px-10">
        <Link href="/control" className="group block border-t-2 border-ink pt-8">
          <div className="font-mono text-[12px] uppercase tracking-[0.1em] text-muted">Live gateway · Tempo Moderato</div>
          <div className="mt-4 flex flex-wrap items-center gap-x-8 gap-y-4">
            <span className="font-serif text-[clamp(56px,9vw,140px)] uppercase leading-[0.85] transition-[font-stretch] duration-500 group-hover:[font-stretch:90%]">
              Enter the Control Center
            </span>
            <span className="transition-transform duration-500 group-hover:translate-x-3">
              <Mark size={72} className="text-ink" />
            </span>
          </div>
        </Link>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-4 px-4 py-6 font-mono text-[11.5px] text-faint sm:px-6 md:px-10">
          <Wordmark size={15} className="text-muted" />
          <span>Pay · Prove · Settle — the trust layer for autonomous commerce on Tempo</span>
          <span className="flex gap-5">
            <Link href="/docs" className="hover:text-ink">
              docs
            </Link>
            <a href={NPM} target="_blank" rel="noreferrer" className="hover:text-ink">
              npm
            </a>
            <Link href="/receipts" className="hover:text-ink">
              receipts
            </Link>
          </span>
        </div>
      </footer>
    </div>
  )
}
