'use client'

import Link from 'next/link'
import { useState, type ReactNode } from 'react'
import { formatUnits, parseUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

import { Hash, Panel, StatePill } from '@/components/ui'
import { useFaucet } from '@/components/WalletButton'
import { useApi } from '@/lib/api'
import { ago, short } from '@/lib/format'
import { agentIdOf, transferPathUsd, txUrl, walletError, type PayStep } from '@/lib/tempo'
import type { PactSummary } from '@/lib/types'
import { useWallet, type AgentKey } from '@/lib/wallet'

type AgentInfo = { agent: { balance: string | null } }
const STEP_TEXT: Record<PayStep, string> = {
  escrow: 'Agent is opening its escrow on Tempo…',
  confirming: 'Waiting for Tempo to confirm the escrow…',
  voucher: 'Agent is signing the voucher…',
  submitted: 'Submitted. PACT is checking the work…',
}

function PactsTable({ agentId, empty }: { agentId: string; empty: ReactNode }) {
  const { data } = useApi<{ pacts: PactSummary[] }>(`/v1/pacts?agent=${agentId}&limit=25`, { refreshMs: 8_000 })
  if (!data) return <div className="h-16 animate-pulse bg-surface-2" />
  if (!data.pacts.length) return <div className="py-6 text-[13.5px] text-muted">{empty}</div>
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-[13.5px]">
        <thead>
          <tr className="border-b border-line text-left font-mono text-[10.5px] uppercase tracking-[0.08em] text-faint">
            <th className="py-2 pr-4 font-medium">Pact</th>
            <th className="py-2 pr-4 font-medium">Request</th>
            <th className="py-2 pr-4 text-right font-medium">Paid / escrowed</th>
            <th className="py-2 pr-4 font-medium">State</th>
            <th className="py-2 text-right font-medium">When</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {data.pacts.map((p) => (
            <tr key={p.id}>
              <td className="py-3 pr-4">
                <Link href={`/pacts/${p.id}`} className="font-mono text-[12.5px] underline decoration-escrow/60 underline-offset-[3px]">
                  {short(p.id, 9, 4)}
                </Link>
              </td>
              <td className="py-3 pr-4">
                {p.service?.name} <span className="text-faint">— {p.service?.provider}</span>
                {p.scenario && p.scenario !== 'normal' && <span className="ml-2 font-mono text-[11px] text-fail">{p.scenario}</span>}
              </td>
              <td className="num py-3 pr-4 text-right font-mono">
                {p.captured ?? '—'} <span className="text-faint">/ {p.authorized ?? p.maxAmount}</span>
              </td>
              <td className="py-3 pr-4">
                <StatePill state={p.state} />
              </td>
              <td className="py-3 text-right font-mono text-[12px] text-muted">{ago(p.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AgentCard({ agent }: { agent: AgentKey }) {
  const w = useWallet()
  const agentId = agentIdOf(agent.address)
  const info = useApi<AgentInfo>(`/v1/agents/${agentId}`, { refreshMs: 10_000 })
  const [amount, setAmount] = useState('2.00')
  const [busy, setBusy] = useState<'fund' | 'task' | 'withdraw' | null>(null)
  const [stepText, setStepText] = useState<string | null>(null)
  const [note, setNote] = useState<{ text: string; tone: 'ok' | 'err'; href?: string } | null>(null)
  const [reveal, setReveal] = useState(false)
  const balance = info.data?.agent.balance ?? null

  const run = async (label: 'fund' | 'task' | 'withdraw', fn: () => Promise<{ text: string; href?: string }>) => {
    setBusy(label)
    setStepText(null)
    setNote(null)
    try {
      setNote({ ...(await fn()), tone: 'ok' })
    } catch (e) {
      setNote({ text: walletError(e), tone: 'err' })
    } finally {
      setBusy(null)
      setStepText(null)
      void info.reload()
      void w.refreshBalance()
    }
  }

  const fund = () =>
    run('fund', async () => {
      if (!w.signer) throw new Error('Connect your wallet first.')
      if (!w.onTempo) await w.switchToTempo()
      const units = parseUnits(amount || '0', 6)
      if (units <= 0n) throw new Error('Enter an amount above zero.')
      setStepText('Confirm the transfer in your wallet…')
      const hash = await transferPathUsd(w.signer, agent.address, units)
      w.markDone('agent')
      return { text: `Moved ${amount} pathUSD into your agent's budget.`, href: txUrl(hash) }
    })

  const task = () =>
    run('task', async () => {
      const client = await w.agentClient(agent, (s) => setStepText(STEP_TEXT[s]))
      setStepText('Agent is asking for the work…')
      const res = await client.fetch({ service: 'sec-filings', input: { company: 'NVIDIA', count: 4 }, maxAmount: '0.50', timeoutMs: 120_000 })
      return {
        text: res.verified
          ? `Verified. The provider was paid $${res.settlement?.captured}; $${res.settlement?.refunded} came back to the agent.`
          : `Not verified. Nothing was paid; $${res.settlement?.refunded} came back to the agent.`,
        href: res.settlement?.txUrl ?? undefined,
      }
    })

  const withdraw = () =>
    run('withdraw', async () => {
      const units = balance ? parseUnits(balance, 6) : 0n
      const reserve = parseUnits('0.10', 6) // left behind to pay the transfer's own network fee
      if (units <= reserve) throw new Error('Nothing to withdraw beyond the 0.10 fee reserve.')
      setStepText('Agent is sending its balance back to you…')
      const hash = await transferPathUsd({ kind: 'key', account: privateKeyToAccount(agent.key) }, agent.owner, units - reserve)
      return { text: `Sent ${formatUnits(units - reserve, 6)} pathUSD back to your wallet.`, href: txUrl(hash) }
    })

  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const env = `PACT_GATEWAY=${origin}/api
PACT_AGENT_ID=${agentId}
PACT_AGENT_KEY=${reveal ? agent.key : `${'•'.repeat(18)}  (reveal to copy)`}`

  return (
    <div className="border-t-2 border-ink">
      <div className="grid grid-cols-1 gap-8 py-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-faint">Agent wallet · created {ago(agent.createdAt)}</div>
          <div className="mt-2 flex items-end gap-3">
            <span className="num font-serif text-[56px] leading-[0.85]">{balance ?? '…'}</span>
            <span className="pb-1 font-mono text-[12px] text-muted">pathUSD budget</span>
          </div>
          <div className="mt-2 text-[12.5px] text-muted">
            <Hash value={agent.address} href={`https://explore.testnet.tempo.xyz/address/${agent.address}`} />
          </div>

          <div className="mt-5 flex flex-wrap items-stretch gap-2">
            <div className="flex border border-line-strong">
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                inputMode="decimal"
                aria-label="Amount to fund"
                className="w-20 bg-transparent px-3 font-mono text-[13px] outline-none"
              />
              <button
                onClick={() => void fund()}
                disabled={!!busy}
                className="bg-escrow px-4 py-2.5 text-[13px] font-bold text-[#0c0c0b] transition hover:brightness-110 disabled:opacity-50"
              >
                {busy === 'fund' ? 'Funding…' : 'Fund from my wallet'}
              </button>
            </div>
            <button
              onClick={() => void task()}
              disabled={!!busy || !balance || Number(balance) < 0.6}
              title={!balance || Number(balance) < 0.6 ? 'Fund the agent with at least 0.60 first' : undefined}
              className="bg-ink px-4 py-2.5 text-[13px] font-semibold text-bg transition hover:opacity-90 disabled:opacity-40"
            >
              {busy === 'task' ? 'Agent is working…' : 'Let it pay for a task'}
            </button>
            <button
              onClick={() => void withdraw()}
              disabled={!!busy}
              className="border border-line-strong px-4 py-2.5 text-[13px] transition hover:border-ink disabled:opacity-40"
            >
              Withdraw to my wallet
            </button>
          </div>
          {stepText && <div className="mt-3 font-mono text-[12px] text-escrow">{stepText}</div>}
          {note && (
            <div className={`mt-3 text-[13px] ${note.tone === 'err' ? 'text-fail' : ''}`}>
              {note.text}{' '}
              {note.href && (
                <a href={note.href} target="_blank" rel="noreferrer" className="underline decoration-escrow underline-offset-2">
                  transaction ↗
                </a>
              )}
            </div>
          )}
        </div>

        <div className="min-w-0">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-faint">Use this agent from your own code</div>
          <pre className="mt-2 overflow-x-auto border-l-2 border-escrow bg-surface py-3 pl-4 pr-3 font-mono text-[12px] leading-relaxed">{env}</pre>
          <pre className="mt-2 overflow-x-auto bg-surface py-3 pl-4 pr-3 font-mono text-[12px] leading-relaxed">{`import { PactClient } from '@pactpayment/tempo'

const gateway = process.env.PACT_GATEWAY
const pact = PactClient.tempo({
  gateway,
  agentId: process.env.PACT_AGENT_ID,
  privateKey: process.env.PACT_AGENT_KEY,
  trustedOperator: (await fetch(\`\${gateway}/v1/rail\`).then((r) => r.json())).operator,
})

await pact.fetch({ service: 'sec-filings', input: { company: 'NVIDIA', count: 4 }, maxAmount: '0.50' })`}</pre>
          <div className="mt-2 flex flex-wrap gap-4 text-[12.5px]">
            <button onClick={() => setReveal((r) => !r)} className="underline decoration-escrow underline-offset-2">
              {reveal ? 'Hide key' : 'Reveal key'}
            </button>
            {reveal && (
              <button onClick={() => void navigator.clipboard?.writeText(env)} className="underline decoration-escrow underline-offset-2">
                Copy .env
              </button>
            )}
            <button
              onClick={() => {
                if (confirm('Forget this agent in this browser? Its key is deleted here; any funds stay at its address.')) w.removeAgent(agent.address)
              }}
              className="text-muted hover:text-fail"
            >
              Forget agent
            </button>
          </div>
          <p className="mt-2 text-[11.5px] text-faint">Testnet only. The key was generated in this browser and is stored only here — never sent to PACT.</p>
        </div>
      </div>
      <div className="pb-2">
        <div className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-faint">This agent&apos;s pacts</div>
        <PactsTable agentId={agentId} empty="No pacts yet. Fund it, then let it pay for a task." />
      </div>
    </div>
  )
}

export default function AccountPage() {
  const w = useWallet()
  const faucet = useFaucet()

  if (w.status !== 'connected' || !w.address)
    return (
      <div className="max-w-3xl">
        <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">Account</div>
        <h1 className="mt-2 font-serif text-[72px] leading-[0.9] max-sm:text-[46px]">Bring your own wallet.</h1>
        <p className="mt-5 text-[16px] leading-relaxed text-muted">
          Connect a browser wallet to pay for verified work yourself, see every pact and refund tied to your address, and give an agent its own
          budget. Everything here runs on the Tempo testnet with free play money.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          {w.status === 'unavailable' ? (
            <a href="https://metamask.io/download/" target="_blank" rel="noreferrer" className="bg-escrow px-5 py-3 text-[14px] font-bold text-[#0c0c0b]">
              Install a wallet ↗
            </a>
          ) : (
            <button
              onClick={() => void w.connect()}
              className="bg-escrow px-5 py-3 text-[14px] font-bold text-[#0c0c0b] transition hover:brightness-110"
            >
              {w.status === 'connecting' ? 'Connecting…' : 'Connect wallet'}
            </button>
          )}
          <Link href="/lab" className="border border-line-strong px-5 py-3 text-[14px] transition hover:border-ink">
            Or watch the demo agent in the Lab
          </Link>
        </div>
        {w.error && <div className="mt-4 text-[13px] text-fail">{w.error}</div>}
      </div>
    )

  return (
    <div className="flex flex-col gap-14">
      <section className="grid grid-cols-1 gap-x-12 gap-y-8 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-7">
          <div className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted">Your wallet · Tempo Moderato</div>
          <div
            className="num mt-3 font-serif text-[150px] leading-[0.8] tracking-[-0.02em] max-md:text-[96px]"
            style={{ fontStretch: '62%' }}
          >
            {w.balance ?? '…'}
          </div>
          <div className="mt-3 break-all font-mono text-[13px] text-muted">pathUSD · {w.address}</div>
        </div>
        <div className="flex flex-col justify-end gap-3 lg:col-span-5">
          <button
            onClick={() => void faucet.claim()}
            disabled={faucet.state === 'sending'}
            className="bg-escrow px-5 py-3 text-left text-[14px] font-bold text-[#0c0c0b] transition hover:brightness-110 disabled:opacity-60"
          >
            {faucet.state === 'sending' ? 'Requesting test funds…' : 'Get free test funds →'}
          </button>
          <Link href="/lab?pay=wallet" className="border border-line-strong px-5 py-3 text-[14px] transition hover:border-ink">
            Pay for verified work in the Chaos Lab →
          </Link>
          {faucet.message && <div className={`text-[12.5px] ${faucet.state === 'error' ? 'text-fail' : 'text-muted'}`}>{faucet.message}</div>}
        </div>
      </section>

      <section id="pacts" className="scroll-mt-20">
        <Panel kicker={`paid from ${short(w.address, 6, 4)}`} title="My pacts" pad={false}>
          <PactsTable
            agentId={agentIdOf(w.address)}
            empty={
              <>
                You haven&apos;t paid for anything yet.{' '}
                <Link href="/lab?pay=wallet" className="underline decoration-escrow underline-offset-2">
                  Try the Chaos Lab with your wallet
                </Link>
                .
              </>
            }
          />
        </Panel>
      </section>

      <section id="agents" className="scroll-mt-20">
        <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <div className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted">Fund my agent</div>
            <h2 className="mt-2 font-serif text-[56px] leading-[0.9]">Give a bot a budget, not your wallet.</h2>
          </div>
          <p className="self-end text-[14.5px] leading-relaxed text-muted lg:col-span-5">
            An agent gets its own wallet. You move a budget into it; it pays for work on its own with PACT — no wallet prompts — and can only ever
            lose what verification lets through. Withdraw what&apos;s left whenever you like.
          </p>
        </div>
        <div className="flex flex-col gap-10">
          {w.agents.map((a) => (
            <AgentCard key={a.address} agent={a} />
          ))}
          <div className="border-t-2 border-ink pt-5">
            <button
              onClick={() => w.createAgent()}
              className="bg-ink px-5 py-3 text-[14px] font-semibold text-bg transition hover:bg-escrow hover:text-[#0c0c0b]"
            >
              {w.agents.length ? 'Create another agent wallet' : 'Create an agent wallet'}
            </button>
            <p className="mt-2 text-[12px] text-faint">Creates a fresh key in this browser. Nothing is sent anywhere until you fund it.</p>
          </div>
        </div>
      </section>
    </div>
  )
}
