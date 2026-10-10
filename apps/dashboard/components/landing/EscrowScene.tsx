'use client'

import { useEffect, useState } from 'react'

/**
 * The PACT lifecycle as a looping motion piece, in two acts:
 *   act 0 — the provider's work passes: $0.40 captured, $0.10 back to the agent, receipt VERIFIED.
 *   act 1 — the work answers about the wrong company: nothing captured, $0.50 back, receipt REFUNDED.
 * Each act runs PAY (escrow closes) → PROVE (request out, result back, checks) → SETTLE (split, receipt prints).
 */

type Act = { cap: string; ref: string; capW: number; failAt: number | null; verdict: string }
const ACTS: Act[] = [
  { cap: '0.40', ref: '0.10', capW: 51, failAt: null, verdict: 'VERIFIED' },
  { cap: '0.00', ref: '0.50', capW: 0, failAt: 4, verdict: 'REFUNDED' },
]
const CHECKS = ['delivered', 'http_ok', 'pact_bound', 'request_bound', 'echo_fields', 'min_items']
/** How long each step holds before the next begins (ms). */
const HOLD = [500, 950, 520, 700, 800, 1500, 1000, 1150, 2600]

const AGENT = 150
const PROVIDER = 1050
const CENTER = 600
const Y = 200
const T = 64
const RED = '#c8203f'

export const PHASES = ['Pay', 'Prove', 'Settle'] as const
export const phaseOf = (step: number) => (step <= 2 ? 0 : step <= 5 ? 1 : 2)

const mono = { fontFamily: 'var(--font-jetbrains), monospace' }

export function EscrowScene({ onStep }: { onStep?: (step: number, act: number) => void }) {
  const [step, setStep] = useState(0)
  const [act, setAct] = useState(0)
  const [still, setStill] = useState(false)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setStill(true)
      setStep(7)
      return
    }
    let s = 0
    let a = 0
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      s += 1
      if (s >= HOLD.length) {
        s = 0
        a = (a + 1) % ACTS.length
        setAct(a)
      }
      setStep(s)
      timer = setTimeout(tick, HOLD[s])
    }
    timer = setTimeout(tick, HOLD[0])
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => onStep?.(step, act), [step, act, onStep])

  const A = ACTS[act]!
  const instant = step === 0 || still
  const ease = (ms: number, delay = 0) => (instant ? 'none' : `transform ${ms}ms cubic-bezier(0.7,0,0.2,1) ${delay}ms, opacity 300ms ${delay}ms`)

  const closed = step >= 2 && step < 6
  const atCenter = step >= 1
  const split = step >= 6
  const capX = split ? (A.capW > 0 ? PROVIDER - A.capW / 2 : AGENT - T / 2) : atCenter ? CENTER - T / 2 : AGENT - T / 2
  const refX = split ? AGENT - (T - A.capW) / 2 : atCenter ? CENTER - T / 2 + A.capW : AGENT - T / 2 + A.capW
  const capFill = split ? 'var(--text)' : 'var(--escrow)'
  const refFill = split ? 'var(--protect)' : 'var(--escrow)'

  return (
    <svg
      viewBox="0 0 1200 520"
      className="h-auto w-full md:min-w-[760px]"
      role="img"
      aria-label="Animated PACT lifecycle: an agent payment is escrowed, the provider's work is verified, and the escrow settles."
    >
      <defs>
        <clipPath id="pact-slot">
          <rect x="640" y="304" width="240" height="216" />
        </clipPath>
      </defs>

      {/* track */}
      <line x1={AGENT} y1={Y} x2={PROVIDER} y2={Y} stroke="var(--line-strong)" strokeDasharray="2 6" />

      {/* parties */}
      {[
        { x: AGENT, anchor: 'start' as const, role: 'AGENT', name: 'ResearchBot', note: 'pays with a budget of $0.50' },
        { x: PROVIDER, anchor: 'end' as const, role: 'PROVIDER', name: 'Northwind Data', note: 'SEC filings · price $0.40' },
      ].map((p) => {
        const tx = p.anchor === 'start' ? p.x - 9 : p.x + 9
        return (
          <g key={p.role}>
            <rect x={p.x - 9} y={Y - 9} width="18" height="18" fill="var(--bg)" stroke="var(--text)" strokeWidth="2" />
            <text x={tx} y={Y - 92} textAnchor={p.anchor} style={mono} fontSize="13" fill="var(--faint)" letterSpacing="1.5">
              {p.role}
            </text>
            <text x={tx} y={Y - 66} textAnchor={p.anchor} fontSize="24" fontWeight="600" fill="var(--text)">
              {p.name}
            </text>
            <text x={tx} y={Y - 44} textAnchor={p.anchor} style={mono} fontSize="13" fill="var(--muted)">
              {p.note}
            </text>
          </g>
        )
      })}

      {/* escrow brackets */}
      <g style={{ transform: `translateX(${closed ? 0 : -46}px)`, transition: ease(320) }}>
        <path d={`M${CENTER - 34} ${Y - 70}H${CENTER - 62}V${Y + 70}H${CENTER - 34}`} fill="none" stroke="var(--text)" strokeWidth="7" />
      </g>
      <g style={{ transform: `translateX(${closed ? 0 : 46}px)`, transition: ease(320) }}>
        <path d={`M${CENTER + 34} ${Y - 70}H${CENTER + 62}V${Y + 70}H${CENTER + 34}`} fill="none" stroke="var(--text)" strokeWidth="7" />
      </g>
      <text x={CENTER} y={Y - 92} textAnchor="middle" style={mono} fontSize="13" fill={closed ? 'var(--escrow)' : 'var(--faint)'} letterSpacing="1.5">
        {closed ? 'ESCROW · LOCKED' : 'TIP-1034 ESCROW'}
      </text>

      {/* request out, result back */}
      <path
        d={`M${CENTER + 70} ${Y - 22}H${PROVIDER - 20}`}
        stroke="var(--text)"
        strokeWidth="2"
        pathLength={1}
        strokeDasharray="1"
        style={{ strokeDashoffset: step >= 3 && step < 6 ? 0 : 1, transition: instant ? 'none' : 'stroke-dashoffset 520ms ease-out' }}
      />
      <text
        x={(CENTER + PROVIDER) / 2 + 20}
        y={Y - 32}
        textAnchor="middle"
        style={{ ...mono, opacity: step >= 3 && step < 6 ? 1 : 0, transition: 'opacity 300ms' }}
        fontSize="12"
        fill="var(--muted)"
      >
        request · sha256:9f2c…e41a
      </text>
      <g
        style={{
          transform: `translateX(${step >= 4 ? CENTER + 78 : PROVIDER - 22}px)`,
          opacity: step >= 4 && step < 6 ? 1 : 0,
          transition: ease(650),
        }}
      >
        <rect x={0} y={Y + 18} width="16" height="16" fill="var(--text)" />
        <text x={8} y={Y + 54} textAnchor="middle" style={mono} fontSize="12" fill="var(--muted)">
          result
        </text>
      </g>

      {/* the money */}
      <g style={{ transform: `translateX(${capX}px)`, transition: ease(900) }}>
        <rect x={0} y={Y - T / 2} width={A.capW || 0.001} height={T} style={{ fill: capFill, transition: instant ? 'none' : 'fill 400ms' }} />
      </g>
      <g style={{ transform: `translateX(${refX}px)`, transition: ease(900, split ? 120 : 0) }}>
        <rect x={0} y={Y - T / 2} width={T - A.capW} height={T} style={{ fill: refFill, transition: instant ? 'none' : 'fill 400ms' }} />
      </g>
      <text
        x={0}
        y={Y + T / 2 + 30}
        textAnchor="middle"
        style={{ ...mono, transform: `translateX(${split ? AGENT : atCenter ? CENTER : AGENT}px)`, transition: ease(900) }}
        fontSize="16"
        fontWeight="700"
        fill={split ? 'var(--protect)' : 'var(--escrow)'}
      >
        {split ? `+${A.ref} back` : '$0.50'}
      </text>
      {split && A.capW > 0 && (
        <text x={PROVIDER} y={Y + T / 2 + 30} textAnchor="middle" style={mono} fontSize="16" fontWeight="700" fill="var(--text)" className="anim-in">
          +{A.cap} paid
        </text>
      )}

      {/* checks */}
      <text x="370" y="322" style={mono} fontSize="12" fill="var(--faint)" letterSpacing="1.5">
        PROVE · deterministic policy
      </text>
      {CHECKS.map((c, i) => {
        const failed = A.failAt === i
        const on = step >= 5
        return (
          <text
            key={c}
            x="370"
            y={350 + i * 24}
            style={{ ...mono, opacity: on ? 1 : 0.18, transition: instant ? 'none' : `opacity 200ms ${on ? i * 190 : 0}ms` }}
            fontSize="15"
            fill={on && failed ? RED : 'var(--text)'}
          >
            {on ? (failed ? '✕' : '✓') : '·'} {c}
            {on && failed ? '  → other company' : ''}
          </text>
        )
      })}

      {/* receipt printing from the slot */}
      <line x1="636" y1="304" x2="884" y2="304" stroke="var(--text)" strokeWidth="3" />
      <text x="640" y="294" style={mono} fontSize="12" fill="var(--faint)" letterSpacing="1.5">
        WORK RECEIPT
      </text>
      <g clipPath="url(#pact-slot)">
        <g style={{ transform: `translateY(${step >= 7 ? 0 : -210}px)`, transition: instant ? 'none' : 'transform 1100ms steps(14, end)' }}>
          <path
            d="M652 304h216v188l-9 8-9-8-9 8-9-8-9 8-9-8-9 8-9-8-9 8-9-8-9 8-9-8-9 8-9-8-9 8-9-8-9 8-9-8-9 8-9-8-9 8-9-8-9 8-9-8-9 8V304z"
            fill="var(--paper)"
          />
          {[
            ['PAY    escrow', '0.50'],
            ['PROVE  checks', A.failAt == null ? '6/6' : '5/6'],
            ['SETTLE capture', A.cap],
            ['       refund', A.ref],
          ].map(([k, v], i) => (
            <g key={k} style={mono} fontSize="12.5" fill="var(--paper-ink)">
              <text x="668" y={336 + i * 22} xmlSpace="preserve">
                {k}
              </text>
              <text x="852" y={336 + i * 22} textAnchor="end">
                {v}
              </text>
            </g>
          ))}
          <line x1="668" y1="424" x2="852" y2="424" stroke="var(--paper-ink)" strokeOpacity="0.3" strokeDasharray="4 3" />
          <text
            x="760"
            y="462"
            textAnchor="middle"
            fontSize="28"
            fontWeight="800"
            style={{ fontStretch: '112%' }}
            fill={A.failAt == null ? 'var(--paper-ink)' : RED}
            letterSpacing="1"
          >
            {A.verdict}
          </text>
        </g>
      </g>
    </svg>
  )
}
