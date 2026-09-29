export type PactState =
  | 'CREATED'
  | 'AUTHORIZED'
  | 'EXECUTING'
  | 'VERIFYING'
  | 'VERIFIED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'SETTLING'
  | 'SETTLED'
  | 'PROTECTED'

export type PactSummary = {
  id: string
  state: PactState
  outcome: 'pass' | 'fail' | 'expired' | null
  scenario: string | null
  origin: string
  rail: 'tempo' | 'local'
  service: { id: string; name: string; provider: string; mode: 'sync' | 'async' } | null
  price: string
  maxAmount: string
  authorized: string | null
  captured: string | null
  refunded: string | null
  settlementTxUrl: string | null
  retryOf: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export type PactEvent = {
  seq: number
  pactId: string | null
  type: string
  actor: string
  data: Record<string, unknown>
  at: string
}

export type Check = { code: string; status: 'pass' | 'fail' | 'skip'; detail: string; label: string }

export type PactDetail = Omit<PactSummary, 'service'> & {
  request: Record<string, unknown>
  requestDigest: string
  deadlineAt: string
  authorizedAt: string | null
  service: {
    id: string
    name: string
    description: string
    provider: string
    providerAddress: string
    endpoint: string
    mode: 'sync' | 'async'
  }
  policy: { id: string; version: number; name: string; description: string; digest: string; maxLatencyMs: number }
  authorization: {
    channelId: string
    payer: string
    deposit: string
    voucherAmount: string
    challengeId: string
    openTx: string | null
    openTxUrl: string | null
    salt: string
    at: string
  } | null
  work: {
    status: string
    jobId: string | null
    dispatchedAt: string
    deliveredAt: string | null
    latencyMs: number | null
    httpStatus: number | null
    contentType: string | null
    bytes: number
    resultDigest: string | null
    claimedResultDigest: string | null
    transportError: string | null
    duplicateDeliveries: number
    bodyPreview: string | null
  } | null
  verification: { verdict: string; reasons: string[]; itemCount: number | null; checks: Check[]; at: string } | null
  settlement: {
    kind: 'capture' | 'refund'
    status: 'pending' | 'confirmed' | 'failed'
    capture: string
    refund: string | null
    txHash: string | null
    txUrl: string | null
    attempts: number
    lastError: string | null
    confirmedAt: string | null
  } | null
  receiptId: string | null
  retries: { id: string; state: PactState; service_id: string }[]
  timeline: PactEvent[]
  payments: { kind: string; amount: string | null; txHash: string | null; txUrl: string | null; detail: string | null; at: string }[]
  failures: { stage: string; code: string; message: string; at: string }[]
}

export type Metrics = {
  authorized: string
  settled: string
  protected: string
  refunded: string
  inFlight: string
  pacts: number
  byState: Record<string, number>
  verdicts: Record<string, number>
  passRate: number | null
  active: number
  providers: { serviceId: string; name: string; provider: string; total: number; passed: number; failed: number; avgLatencyMs: number | null }[]
}

export type RailInfo = {
  kind: 'tempo' | 'local'
  label: string
  chainId: number | null
  network: string
  token: string
  tokenSymbol: string
  escrow: string | null
  operator: string
  explorerUrl: string | null
  parties: { role: 'agent' | 'provider' | 'operator'; name: string; address: string; balance: string | null; url: string | null }[]
}

export type Service = {
  id: string
  name: string
  description: string
  provider: string
  providerAddress: string
  endpoint: string
  mode: 'sync' | 'async'
  price: string
  policy: string
  capability: string
  inputSchema: Record<string, unknown>
}

export type Scenario = { id: string; label: string; expect: 'PASS' | 'FAIL'; description: string }

export type WorkReceipt = Record<string, unknown> & {
  receiptId: string
  receiptDigest: string
  pactSignature: string
  pactId: string
  issuedAt: string
}

export type ReceiptVerification = {
  valid: boolean
  checks: { digestMatches: boolean; idMatches: boolean; signatureValid: boolean; storedMatches: boolean }
  signer: string
}
