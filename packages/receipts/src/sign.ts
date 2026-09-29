import { verifyMessage, type Account, type Hex } from 'viem'

import { receiptDigest, receiptIdFor, unseal, type ReceiptBody, type WorkReceipt } from './receipt.js'

/** Seals a receipt body: digest → id → EIP-191 signature by the PACT operator. */
export async function sealReceipt(body: ReceiptBody, signer: Account): Promise<WorkReceipt> {
  if (!signer.signMessage) throw new Error('signer cannot sign messages')
  const d = receiptDigest(body)
  const pactSignature = await signer.signMessage({ message: d })
  return { ...body, receiptId: receiptIdFor(d), receiptDigest: d, pactSignature }
}

export type ReceiptVerification = {
  valid: boolean
  checks: { digestMatches: boolean; idMatches: boolean; signatureValid: boolean; storedMatches: boolean }
  signer: string
}

/**
 * Verifies a receipt from its own content: recomputes the digest, the id and the
 * signer. Never trusts the id or digest the document claims. `stored` is an
 * optional copy from the issuing gateway to compare against.
 */
export async function verifyReceipt(
  receipt: WorkReceipt,
  expectedSigner: string,
  stored: WorkReceipt | null = null,
): Promise<ReceiptVerification> {
  const recomputed = receiptDigest(unseal(receipt))
  const digestMatches = recomputed === receipt.receiptDigest
  const idMatches = receiptIdFor(recomputed) === receipt.receiptId
  const signatureValid = await verifyMessage({
    address: expectedSigner as Hex,
    message: recomputed,
    signature: receipt.pactSignature as Hex,
  }).catch(() => false)
  const storedMatches = stored ? stored.receiptDigest === recomputed : false
  return {
    valid: digestMatches && idMatches && signatureValid,
    checks: { digestMatches, idMatches, signatureValid, storedMatches },
    signer: expectedSigner,
  }
}
