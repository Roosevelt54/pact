# @pact/tempo

**PACT on Tempo — pay, prove, settle.** Agents escrow payment in Tempo's TIP-1034 channel;
providers' results are verified against a published policy; only verified work is captured
on-chain, everything else is refunded to the agent in the same transaction.

```bash
npm install @pact/tempo viem
```

## Agents — `PactClient`

```ts
import { PactClient } from '@pact/tempo'

const pact = PactClient.tempo({
  gateway: 'https://your-pact-gateway.example',
  agentId: 'agt_researchbot',
  privateKey: process.env.AGENT_KEY as `0x${string}`,
  trustedOperator: '0xGatewayOperator',
})

const res = await pact.fetch({ service: 'sec-filings', input: { company: 'NVIDIA', count: 4 }, maxAmount: '0.50' })
res.verified    // true only if the result passed the published policy
res.settlement  // { captured, refunded, txHash, txUrl }
res.receipt     // signed Work Receipt
await pact.verifyReceipt(res.receipt!)
```

## Providers — `pactProvider`

```ts
import { pactProvider } from '@pact/tempo'

const provider = pactProvider({ account, gateway: 'https://your-pact-gateway.example' })
app.post('/rates', (c) => provider.protect(async (input) => lookupRates(input))(c.req.raw))
```

`protect()` refuses unfunded requests and signs every result so the gateway can verify it came from you.

## Also exported

`PactGateway` (wallet-less API client), `TempoRail` / `TempoPayer` (TIP-1034 escrow via mppx),
MPP helpers (`issueChallenge`, `parseCredential`, `buildCredentialHeader`), and Moderato chain helpers.

Docs: https://github.com/Roosevelt54/pact/tree/main/docs · License: MIT
