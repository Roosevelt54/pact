# Work Receipts

An MPP `Payment-Receipt` proves money moved. A PACT **Work Receipt** proves *what the money bought*.
One is sealed for every settled pact — captured or refunded.

```json
{
  "version": "pact.receipt/v1",
  "pactId": "pact_…",
  "issuedAt": "2026-09-29T10:00:00.000Z",
  "agent":    { "id": "agt_researchbot", "address": "0x…" },
  "service":  { "id": "sec-filings", "name": "SEC Filings Research", "endpoint": "https://…" },
  "provider": { "name": "Northwind Data", "address": "0x…" },
  "request":  { "digest": "sha256:…" },
  "payment": {
    "rail": "tempo", "chainId": 42431, "token": "0x20c0…", "escrow": "0x4d505…",
    "operator": "0x…", "challengeId": "…", "channelId": "0x…", "channelSalt": "0x…",
    "authorizeTx": "0x…", "authorizedAmount": "0.50", "price": "0.40"
  },
  "result":       { "digest": "sha256:…", "itemCount": 4, "latencyMs": 131 },
  "verification": { "policyId": "company-filings", "policyVersion": 1, "policyDigest": "sha256:…",
                    "verdict": "PASS", "reasons": [], "checks": [ … ] },
  "settlement":   { "outcome": "captured", "captureAmount": "0.40", "refundAmount": "0.10", "txHash": "0x…" },
  "receiptId": "wr_…",
  "receiptDigest": "sha256:…",
  "pactSignature": "0x…"
}
```

From one document anyone can answer: what was requested, who provided it, how much was authorized,
what result was produced, which rules judged it, what the verdict was, and what was finally settled —
and follow `authorizeTx` / `txHash` to the chain.

## Seal

1. `receiptDigest = sha256(canonical JSON of the body)` (everything except the three seal fields)
2. `receiptId = "wr_" + first 20 hex chars of the digest`
3. `pactSignature = EIP-191 signature of receiptDigest by the gateway operator`

## Verify — offline, no trust in the issuer's storage

```ts
import { verifyReceipt } from '@pactpayment/receipts'

const check = await verifyReceipt(receipt, TRUSTED_OPERATOR)
check.valid                 // digest, id and signature all check out
check.checks.digestMatches  // content was not altered
check.checks.idMatches      // id was not relabelled
check.checks.signatureValid // signed by the operator you trust
```

Or ask the gateway: `POST /v1/receipts/verify` with the receipt as the body. Changing a single
field — for example `captureAmount` — makes `digestMatches` false. The Control Center's Work Receipts
page has a "Load a tampered copy" button that demonstrates exactly this.
