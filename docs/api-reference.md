# Gateway API

Base URL: your gateway (local default `http://localhost:8787`). All bodies are JSON. Errors are
`{ "error": { "code": "machine_readable", "message": "…" } }`. Amounts are decimal strings with up
to 6 places (pathUSD); timestamps are ISO-8601.

## Pacts

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/pacts` | Create a pact. Body `{ agentId, serviceId, request, maxAmount? }`. Honours `Idempotency-Key`: same key + same request returns the same pact (`200`); same key + different request is `409 idempotency_conflict`. |
| `POST` | `/v1/pacts/:id/authorize` | **MPP.** Without `Authorization`: `402` with `WWW-Authenticate: Payment …` (method `tempo`, intent `session`). With `Authorization: Payment <credential>`: verifies the escrow and voucher, returns `Payment-Receipt`. Replaying the same credential is idempotent. |
| `POST` | `/v1/pacts/:id/deliver` | Async provider callback. Must carry `x-pact-result-digest` and a provider `x-pact-signature`; otherwise `401` and no state change. Duplicates are ignored. |
| `GET` | `/v1/pacts` | List (`limit`, `before`, `state`). |
| `GET` | `/v1/pacts/:id` | Full detail: request, policy, authorization, work, verification checks, settlement, timeline, payment events, failures, retries. |
| `GET` | `/v1/pacts/:id/result` | Delivered body + verdict + settlement + Work Receipt, once settled (`409 not_settled` before). |
| `POST` | `/v1/pacts/:id/settlement/retry` | Re-attempt a settlement stuck on an RPC failure. Idempotent; cannot change the capture amount. |

### Authorization errors (all leave the pact in `CREATED`)

`missing_credential`, `invalid_credential`, `invalid_challenge` (HMAC mismatch), `challenge_pact_mismatch`,
`stale_challenge`, `challenge_expired`, `invalid_payload`, `challenge_terms_mismatch`, `channel_not_bound`,
`wrong_payer`, `voucher_amount`, `channel_id_mismatch`, `wrong_payee`, `wrong_operator`, `wrong_token`,
`channel_not_found`, `channel_closing`, `channel_used`, `insufficient_deposit`, `deposit_exceeds_max`,
`invalid_voucher`, `channel_reused`, `chain_unavailable` (`503`, retryable).

## Receipts

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/receipts` | Recent receipts and the signing operator. |
| `GET` | `/v1/receipts/:id` | The Work Receipt document. |
| `GET` | `/v1/receipts/:id/verify` | Recompute digest, id and signature for a stored receipt. |
| `POST` | `/v1/receipts/verify` | Verify any receipt document you hold (detects tampering and relabelling). |

## Platform

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/rail` | Rail (`tempo` / `local`), chain id, token, escrow, operator, party balances with explorer links. |
| `GET` | `/v1/services` | Services with price, mode, policy and input JSON Schema. |
| `GET` | `/v1/policies` | Published verification policies with digests. |
| `GET` | `/v1/metrics` | Authorized, settled, protected, refunded and in-flight totals; pass rate; provider reliability. All derived from recorded settlements. |
| `GET` | `/v1/events` | Server-sent events (`event: pact`). Send `Last-Event-ID` (or `?after=`) to resume without gaps. |
| `GET` | `/health` | Liveness. |

## Admin (`x-admin-token: $PACT_ADMIN_TOKEN`)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/admin/policies` | Publish a policy version (immutable; `409` if it exists). |
| `POST` | `/v1/admin/services` | Register or update a provider service. Endpoint must be http(s). |
| `POST` | `/v1/admin/recover` | Resume every non-terminal pact (also runs at startup). |

## Chaos Lab

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/lab/runs` | Run the demo agent against an armed demo provider. Body `{ scenario, serviceId?, company?, count?, market?, sections?, retryOf? }`. Rate limited (30/min per client, 8 in flight). |

Scenarios: `normal`, `incomplete`, `malformed`, `timeout`, `wrong`, `delayed`, `duplicate`, `replay`,
`forged`, `http_error`; for async services `normal`, `incomplete`, `malformed`, `timeout`, `forged`,
`duplicate_callback`.
