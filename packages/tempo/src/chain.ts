/**
 * Thin adapter over the TIP-1034 escrow precompile using mppx's maintained
 * precompile helpers (the same code the mppx session server runs) and viem's
 * Tempo chain definition. PACT never re-implements channel IDs, voucher
 * EIP-712 domains or close encoding — it calls mppx for all of them.
 */
import { Session } from 'mppx/tempo'
import {
  createClient,
  encodeFunctionData,
  http,
  keccak256,
  publicActions,
  stringToHex,
  walletActions,
  type Account,
  type Address,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { tempoModerato } from 'viem/chains'
import { Actions } from 'viem/tempo'

const { Chain, Channel, Voucher, Constants } = Session.Precompile

export const ESCROW: Address = Constants.tip20ChannelEscrow as Address

export type ChannelDescriptor = Session.Precompile.Channel.ChannelDescriptor

export type TempoContext = {
  chainId: number
  explorerUrl: string
  token: Address
  client: ReturnType<typeof makeClient>
}

function makeClient(rpcUrl: string, token: Address) {
  return createClient({
    chain: tempoModerato.extend({ feeToken: token }),
    transport: http(rpcUrl, { retryCount: 3, timeout: 20_000 }),
  })
    .extend(publicActions)
    .extend(walletActions)
}

export function createTempoContext(rpcUrl: string, token: Address): TempoContext {
  return {
    chainId: tempoModerato.id,
    explorerUrl: tempoModerato.blockExplorers.default.url,
    token,
    client: makeClient(rpcUrl, token),
  }
}

export const accountFromKey = (key: Hex): Account => privateKeyToAccount(key)

/** Deterministic, pact-bound channel salt: the on-chain channel commits to exactly one pact. */
export const pactSalt = (pactId: string): Hex => keccak256(stringToHex(`pact:v1:${pactId}`))

export function txUrl(ctx: TempoContext, hash: Hex): string {
  return `${ctx.explorerUrl}/tx/${hash}`
}

export function addressUrl(ctx: TempoContext, address: Address): string {
  return `${ctx.explorerUrl}/address/${address}`
}

export async function fundFromFaucet(ctx: TempoContext, account: Address): Promise<readonly Hex[]> {
  return Actions.faucet.fund(ctx.client, { account })
}

export async function tokenBalance(ctx: TempoContext, owner: Address): Promise<bigint> {
  return ctx.client.readContract({
    address: ctx.token,
    abi: [
      {
        type: 'function',
        name: 'balanceOf',
        stateMutability: 'view',
        inputs: [{ name: 'owner', type: 'address' }],
        outputs: [{ name: '', type: 'uint256' }],
      },
    ] as const,
    functionName: 'balanceOf',
    args: [owner],
  })
}

export type OpenedChannel = {
  channelId: Hex
  descriptor: ChannelDescriptor
  deposit: bigint
  txHash: Hex
}

/** Payer side: lock `deposit` in a TIP-1034 channel whose payee is the provider and operator is PACT. */
export async function openChannel(
  ctx: TempoContext,
  payer: Account,
  params: { payee: Address; operator: Address; deposit: bigint; salt: Hex },
): Promise<OpenedChannel> {
  const data = encodeFunctionData({
    abi: Session.Precompile.escrowAbi,
    functionName: 'open',
    args: [params.payee, params.operator, ctx.token, params.deposit, params.salt, payer.address],
  })
  const txHash = await ctx.client.sendTransaction({
    account: payer,
    chain: ctx.client.chain,
    to: ESCROW,
    data,
  })
  const receipt = await Chain.waitForSuccessfulReceipt(ctx.client, txHash)
  const opened = findOpenedEvent(receipt)
  const descriptor: ChannelDescriptor = {
    payer: payer.address,
    payee: params.payee,
    operator: params.operator,
    token: ctx.token,
    salt: params.salt,
    authorizedSigner: payer.address,
    expiringNonceHash: opened.expiringNonceHash,
  }
  const derived = Channel.computeId({ ...descriptor, chainId: ctx.chainId, escrow: ESCROW })
  if (derived.toLowerCase() !== opened.channelId.toLowerCase())
    throw new Error('channel id mismatch between descriptor and ChannelOpened event')
  return { channelId: opened.channelId, descriptor, deposit: opened.deposit, txHash }
}

function findOpenedEvent(receipt: Parameters<typeof Chain.getChannelEvent>[0]) {
  const logs = receipt.logs.filter((l) => l.address.toLowerCase() === ESCROW.toLowerCase())
  for (const log of logs) {
    try {
      const channelId = log.topics[1] as Hex | undefined
      if (!channelId) continue
      const event = Chain.getChannelEvent(receipt, 'ChannelOpened', channelId)
      return Chain.readChannelOpenedReceiptFields(event)
    } catch {
      /* not the ChannelOpened log */
    }
  }
  throw new Error('ChannelOpened event missing from open receipt')
}

/** Payer side: sign a cumulative TIP-1034 voucher (authorization, not settlement). */
export async function signVoucher(
  ctx: TempoContext,
  signer: Account,
  channelId: Hex,
  cumulativeAmount: bigint,
): Promise<Hex> {
  return Voucher.signVoucher(ctx.client, signer, { channelId, cumulativeAmount }, ESCROW, ctx.chainId)
}

export function verifyVoucher(
  ctx: TempoContext,
  voucher: { channelId: Hex; cumulativeAmount: bigint; signature: Hex },
  expectedSigner: Address,
): boolean {
  return Voucher.verifyVoucher(ESCROW, ctx.chainId, voucher, expectedSigner)
}

export function computeChannelId(ctx: TempoContext, descriptor: ChannelDescriptor): Hex {
  return Channel.computeId({ ...descriptor, chainId: ctx.chainId, escrow: ESCROW })
}

export async function readChannel(ctx: TempoContext, descriptor: ChannelDescriptor) {
  return Chain.getChannel(ctx.client, descriptor, ESCROW)
}

export type ClosedChannel = {
  txHash: Hex
  settledToPayee: bigint
  refundedToPayer: bigint
}

/**
 * Operator side: close the channel capturing only `captureAmount` for the payee.
 * Everything else in escrow is refunded to the payer by the precompile.
 */
export async function closeChannel(
  ctx: TempoContext,
  operator: Account,
  params: {
    descriptor: ChannelDescriptor
    channelId: Hex
    cumulativeAmount: bigint
    captureAmount: bigint
    signature: Hex
  },
): Promise<ClosedChannel> {
  const txHash = await Chain.closeOnChain(
    ctx.client,
    params.descriptor,
    params.cumulativeAmount,
    params.captureAmount,
    params.signature,
    ESCROW,
    { account: operator, candidateFeeTokens: [ctx.token] },
  )
  const receipt = await Chain.waitForSuccessfulReceipt(ctx.client, txHash)
  const closed = Chain.readChannelClosedReceiptFields(
    Chain.getChannelEvent(receipt, 'ChannelClosed', params.channelId),
  )
  return { txHash, ...closed }
}
