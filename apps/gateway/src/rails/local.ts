/**
 * In-process ledger rail. Same authority model as the Tempo rail — escrowed
 * deposit, EIP-712 voucher (signed and verified with mppx), operator close that
 * captures ≤ voucher and refunds the rest — but balances live in SQLite and
 * nothing is broadcast. Used for tests and offline demos; the UI labels it.
 */
import { randomBytes } from 'node:crypto'
import { isAddressEqual, type Account, type Address, type Hex } from 'viem'

import { transaction } from '../db/index.js'
import type { Repo } from '../db/repo.js'
import {
  accountFromKey,
  computeChannelId,
  pactSalt,
  signVoucher,
  verifyVoucher,
  type ChannelDescriptor,
  type TempoContext,
} from '@pact/tempo'
import { RailError, type CloseResult, type PayerWallet, type SettlementRail } from '@pact/tempo'

type ChannelRow = { channel_id: string; descriptor: string; deposit: string; settled: string; closed: number }

function balance(repo: Repo, address: Address): bigint {
  const row = repo.db.prepare('SELECT balance FROM local_ledger WHERE address = ?').get(address.toLowerCase()) as
    | { balance: string }
    | undefined
  return BigInt(row?.balance ?? '0')
}

function credit(repo: Repo, address: Address, amount: bigint) {
  const next = balance(repo, address) + amount
  if (next < 0n) throw new RailError('insufficient_funds', `${address} has insufficient ledger balance`)
  repo.db
    .prepare(
      'INSERT INTO local_ledger (address, balance) VALUES (?, ?) ON CONFLICT(address) DO UPDATE SET balance = excluded.balance',
    )
    .run(address.toLowerCase(), next.toString())
}

export function seedLedger(repo: Repo, address: Address, amount: bigint) {
  if (repo.db.prepare('SELECT 1 FROM local_ledger WHERE address = ?').get(address.toLowerCase())) return
  credit(repo, address, amount)
}

const closeRef = (channelId: string) => `ledger:close:${channelId.slice(2, 18)}`

export class LocalRail implements SettlementRail {
  readonly info

  constructor(
    private readonly repo: Repo,
    private readonly ctx: TempoContext,
    operator: Address,
  ) {
    this.info = {
      kind: 'local' as const,
      label: 'Local ledger · no chain',
      chainId: null,
      network: 'Local ledger (simulated settlement)',
      token: ctx.token,
      tokenSymbol: 'pathUSD',
      escrow: null,
      operator,
      explorerUrl: null,
    }
  }

  private channel(channelId: string) {
    return (this.repo.db.prepare('SELECT * FROM local_channels WHERE channel_id = ?').get(channelId.toLowerCase()) ??
      null) as ChannelRow | null
  }

  async verifyChannel(p: Parameters<SettlementRail['verifyChannel']>[0]) {
    const d = p.descriptor
    if (computeChannelId(this.ctx, d).toLowerCase() !== p.channelId.toLowerCase())
      throw new RailError('channel_id_mismatch', 'channelId is not derived from the supplied descriptor')
    if (!isAddressEqual(d.payee, p.expectedPayee)) throw new RailError('wrong_payee', 'channel payee is not the service provider')
    if (!isAddressEqual(d.operator, this.info.operator))
      throw new RailError('wrong_operator', 'channel operator is not this PACT gateway')
    if (!isAddressEqual(d.token, this.ctx.token)) throw new RailError('wrong_token', 'channel token is not pathUSD')
    const row = this.channel(p.channelId)
    if (!row || row.closed) throw new RailError('channel_not_found', 'channel is not open on the ledger')
    if (BigInt(row.settled) !== 0n) throw new RailError('channel_used', 'channel already has settled value')
    const deposit = BigInt(row.deposit)
    if (deposit < p.minDeposit) throw new RailError('insufficient_deposit', `deposit ${deposit} is below required ${p.minDeposit}`)
    return { deposit, payer: d.payer }
  }

  verifyVoucher(p: Parameters<SettlementRail['verifyVoucher']>[0]) {
    return verifyVoucher(this.ctx, { channelId: p.channelId, cumulativeAmount: p.amount, signature: p.signature }, p.signer)
  }

  async close(p: Parameters<SettlementRail['close']>[0]): Promise<CloseResult> {
    return transaction(this.repo.db, () => {
      const row = this.channel(p.channelId)
      if (!row) throw new RailError('channel_not_found', 'channel is not on the ledger')
      if (row.closed) throw new RailError('channel_closed', 'channel already closed')
      const deposit = BigInt(row.deposit)
      if (p.captureAmount > p.voucherAmount) throw new RailError('capture_exceeds_voucher', 'capture exceeds voucher')
      if (p.captureAmount > deposit) throw new RailError('capture_exceeds_deposit', 'capture exceeds deposit')
      const descriptor = JSON.parse(row.descriptor) as ChannelDescriptor
      const refund = deposit - p.captureAmount
      credit(this.repo, descriptor.payee, p.captureAmount)
      credit(this.repo, descriptor.payer, refund)
      this.repo.db
        .prepare('UPDATE local_channels SET closed = 1, settled = ? WHERE channel_id = ?')
        .run(p.captureAmount.toString(), row.channel_id)
      return { txHash: closeRef(p.channelId), settledToPayee: p.captureAmount, refundedToPayer: refund }
    })
  }

  async findClose(p: { channelId: Hex }): Promise<CloseResult | null> {
    const row = this.channel(p.channelId)
    if (!row?.closed) return null
    const settled = BigInt(row.settled)
    return { txHash: closeRef(p.channelId), settledToPayee: settled, refundedToPayer: BigInt(row.deposit) - settled }
  }

  txUrl() {
    return null
  }

  async balanceOf(address: Address) {
    return balance(this.repo, address)
  }
}

export class LocalPayer implements PayerWallet {
  private readonly account: Account
  constructor(
    private readonly repo: Repo,
    private readonly ctx: TempoContext,
    key: Hex,
  ) {
    this.account = accountFromKey(key)
  }
  get address() {
    return this.account.address
  }

  async openAndSign(p: Parameters<PayerWallet['openAndSign']>[0]) {
    const descriptor: ChannelDescriptor = {
      payer: this.account.address,
      payee: p.payee,
      operator: p.operator,
      token: this.ctx.token,
      salt: pactSalt(p.pactId),
      authorizedSigner: this.account.address,
      expiringNonceHash: `0x${randomBytes(32).toString('hex')}`,
    }
    const channelId = computeChannelId(this.ctx, descriptor)
    transaction(this.repo.db, () => {
      credit(this.repo, this.account.address, -p.deposit)
      this.repo.db
        .prepare('INSERT INTO local_channels (channel_id, descriptor, deposit, created_at) VALUES (?, ?, ?, ?)')
        .run(channelId.toLowerCase(), JSON.stringify(descriptor), p.deposit.toString(), Date.now())
    })
    const signature = await signVoucher(this.ctx, this.account, channelId, p.amount)
    return {
      action: 'open' as const,
      type: 'hash' as const,
      channelId,
      descriptor,
      txHash: null,
      voucher: { cumulativeAmount: p.amount.toString(), signature },
    }
  }
}
