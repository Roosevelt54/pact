# PACT

**PAY. PROVE. SETTLE.** — the trust layer for autonomous commerce on Tempo.

Agents can pay for APIs, data and MCP tools inline with MPP. What an MPP receipt proves is that
money moved — not that the paid work was delivered. PACT binds each payment to its request, escrows
it in Tempo's native TIP-1034 channel, verifies the delivered result against a published
deterministic policy, and captures only what passed. Everything else goes back to the agent, on-chain,
in the same transaction — with a signed Work Receipt either way.

- **No custom escrow contract.** PACT is the operator of a TIP-1034 channel whose payee is the provider.
- **No new protocol.** 402 challenges, credentials, receipts and MPP-over-MCP come from mppx.
- **No LLM in the money path.** The verdict that sets `captureAmount` is deterministic and reproducible.

## Three surfaces

| Surface | What it is |
|---|---|
| **SDK** | `@pact/tempo` (`PactClient` for agents, `pactProvider` for APIs), `@pact/verifier`, `@pact/receipts`, `@pact/mcp`, `@pact/core` |
| **Control Center** | `apps/dashboard` — live pacts and spend, the lifecycle of every payment, Work Receipts, and the **Chaos Lab** |
| **PACT MCP** | paid MCP tools that only settle when the tool output verifies (`-32042` → escrow → verify → settle) |

```ts
// agent
const res = await pact.fetch({ service: 'sec-filings', input: { company: 'NVIDIA', count: 4 }, maxAmount: '0.50' })
res.verified    // true only if the result passed the published policy
res.settlement  // { captured: '0.40', refunded: '0.10', txUrl: 'https://explore.testnet.tempo.xyz/tx/…' }

// provider
app.post('/filings', (c) => provider.protect(async (input) => lookup(input))(c.req.raw))
```

## Quick start

```bash
npm install
npm test
npm run dev
```

Gateway on <http://localhost:8787>, Control Center on <http://localhost:3000>. Without a `.env`
PACT runs on the **local ledger rail** (same semantics, nothing broadcast, clearly labelled).

### On Tempo testnet (Moderato)

```bash
npm run tempo:setup   # testnet keys → .env (gitignored), funded from the faucet
npm run tempo:smoke   # prove open → voucher → close(capture 0 | price) on-chain
npm run dev           # the Control Center now shows real transactions
npm run test:live     # capture + refund through the full gateway on Moderato
```

## Repository

```
packages/
  core/        @pact/core       amounts, canonical digests, state machine
  verifier/    @pact/verifier   deterministic verification engine
  receipts/    @pact/receipts   Work Receipt seal + offline verify
  tempo/       @pact/tempo      PactClient · pactProvider · TIP-1034 rail · MPP wire
  mcp/         @pact/mcp        MCP server + withPact client wrapper
apps/
  gateway/                      hosted PACT gateway (Hono + SQLite, Postgres-portable schema)
  dashboard/                    PACT Control Center (Next.js)
  demo-provider/                controllable provider for the Chaos Lab
examples/
  basic-api/                    protect an API (FX rates) and register it with a gateway
  research-agent/               an agent buying verified research on Tempo
  mcp-agent/                    an MCP agent paying for PACT tools over stdio
test/                           lifecycle, security, SDK, MCP, external-provider, live Tempo
docs/                           developer documentation (also rendered at /docs)
```

## Documentation

| | |
|---|---|
| [What PACT solves](docs/overview.md) | the problem, and how PACT relates to Tempo, MPP and mppx |
| [Payment ↔ work correlation](docs/how-it-works.md) | digests, salts, signatures, state machine, failure handling |
| [Verification policies](docs/verification-policies.md) · [Work Receipts](docs/work-receipts.md) · [Settlement](docs/settlement.md) | the core concepts |
| [Protect an API](docs/protect-an-api.md) · [Build an agent](docs/build-an-agent.md) · [Paid MCP tools](docs/mcp.md) | guides with copy-paste code |
| [Run locally](docs/run-locally.md) · [Tempo testnet](docs/tempo-testnet.md) · [Gateway API](docs/api-reference.md) | operations and reference |
| [Architecture & findings](docs/ARCHITECTURE.md) | what was verified in the Tempo / mppx source, and the design decision |
| [60-second demo](docs/DEMO.md) | the judge walkthrough |
| [Publish the SDK to npm](docs/publish-sdk.md) | `npm run release:pack` / `release:publish`, step by step |

## Checks

```bash
npm run typecheck     # packages, gateway, examples, tests, dashboard
npm run lint          # strict unused-code check
npm test              # 80 tests on the local rail
npm run test:live     # 2 tests on Tempo Moderato
npm run build:web     # production build of the Control Center
```

## Deploy

One service, two processes (gateway + Control Center), e.g. on Railway or Render:

| Setting | Value |
|---|---|
| Build | `npm install && npm run build:web` |
| Start | `npm start` |
| Port | the platform's `$PORT` is served by the Control Center; the gateway listens internally on `PACT_API_PORT` (default 8787) |
| Volume | mount persistent storage and set `PACT_DB_PATH=/data/pact.db` |
| Env | `PACT_RAIL=tempo`, the four testnet keys, `MPP_SECRET_KEY` (32+ random bytes), `PACT_ADMIN_TOKEN` |

The Control Center proxies `/api/*` to the gateway (`PACT_API_URL`, default `http://localhost:8787`).
To expose the gateway API to external agents and providers, run it as its own service and set
`PACT_API_URL` and `PACT_PUBLIC_URL` to its public URL. Keys in `.env` are testnet-only; never commit them.
