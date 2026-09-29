# @pact/mcp

Paid MCP tools that only settle when the tool output is verified. Uses the MPP-over-MCP wire format
defined by mppx: JSON-RPC `-32042` with a payment challenge, retry with
`_meta["org.paymentauth/credential"]`, receipt in `_meta["org.paymentauth/receipt"]`.

```bash
npm install @pact/mcp @pact/tempo @modelcontextprotocol/sdk
```

## Server

```ts
import { createPactMcpServer } from '@pact/mcp'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

const { server } = await createPactMcpServer({ gateway: 'https://your-pact-gateway.example' })
await server.connect(new StdioServerTransport())
```

Or run the binary: `PACT_GATEWAY_URL=https://your-pact-gateway.example npx pact-mcp`

## Client (the agent pays)

```ts
import { withPact } from '@pact/mcp'

withPact(mcpClient, { pact })   // pact = PactClient from @pact/tempo
const res = await mcpClient.callTool({ name: 'pact_sec_filings', arguments: { company: 'Apple', count: 2 } })
res._meta['org.pact/result']    // { verified, state, settlement }
```

Docs: https://github.com/Roosevelt54/pact/blob/main/docs/mcp.md · License: MIT
