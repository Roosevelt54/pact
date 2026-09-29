# Settlement

PACT does not use a custom escrow contract. It uses Tempo's **TIP-1034 `TIP20EscrowChannel`
precompile** — the same escrow MPP sessions use — through mppx's precompile helpers.

## Roles in the channel

| Descriptor field | PACT value |
|---|---|
| `payer` | the agent |
| `payee` | the provider (receives captured value directly from escrow) |
| `operator` | the PACT gateway — may close the channel on the payee's side |
| `token` | pathUSD |
| `salt` | `keccak256("pact:v1:" + pactId)` — binds the channel to one pact |
| `deposit` | the agent's budget (`maxAmount`) |

## The decision

```
verdict PASS            → close(voucher = price, captureAmount = price)
verdict FAIL / EXPIRED  → close(voucher = price, captureAmount = 0)
```

`close(descriptor, cumulativeAmount, captureAmount, signature)` captures `captureAmount` for the
payee and **refunds the rest of the deposit to the payer in the same transaction**, emitting
`ChannelClosed { settledToPayee, refundedToPayer }`. That event is what the Control Center shows and
what the Work Receipt records.

Proven on Moderato during development:

```
FAIL → settledToPayee = 0       refundedToPayer = 500000   (agent paid only fees)
PASS → settledToPayee = 400000  refundedToPayer = 100000
```

## Why this is enforceable

- The provider never receives the agent's voucher, so it cannot settle on its own.
- The only capture path is the operator close, and its `captureAmount` is set by the deterministic verifier.
- Every close is public and matches a signed Work Receipt.
- If the gateway disappears, the payer can `requestClose` and `withdraw` after the escrow's grace period — funds never get stuck.

## Exactly-once

- A unique settlement row per pact plus a compare-and-swap into `SETTLING`.
- A closed channel cannot be closed again on-chain; if a close fails ambiguously, PACT looks for the
  `ChannelClosed` event before retrying.
- Retries back off (1 s, 3 s, 10 s, 30 s) and resume after restarts.

## Trust model

The agent trusts the PACT operator not to capture for failed work; the provider trusts it to capture
for verified work. Both can audit every decision after the fact. A future version can move the verdict
on-chain or to a quorum of verifiers without changing the SDK surface.
