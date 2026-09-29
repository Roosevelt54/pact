# Verification policies

A policy is a published, versioned, deterministic contract for "what counts as delivered". The
verdict it produces is **the only input that decides how much of an authorization is captured**.
No LLM, no operator discretion.

```ts
import type { VerificationPolicy } from '@pact/verifier'

export const FX_POLICY: VerificationPolicy = {
  id: 'fx-rates',
  version: 1,
  name: 'FX rates v1',
  description: 'One positive rate per requested symbol, for the requested base, signed, within 2 s.',
  maxLatencyMs: 2_000,
  itemsPath: 'rates',                                  // where the result items live
  topLevelFields: { base: 'string', asOf: 'date', rates: 'array' },
  itemFields: { symbol: 'string', rate: 'number' },
  minItems: 'request.symbols',                         // bound from the request itself
  maxItems: 'request.symbols',
  uniqueItemKey: 'symbol',
  echoFields: ['base'],                                // must answer the question that was asked
  requireProviderSignature: true,
  requireRequestBinding: true,
}
```

Field types: `string` (non-empty), `number` (finite), `boolean`, `url` (http/https), `date` (ISO),
`array`, `object`. Bounds are a number, `null`, or `request.<path>` — a numeric request field, or
an array whose length is used.

## Checks

| Code | Fails when |
|---|---|
| `delivered` | the provider timed out or was unreachable |
| `http_ok` | status is not 2xx |
| `deadline` | latency exceeded `maxLatencyMs` |
| `content_type` | response is not JSON |
| `non_empty` | body is empty |
| `json_parse` | body is not valid JSON |
| `pact_bound` | provider echoed a different pact id |
| `request_bound` | provider echoed a different request digest |
| `result_digest` | body does not match the digest the provider signed |
| `fresh_result` | the identical result was already delivered for a different request |
| `provider_signature` | signature does not recover to the registered provider |
| `schema_valid` | a required field is missing or has the wrong type |
| `echo_fields` | the result answers about something else (e.g. another company) |
| `min_items` / `max_items` | too few / too many items |
| `unique_items` | the result pads itself with duplicates |

Checks that depend on a failed prerequisite are reported as `skip`, never silently passed.

## Using the verifier directly

```ts
import { verifyDelivery } from '@pact/verifier'

const result = await verifyDelivery(policy, delivery, {
  pactId, request, requestDigest, deadlineAt, providerAddress,
  priorResults: [],
  checkSignature: ({ message, signature, address }) => verifyMessage({ address, message, signature }),
})
result.verdict   // 'PASS' | 'FAIL'
result.reasons   // e.g. ['min_items', 'echo_fields']
result.checks    // every check with pass / fail / skip and a human-readable detail
```

## Publishing a policy on a gateway

Policies are immutable per `(id, version)`; publishing the same version twice returns `409`.

```bash
curl -X POST $GATEWAY/v1/admin/policies \
  -H "x-admin-token: $PACT_ADMIN_TOKEN" -H 'content-type: application/json' \
  -d @fx-policy.json
```

Each pact records the policy id, version and **policy digest**, and the Work Receipt carries them,
so a verdict can always be re-derived against the exact rules that were in force.

## AI review

Semantic review by a model can be layered *after* the deterministic checks as an advisory signal. It is
not part of the capture decision in this release, by design.
