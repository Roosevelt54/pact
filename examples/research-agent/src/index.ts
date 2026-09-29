/**
 * An agent that buys research through PACT on Tempo Moderato.
 *
 *   npm run tempo:setup          # funds DEMO_AGENT_PRIVATE_KEY on testnet
 *   npm run dev:api              # gateway with PACT_RAIL=tempo
 *   npm start -w @pact/example-research-agent
 */
import type { Address, Hex } from 'viem'

import { PactClient, PactGateway } from '@pact/tempo'

try {
  process.loadEnvFile('../../.env')
} catch {
  /* env may come from the shell */
}

const gateway = process.env.PACT_GATEWAY_URL ?? 'http://localhost:8787'
const privateKey = process.env.DEMO_AGENT_PRIVATE_KEY as Hex | undefined
if (!privateKey) throw new Error('DEMO_AGENT_PRIVATE_KEY is required (run `npm run tempo:setup`).')

// Pin the operator you trust in production. Discovering it from the gateway is for demos only.
const trustedOperator =
  (process.env.PACT_TRUSTED_OPERATOR as Address | undefined) ?? ((await new PactGateway(gateway).operator()) as Address)

const pact = PactClient.tempo({ gateway, agentId: 'agt_researchbot', privateKey, trustedOperator })

type Filings = { company: string; ticker: string; filings: { form: string; period: string; revenueUsd: number }[] }

const res = await pact.fetch<Filings>({
  service: 'sec-filings',
  input: { company: 'NVIDIA', count: 4 },
  maxAmount: '0.50',
})

console.log(`pact        ${res.pactId}`)
console.log(`state       ${res.state}  verified=${res.verified}  verdict=${res.verdict}`)
if (res.verified && res.data)
  for (const f of res.data.filings) console.log(`  ${f.period} ${f.form} revenue $${f.revenueUsd.toLocaleString()}`)
else console.log(`  reasons: ${res.reasons.join(', ')}`)
console.log(`settlement  captured ${res.settlement?.captured} · refunded ${res.settlement?.refunded}`)
console.log(`            ${res.settlement?.txUrl ?? '(local ledger)'}`)

if (res.receipt) {
  const check = await pact.verifyReceipt(res.receipt)
  console.log(`receipt     ${res.receipt.receiptId} valid=${check.valid}`)
}
