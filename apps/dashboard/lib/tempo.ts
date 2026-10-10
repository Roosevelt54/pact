/**
 * Browser-side Tempo: the network a visitor's wallet must be on, and payers that open PACT escrows
 * from a wallet extension (MetaMask & co.) or from an agent key held in this browser.
 *
 * Generic wallets know nothing about Tempo's own transaction type, so everything here is a plain
 * EIP-1559 transaction and an EIP-712 voucher — both verified to work on Moderato.
 */
import { Session } from 'mppx/tempo'
import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  encodeFunctionData,
  erc20Abi,
  http,
  type Account,
  type Address,
  type EIP1193Provider,
  type Hex,
} from 'viem'

import { ESCROW, pactSalt, type PayerWallet } from '@pact/tempo'

export const TEMPO_RPC = 'https://rpc.moderato.tempo.xyz'
export const TEMPO_EXPLORER = 'https://explore.testnet.tempo.xyz'
export const PATH_USD: Address = '0x20c0000000000000000000000000000000000000'

export const tempoChain = defineChain({
  id: 42431,
  name: 'Tempo Moderato',
  nativeCurrency: { name: 'USD', symbol: 'USD', decimals: 18 },
  rpcUrls: { default: { http: [TEMPO_RPC] } },
  blockExplorers: { default: { name: 'Tempo Explorer', url: TEMPO_EXPLORER } },
  testnet: true,
})

/** What wallet_addEthereumChain needs to teach a wallet about Moderato. */
export const ADD_CHAIN_PARAMS = {
  chainId: `0x${tempoChain.id.toString(16)}`,
  chainName: 'Tempo Moderato (testnet)',
  nativeCurrency: tempoChain.nativeCurrency,
  rpcUrls: [TEMPO_RPC],
  blockExplorerUrls: [TEMPO_EXPLORER],
}

export const publicClient = createPublicClient({ chain: tempoChain, transport: http(TEMPO_RPC) })

export const agentIdOf = (address: string) => `agt_${address.toLowerCase()}`
export const txUrl = (hash: string) => `${TEMPO_EXPLORER}/tx/${hash}`

const { Chain, Channel } = Session.Precompile
const DOMAIN = { name: 'TIP20 Channel Reserve', version: '1', chainId: tempoChain.id, verifyingContract: ESCROW } as const
const VOUCHER_TYPES = {
  Voucher: [
    { name: 'channelId', type: 'bytes32' },
    { name: 'cumulativeAmount', type: 'uint96' },
  ],
} as const

export type PayStep = 'escrow' | 'confirming' | 'voucher' | 'submitted'

/** A signer: either the visitor's wallet extension or an agent key that lives in this browser. */
export type Signer = { kind: 'extension'; address: Address; provider: EIP1193Provider } | { kind: 'key'; account: Account }

function walletClientFor(signer: Signer) {
  return signer.kind === 'extension'
    ? createWalletClient({ account: signer.address, chain: tempoChain, transport: custom(signer.provider) })
    : createWalletClient({ account: signer.account, chain: tempoChain, transport: http(TEMPO_RPC) })
}

export const signerAddress = (signer: Signer): Address => (signer.kind === 'extension' ? signer.address : signer.account.address)

/** PACT's payer interface backed by a browser signer: escrow deposit (a transaction), then the voucher (a signature). */
export function browserPayer(signer: Signer, onStep?: (step: PayStep) => void): PayerWallet {
  const wallet = walletClientFor(signer)
  const address = signerAddress(signer)
  return {
    address,
    async openAndSign(p) {
      const salt = pactSalt(p.pactId)
      onStep?.('escrow')
      const txHash = await wallet.sendTransaction({
        to: ESCROW,
        data: encodeFunctionData({
          abi: Session.Precompile.escrowAbi,
          functionName: 'open',
          args: [p.payee, p.operator, PATH_USD, p.deposit, salt, address],
        }),
      })
      onStep?.('confirming')
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 90_000 })
      if (receipt.status !== 'success') throw new Error('the escrow deposit was reverted on Tempo')
      const log = receipt.logs.find((l) => l.address.toLowerCase() === ESCROW.toLowerCase())
      if (!log?.topics[1]) throw new Error('escrow deposit receipt has no ChannelOpened event')
      const opened = Chain.readChannelOpenedReceiptFields(Chain.getChannelEvent(receipt as never, 'ChannelOpened', log.topics[1] as Hex))
      const descriptor = {
        payer: address,
        payee: p.payee,
        operator: p.operator,
        token: PATH_USD,
        salt,
        authorizedSigner: address,
        expiringNonceHash: opened.expiringNonceHash,
      }
      const channelId = Channel.computeId({ ...descriptor, chainId: tempoChain.id, escrow: ESCROW })
      onStep?.('voucher')
      const signature = await wallet.signTypedData({
        domain: DOMAIN,
        types: VOUCHER_TYPES,
        primaryType: 'Voucher',
        message: { channelId, cumulativeAmount: p.amount },
      })
      onStep?.('submitted')
      return {
        action: 'open',
        type: 'hash',
        channelId,
        descriptor,
        txHash,
        voucher: { cumulativeAmount: p.amount.toString(), signature },
      }
    },
  }
}

/** Moves pathUSD between addresses (owner → agent to fund it, agent → owner to withdraw). */
export async function transferPathUsd(signer: Signer, to: Address, amount: bigint) {
  const hash = await walletClientFor(signer).sendTransaction({
    to: PATH_USD,
    data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [to, amount] }),
  })
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 })
  if (receipt.status !== 'success') throw new Error('transfer reverted on Tempo')
  return hash
}

/** Readable reason for the errors wallets throw ("User rejected the request." etc.). */
export function walletError(error: unknown): string {
  const e = error as { shortMessage?: string; message?: string; code?: number }
  if (e?.code === 4001 || /rejected|denied/i.test(e?.shortMessage ?? e?.message ?? '')) return 'You cancelled the request in your wallet.'
  return (e?.shortMessage ?? e?.message ?? String(error)).split('\n')[0]!
}
