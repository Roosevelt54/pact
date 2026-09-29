# Payment ↔ work correlation

A PACT payment is bound to exactly one request, one provider and one result. Every link in the chain
is a digest or a signature that a third party can check.

```
REQUEST ──► request digest ──► pact id ──► 402 challenge (HMAC-bound, meta.pact)
                                   │
                                   ▼
             TIP-1034 channel  salt = keccak256("pact:v1:" + pactId)
             payee = provider · operator = PACT · deposit = agent budget
                                   │
                                   ▼
             voucher (EIP-712) for exactly the price  ── authorization, not payment
                                   │
                                   ▼
             dispatch with x-pact-id + x-pact-request-digest
                                   │
                                   ▼
             provider signs  "pact:v1:{pactId}:{requestDigest}:{resultDigest}"
                                   │
                                   ▼
             deterministic verification ──► verdict
                                   │
                                   ▼
             operator close(capture = price | 0) ──► Work Receipt (sealed + signed)
```

## The pieces

**Request digest.** `sha256(canonical JSON of { serviceId, request })`. Canonical means sorted keys,
no `undefined`, bigints as strings — the same bytes everywhere.

**Challenge.** Created with mppx `Challenge.from({ secretKey, method: 'tempo', intent: 'session', meta: { pact } })`.
Its id is an HMAC over its contents, so a challenge cannot be forged or moved to another pact.

**Channel salt.** The agent derives the TIP-1034 channel salt from the pact id. The salt is part of
the on-chain `channelId`, so the escrow *itself* commits to one pact. A channel opened for pact A is
rejected when presented for pact B (`channel_not_bound`).

**Voucher.** Signed with mppx `Voucher.signVoucher` for exactly the pact price. It authorizes value;
it does not move it.

**Provider attestation.** The provider signs the pact id, the request digest and the digest of the
exact bytes it returned. A result replayed from another pact, or altered in transit, fails.

**Async jobs.** For long-running work the provider answers `202 { jobId }` and later POSTs the result
to `/v1/pacts/:id/deliver`. The callback must carry the provider's signature over the same message;
unsigned or forged callbacks are rejected without changing state, and duplicates are counted and
ignored. This closes the "async paid delivery has no required correlation to its payment" gap.

## State machine

```
CREATED → AUTHORIZED → EXECUTING → VERIFYING → VERIFIED → SETTLING → SETTLED
                           │            └────► REJECTED ─┘   └────► PROTECTED
   └──────────┴────────────┴──► EXPIRED ──► SETTLING (capture 0)
```

Every transition is a compare-and-swap on the stored state. Duplicate callbacks, repeated
authorizations, browser refreshes and process restarts cannot apply a transition twice, and a pact
can never be settled twice.

## Failure handling

| Failure | Behaviour |
|---|---|
| Forged / stale / cross-pact challenge | `402` with a machine-readable code; state unchanged |
| Tampered voucher, wrong payer, wrong payee | rejected before any work is dispatched |
| Provider timeout / network error | verdict FAIL (`delivered`), full refund |
| Late delivery | verdict FAIL (`deadline`), full refund |
| Authorization arrives after expiry | channel closed immediately with capture 0 |
| Chain RPC failure during settlement | stays `SETTLING`, retried with backoff; recovered on restart |
| Close already executed | detected from the `ChannelClosed` event; never re-sent |
