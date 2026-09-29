# Protect an API

Three steps: sign your results, publish a policy, register the service. A complete runnable version is
in `examples/basic-api` (`npm start -w @pactpayment/example-basic-api`).

## 1. Sign every result with `pactProvider`

```ts
import { Hono } from 'hono'
import { privateKeyToAccount } from 'viem/accounts'
import { pactProvider, ProviderError } from '@pactpayment/tempo'

const account = privateKeyToAccount(process.env.PROVIDER_KEY as `0x${string}`)
const provider = pactProvider({ account, gateway: 'https://pact.example.com' })

const app = new Hono()
app.post('/rates', (c) =>
  provider.protect<{ base: string; symbols: string[] }>(async (input) => {
    if (!input.symbols?.length) throw new ProviderError(422, 'symbols required')
    return { base: input.base, asOf: today(), rates: await lookup(input) }
  })(c.req.raw),
)
```

`protect()`:

- rejects requests without valid `x-pact-*` headers (`400`)
- asks the gateway whether the pact is funded, executing and addressed to *you* (`402` otherwise), so
  you never do free work for unpaid requests
- signs `pact:v1:{pactId}:{requestDigest}:{sha256(body)}` with your key and attaches it

For async work, answer `202 { jobId }` and later call `provider.deliver(ctx, result)` — it POSTs the
signed result to the gateway callback carried in the dispatch.

## 2. Publish a verification policy

```bash
curl -X POST $GATEWAY/v1/admin/policies -H "x-admin-token: $PACT_ADMIN_TOKEN" \
  -H 'content-type: application/json' -d '{
  "id": "fx-rates", "version": 1, "name": "FX rates v1",
  "description": "One rate per requested symbol, signed, within 2 s.",
  "maxLatencyMs": 2000, "itemsPath": "rates",
  "topLevelFields": { "base": "string", "asOf": "date", "rates": "array" },
  "itemFields": { "symbol": "string", "rate": "number" },
  "minItems": "request.symbols", "maxItems": "request.symbols",
  "uniqueItemKey": "symbol", "echoFields": ["base"],
  "requireProviderSignature": true, "requireRequestBinding": true
}'
```

See [Verification policies](./verification-policies.md) for every field and check.

## 3. Register the service

```bash
curl -X POST $GATEWAY/v1/admin/services -H "x-admin-token: $PACT_ADMIN_TOKEN" \
  -H 'content-type: application/json' -d '{
  "id": "fx-rates", "name": "FX Rates", "description": "Spot FX rates",
  "providerName": "Example FX Co.", "providerAddress": "0xYourAddress",
  "endpoint": "https://fx.example.com/rates", "mode": "sync", "price": "0.02",
  "policyId": "fx-rates", "policyVersion": 1, "capability": "fx-rates",
  "inputSchema": { "type": "object", "required": ["base", "symbols"] }
}'
```

The service now appears in `GET /v1/services`, as an MCP tool (`pact_fx_rates`), and agents can buy
it with `pact.fetch({ service: 'fx-rates', … })`. You are paid — directly from escrow, on Tempo — only
for results that pass the policy.
