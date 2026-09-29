import type { Account } from 'viem'

import { formatAmount } from '@pact/core'
import { RECEIPT_VERSION, sealReceipt, type ReceiptBody, type WorkReceipt } from '@pact/receipts'
import type { SettlementRail } from '@pact/tempo'
import type { Check, CheckCode, Verdict } from '@pact/verifier'

import type { Repo } from '../db/repo.js'

/** Assembles the receipt from the recorded facts of one pact and seals it with the operator key. */
export async function issueReceipt(repo: Repo, rail: SettlementRail, signer: Account, pactId: string): Promise<WorkReceipt> {
  const existing = repo.getReceiptByPact(pactId)
  if (existing) return JSON.parse(existing.body) as WorkReceipt

  const pact = repo.getPact(pactId)
  if (!pact) throw new Error(`pact ${pactId} not found`)
  const service = repo.getService(pact.service_id)!
  const agent = repo.getAgent(pact.agent_id)!
  const policy = repo.getPolicy(pact.policy_id, pact.policy_version)!
  const auth = repo.getAuthorization(pactId)
  const work = repo.getWorkItem(pactId)
  const verification = repo.getVerification(pactId)
  const settlement = repo.getSettlement(pactId)

  const capture = settlement ? BigInt(settlement.capture_amount) : 0n
  const refund = settlement?.refund_amount ? BigInt(settlement.refund_amount) : 0n
  const descriptor = auth ? (JSON.parse(auth.descriptor) as { salt: string }) : null

  const body: ReceiptBody = {
    version: RECEIPT_VERSION,
    pactId,
    issuedAt: new Date().toISOString(),
    agent: { id: agent.id, address: agent.address },
    service: { id: service.id, name: service.name, endpoint: service.endpoint },
    provider: { name: service.provider_name, address: service.provider_address },
    request: { digest: pact.request_digest },
    payment: {
      rail: rail.info.kind,
      chainId: rail.info.chainId,
      token: rail.info.token,
      escrow: rail.info.escrow,
      operator: rail.info.operator,
      challengeId: auth?.challenge_id ?? pact.challenge_id,
      channelId: auth?.channel_id ?? null,
      channelSalt: descriptor?.salt ?? null,
      authorizeTx: auth?.open_tx_hash ?? null,
      authorizedAmount: formatAmount(BigInt(auth?.deposit ?? '0')),
      price: formatAmount(BigInt(pact.price)),
    },
    result: {
      digest: work?.result_digest ?? null,
      itemCount: verification?.item_count ?? null,
      latencyMs: work?.latency_ms ?? null,
    },
    verification: {
      policyId: policy.id,
      policyVersion: policy.version,
      policyDigest: policy.digest,
      verdict: (verification?.verdict ?? 'EXPIRED') as Verdict,
      reasons: verification ? (JSON.parse(verification.reasons) as CheckCode[]) : ['deadline'],
      checks: verification ? (JSON.parse(verification.checks) as Check[]) : [],
    },
    settlement: {
      outcome: !settlement ? 'none' : capture > 0n ? 'captured' : 'refunded',
      captureAmount: formatAmount(capture),
      refundAmount: formatAmount(refund),
      txHash: settlement?.tx_hash ?? null,
    },
  }

  const receipt = await sealReceipt(body, signer)
  repo.insertReceipt({
    id: receipt.receiptId,
    pact_id: pactId,
    body: JSON.stringify(receipt),
    receipt_digest: receipt.receiptDigest,
    signature: receipt.pactSignature,
    created_at: Date.now(),
  })
  return receipt
}
