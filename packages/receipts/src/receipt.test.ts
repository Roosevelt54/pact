import { describe, expect, it } from 'vitest'

import { RECEIPT_VERSION, receiptDigest, receiptIdFor, unseal, type ReceiptBody } from './receipt.js'

const body: ReceiptBody = {
  version: RECEIPT_VERSION,
  pactId: 'pact_1',
  issuedAt: '2026-09-28T12:00:00.000Z',
  agent: { id: 'agt_1', address: '0xa' },
  service: { id: 'svc', name: 'Svc', endpoint: 'https://p.example/x' },
  provider: { name: 'P', address: '0xb' },
  request: { digest: 'sha256:00' },
  payment: {
    rail: 'local',
    chainId: null,
    token: '0x20c0000000000000000000000000000000000000',
    escrow: null,
    operator: '0xc',
    challengeId: 'ch_1',
    channelId: '0xdd',
    channelSalt: '0xee',
    authorizeTx: null,
    authorizedAmount: '0.50',
    price: '0.40',
  },
  result: { digest: 'sha256:11', itemCount: 3, latencyMs: 120 },
  verification: {
    policyId: 'p',
    policyVersion: 1,
    policyDigest: 'sha256:22',
    verdict: 'PASS',
    reasons: [],
    checks: [{ code: 'http_ok', status: 'pass', detail: 'HTTP 200' }],
  },
  settlement: { outcome: 'captured', captureAmount: '0.40', refundAmount: '0.10', txHash: null },
}

describe('work receipt', () => {
  it('derives a stable id from the digest', () => {
    const d = receiptDigest(body)
    expect(receiptIdFor(d)).toMatch(/^wr_[0-9a-f]{20}$/)
    expect(receiptDigest(structuredClone(body))).toBe(d)
  })

  it('changes digest when any bound field is altered', () => {
    const d = receiptDigest(body)
    const tampered = { ...body, settlement: { ...body.settlement, captureAmount: '0.50' } }
    expect(receiptDigest(tampered)).not.toBe(d)
    const otherRequest = { ...body, request: { digest: 'sha256:01' } }
    expect(receiptDigest(otherRequest)).not.toBe(d)
  })

  it('unseals back to the exact signed body', () => {
    const d = receiptDigest(body)
    const sealed = { ...body, receiptId: receiptIdFor(d), receiptDigest: d, pactSignature: '0xsig' }
    expect(receiptDigest(unseal(sealed))).toBe(d)
  })
})
