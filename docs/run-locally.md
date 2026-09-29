# Run PACT locally

Requirements: **Node.js 22.13+** (PACT uses the built-in `node:sqlite`). No Docker, no database server.

```bash
npm install
npm test
```

## Start the gateway and the Control Center

```bash
npm run dev
```

That starts the gateway on <http://localhost:8787> and the Control Center on <http://localhost:3000>.
To run them separately: `npm run dev:api` and `npm run dev:web`.

Without a `.env`, the gateway runs on the **local ledger rail**: identical authorize / capture /
refund semantics with real EIP-712 vouchers, but balances live in SQLite and nothing is broadcast.
The Control Center labels this **Local ledger** everywhere and never shows explorer links for it.

To settle on Tempo instead, see [Use Tempo testnet](./tempo-testnet.md).

## Try it

Open <http://localhost:3000/lab>, pick **Incomplete response**, run it, then run **Normal**.

Or from a terminal:

```bash
curl -s -X POST localhost:8787/v1/lab/runs -H 'content-type: application/json' -d '{"scenario":"incomplete"}'
```

## Repository layout

```
packages/
  core/          amounts, canonical digests, state machine
  verifier/      deterministic verification engine
  receipts/      Work Receipt seal + verify
  tempo/         SDK: PactClient, pactProvider, TIP-1034 rail, MPP wire
  mcp/           MCP server + client wrapper
apps/
  gateway/       hosted PACT gateway (Hono + SQLite)
  dashboard/     PACT Control Center (Next.js)
  demo-provider/ controllable provider for the Chaos Lab
examples/
  basic-api/       protect an API with pactProvider
  research-agent/  an agent using PactClient.fetch
  mcp-agent/       an MCP agent paying for PACT tools
test/            integration, security, SDK, MCP and live Tempo tests
docs/            this documentation
```

## Checks

```bash
npm run typecheck
npm run lint
npm test
npm run test:live
```

`test:live` needs a funded `.env` (see [Use Tempo testnet](./tempo-testnet.md)).
