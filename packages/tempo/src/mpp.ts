/**
 * MPP wire handling for the PACT authorize step, built on mppx's Challenge,
 * Credential and Receipt modules (HMAC-bound challenge ids, base64url
 * credentials, Payment-Receipt headers).
 */
import { Challenge, Credential, PaymentRequest, Receipt } from 'mppx'
import { z } from 'zod'

import type { OpenCredentialPayload } from './rails/types.js'

export const Headers = {
  wwwAuthenticate: 'WWW-Authenticate',
  authorization: 'Authorization',
  paymentReceipt: 'Payment-Receipt',
} as const

const hex = (bytes?: number) =>
  z.string().regex(bytes ? new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`) : /^0x[0-9a-fA-F]+$/)
const address = hex(20)

export const openPayloadSchema = z.object({
  action: z.literal('open'),
  type: z.literal('hash'),
  channelId: hex(32),
  descriptor: z.object({
    payer: address,
    payee: address,
    operator: address,
    token: address,
    salt: hex(32),
    authorizedSigner: address,
    expiringNonceHash: hex(32),
  }),
  txHash: hex(32).nullable(),
  voucher: z.object({
    cumulativeAmount: z.string().regex(/^\d{1,29}$/),
    signature: hex().max(4096),
  }),
})

export type SessionChallengeRequest = {
  amount: string
  currency: string
  recipient: string
  unitType: 'request'
  methodDetails: { chainId: number | null; escrowContract: string | null; operator: string; rail: string; pact: string }
}

export function issueChallenge(p: {
  secretKey: string
  realm: string
  pactId: string
  request: SessionChallengeRequest
  expiresAt: Date
  description: string
}) {
  return Challenge.from({
    secretKey: p.secretKey,
    realm: p.realm,
    method: 'tempo',
    intent: 'session',
    request: p.request,
    expires: p.expiresAt.toISOString(),
    description: p.description,
    meta: { pact: p.pactId },
  })
}

export const serializeChallenge = (c: Challenge.Challenge) => Challenge.serialize(c)

export class PaymentError extends Error {
  override readonly name = 'PaymentError'
  constructor(
    readonly code: string,
    message: string,
    readonly status = 402,
  ) {
    super(message)
  }
}

export type ParsedCredential = {
  challengeId: string
  challengeRequest: SessionChallengeRequest
  payload: OpenCredentialPayload
  source: string | undefined
}

/** Parses and authenticates an `Authorization: Payment …` credential for a specific pact. */
export function parseCredential(
  header: string | null | undefined,
  p: { secretKey: string; pactId: string; expectedChallengeId: string | null; now: number },
): ParsedCredential {
  if (!header) throw new PaymentError('missing_credential', 'Authorization: Payment credential required')
  let credential: ReturnType<typeof Credential.deserialize>
  try {
    const scheme = Credential.extractPaymentScheme(header) ?? header
    credential = Credential.deserialize(scheme)
  } catch {
    throw new PaymentError('invalid_credential', 'credential is not valid base64url JSON', 400)
  }
  const challenge = credential.challenge
  if (!Challenge.verify(challenge, { secretKey: p.secretKey }))
    throw new PaymentError('invalid_challenge', 'challenge was not issued by this gateway or was altered')
  if (challenge.method !== 'tempo' || challenge.intent !== 'session')
    throw new PaymentError('unsupported_method', 'expected method=tempo intent=session')
  // After a wire round-trip mppx keeps `meta` only as the HMAC-covered `opaque` string.
  let meta = Challenge.meta(challenge) as Record<string, unknown> | undefined
  if (!meta && typeof challenge.opaque === 'string') {
    try {
      meta = PaymentRequest.deserialize(challenge.opaque) as Record<string, unknown>
    } catch {
      meta = undefined
    }
  }
  if (meta?.pact !== p.pactId) throw new PaymentError('challenge_pact_mismatch', 'challenge belongs to a different pact')
  if (p.expectedChallengeId && challenge.id !== p.expectedChallengeId)
    throw new PaymentError('stale_challenge', 'challenge has been superseded; request a new one')
  if (challenge.expires && Date.parse(challenge.expires) < p.now)
    throw new PaymentError('challenge_expired', 'challenge expired; request a new one')
  const parsed = openPayloadSchema.safeParse(credential.payload)
  if (!parsed.success)
    throw new PaymentError('invalid_payload', `credential payload invalid: ${parsed.error.issues[0]?.message ?? 'schema'}`, 400)
  return {
    challengeId: challenge.id,
    challengeRequest: challenge.request as unknown as SessionChallengeRequest,
    payload: parsed.data as OpenCredentialPayload,
    source: credential.source,
  }
}

export function buildCredentialHeader(challenge: Challenge.Challenge, payload: OpenCredentialPayload, source?: string) {
  return Credential.serialize(Credential.from({ challenge, payload, ...(source ? { source } : {}) }))
}

export function receiptHeader(p: { reference: string; status?: 'success' }) {
  return Receipt.serialize(
    Receipt.from({ method: 'tempo', status: p.status ?? 'success', timestamp: new Date().toISOString(), reference: p.reference }),
  )
}

export const challengeFromResponse = (res: Response) => Challenge.fromResponse(res)
