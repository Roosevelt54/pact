import Link from 'next/link'

import { DOCS } from '@/lib/docs'

export const metadata = { title: 'Developers' }

const PACKAGES = [
  { name: '@pact/tempo', role: 'The SDK', body: 'PactClient for agents, pactProvider for APIs, TIP-1034 escrow rail for gateways, MPP wire helpers.' },
  { name: '@pact/verifier', role: 'Policies', body: 'Deterministic verification engine. The verdict it returns is the only thing that decides capture.' },
  { name: '@pact/receipts', role: 'Proof', body: 'Seal and verify Work Receipts offline — digest, id and operator signature recomputed from content.' },
  { name: '@pact/mcp', role: 'Agents & tools', body: 'MCP server and client wrapper: mppx’s MPP-over-MCP wire format with escrowed, verified settlement.' },
  { name: '@pact/core', role: 'Primitives', body: 'TIP-20 amounts, canonical digests and the pact state machine.' },
]

const AGENT = `import { PactClient } from '@pact/tempo'

const pact = PactClient.tempo({
  gateway: 'https://pact.example.com',
  agentId: 'agt_researchbot',
  privateKey: process.env.AGENT_KEY,
  trustedOperator: '0x…',              // the gateway operator you trust
})

const res = await pact.fetch({
  service: 'sec-filings',
  input: { company: 'NVIDIA', count: 4 },
  maxAmount: '0.50',                    // escrowed, not paid
})

res.verified   // true only if the result passed the published policy
res.settlement // { captured: '0.40', refunded: '0.10', txUrl }
res.receipt    // signed Work Receipt`

const PROVIDER = `import { pactProvider } from '@pact/tempo'

const provider = pactProvider({ account, gateway: 'https://pact.example.com' })

// Refuses unfunded requests, signs every result it returns.
app.post('/rates', (c) =>
  provider.protect(async (input) => lookupRates(input))(c.req.raw),
)`

export default function DocsHome() {
  return (
    <div>
      <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-escrow">PACT SDK</div>
      <h1 className="mt-1 max-w-3xl font-serif text-[48px] leading-[1.02] tracking-tight max-sm:text-[34px]">
        Payment assurance for autonomous commerce, in one function call.
      </h1>
      <p className="mt-3 max-w-2xl text-[15px] text-muted">
        PACT sits between an agent&apos;s MPP payment and a provider&apos;s work. The agent authorizes into Tempo&apos;s native escrow; the gateway
        verifies the delivered result against a published policy; only verified work is captured. Everything is correlated by the pact id and sealed in
        a signed Work Receipt.
      </p>

      <div className="mt-8 grid grid-cols-1 gap-5 xl:grid-cols-2">
        <div className="min-w-0 rounded-xl border border-line bg-surface">
          <div className="border-b border-line px-4 py-2.5 font-mono text-[11px] text-muted">agent.ts · pay → prove → settle</div>
          <pre className="overflow-x-auto p-4 font-mono text-[12px] leading-relaxed">{AGENT}</pre>
        </div>
        <div className="min-w-0 rounded-xl border border-line bg-surface">
          <div className="border-b border-line px-4 py-2.5 font-mono text-[11px] text-muted">provider.ts · protect an API</div>
          <pre className="overflow-x-auto p-4 font-mono text-[12px] leading-relaxed">{PROVIDER}</pre>
        </div>
      </div>

      <h2 className="mt-12 font-mono text-[11px] uppercase tracking-[0.18em] text-faint">Packages</h2>
      <div className="mt-3 grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 xl:grid-cols-3">
        {PACKAGES.map((p) => (
          <div key={p.name} className="bg-surface p-4">
            <div className="font-mono text-[13px] font-semibold">{p.name}</div>
            <div className="font-mono text-[10.5px] uppercase tracking-wider text-escrow">{p.role}</div>
            <p className="mt-2 text-[13px] text-muted">{p.body}</p>
          </div>
        ))}
        <div className="bg-surface p-4">
          <div className="font-mono text-[13px] font-semibold">apps/gateway</div>
          <div className="font-mono text-[10.5px] uppercase tracking-wider text-escrow">Hosted service</div>
          <p className="mt-2 text-[13px] text-muted">
            The PACT gateway this Control Center observes: MPP authorization, dispatch, verification, receipts, settlement.
          </p>
        </div>
      </div>

      <h2 className="mt-12 font-mono text-[11px] uppercase tracking-[0.18em] text-faint">Documentation</h2>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {DOCS.map((d) => (
          <Link key={d.slug} href={`/docs/${d.slug}`} className="group rounded-xl border border-line bg-surface p-4 transition hover:border-line-strong">
            <div className="font-mono text-[10px] uppercase tracking-wider text-faint">{d.group}</div>
            <div className="mt-1 text-[14.5px] font-semibold group-hover:underline">{d.title}</div>
            <div className="mt-1 text-[13px] text-muted">{d.summary}</div>
          </Link>
        ))}
      </div>
    </div>
  )
}
