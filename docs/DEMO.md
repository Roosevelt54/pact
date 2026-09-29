# PACT — 60-second judge demo

**One line:** *Agents can pay for work now. PACT makes sure they only pay for work that was actually delivered.*

Setup (once): `npm run tempo:setup && npm run dev`, then open <http://localhost:3000>.
The sidebar must say **Tempo Moderato** — every number on screen is backed by a real testnet transaction.

| # | Time | Where | Do | Say |
|---|---|---|---|---|
| 1 | 0:00 | Control Center `/` | Point at **Pay. Prove. Settle.** and the Protected spend figure | "Tempo and MPP made machine payments easy. A payment receipt proves money moved — not that the work was done. PACT is the missing prepare/commit layer." |
| 2 | 0:08 | Chaos Lab `/lab` | Select **Incomplete response** → **Run paid request** | "An agent asks for 4 SEC filings and escrows $0.50 on Tempo, bound to this exact request." |
| 3 | 0:15 | Lifecycle rail | Watch **Payment authorized → Service executing → Result received** light up | "Payment is *authorized* — locked in Tempo's native escrow, not paid." |
| 4 | 0:22 | Verification panel | Point at the red **✕ Minimum items · 2 of ≥4** | "The provider returned 2 of 4. Sixteen deterministic checks — no LLM decides where money goes." |
| 5 | 0:28 | Banner + money bar | **Settlement protected. Nothing released.** Open the **Settlement tx** | "PACT closed the channel capturing zero. The full $0.50 went back to the agent in one transaction — here it is on the explorer." |
| 6 | 0:36 | Same page | Click **Retry with Atlas Research** | "The agent retries with another provider." |
| 7 | 0:42 | Lifecycle rail | All seven stages go green through **Settlement** | "Verified. $0.42 captured by the provider, the unused authorization refunded — same transaction." |
| 8 | 0:48 | Click **Work receipt** | Show the stamped receipt and **Authentic** | "A signed Work Receipt binds request, payment, result, verdict and settlement. Anyone can verify it offline." |
| 9 | 0:53 | `/docs` | Show the two code blocks | "It's an SDK: `pact.fetch()` for agents, `provider.protect()` for APIs, plus paid MCP tools." |
| 10 | 0:58 | Repository | `packages/` · `apps/` · `examples/` | "Infrastructure, not a demo: reusable packages, a hosted gateway, and this Control Center." |

## If there is more time

- **Work Receipts → Load a tampered copy → Verify** — change one number, the receipt is rejected (digest, id and signature all fail).
- **Async job → Duplicate callback** — the provider delivers twice; PACT settles exactly once.
- **Async job → Forged callback** — a callback signed by the wrong key is rejected without touching state.
- **Timeout** / **Delayed result** — correct data that arrives late is still refunded.
- `npm start -w @pact/example-mcp-agent` — an MCP agent hits `-32042`, escrows, and gets verified tool output.

## Backup plan (no network)

Set `PACT_RAIL=local` in `.env` and restart. Everything works on the local ledger rail and the UI says
**Local ledger** instead of Tempo Moderato; explorer links are hidden, never faked.
