#!/usr/bin/env node
/**
 * stdio entry point: `npx pact-mcp` (published) or `npx tsx packages/mcp/src/bin.ts` (this repo)
 *
 *   PACT_GATEWAY_URL      gateway base URL (default http://localhost:8787)
 *   PACT_AGENT_ID         agent id used for pacts created through this server
 *   PACT_AGENT_PRIVATE_KEY + PACT_TRUSTED_OPERATOR
 *                         optional: pay on the host's behalf (autopay) — for MCP
 *                         hosts that cannot answer -32042 payment challenges
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { Address, Hex } from 'viem'

import { PactClient } from '@pact/tempo'

import { createPactMcpServer } from './server.js'

const gateway = process.env.PACT_GATEWAY_URL ?? 'http://localhost:8787'
const agentId = process.env.PACT_AGENT_ID
const key = process.env.PACT_AGENT_PRIVATE_KEY as Hex | undefined
const operator = process.env.PACT_TRUSTED_OPERATOR as Address | undefined

const autopay =
  key && operator && agentId
    ? PactClient.tempo({
        gateway,
        agentId,
        privateKey: key,
        trustedOperator: operator,
        ...(process.env.TEMPO_RPC_URL ? { rpcUrl: process.env.TEMPO_RPC_URL } : {}),
      })
    : undefined

const { server, tools } = await createPactMcpServer({
  gateway,
  ...(agentId ? { defaultAgentId: agentId } : {}),
  ...(autopay ? { autopay } : {}),
})
await server.connect(new StdioServerTransport())
console.error(`pact-mcp: ${tools.length} tools from ${gateway}${autopay ? ' (autopay)' : ''}`)
