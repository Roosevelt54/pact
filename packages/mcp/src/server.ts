/**
 * PACT MCP server: exposes a gateway's services as MCP tools whose calls go
 * through PAY → PROVE → SETTLE.
 *
 * Wire protocol is MPP-over-MCP exactly as mppx defines it (see `Mcp` in mppx):
 *   1. tools/call without credential  → JSON-RPC error -32042 { httpStatus: 402, challenges: [challenge] }
 *   2. tools/call with _meta["org.paymentauth/credential"] → tool runs, result carries
 *      _meta["org.paymentauth/receipt"] plus the PACT verdict and signed Work Receipt.
 *
 * `autopay` lets hosts that cannot pay (e.g. desktop MCP clients) delegate
 * payment to an agent wallet configured on this server.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'
import { Credential, Mcp, Receipt } from 'mppx'

import { formatAmount, parseAmount } from '@pact/core'
import {
  PactClientError,
  PactGateway,
  type FetchLike,
  type PactClient,
  type PactResult,
  type ServiceInfo,
} from '@pact/tempo'

export const PACT_META = {
  agent: 'org.pact/agent',
  idempotencyKey: 'org.pact/idempotency-key',
  maxAmount: 'org.pact/max-amount',
  result: 'org.pact/result',
  workReceipt: 'org.pact/work-receipt',
} as const

export type PactMcpServerOptions = {
  gateway: string
  fetch?: FetchLike
  /** Only expose these service ids. */
  services?: string[]
  /** Agent id used when the caller does not send `_meta["org.pact/agent"]`. */
  defaultAgentId?: string
  /** Pay on the caller's behalf with this agent client (for hosts without a wallet). */
  autopay?: PactClient
  /** Budget in percent of price when the caller does not set `_meta["org.pact/max-amount"]`. */
  budgetPercent?: number
  timeoutMs?: number
  name?: string
}

export const toolName = (serviceId: string) => `pact_${serviceId.replace(/[^a-zA-Z0-9]/g, '_')}`

const budgetFor = (price: string, percent: number) => formatAmount((parseAmount(price) * BigInt(percent)) / 100n)

function toToolResult(r: PactResult, mppReceipt: Record<string, unknown> | null) {
  const summary = r.verified
    ? JSON.stringify(r.data, null, 2)
    : `PACT verification ${r.verdict === 'EXPIRED' ? 'expired' : 'failed'} (${r.reasons.join(', ') || 'no result'}). ` +
      `Nothing was paid: ${r.settlement?.refunded ?? 'the full authorization'} was refunded to the agent.`
  return {
    content: [{ type: 'text' as const, text: summary }],
    isError: !r.verified,
    _meta: {
      ...(mppReceipt ? { [Mcp.receiptMetaKey]: mppReceipt } : {}),
      [PACT_META.result]: {
        pactId: r.pactId,
        state: r.state,
        verified: r.verified,
        verdict: r.verdict,
        reasons: r.reasons,
        settlement: r.settlement,
      },
      [PACT_META.workReceipt]: r.receipt,
    },
  }
}

export async function createPactMcpServer(o: PactMcpServerOptions) {
  const gateway = new PactGateway(o.gateway, o.fetch)
  const all = await gateway.services()
  const services = o.services ? all.filter((s) => o.services!.includes(s.id)) : all
  const byTool = new Map<string, ServiceInfo>(services.map((s) => [toolName(s.id), s]))
  const percent = o.budgetPercent ?? 125

  const server = new Server({ name: o.name ?? 'pact', version: '0.1.0' }, { capabilities: { tools: {} } })

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: services.map((s) => ({
      name: toolName(s.id),
      title: `${s.name} · ${s.provider}`,
      description:
        `${s.description} Paid via PACT: ${s.price} pathUSD is escrowed on Tempo and only captured if the result ` +
        `passes the ${s.policy} verification policy; otherwise it is refunded. Returns a signed Work Receipt.`,
      inputSchema: s.inputSchema as { type: 'object'; [k: string]: unknown },
      annotations: { readOnlyHint: true, openWorldHint: true },
    })),
  }))

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const service = byTool.get(req.params.name)
    if (!service) throw new McpError(ErrorCode.InvalidParams, `unknown tool ${req.params.name}`)
    const input = (req.params.arguments ?? {}) as Record<string, unknown>
    const meta = (req.params._meta ?? {}) as Record<string, unknown>
    const maxAmount =
      typeof meta[PACT_META.maxAmount] === 'string' ? (meta[PACT_META.maxAmount] as string) : budgetFor(service.price, percent)

    try {
      if (o.autopay) {
        const r = await o.autopay.fetch({ service: service.id, input, maxAmount, ...(o.timeoutMs ? { timeoutMs: o.timeoutMs } : {}) })
        return toToolResult(r, null)
      }

      const credential = meta[Mcp.credentialMetaKey] as Credential.Credential | undefined
      if (!credential) {
        const agentId = (meta[PACT_META.agent] as string | undefined) ?? o.defaultAgentId
        if (!agentId) throw new McpError(ErrorCode.InvalidParams, `set _meta["${PACT_META.agent}"] to your PACT agent id`)
        const pact = await gateway.create({
          agentId,
          service: service.id,
          input,
          maxAmount,
          idempotencyKey: meta[PACT_META.idempotencyKey] as string | undefined,
          origin: 'mcp',
        })
        const challenge = await gateway.challenge(pact.id)
        throw new McpError(Mcp.paymentRequiredCode, 'Payment Required', { httpStatus: 402, challenges: [challenge] })
      }

      const pactId = (credential.challenge?.request as { methodDetails?: { pact?: unknown } } | undefined)?.methodDetails?.pact
      if (typeof pactId !== 'string') throw new McpError(Mcp.invalidParamsCode, 'credential is not for a PACT challenge')
      const { paymentReceipt } = await gateway.submit(pactId, Credential.serialize(credential))
      const r = await gateway.wait(pactId, { timeoutMs: o.timeoutMs })
      const mppReceipt = paymentReceipt ? { ...Receipt.deserialize(paymentReceipt), challengeId: credential.challenge.id } : null
      return toToolResult(r, mppReceipt)
    } catch (error) {
      if (error instanceof McpError) throw error
      if (error instanceof PactClientError)
        throw new McpError(Mcp.paymentVerificationFailedCode, `${error.code}: ${error.message}`, { httpStatus: 402, challenges: [] })
      throw new McpError(Mcp.internalErrorCode, (error as Error).message)
    }
  })

  return { server, services, tools: [...byTool.keys()] }
}
