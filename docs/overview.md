# What PACT solves

> **PAY. PROVE. SETTLE.** — the trust layer for autonomous commerce on Tempo.

Tempo and MPP made machine payments easy: an agent calls an API, gets `402 Payment Required`,
pays inline, and receives a receipt. What that receipt proves is that **money moved**. It does not
prove that **the work was delivered**.

Once agents spend autonomously, that gap becomes the risk:

| What happens | Without PACT | With PACT |
|---|---|---|
| Provider returns 3 of the 10 records you paid for | paid | refunded |
| Provider times out after charging | paid | refunded |
| Provider answers about the wrong company | paid | refunded |
| Provider replays a result it sold to someone else | paid | refunded |
| Provider delivers exactly what was asked, signed | paid | **paid** — and you get a signed Work Receipt |

mppx's own session design says it plainly: HTTP session accounting charges *before* the handler
runs, and "charge only after a successful handler" would need an explicit prepare/commit contract.
**PACT is that prepare/commit contract**, built on Tempo's native TIP-1034 escrow.

## How PACT relates to Tempo, MPP and mppx

| Layer | What it gives PACT |
|---|---|
| **Tempo** | Stablecoin-native chain (TIP-20, ~0.5 s blocks, sub-cent fees) and the **TIP-1034 escrow precompile** that lets an operator capture *less* than a payer authorized and refund the rest in the same transaction. |
| **MPP** | The wire protocol: `402` + `WWW-Authenticate: Payment`, `Authorization: Payment` credentials, `Payment-Receipt`, and the MPP-over-MCP error `-32042`. PACT speaks it unchanged. |
| **mppx** | The maintained TypeScript implementation. PACT uses mppx's `Challenge` (HMAC-bound), `Credential`, `Receipt`, `Mcp` constants and its TIP-1034 precompile helpers (`Channel.computeId`, `Voucher.sign/verify`, `Chain.closeOnChain`). No re-implementation. |
| **PACT** | Request identity, payment ↔ work correlation, deterministic verification, Work Receipts, and the settlement decision. |

## What PACT is not

Not a wallet, stablecoin, payment processor, generic escrow contract, or agent framework. PACT adds
exactly one layer: **payment authorization + work verification + correlation + receipt + settlement.**

## Three surfaces

1. **The SDK** — `@pact/tempo` (agents and providers), `@pact/verifier`, `@pact/receipts`, `@pact/mcp`, `@pact/core`.
2. **The Control Center** — live pacts, spend, verdicts, receipts, and the Chaos Lab.
3. **PACT MCP** — paid MCP tools that only settle when the tool output verifies.

Next: [Run PACT locally](./run-locally.md) · [Payment ↔ work correlation](./how-it-works.md)
