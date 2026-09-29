/**
 * A minimal provider protected by PACT. The only PACT-specific code is
 * `provider.protect(...)`: it refuses unfunded requests and signs every result.
 * Rates are illustrative, not live market data.
 */
import { Hono } from 'hono'
import type { Account } from 'viem'

import { pactProvider, ProviderError, type FetchLike } from '@pact/tempo'
import type { VerificationPolicy } from '@pact/verifier'

export const FX_POLICY: VerificationPolicy = {
  id: 'fx-rates',
  version: 1,
  name: 'FX rates v1',
  description: 'Exactly one positive rate per requested symbol, for the requested base currency, signed and within 2 s.',
  maxLatencyMs: 2_000,
  itemsPath: 'rates',
  topLevelFields: { base: 'string', asOf: 'date', rates: 'array' },
  itemFields: { symbol: 'string', rate: 'number' },
  minItems: 'request.symbols',
  maxItems: 'request.symbols',
  uniqueItemKey: 'symbol',
  echoFields: ['base'],
  requireProviderSignature: true,
  requireRequestBinding: true,
}

export const FX_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    base: { type: 'string', pattern: '^[A-Z]{3}$' },
    symbols: { type: 'array', items: { type: 'string', pattern: '^[A-Z]{3}$' }, minItems: 1, maxItems: 10 },
  },
  required: ['base', 'symbols'],
  additionalProperties: false,
}

const USD: Record<string, number> = { USD: 1, EUR: 0.92, GBP: 0.79, NGN: 1540, KES: 129, JPY: 147, BRL: 5.6 }

export function createFxProvider(o: { account: Account; gateway?: string; fetch?: FetchLike }) {
  const provider = pactProvider(o)
  const app = new Hono()

  app.post('/rates', (c) =>
    provider.protect<{ base?: unknown; symbols?: unknown }>((input) => {
      const base = typeof input.base === 'string' ? input.base : ''
      const symbols = Array.isArray(input.symbols) ? input.symbols.filter((s): s is string => typeof s === 'string') : []
      if (!USD[base] || symbols.length === 0 || symbols.some((s) => !USD[s]))
        throw new ProviderError(422, `supported currencies: ${Object.keys(USD).join(', ')}`)
      return {
        base,
        asOf: new Date().toISOString().slice(0, 10),
        rates: symbols.map((symbol) => ({ symbol, rate: Number((USD[symbol]! / USD[base]!).toFixed(6)) })),
      }
    })(c.req.raw),
  )

  return { app, provider }
}

/** Body for POST /v1/admin/services on the gateway. */
export const fxServiceRegistration = (endpoint: string, providerAddress: string) => ({
  id: 'fx-rates',
  name: 'FX Rates',
  description: 'Spot FX rates for a base currency (illustrative data).',
  providerName: 'Example FX Co.',
  providerAddress,
  endpoint,
  mode: 'sync' as const,
  price: '0.02',
  policyId: FX_POLICY.id,
  policyVersion: FX_POLICY.version,
  capability: 'fx-rates',
  inputSchema: FX_INPUT_SCHEMA,
})
