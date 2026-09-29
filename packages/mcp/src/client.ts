/**
 * Agent-side MCP wrapper. Mirrors mppx's `McpClient.wrap`: on JSON-RPC -32042
 * it pays the challenge and retries with `_meta["org.paymentauth/credential"]`.
 * The difference: the credential is created by a PactClient, so the payment is
 * an escrowed authorization bound to the pact rather than an immediate charge.
 */
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { McpError } from '@modelcontextprotocol/sdk/types.js'
import { Mcp } from 'mppx'

import { formatAmount } from '@pact/core'
import type { PactChallenge, PactClient } from '@pact/tempo'

import { PACT_META } from './server.js'

type CallTool = Client['callTool']

export type WithPactOptions = {
  pact: PactClient
  /** Maximum to escrow for a call, given the tool and the challenged price (6-decimal units). Default: price + 25%. */
  budget?: (tool: string, priceUnits: bigint) => string
  /** Called before paying; return false to decline. */
  onPaymentRequired?: (challenge: PactChallenge, tool: string) => boolean | Promise<boolean>
}

export function withPact<C extends Pick<Client, 'callTool'>>(client: C, o: WithPactOptions): C {
  const original: CallTool = client.callTool.bind(client)
  const budget = o.budget ?? ((_tool, price) => formatAmount(price + price / 4n))

  const callTool: CallTool = async (params, resultSchema, options) => {
    const meta = {
      ...(params._meta ?? {}),
      [PACT_META.agent]: o.pact.agentId,
      [PACT_META.idempotencyKey]: (params._meta?.[PACT_META.idempotencyKey] as string | undefined) ?? crypto.randomUUID(),
    }
    try {
      return await original({ ...params, _meta: meta }, resultSchema, options)
    } catch (error) {
      if (!(error instanceof McpError) || error.code !== Mcp.paymentRequiredCode) throw error
      const challenge = (error.data as { challenges?: PactChallenge[] } | undefined)?.challenges?.[0]
      if (!challenge) throw error
      if (o.onPaymentRequired && !(await o.onPaymentRequired(challenge, params.name))) throw error
      const maxAmount = budget(params.name, BigInt((challenge.request as { amount: string }).amount))
      const { credential } = await o.pact.createCredential(challenge, maxAmount)
      return original(
        { ...params, _meta: { ...meta, [PACT_META.maxAmount]: maxAmount, [Mcp.credentialMetaKey]: credential } },
        resultSchema,
        options,
      )
    }
  }
  ;(client as { callTool: CallTool }).callTool = callTool
  return client
}
