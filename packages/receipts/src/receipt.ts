import { digest, type Digest } from '@pact/core'
import type { Check, CheckCode, Verdict } from '@pact/verifier'

export const RECEIPT_VERSION = 'pact.receipt/v1' as const

export type ReceiptBody = {
  version: typeof RECEIPT_VERSION
  pactId: string
  issuedAt: string
  agent: { id: string; address: string }
  service: { id: string; name: string; endpoint: string }
  provider: { name: string; address: string }
  request: { digest: string }
  payment: {
    rail: 'tempo' | 'local'
    chainId: number | null
    token: string
    escrow: string | null
    operator: string
    challengeId: string | null
    channelId: string | null
    channelSalt: string | null
    authorizeTx: string | null
    authorizedAmount: string
    price: string
  }
  result: { digest: string | null; itemCount: number | null; latencyMs: number | null }
  verification: {
    policyId: string
    policyVersion: number
    policyDigest: string
    verdict: Verdict
    reasons: CheckCode[]
    checks: Check[]
  }
  settlement: {
    outcome: 'captured' | 'refunded' | 'none'
    captureAmount: string
    refundAmount: string
    txHash: string | null
  }
}

export type WorkReceipt = ReceiptBody & {
  receiptId: string
  receiptDigest: Digest
  pactSignature: string
}

export const receiptDigest = (body: ReceiptBody): Digest => digest(body)

export const receiptIdFor = (d: Digest): string => `wr_${d.slice('sha256:'.length, 'sha256:'.length + 20)}`

/** Strips the seal so the body can be re-digested for verification. */
export function unseal(receipt: WorkReceipt): ReceiptBody {
  const { receiptId: _id, receiptDigest: _d, pactSignature: _s, ...body } = receipt
  return body
}
