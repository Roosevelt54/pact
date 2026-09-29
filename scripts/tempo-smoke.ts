/**
 * End-to-end proof on Tempo Moderato of the native PACT settlement primitive:
 *   agent opens TIP-1034 channel (payee = provider, operator = PACT)
 *   agent signs voucher for the price (authorization)
 *   PACT closes capturing 0 (verification failed)   → full refund to agent
 *   PACT closes capturing price (verification passed) → provider paid, rest refunded
 */
import type { Hex } from 'viem'

import { loadConfig } from '../apps/gateway/src/config.js'
import {
  accountFromKey,
  closeChannel,
  createTempoContext,
  openChannel,
  pactSalt,
  signVoucher,
  tokenBalance,
  txUrl,
  verifyVoucher,
} from '@pact/tempo'

try {
  process.loadEnvFile('.env')
} catch {
  /* no .env */
}

async function run(label: string, capture: 'none' | 'full') {
  const config = loadConfig({ ...process.env, PACT_RAIL: 'tempo' })
  const ctx = createTempoContext(config.TEMPO_RPC_URL, config.TEMPO_TOKEN as Hex)
  const operator = accountFromKey(config.PACT_OPERATOR_PRIVATE_KEY as Hex)
  const agent = accountFromKey(config.DEMO_AGENT_PRIVATE_KEY as Hex)
  const provider = accountFromKey(config.DEMO_PROVIDER_PRIVATE_KEY as Hex)

  const deposit = 500_000n // 0.50 pathUSD authorized
  const price = 400_000n // 0.40 pathUSD price
  const pactId = `smoke_${label}_${Date.now()}`

  const agentBefore = await tokenBalance(ctx, agent.address)
  const providerBefore = await tokenBalance(ctx, provider.address)

  const opened = await openChannel(ctx, agent, {
    payee: provider.address,
    operator: operator.address,
    deposit,
    salt: pactSalt(pactId),
  })
  console.log(`[${label}] open   ${txUrl(ctx, opened.txHash)}`)

  const signature = await signVoucher(ctx, agent, opened.channelId, price)
  const ok = verifyVoucher(ctx, { channelId: opened.channelId, cumulativeAmount: price, signature }, agent.address)
  console.log(`[${label}] voucher verified=${ok}`)

  const closed = await closeChannel(ctx, operator, {
    descriptor: opened.descriptor,
    channelId: opened.channelId,
    cumulativeAmount: price,
    captureAmount: capture === 'full' ? price : 0n,
    signature,
  })
  console.log(
    `[${label}] close  ${txUrl(ctx, closed.txHash)} settledToPayee=${closed.settledToPayee} refundedToPayer=${closed.refundedToPayer}`,
  )
  const agentAfter = await tokenBalance(ctx, agent.address)
  const providerAfter = await tokenBalance(ctx, provider.address)
  console.log(
    `[${label}] agent Δ=${Number(agentAfter - agentBefore) / 1e6}  provider Δ=${Number(providerAfter - providerBefore) / 1e6}`,
  )
}

await run('fail', 'none')
await run('pass', 'full')
