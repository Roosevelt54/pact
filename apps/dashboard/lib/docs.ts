import 'server-only'

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export type Doc = {
  slug: string
  file: string
  title: string
  summary: string
  group: 'Start here' | 'Use PACT in your code' | 'Concepts' | 'Reference' | 'Self-hosting'
}

/**
 * Single source of truth: the repository's /docs folder renders here and on GitHub.
 * Ordered for the reader: nobody needs to run PACT to use it — integrations point at the live gateway;
 * running your own copy comes last.
 */
export const DOCS: Doc[] = [
  { slug: 'overview', file: 'overview.md', title: 'What PACT solves', summary: 'Payment success is not work success.', group: 'Start here' },
  { slug: 'demo', file: 'DEMO.md', title: '60-second demo', summary: 'Try it in the browser, step by step.', group: 'Start here' },
  { slug: 'build-an-agent', file: 'build-an-agent.md', title: 'Build a paying agent', summary: 'PactClient.fetch in one call.', group: 'Use PACT in your code' },
  { slug: 'protect-an-api', file: 'protect-an-api.md', title: 'Get paid for your API', summary: 'pactProvider + a published policy.', group: 'Use PACT in your code' },
  { slug: 'mcp', file: 'mcp.md', title: 'Paid MCP tools', summary: 'MPP-over-MCP with PACT assurance.', group: 'Use PACT in your code' },
  { slug: 'how-it-works', file: 'how-it-works.md', title: 'Payment ↔ work correlation', summary: 'How a payment is bound to one request.', group: 'Concepts' },
  { slug: 'verification-policies', file: 'verification-policies.md', title: 'Verification policies', summary: 'Deterministic checks that decide capture.', group: 'Concepts' },
  { slug: 'work-receipts', file: 'work-receipts.md', title: 'Work Receipts', summary: 'Portable, signed proof of paid work.', group: 'Concepts' },
  { slug: 'settlement', file: 'settlement.md', title: 'Settlement', summary: 'Operator close on the TIP-1034 escrow.', group: 'Concepts' },
  { slug: 'api-reference', file: 'api-reference.md', title: 'Gateway API', summary: 'Every HTTP endpoint.', group: 'Reference' },
  { slug: 'architecture', file: 'ARCHITECTURE.md', title: 'Architecture & findings', summary: 'What was verified in Tempo / mppx source.', group: 'Reference' },
  { slug: 'run-locally', file: 'run-locally.md', title: 'Run your own gateway', summary: 'Only if you want your own copy of PACT.', group: 'Self-hosting' },
  { slug: 'tempo-testnet', file: 'tempo-testnet.md', title: 'Your gateway on Tempo testnet', summary: 'Fund operator keys and settle on Moderato.', group: 'Self-hosting' },
  { slug: 'publish-sdk', file: 'publish-sdk.md', title: 'Publish the SDK to npm', summary: 'For maintainers releasing new versions.', group: 'Self-hosting' },
]

const DOCS_DIR = join(process.cwd(), '..', '..', 'docs')

export async function loadDoc(slug: string): Promise<{ doc: Doc; markdown: string } | null> {
  const doc = DOCS.find((d) => d.slug === slug)
  if (!doc) return null
  try {
    return { doc, markdown: await readFile(join(DOCS_DIR, doc.file), 'utf8') }
  } catch {
    return null
  }
}
