import type { Hono } from 'hono'
import type { Address, Hex } from 'viem'
import { generatePrivateKey } from 'viem/accounts'

import { parseAmount } from '@pact/core'
import { DemoProvider } from '@pact/demo-provider'
import {
  accountFromKey,
  createTempoContext,
  PactClient,
  TempoPayer,
  TempoRail,
  type PayerWallet,
  type SettlementRail,
} from '@pact/tempo'

import { createApp } from './api/app.js'
import { POLICIES, SERVICES, type ProviderKey } from './catalog.js'
import type { Config } from './config.js'
import { openDatabase } from './db/index.js'
import { Repo } from './db/repo.js'
import { PactEngine } from './engine/pactEngine.js'
import { EventBus } from './events.js'
import { LocalPayer, LocalRail, seedLedger } from './rails/local.js'

export const DEMO_AGENT_ID = 'agt_researchbot'

type Keys = { operator: Hex; agent: Hex; northwind: Hex; atlas: Hex; forger: Hex }

/** Env keys win; otherwise keys are generated once and persisted (local rail / non-funded roles only). */
function resolveKeys(config: Config, repo: Repo): Keys {
  const persisted = (name: string, env?: string) => {
    if (env) return env as Hex
    const existing = repo.getSetting(`key:${name}`)
    if (existing) return existing as Hex
    const key = generatePrivateKey()
    repo.setSetting(`key:${name}`, key)
    return key
  }
  return {
    operator: persisted('operator', config.PACT_OPERATOR_PRIVATE_KEY),
    agent: persisted('agent', config.DEMO_AGENT_PRIVATE_KEY),
    northwind: persisted('northwind', config.DEMO_PROVIDER_PRIVATE_KEY),
    atlas: persisted('atlas', config.DEMO_PROVIDER_B_PRIVATE_KEY),
    forger: persisted('forger'),
  }
}

/**
 * Routes calls to this server's own public URL through the Hono app in-process
 * (still real Request/Response objects), with fetch-compatible abort semantics.
 */
function makeRouter(publicUrl: string, getApp: () => Hono) {
  const base = publicUrl.replace(/\/$/, '')
  return async (url: string, init: RequestInit = {}): Promise<Response> => {
    if (!url.startsWith(base)) return fetch(url, init)
    const signal = init.signal
    if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError')
    const pending = Promise.resolve(getApp().request(url.slice(base.length) || '/', init))
    if (!signal) return pending
    return new Promise<Response>((resolve, reject) => {
      const onAbort = () => reject(new DOMException('The operation was aborted.', 'AbortError'))
      signal.addEventListener('abort', onAbort, { once: true })
      pending.then(
        (r) => {
          signal.removeEventListener('abort', onAbort)
          resolve(r)
        },
        (e: unknown) => {
          signal.removeEventListener('abort', onAbort)
          reject(e)
        },
      )
    })
  }
}

export type Runtime = ReturnType<typeof createRuntime>

export function createRuntime(
  config: Config,
  overrides: {
    provider?: { delayedMs?: number; timeoutMs?: number; reportDelayMs?: number }
    settleRetryDelaysMs?: number[]
    rail?: (repo: Repo, operatorAddress: Address) => SettlementRail
  } = {},
) {
  const db = openDatabase(config.PACT_DB_PATH)
  const repo = new Repo(db)
  const keys = resolveKeys(config, repo)
  const tempo = createTempoContext(config.TEMPO_RPC_URL, config.TEMPO_TOKEN as Address)
  const operator = accountFromKey(keys.operator)

  let rail: SettlementRail
  let payer: PayerWallet
  if (config.PACT_RAIL === 'tempo') {
    rail = new TempoRail(tempo, keys.operator)
    payer = new TempoPayer(tempo, keys.agent)
  } else {
    rail = overrides.rail?.(repo, operator.address) ?? new LocalRail(repo, tempo, operator.address)
    payer = new LocalPayer(repo, tempo, keys.agent)
    seedLedger(repo, payer.address, parseAmount('100'))
  }

  const providerAccounts: Record<ProviderKey, ReturnType<typeof accountFromKey>> = {
    northwind: accountFromKey(keys.northwind),
    atlas: accountFromKey(keys.atlas),
  }
  const publicUrl = config.PACT_PUBLIC_URL.replace(/\/$/, '')

  for (const p of POLICIES) repo.upsertPolicy(p)
  for (const s of SERVICES)
    repo.upsertService({
      id: s.id,
      name: s.name,
      description: s.description,
      provider_name: s.providerName,
      provider_address: providerAccounts[s.provider].address,
      endpoint: `${publicUrl}${s.path}`,
      mode: s.mode,
      price: parseAmount(s.price).toString(),
      policy_id: s.policyId,
      policy_version: POLICIES.find((p) => p.id === s.policyId)!.version,
      capability: s.capability,
      input_schema: JSON.stringify(s.inputSchema),
    })
  repo.upsertAgent({ id: DEMO_AGENT_ID, name: 'ResearchBot', address: payer.address, budget: parseAmount('25').toString() })

  let app: Hono | null = null
  const route = makeRouter(publicUrl, () => app!)
  const bus = new EventBus(repo)
  const engine = new PactEngine({
    repo,
    rail,
    bus,
    signer: operator,
    secretKey: config.MPP_SECRET_KEY,
    realm: new URL(publicUrl).host,
    publicUrl,
    fetchProvider: route,
    ...(overrides.settleRetryDelaysMs ? { settleRetryDelaysMs: overrides.settleRetryDelaysMs } : {}),
  })
  const provider = new DemoProvider({
    accounts: providerAccounts,
    forger: accountFromKey(keys.forger),
    callbackFetch: route,
    ...overrides.provider,
  })
  const agent = new PactClient({
    gateway: publicUrl,
    agentId: DEMO_AGENT_ID,
    wallet: payer,
    trustedOperator: operator.address,
    fetch: route,
  })
  app = createApp({ config, repo, engine, rail, bus, provider, agent, signer: operator })

  return {
    app,
    engine,
    provider,
    agent,
    repo,
    rail,
    bus,
    route,
    close() {
      engine.stop()
      db.close()
    },
  }
}
