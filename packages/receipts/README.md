# @pact/receipts

PACT Work Receipts: one signed document binding request → payment → provider → result →
verification policy → verdict → settlement. Verify them offline, without trusting anyone's database.

```bash
npm install @pact/receipts viem
```

```ts
import { verifyReceipt } from '@pact/receipts'

const check = await verifyReceipt(receipt, '0xTrustedOperator')
check.valid                  // digest, id and signature all check out
check.checks.digestMatches   // content not altered
check.checks.idMatches       // id not relabelled
check.checks.signatureValid  // signed by the operator you trust
```

Issuers seal receipts with `sealReceipt(body, operatorAccount)`: `sha256(canonical body)` → `wr_…` id →
EIP-191 signature.

Docs: https://github.com/Roosevelt54/pact/blob/main/docs/work-receipts.md · License: MIT
