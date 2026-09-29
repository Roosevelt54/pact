# Paid MCP tools

`@pact/mcp` exposes a gateway's services as MCP tools whose calls go through PAY → PROVE → SETTLE.
The wire format is **MPP-over-MCP exactly as mppx defines it** (`Mcp` in mppx):

| Step | Wire |
|---|---|
| Unpaid call | JSON-RPC error `-32042` with `data: { httpStatus: 402, challenges: [challenge] }` |
| Paid retry | same `tools/call` with `_meta["org.paymentauth/credential"] = credential` |
| Result | `_meta["org.paymentauth/receipt"]` (MPP receipt) + `_meta["org.pact/result"]` (verdict, settlement) + `_meta["org.pact/work-receipt"]` |

The difference from a plain MPP charge: the credential is an **escrowed authorization bound to the
pact**, and the tool's result is only paid for if it verifies. A failing tool returns `isError: true`
with "Nothing was paid" and the refund amount.

## Server

```ts
import { createPactMcpServer } from '@pact/mcp'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

const { server, tools } = await createPactMcpServer({ gateway: 'https://pact.example.com' })
await server.connect(new StdioServerTransport())
// tools: pact_sec_filings, pact_sec_filings_atlas, pact_market_report, …
```

Or run the bundled binary:

```bash
PACT_GATEWAY_URL=http://localhost:8787 npx tsx packages/mcp/src/bin.ts
```

## Client (agent pays)

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { withPact } from '@pact/mcp'

const client = new Client({ name: 'my-agent', version: '1.0.0' })
await client.connect(transport)
withPact(client, { pact })            // pact = PactClient

const res = await client.callTool({ name: 'pact_sec_filings', arguments: { company: 'Apple', count: 2 } })
res._meta['org.pact/result']          // { verified, state, settlement, … }
```

`withPact` mirrors mppx's `McpClient.wrap`: it catches `-32042`, applies the agent's budget policy
(default: price + 25%, override with `budget`), escrows, and retries with the credential. Use
`onPaymentRequired` to approve or decline each payment.

## Hosts that cannot pay (autopay)

Desktop MCP hosts cannot answer `-32042`. Give the server an agent wallet and it pays on the host's
behalf — still escrowed, still verified:

```json
{
  "mcpServers": {
    "pact": {
      "command": "npx",
      "args": ["tsx", "/path/to/pact/packages/mcp/src/bin.ts"],
      "env": {
        "PACT_GATEWAY_URL": "http://localhost:8787",
        "PACT_AGENT_ID": "agt_researchbot",
        "PACT_AGENT_PRIVATE_KEY": "0x… (testnet only)",
        "PACT_TRUSTED_OPERATOR": "0x…"
      }
    }
  }
}
```

A runnable agent is in `examples/mcp-agent`.
