/**
 * PactClient — the agent side of PACT.
 *
 *   const pact = PactClient.tempo({ gateway, agentId, privateKey, trustedOperator })
 *   const res  = await pact.fetch({ service: 'sec-filings', input: { company: 'NVIDIA', count: 4 }, maxAmount: '0.50' })
 *   res.verified  // true only if the provider's work passed the published policy
 *   res.receipt   // signed Work Receipt binding request → payment → result → verdict → settlement
 *
 * Under the hood: create pact → MPP 402 session challenge → escrow the budget in a
 * TIP-1034 channel bound to the pact → voucher for the price → wait for PROVE/SETTLE.
 */
import { Credential } from 'mppx'
import type { Address, Hex } from 'viem'

import { formatAmount, parseAmount } from '@pact/core'
import { verifyReceipt, type ReceiptVerification, type WorkReceipt } from '@pact/receipts'

import { createTempoContext } from './chain.js'
import {
  PactClientError,
  PactGateway,
  type CreatePactParams,
  type FetchLike,
  type PactChallenge,
  type PactResult,
  type PactSummary,
} from './gateway.js'
import { buildCredentialHeader, type SessionChallengeRequest } from './mpp.js'
import { TempoPayer } from './rails/tempo.js'
import type { OpenCredentialPayload, PayerWallet } from './rails/types.js'

export * from './gateway.js'

export type PactClientOptions = {
  /** Base URL of the PACT gateway, e.g. https://pact.example.com */
  gateway: string
  /** Agent identity registered with the gateway. */
  agentId: string
  /** Wallet that escrows funds and signs vouchers. Never leaves the agent. */
  wallet: PayerWallet
  /** The gateway operator address this agent trusts to settle its escrow. */
  trustedOperator: Address
  fetch?: FetchLike
}

export class PactClient {
  readonly gateway: PactGateway

  constructor(private readonly o: PactClientOptions) {
    this.gateway = new PactGateway(o.gateway, o.fetch)
  }

  /** Convenience constructor for an agent paying on Tempo with a raw private key. */
  static tempo(o: Omit<PactClientOptions, 'wallet'> & { privateKey: Hex; rpcUrl?: string; token?: Address }) {
    const ctx = createTempoContext(
      o.rpcUrl ?? 'https://rpc.moderato.tempo.xyz',
      o.token ?? '0x20c0000000000000000000000000000000000000',
    )
    return new PactClient({ ...o, wallet: new TempoPayer(ctx, o.privateKey) })
  }

  get address() {
    return this.o.wallet.address
  }

  get agentId() {
    return this.o.agentId
  }

  /** Registers the request and its budget. Idempotent per key. */
  create(p: Omit<CreatePactParams, 'agentId'>): Promise<PactSummary> {
    return this.gateway.create({ ...p, agentId: this.o.agentId })
  }

  challenge(pactId: string): Promise<PactChallenge> {
    return this.gateway.challenge(pactId)
  }

  get(pactId: string) {
    return this.gateway.get(pactId)
  }

  wait<T = unknown>(pactId: string, o?: { timeoutMs?: number | undefined; intervalMs?: number }) {
    return this.gateway.wait<T>(pactId, o)
  }

  outcome<T = unknown>(pactId: string) {
    return this.gateway.outcome<T>(pactId)
  }

  /**
   * Enforces this agent's own policy on a challenge, escrows `maxAmount` in a
   * pact-bound TIP-1034 channel and signs a voucher for exactly the price.
   * Returns both the MPP credential object (for MCP `_meta`) and header form (HTTP).
   */
  async createCredential(
    challenge: PactChallenge,
    maxAmount: string,
  ): Promise<{ pactId: string; payload: OpenCredentialPayload; credential: Credential.Credential; header: string }> {
    const request = challenge.request as unknown as SessionChallengeRequest
    if (challenge.method !== 'tempo' || challenge.intent !== 'session')
      throw new PactClientError('unsupported_challenge', `${challenge.method}/${challenge.intent}`)
    const pactId = request.methodDetails?.pact
    if (!pactId) throw new PactClientError('not_a_pact_challenge', 'challenge carries no pact id')
    if (request.methodDetails.operator.toLowerCase() !== this.o.trustedOperator.toLowerCase())
      throw new PactClientError('untrusted_operator', 'challenge names an operator this agent does not trust', pactId)
    const price = BigInt(request.amount)
    const budget = parseAmount(maxAmount)
    if (price > budget) throw new PactClientError('over_budget', `price ${formatAmount(price)} exceeds budget ${maxAmount}`, pactId)

    const payload = await this.o.wallet.openAndSign({
      pactId,
      payee: request.recipient as Address,
      operator: request.methodDetails.operator as Address,
      deposit: budget,
      amount: price,
    })
    const source = `did:pkh:eip155:${request.methodDetails.chainId ?? 0}:${this.o.wallet.address}`
    const credential = Credential.from({ challenge, payload, source })
    return { pactId, payload, credential, header: buildCredentialHeader(challenge, payload, source) }
  }

  /** PAY: challenge → escrow → `Authorization: Payment …`. */
  async authorize(pactId: string, maxAmount: string) {
    const challenge = await this.challenge(pactId)
    const { header, payload } = await this.createCredential(challenge, maxAmount)
    const { paymentReceipt } = await this.gateway.submit(pactId, header)
    return { channelId: payload.channelId, paymentReceipt }
  }

  /** PAY → PROVE → SETTLE in one call. */
  async fetch<T = unknown>(p: {
    service: string
    input: Record<string, unknown>
    maxAmount: string
    idempotencyKey?: string
    retryOf?: string
    timeoutMs?: number
  }): Promise<PactResult<T>> {
    const pact = await this.create(p)
    if (pact.state === 'CREATED') await this.authorize(pact.id, p.maxAmount)
    return this.wait<T>(pact.id, { timeoutMs: p.timeoutMs })
  }

  /** Verifies a Work Receipt locally against the operator this agent trusts. */
  verifyReceipt(receipt: WorkReceipt): Promise<ReceiptVerification> {
    return verifyReceipt(receipt, this.o.trustedOperator)
  }
}
