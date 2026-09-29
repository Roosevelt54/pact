import 'server-only'

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export type Doc = { slug: string; file: string; title: string; summary: string; group: 'Start' | 'Concepts' | 'Guides' | 'Reference' }

/** Single source of truth: the repository's /docs folder renders here and on GitHub. */
export const DOCS: Doc[] = [
  { slug: 'overview', file: 'overview.md', title: 'What PACT solves', summary: 'Payment success is not work success.', group: 'Start' },
  { slug: 'run-locally', file: 'run-locally.md', title: 'Run PACT locally', summary: 'Gateway, Control Center and tests in minutes.', group: 'Start' },
  { slug: 'tempo-testnet', file: 'tempo-testnet.md', title: 'Use Tempo testnet', summary: 'Fund keys and settle on Moderato.', group: 'Start' },
  { slug: 'demo', file: 'DEMO.md', title: '60-second demo', summary: 'The judge walkthrough, step by step.', group: 'Start' },
  { slug: 'publish-sdk', file: 'publish-sdk.md', title: 'Publish the SDK to npm', summary: 'Build, verify and publish the packages.', group: 'Reference' },
  { slug: 'how-it-works', file: 'how-it-works.md', title: 'Payment ↔ work correlation', summary: 'How a payment is bound to one request.', group: 'Concepts' },
  { slug: 'verification-policies', file: 'verification-policies.md', title: 'Verification policies', summary: 'Deterministic checks that decide capture.', group: 'Concepts' },
  { slug: 'work-receipts', file: 'work-receipts.md', title: 'Work Receipts', summary: 'Portable, signed proof of paid work.', group: 'Concepts' },
  { slug: 'settlement', file: 'settlement.md', title: 'Settlement', summary: 'Operator close on the TIP-1034 escrow.', group: 'Concepts' },
  { slug: 'protect-an-api', file: 'protect-an-api.md', title: 'Protect an API', summary: 'pactProvider + a published policy.', group: 'Guides' },
  { slug: 'build-an-agent', file: 'build-an-agent.md', title: 'Build a paying agent', summary: 'PactClient.fetch in one call.', group: 'Guides' },
  { slug: 'mcp', file: 'mcp.md', title: 'Paid MCP tools', summary: 'MPP-over-MCP with PACT assurance.', group: 'Guides' },
  { slug: 'api-reference', file: 'api-reference.md', title: 'Gateway API', summary: 'Every HTTP endpoint.', group: 'Reference' },
  { slug: 'architecture', file: 'ARCHITECTURE.md', title: 'Architecture & findings', summary: 'What was verified in Tempo / mppx source.', group: 'Reference' },
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
