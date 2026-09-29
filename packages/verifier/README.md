# @pact/verifier

Deterministic verification policies for paid machine work. The verdict this engine returns is the
only input PACT uses to decide how much of an escrowed payment is captured — no LLM, no discretion.

```bash
npm install @pact/verifier
```

```ts
import { verifyDelivery, type VerificationPolicy } from '@pact/verifier'

const policy: VerificationPolicy = {
  id: 'fx-rates', version: 1, name: 'FX rates v1', description: 'One rate per symbol',
  maxLatencyMs: 2000, itemsPath: 'rates',
  topLevelFields: { base: 'string', rates: 'array' }, itemFields: { symbol: 'string', rate: 'number' },
  minItems: 'request.symbols', maxItems: 'request.symbols', uniqueItemKey: 'symbol',
  echoFields: ['base'], requireProviderSignature: true, requireRequestBinding: true,
}

const result = await verifyDelivery(policy, delivery, context)
result.verdict  // 'PASS' | 'FAIL'
result.reasons  // e.g. ['min_items']
```

Checks: `delivered`, `http_ok`, `deadline`, `content_type`, `non_empty`, `json_parse`, `pact_bound`,
`request_bound`, `result_digest`, `fresh_result`, `provider_signature`, `schema_valid`, `echo_fields`,
`min_items`, `max_items`, `unique_items`.

Docs: https://github.com/Roosevelt54/pact/blob/main/docs/verification-policies.md · License: MIT
