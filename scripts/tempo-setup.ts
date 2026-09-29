/**
 * Generates Moderato testnet keys for the PACT operator, demo agent and demo
 * providers (only when absent), writes them to .env (gitignored), and funds
 * each address from the Tempo testnet faucet. Prints addresses, never keys.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import type { Hex } from 'viem'

import { loadConfig } from '../apps/gateway/src/config.js'
import { createTempoContext, fundFromFaucet, tokenBalance } from '@pact/tempo'

const ENV_PATH = '.env'
const KEYS = [
  'PACT_OPERATOR_PRIVATE_KEY',
  'DEMO_AGENT_PRIVATE_KEY',
  'DEMO_PROVIDER_PRIVATE_KEY',
  'DEMO_PROVIDER_B_PRIVATE_KEY',
] as const

function readEnvFile(): Map<string, string> {
  const map = new Map<string, string>()
  if (!existsSync(ENV_PATH)) return map
  for (const line of readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (m) map.set(m[1]!, m[2]!)
  }
  return map
}

async function main() {
  const env = readEnvFile()
  let changed = false
  for (const key of KEYS) {
    if (!env.get(key)) {
      env.set(key, generatePrivateKey())
      changed = true
    }
  }
  if (!env.get('PACT_RAIL')) env.set('PACT_RAIL', 'tempo')
  if (!env.get('MPP_SECRET_KEY'))
    env.set('MPP_SECRET_KEY', Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'))
  if (!env.get('PACT_ADMIN_TOKEN'))
    env.set('PACT_ADMIN_TOKEN', Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('hex'))

  const body = [...env.entries()].map(([k, v]) => `${k}=${v}`).join('\n') + '\n'
  writeFileSync(ENV_PATH, body, { mode: 0o600 })
  console.log(changed ? 'Wrote new testnet keys to .env' : 'Using existing keys from .env')

  const config = loadConfig({ ...process.env, ...Object.fromEntries(env) })
  const ctx = createTempoContext(config.TEMPO_RPC_URL, config.TEMPO_TOKEN as Hex)

  for (const key of KEYS) {
    const address = privateKeyToAccount(env.get(key) as Hex).address
    const before = await tokenBalance(ctx, address)
    if (before < 1_000_000n) {
      process.stdout.write(`funding ${key.replace('_PRIVATE_KEY', '')} ${address} … `)
      try {
        const hashes = await fundFromFaucet(ctx, address)
        await Promise.all(hashes.map((hash) => ctx.client.waitForTransactionReceipt({ hash })))
        console.log('ok')
      } catch (error) {
        console.log(`faucet failed: ${(error as Error).message.split('\n')[0]}`)
      }
    }
    const after = await tokenBalance(ctx, address)
    console.log(`${key.replace('_PRIVATE_KEY', '').padEnd(18)} ${address}  ${Number(after) / 1e6} pathUSD`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
