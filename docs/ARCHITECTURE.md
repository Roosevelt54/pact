# PACT — Technical Implementation Report & Architecture

> **PAY → PROVE → SETTLE.** PACT binds a machine payment to proof that the paid work was delivered,
> and settles on Tempo only the value that passed verification.

This document is the Phase 1 report: what the current Tempo / MPP / mppx code actually does
(verified by reading source at `wevm/mppx@0.11.0` and `tempoxyz/mpp-specs` main, and by running
transactions on Moderato), and the architecture PACT is built on as a result.

---

## 1. Verified findings (source of truth: code, not blog posts)

| # | Finding | Where verified |
|---|---------|----------------|
| F1 | Moderato testnet: chain id `42431`, RPC `https://rpc.moderato.tempo.xyz`, explorer `https://explore.testnet.tempo.xyz` (viem's current chain definition — the older `explore.tempo.xyz` URL in some tutorials is not what viem ships). | `viem/chains` → `tempoModerato`; `eth_chainId` returned `0xa5bf` |
| F2 | Testnet faucet is the RPC method `tempo_fundAddress`, wrapped by `Actions.faucet.fund` in `viem/tempo`. | `viem/tempo/actions/faucet.ts`; used by mppx CLI |
| F3 | `pathUSD` TIP-20 is at `0x20c0…0000` and can be used as fee token (`chain.extend({ feeToken })`). | `viem/tempo/Addresses.ts`, `chainConfig.ts` |
| F4 | MPP sessions use the **TIP-1034 `TIP20EscrowChannel` precompile** at `0x4d50500000000000000000000000000000000000`, live on Moderato. | `mppx/src/tempo/session/precompile/Protocol.ts`; `eth_getCode` |
| F5 | The escrow tracks three distinct values: **voucher-authorized** cumulative, server-recorded **spent**, and on-chain **settled**. mppx's session README states these are *separate operations*. | `src/tempo/session/README.md` "Design principles" |
| F6 | **The gap PACT fills, stated by mppx itself:** HTTP session accounting charges *before the handler runs*; "Sessions does not promise an atomic 'charge only after a successful handler' transaction… SDK changes must … introduce an explicit prepare/commit contract." | `src/tempo/session/README.md` "Request lifecycle" |
| F7 | `close(descriptor, cumulativeAmount, captureAmount, signature)` lets the payee **or the payee-side `operator`** capture *less* than the signed authorization; the precompile refunds the rest to the payer in the same transaction (`ChannelClosed{settledToPayee, refundedToPayer}`). | `escrow.abi.ts`, `Chain.closeOnChain`, `Settlement.assertSettlementSender` |
| F8 | The channel descriptor includes a payer-chosen 32-byte `salt`, hashed into the `channelId`. | `Protocol.ts` `ChannelDescriptor`, `Channel.computeId` |
| F9 | mppx exposes these primitives publicly: `mppx/tempo` → `Session.Precompile.{Chain, Channel, Voucher, Constants, escrowAbi}`; `mppx` → `Challenge`, `Credential`, `Receipt`. | `src/tempo/index.ts`, `src/index.ts`, `package.json#exports` |
| F10 | Challenge IDs can be HMAC-bound to their contents with a server secret (`Challenge.from(..., {secretKey})`, `Challenge.verify`). | `src/Challenge.ts` |

**Live proof** (`npm run tempo:smoke`, run during Phase 1 on Moderato):

```
[fail] close settledToPayee=0      refundedToPayer=500000   agent Δ=-0.000815 (fees only)
[pass] close settledToPayee=400000 refundedToPayer=100000   provider Δ=+0.40
```

## 2. Architecture decision

**No custom escrow contract.** PACT is the *prepare/commit contract* that F6 says is missing,
implemented on the native TIP-1034 escrow (F4, F7):

| MPP/TIP-1034 concept | PACT meaning |
|---|---|
| Channel open with `deposit` | Agent **authorizes** a maximum spend for one pact — funds locked in the escrow precompile, not paid |
| `salt = keccak256("pact:v1:" + pactId)` | On-chain **commitment** binding the channel to exactly one pact (payment ↔ work correlation, F8) |
| `payee` | The provider (receives captured value directly from escrow) |
| `operator` | The PACT gateway — the only party that ever holds the agent's voucher |
| Signed voucher (cumulative = price) | Authorization of the price; **not** settlement |
| `close(…, captureAmount = price)` | Verification **PASSED** → provider paid, remainder refunded |
| `close(…, captureAmount = 0)` | Verification **FAILED / EXPIRED** → full refund, on-chain, in one tx |

Why this is enforceable, not just bookkeeping: the provider never sees the voucher, so it cannot
settle on its own; the only capture path is PACT's operator close, whose `captureAmount` is set
by the deterministic verifier. The agent can independently audit every close on the explorer
(`ChannelClosed` event) against the signed Work Receipt.

### Trust model (stated honestly)

- Agent trusts PACT (the operator) not to capture for failed work. Mitigations: deterministic,
  published verification policies; PACT-signed Work Receipts binding request/result/verdict to the
  on-chain close; every capture is publicly auditable. A future version can move the verdict
  on-chain or to a quorum of verifiers.
- Provider trusts that PACT will capture for passing work. The agent's funds are already in escrow,
  so non-payment for verified work requires PACT to misbehave, not the agent.
- If PACT disappears, the payer can `requestClose` + `withdraw` after the escrow grace period
  (precompile feature), so funds are never stuck.

## 3. MPP wire format

The authorize step speaks MPP: `POST /v1/pacts/:id/authorize` without credentials returns
`402 Payment Required` with `WWW-Authenticate: Payment …` produced by `mppx` `Challenge.from`
(method `tempo`, intent `session`, HMAC-bound id, `expires`, `meta.pact = <pactId>`). The request
carries `amount`, `currency`, `recipient` (provider), and `methodDetails` with `chainId`,
`escrowContract` and `operator`.

The agent answers with `Authorization: Payment <Credential>` (mppx `Credential.serialize`) whose
payload is a **PACT extension** of the session `open` action:
`{ action: "open", type: "hash", channelId, descriptor, txHash, voucher }` — the agent broadcasts
the open itself (hash mode) so the gateway never custodies an unsigned transaction.
Successful authorization and settlement return `Payment-Receipt` headers (mppx `Receipt.serialize`).

## 4. Pact lifecycle (state machine)

```
CREATED ──authorize──▶ AUTHORIZED ──dispatch──▶ EXECUTING ──result──▶ VERIFYING
   │                        │                       │                    │
   └──expire──▶ EXPIRED ◀───┴────────expire─────────┘           PASS ────┼──── FAIL
                  │                                               ▼         ▼
                  └──────────────▶ SETTLING (capture 0) ◀──── REJECTED   VERIFIED
                                        │                                   │
                                        ▼                                   ▼
                                 PROTECTED (refunded)              SETTLING (capture price)
                                                                            │
                                                                            ▼
                                                                         SETTLED
```

Transitions are compare-and-swap updates (`UPDATE … WHERE id=? AND state=?`) so concurrent
callbacks, retries and refreshes cannot double-apply. Settlement uses a unique
`settlements(pact_id)` row plus the on-chain fact that a closed channel cannot be closed twice.

## 5. Components

```
packages/                      the SDK — reusable outside this repo
  core/        @pact/core      TIP-20 amounts, canonical digests, pact state machine
  verifier/    @pact/verifier  deterministic policy engine → PASS | FAIL | EXPIRED + reasons
  receipts/    @pact/receipts  Work Receipt body, seal (digest → id → EIP-191) and offline verify
  tempo/       @pact/tempo     PactClient (agents), pactProvider (APIs), PactGateway (wallet-less
                               API client), TempoRail + TempoPayer (TIP-1034 via mppx), MPP wire
  mcp/         @pact/mcp       MCP server + withPact client wrapper (mppx MPP-over-MCP format)
apps/
  gateway/                     hosted PACT gateway (Hono + node:sqlite)
    config.ts                  zod-validated env
    db/                        Postgres-portable schema, migrations, repository
    engine/                    PactEngine: create/authorize/dispatch/deliver/verify/settle/expire/recover
    rails/local.ts             in-process ledger rail (tests, offline demos)
    api/                       HTTP API, SSE stream, Chaos Lab, admin registration
  dashboard/                   PACT Control Center (Next.js 16, Tailwind 4)
  demo-provider/               controllable provider built on pactProvider (Chaos behaviours)
examples/                      basic-api, research-agent, mcp-agent
```

## 6. Rails

- **tempo** — real Moderato settlement (default when keys exist; `npm run tempo:setup`).
- **local** — deterministic in-process ledger with identical authorize / capture / refund
  semantics. Used by the test suite and when no chain keys are configured. The UI labels it
  **LOCAL LEDGER** everywhere and never renders explorer links for it.

## 7. Verification engine

Deterministic first. The verdict that controls `captureAmount` is never produced by an LLM.
Checks (each yields a machine-readable code):

`delivered`, `http_ok`, `deadline`, `content_type`, `non_empty`, `json_parse`, `pact_bound`,
`request_bound` (provider echoes the pact's request digest), `result_digest` (recomputed),
`fresh_result` (same provider must not re-sell one result for a different request),
`provider_signature` (EIP-191 by the registered provider key), `schema_valid`, `echo_fields`,
`min_items`, `max_items`, `unique_items`. Duplicate *deliveries* (e.g. a repeated async callback)
are handled by the engine's exactly-once state machine rather than by the verdict.

Semantic (LLM) review is not part of this release. If added, it runs only after all deterministic
checks pass and is advisory: it cannot turn a FAIL into a PASS.

## 8. Work Receipt

A canonical JSON document binding request → payment → provider → result → policy → verdict →
settlement, with `receiptDigest = sha256(canonical(receipt minus signature))` and
`pactSignature` = EIP-191 signature of the digest by the PACT operator key.
`GET /v1/receipts/:id/verify` recomputes both; forged or altered receipts fail.
