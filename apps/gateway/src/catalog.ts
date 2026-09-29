import type { VerificationPolicy } from '@pact/verifier'

export const POLICIES: VerificationPolicy[] = [
  {
    id: 'company-filings',
    version: 1,
    name: 'Company filings v1',
    description:
      'Exactly the requested number of filings for the requested company, each with form, period, revenue, filing date and an http(s) source. Signed by the provider, bound to the pact request, within 4 s.',
    maxLatencyMs: 4_000,
    itemsPath: 'filings',
    topLevelFields: { company: 'string', ticker: 'string', filings: 'array' },
    itemFields: { form: 'string', period: 'string', revenueUsd: 'number', filedAt: 'date', source: 'url' },
    minItems: 'request.count',
    maxItems: 'request.count',
    uniqueItemKey: 'period',
    echoFields: ['company'],
    requireProviderSignature: true,
    requireRequestBinding: true,
  },
  {
    id: 'market-report',
    version: 1,
    name: 'Market report v1',
    description:
      'Asynchronous report on the requested market with at least the requested number of distinct sections, each with a heading, body and source count. Delivered by signed callback within 45 s.',
    maxLatencyMs: 45_000,
    itemsPath: 'sections',
    topLevelFields: { title: 'string', market: 'string', generatedAt: 'date', sections: 'array' },
    itemFields: { heading: 'string', body: 'string', sourceCount: 'number' },
    minItems: 'request.sections',
    maxItems: null,
    uniqueItemKey: 'heading',
    echoFields: ['market'],
    requireProviderSignature: true,
    requireRequestBinding: true,
  },
]

export type ProviderKey = 'northwind' | 'atlas'

export type ServiceDef = {
  id: string
  name: string
  description: string
  provider: ProviderKey
  providerName: string
  path: string
  mode: 'sync' | 'async'
  price: string
  policyId: string
  capability: string
  /** JSON Schema of the request input. Published so agents and MCP hosts know what to send. */
  inputSchema: Record<string, unknown>
}

const FILINGS_INPUT = {
  type: 'object',
  properties: {
    company: { type: 'string', minLength: 1, maxLength: 80, description: 'Company name, e.g. "NVIDIA"' },
    count: { type: 'integer', minimum: 1, maximum: 12, description: 'Number of most recent quarterly filings' },
  },
  required: ['company', 'count'],
  additionalProperties: false,
}

const REPORT_INPUT = {
  type: 'object',
  properties: {
    market: { type: 'string', minLength: 1, maxLength: 80, description: 'Market to analyse' },
    sections: { type: 'integer', minimum: 1, maximum: 12, description: 'Minimum number of report sections' },
  },
  required: ['market', 'sections'],
  additionalProperties: false,
}

export const SERVICES: ServiceDef[] = [
  {
    id: 'sec-filings',
    name: 'SEC Filings Research',
    description: 'Quarterly filings (form, period, revenue, source) for a public company.',
    provider: 'northwind',
    providerName: 'Northwind Data',
    path: '/provider/northwind/filings',
    mode: 'sync',
    price: '0.40',
    policyId: 'company-filings',
    capability: 'company-filings',
    inputSchema: FILINGS_INPUT,
  },
  {
    id: 'sec-filings-atlas',
    name: 'SEC Filings Research',
    description: 'Same capability from an independent provider. Used as the retry target.',
    provider: 'atlas',
    providerName: 'Atlas Research',
    path: '/provider/atlas/filings',
    mode: 'sync',
    price: '0.42',
    policyId: 'company-filings',
    capability: 'company-filings',
    inputSchema: FILINGS_INPUT,
  },
  {
    id: 'market-report',
    name: 'Market Report Generator',
    description: 'Long-running report job. Accepts the job, then delivers by signed callback.',
    provider: 'northwind',
    providerName: 'Northwind Data',
    path: '/provider/northwind/report',
    mode: 'async',
    price: '1.20',
    policyId: 'market-report',
    capability: 'market-report',
    inputSchema: REPORT_INPUT,
  },
]

export const SCENARIOS = [
  { id: 'normal', label: 'Normal', expect: 'PASS', description: 'Correct, signed, complete result.' },
  { id: 'incomplete', label: 'Incomplete response', expect: 'FAIL', description: 'Returns fewer filings than requested.' },
  { id: 'malformed', label: 'Malformed response', expect: 'FAIL', description: 'Truncated, unparseable JSON.' },
  { id: 'timeout', label: 'Timeout', expect: 'FAIL', description: 'Never answers; the gateway aborts.' },
  { id: 'wrong', label: 'Wrong result', expect: 'FAIL', description: 'Answers about a different company.' },
  { id: 'delayed', label: 'Delayed result', expect: 'FAIL', description: 'Correct data, but after the latency limit.' },
  { id: 'duplicate', label: 'Duplicate items', expect: 'FAIL', description: 'Pads the result by repeating a filing.' },
  { id: 'replay', label: 'Replayed result', expect: 'FAIL', description: 'Re-sends a result signed for another request.' },
  { id: 'forged', label: 'Forged signature', expect: 'FAIL', description: 'Result signed by a key that is not the provider.' },
  { id: 'http_error', label: 'Provider error', expect: 'FAIL', description: 'HTTP 503 after taking the job.' },
] as const

export type ScenarioId = (typeof SCENARIOS)[number]['id']
export const SCENARIO_IDS = SCENARIOS.map((s) => s.id) as [ScenarioId, ...ScenarioId[]]
