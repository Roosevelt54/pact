import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpError } from '@modelcontextprotocol/sdk/types.js'
import { Mcp } from 'mppx'
import { afterEach, describe, expect, it } from 'vitest'

import { createPactMcpServer, PACT_META, withPact } from '@pact/mcp'
import type { WorkReceipt } from '@pact/receipts'

import { PUBLIC_URL, testRuntime, type TestRuntime } from './helpers.js'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const fn of cleanup.splice(0)) await fn()
})

async function connect(opts: { autopay?: boolean } = {}) {
  const rt: TestRuntime = testRuntime()
  const { server } = await createPactMcpServer({
    gateway: PUBLIC_URL,
    fetch: rt.route,
    timeoutMs: 15_000,
    ...(opts.autopay ? { autopay: rt.agent } : {}),
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({ name: 'test-agent', version: '1.0.0' })
  await client.connect(clientTransport)
  cleanup.push(async () => {
    await client.close()
    await rt.engine.idle()
    await rt.provider.idle()
    rt.close()
  })
  return { rt, client }
}

type ToolResult = { isError?: boolean; content: { type: string; text: string }[]; _meta?: Record<string, any> }

describe('PACT MCP', () => {
  it('lists every gateway service as a tool with its input schema', async () => {
    const { client } = await connect()
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual(['pact_market_report', 'pact_sec_filings', 'pact_sec_filings_atlas'])
    const filings = tools.find((t) => t.name === 'pact_sec_filings')!
    expect(filings.inputSchema.required).toEqual(['company', 'count'])
    expect(filings.description).toMatch(/escrowed on Tempo/)
  })

  it('answers an unpaid call with the MPP -32042 payment challenge', async () => {
    const { client, rt } = await connect()
    const err = await client
      .callTool({ name: 'pact_sec_filings', arguments: { company: 'NVIDIA', count: 2 }, _meta: { [PACT_META.agent]: rt.agent.agentId } })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(McpError)
    expect((err as McpError).code).toBe(Mcp.paymentRequiredCode)
    const challenge = ((err as McpError).data as { challenges: { method: string; intent: string }[] }).challenges[0]!
    expect(challenge).toMatchObject({ method: 'tempo', intent: 'session' })
  })

  it('pays through withPact, runs the tool and returns verified data with MPP and Work receipts', async () => {
    const { client, rt } = await connect()
    withPact(client, { pact: rt.agent })
    const res = (await client.callTool({ name: 'pact_sec_filings', arguments: { company: 'NVIDIA', count: 3 } })) as ToolResult
    expect(res.isError).toBe(false)
    expect(JSON.parse(res.content[0]!.text).filings).toHaveLength(3)
    expect(res._meta?.[Mcp.receiptMetaKey]).toMatchObject({ method: 'tempo', status: 'success' })
    expect(res._meta?.[PACT_META.result]).toMatchObject({ verified: true, state: 'SETTLED' })
    const receipt = res._meta?.[PACT_META.workReceipt] as WorkReceipt
    expect((await rt.agent.verifyReceipt(receipt)).valid).toBe(true)
  })

  it('returns an error result and refunds when the tool output fails verification', async () => {
    const { client, rt } = await connect()
    withPact(client, {
      pact: rt.agent,
      onPaymentRequired: (challenge) => {
        rt.provider.arm((challenge.request as { methodDetails: { pact: string } }).methodDetails.pact, 'incomplete')
        return true
      },
    })
    const res = (await client.callTool({ name: 'pact_sec_filings', arguments: { company: 'Apple', count: 4 } })) as ToolResult
    expect(res.isError).toBe(true)
    expect(res.content[0]!.text).toMatch(/Nothing was paid/)
    expect(res._meta?.[PACT_META.result]).toMatchObject({ verified: false, state: 'PROTECTED', settlement: { captured: '0.00' } })
  })

  it('autopay mode lets a host without a wallet call paid tools', async () => {
    const { client } = await connect({ autopay: true })
    const res = (await client.callTool({ name: 'pact_sec_filings_atlas', arguments: { company: 'Tesla', count: 2 } })) as ToolResult
    expect(res.isError).toBe(false)
    expect(res._meta?.[PACT_META.result]).toMatchObject({ verified: true, settlement: { captured: '0.42' } })
  })
})
