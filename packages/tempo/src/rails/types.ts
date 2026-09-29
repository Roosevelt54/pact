import type { Address, Hex } from 'viem'

import type { ChannelDescriptor } from '../chain.js'

export type { ChannelDescriptor }

/**
 * PACT extension of the MPP tempo/session `open` credential payload. The payer
 * broadcasts the TIP-1034 open itself (hash mode) and hands PACT only the
 * descriptor, the tx hash and a voucher authorizing the pact price.
 */
export type OpenCredentialPayload = {
  action: 'open'
  type: 'hash'
  channelId: Hex
  descriptor: ChannelDescriptor
  txHash: Hex | null
  voucher: { cumulativeAmount: string; signature: Hex }
}

export type RailInfo = {
  kind: 'tempo' | 'local'
  label: string
  chainId: number | null
  network: string
  token: Address
  tokenSymbol: string
  escrow: Address | null
  operator: Address
  explorerUrl: string | null
}

export type CloseResult = { txHash: string | null; settledToPayee: bigint; refundedToPayer: bigint }

export class RailError extends Error {
  override readonly name = 'RailError'
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message)
  }
}

export interface SettlementRail {
  readonly info: RailInfo
  /** Validates the escrowed channel against what this pact requires. Returns rail-authoritative facts. */
  verifyChannel(p: {
    descriptor: ChannelDescriptor
    channelId: Hex
    expectedPayee: Address
    minDeposit: bigint
  }): Promise<{ deposit: bigint; payer: Address }>
  verifyVoucher(p: { channelId: Hex; amount: bigint; signature: Hex; signer: Address }): boolean
  /** Operator close: capture `captureAmount` to the payee, refund the rest of the deposit to the payer. */
  close(p: {
    descriptor: ChannelDescriptor
    channelId: Hex
    voucherAmount: bigint
    signature: Hex
    captureAmount: bigint
    openTxHash: string | null
  }): Promise<CloseResult>
  /** Finds an already-executed close (crash recovery / duplicate settlement). */
  findClose(p: { channelId: Hex; openTxHash: string | null }): Promise<CloseResult | null>
  txUrl(hash: string | null): string | null
  balanceOf(address: Address): Promise<bigint>
}

/** Payer side of the rail (the agent's wallet). Never runs on behalf of a provider. */
export interface PayerWallet {
  readonly address: Address
  openAndSign(p: {
    pactId: string
    payee: Address
    operator: Address
    deposit: bigint
    amount: bigint
  }): Promise<OpenCredentialPayload>
}
