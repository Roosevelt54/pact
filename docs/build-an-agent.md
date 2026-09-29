# Build a paying agent

```ts
import { PactClient } from '@pactpayment/tempo'

const pact = PactClient.tempo({
  gateway: 'https://pact.example.com',
  agentId: 'agt_researchbot',
  privateKey: process.env.AGENT_KEY as `0x${string}`,
  trustedOperator: '0xGatewayOperator',   // pin the operator you trust
})

const res = await pact.fetch<{ filings: { period: string }[] }>({
  service: 'sec-filings',
  input: { company: 'NVIDIA', count: 4 },
  maxAmount: '0.50',
})

if (res.verified) use(res.data)
else console.log('refunded:', res.settlement?.refunded, 'because', res.reasons)

const proof = await pact.verifyReceipt(res.receipt!)   // offline check
```

## What `fetch` does

1. **create** — registers the request and budget (idempotent per key)
2. **challenge** — `POST /v1/pacts/:id/authorize` → `402` with an MPP `tempo/session` challenge
3. **agent policy** — refuses the challenge if the operator is not the one you trust, if it is not a
   PACT challenge, or if the price exceeds `maxAmount` — before any money moves
4. **escrow** — opens a TIP-1034 channel (payee = provider, operator = gateway, salt = pact id) with
   `maxAmount` as the deposit, and signs a voucher for exactly the price
5. **authorize** — sends `Authorization: Payment <credential>`; receives `Payment-Receipt`
6. **wait** — until `SETTLED` or `PROTECTED`
7. **outcome** — result data, verdict, reasons, settlement (with explorer URL) and the Work Receipt

## Lower-level control

```ts
const p = await pact.create({ service, input, maxAmount, idempotencyKey })
const challenge = await pact.challenge(p.id)
const { header, credential } = await pact.createCredential(challenge, maxAmount)
await pact.gateway.submit(p.id, header)
const outcome = await pact.wait(p.id, { timeoutMs: 60_000 })
```

`createCredential` returns both the HTTP header form and the MPP credential object used over MCP.

## Custom wallets

`PactClient` accepts any `PayerWallet` (`openAndSign({ pactId, payee, operator, deposit, amount })`).
`TempoPayer` is the built-in implementation using a viem account; passkey or remote-signer wallets can
implement the same interface.

A runnable version lives in `examples/research-agent`.
