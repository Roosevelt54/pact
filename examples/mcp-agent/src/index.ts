/**
 * An MCP agent calling PACT-protected tools. It spawns the PACT MCP server over
 * stdio, wraps its MCP client with `withPact`, and pays -32042 challenges from
 * its own wallet (escrow + voucher), exactly like mppx's MCP flow.
 *
 *   npm run dev:api                          # gateway on Tempo
 *   npm start -w @pact/example-mcp-agent
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { Address, Hex } from 'viem'

import { PACT_META, withPact } from '@pact/mcp'
import { PactClient, PactGateway } from '@pact/tempo'

try {
  process.loadEnvFile('../../.env')
} catch {
  /* env may come from the shell */
}

const gateway = process.env.PACT_GATEWAY_URL ?? 'http://localhost:8787'
const privateKey = process.env.DEMO_AGENT_PRIVATE_KEY as Hex | undefined
if (!privateKey) throw new Error('DEMO_AGENT_PRIVATE_KEY is required (run `npm run tempo:setup`).')
const trustedOperator =
  (process.env.PACT_TRUSTED_OPERATOR as Address | undefined) ?? ((await new PactGateway(gateway).operator()) as Address)

const client = new Client({ name: 'pact-mcp-agent', version: '0.1.0' })
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', '../../packages/mcp/src/bin.ts'],
    env: { PATH: process.env.PATH ?? '', PACT_GATEWAY_URL: gateway },
  }),
)

withPact(client, {
  pact: PactClient.tempo({ gateway, agentId: 'agt_researchbot', privateKey, trustedOperator }),
  onPaymentRequired: (challenge, tool) => {
    const amount = Number((challenge.request as { amount: string }).amount) / 1e6
    console.log(`→ ${tool} requires ${amount} pathUSD (escrowed, captured only if verified)`)
    return true
  },
})

const { tools } = await client.listTools()
console.log(`tools: ${tools.map((t) => t.name).join(', ')}`)

const result = (await client.callTool({ name: 'pact_sec_filings', arguments: { company: 'Apple', count: 2 } })) as {
  isError?: boolean
  content: { text: string }[]
  _meta?: Record<string, unknown>
}
const pact = result._meta?.[PACT_META.result] as {
  verified: boolean
  state: string
  settlement: { captured: string; txUrl: string | null }
}
console.log(`verified=${pact.verified} state=${pact.state} captured=${pact.settlement.captured}`)
console.log(pact.settlement.txUrl ?? '')
console.log(result.content[0]?.text.slice(0, 400))
await client.close()
