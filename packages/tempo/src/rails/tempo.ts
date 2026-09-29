import { Session } from 'mppx/tempo'
import { getAbiItem, isAddressEqual, type Account, type Address, type Hex } from 'viem'

import {
  accountFromKey,
  closeChannel,
  computeChannelId,
  createTempoContext,
  ESCROW,
  openChannel,
  pactSalt,
  readChannel,
  signVoucher,
  tokenBalance,
  txUrl,
  verifyVoucher,
  type TempoContext,
} from '../chain.js'
import { RailError, type CloseResult, type PayerWallet, type SettlementRail } from './types.js'

const channelClosedEvent = getAbiItem({ abi: Session.Precompile.escrowAbi, name: 'ChannelClosed' })

export class TempoRail implements SettlementRail {
  readonly info
  private readonly operator: Account

  constructor(
    readonly ctx: TempoContext,
    operatorKey: Hex,
  ) {
    this.operator = accountFromKey(operatorKey)
    this.info = {
      kind: 'tempo' as const,
      label: 'Tempo Moderato · TIP-1034 escrow',
      chainId: ctx.chainId,
      network: 'Tempo Testnet (Moderato)',
      token: ctx.token,
      tokenSymbol: 'pathUSD',
      escrow: ESCROW,
      operator: this.operator.address,
      explorerUrl: ctx.explorerUrl,
    }
  }

  static fromConfig(rpcUrl: string, token: Address, operatorKey: Hex) {
    return new TempoRail(createTempoContext(rpcUrl, token), operatorKey)
  }

  async verifyChannel(p: Parameters<SettlementRail['verifyChannel']>[0]) {
    const d = p.descriptor
    if (computeChannelId(this.ctx, d).toLowerCase() !== p.channelId.toLowerCase())
      throw new RailError('channel_id_mismatch', 'channelId is not derived from the supplied descriptor')
    if (!isAddressEqual(d.payee, p.expectedPayee))
      throw new RailError('wrong_payee', 'channel payee is not the service provider')
    if (!isAddressEqual(d.operator, this.operator.address))
      throw new RailError('wrong_operator', 'channel operator is not this PACT gateway')
    if (!isAddressEqual(d.token, this.ctx.token)) throw new RailError('wrong_token', 'channel token is not pathUSD')
    let onChain
    try {
      onChain = await readChannel(this.ctx, d)
    } catch (error) {
      throw new RailError('chain_unavailable', `could not read channel: ${(error as Error).message.split('\n')[0]}`, true)
    }
    const { state } = onChain
    if (state.deposit === 0n)
      throw new RailError('channel_not_found', 'channel has no deposit on-chain (not opened or already closed)')
    if (state.closeRequestedAt !== 0) throw new RailError('channel_closing', 'payer has requested close on this channel')
    if (state.settled !== 0n) throw new RailError('channel_used', 'channel already has settled value')
    if (state.deposit < p.minDeposit)
      throw new RailError('insufficient_deposit', `deposit ${state.deposit} is below required ${p.minDeposit}`)
    return { deposit: state.deposit, payer: d.payer }
  }

  verifyVoucher(p: Parameters<SettlementRail['verifyVoucher']>[0]) {
    return verifyVoucher(this.ctx, { channelId: p.channelId, cumulativeAmount: p.amount, signature: p.signature }, p.signer)
  }

  async close(p: Parameters<SettlementRail['close']>[0]): Promise<CloseResult> {
    try {
      return await closeChannel(this.ctx, this.operator, {
        descriptor: p.descriptor,
        channelId: p.channelId,
        cumulativeAmount: p.voucherAmount,
        captureAmount: p.captureAmount,
        signature: p.signature,
      })
    } catch (error) {
      throw new RailError('close_failed', (error as Error).message.split('\n')[0] ?? 'close failed', true)
    }
  }

  async findClose(p: { channelId: Hex; openTxHash: string | null }): Promise<CloseResult | null> {
    let fromBlock: bigint | 'earliest' = 'earliest'
    if (p.openTxHash) {
      const receipt = await this.ctx.client.getTransactionReceipt({ hash: p.openTxHash as Hex }).catch(() => null)
      if (receipt) fromBlock = receipt.blockNumber
    }
    const logs = await this.ctx.client.getLogs({
      address: ESCROW,
      event: channelClosedEvent,
      args: { channelId: p.channelId },
      fromBlock,
      toBlock: 'latest',
    })
    const log = logs[0]
    if (!log) return null
    return {
      txHash: log.transactionHash,
      settledToPayee: log.args.settledToPayee ?? 0n,
      refundedToPayer: log.args.refundedToPayer ?? 0n,
    }
  }

  txUrl(hash: string | null) {
    return hash ? txUrl(this.ctx, hash as Hex) : null
  }

  balanceOf(address: Address) {
    return tokenBalance(this.ctx, address)
  }
}

export class TempoPayer implements PayerWallet {
  private readonly account: Account
  constructor(
    private readonly ctx: TempoContext,
    key: Hex,
  ) {
    this.account = accountFromKey(key)
  }
  get address() {
    return this.account.address
  }

  async openAndSign(p: Parameters<PayerWallet['openAndSign']>[0]) {
    const opened = await openChannel(this.ctx, this.account, {
      payee: p.payee,
      operator: p.operator,
      deposit: p.deposit,
      salt: pactSalt(p.pactId),
    })
    const signature = await signVoucher(this.ctx, this.account, opened.channelId, p.amount)
    return {
      action: 'open' as const,
      type: 'hash' as const,
      channelId: opened.channelId,
      descriptor: opened.descriptor,
      txHash: opened.txHash,
      voucher: { cumulativeAmount: p.amount.toString(), signature },
    }
  }
}
