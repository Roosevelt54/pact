# @pact/core

Primitives shared by the PACT SDK: 6-decimal TIP-20 amounts as `bigint`, canonical JSON + sha256
digests, and the pact state machine.

```bash
npm install @pact/core
```

```ts
import { parseAmount, formatAmount, digest, canTransition } from '@pact/core'

parseAmount('0.40')                    // 400000n
formatAmount(400000n)                  // '0.40'
digest({ b: 1, a: 2 })                 // 'sha256:…' — independent of key order
canTransition('VERIFIED', 'SETTLING')  // true
```

Part of PACT: https://github.com/Roosevelt54/pact · License: MIT
