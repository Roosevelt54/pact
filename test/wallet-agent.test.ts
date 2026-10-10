import type { Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { afterEach, describe, expect, it } from 'vitest'

import { parseAmount } from '@pact/core'
import { createTempoContext, PactClient } from '@pact/tempo'

import { LocalPayer, seedLedger } from '../apps/gateway/src/rails/local.js'
import { json, PUBLIC_URL, testRuntime, type TestRuntime } from './helpers.js'

/**
 * Wallet agents: anyone with a wallet can be an agent without an account. The agent id is derived from
 * the wallet address (`agt_0x…`), it is registered on first use, and only that wallet can fund its escrow.
 */

const runtimes: TestRuntime[] = []
afterEach(async () => {
  for (const rt of runtimes.splice(0)) {
    await rt.engine.idle()
    await rt.provider.idle()
    rt.close()
  }
})
const make = () => {
  const rt = testRuntime()
  runtimes.push(rt)
  return rt
}
const ctx = createTempoContext('http://127.0.0.1:1', '0x20c0000000000000000000000000000000000000')

function walletAgent(rt: TestRuntime, key: Hex = generatePrivateKey(), opts: { payWith?: Hex } = {}) {
  const address = privateKeyToAccount(key).address
  const payKey = opts.payWith ?? key
  seedLedger(rt.repo, privateKeyToAccount(payKey).address, parseAmount('10'))
  const agentId = `agt_${address.toLowerCase()}`
  const client = new PactClient({
    gateway: PUBLIC_URL,
    agentId,
    wallet: new LocalPayer(rt.repo, ctx, payKey),
    trustedOperator: rt.rail.info.operator,
    fetch: rt.route,
  })
  return { agentId, address, client }
}

describe('wallet agents', () => {
  it('registers a wallet agent on first use and settles a pact it pays for', async () => {
    const rt = make()
    const { agentId, address, client } = walletAgent(rt)
    expect(rt.repo.getAgent(agentId)).toBeFalsy()

    const res = await client.fetch({ service: 'sec-filings', input: { company: 'Microsoft', count: 2 }, maxAmount: '0.50', timeoutMs: 15_000 })

    expect(res.state).toBe('SETTLED')
    expect(res.verified).toBe(true)
    expect(rt.repo.getAgent(agentId)?.address.toLowerCase()).toBe(address.toLowerCase())
  })

  it('rejects an escrow funded by any wallet other than the one in the agent id', async () => {
    const rt = make()
    const { client } = walletAgent(rt, generatePrivateKey(), { payWith: generatePrivateKey() })
    const pact = await client.create({ service: 'sec-filings', input: { company: 'Apple', count: 2 }, maxAmount: '0.50' })
    await expect(client.authorize(pact.id, '0.50')).rejects.toMatchObject({ code: 'wrong_payer' })
    expect(rt.repo.getPact(pact.id)!.state).toBe('CREATED')
  })

  it('refuses agent ids that are not a well-formed wallet address', async () => {
    const rt = make()
    for (const agentId of ['agt_0x123', `agt_0x${'g'.repeat(40)}`, 'agt_unknown']) {
      const res = await json(rt, '/v1/pacts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agentId, serviceId: 'sec-filings', request: { company: 'Apple', count: 2 } }),
      })
      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('unknown_agent')
    }
  })

  it('lists only the pacts of one agent when asked', async () => {
    const rt = make()
    const a = walletAgent(rt)
    const b = walletAgent(rt)
    await a.client.create({ service: 'sec-filings', input: { company: 'Apple', count: 2 }, maxAmount: '0.50' })
    await b.client.create({ service: 'sec-filings', input: { company: 'Tesla', count: 2 }, maxAmount: '0.50' })

    const res = await json<{ pacts: { agentId: string }[] }>(rt, `/v1/pacts?agent=${a.agentId}`)
    expect(res.body.pacts).toHaveLength(1)
    expect(res.body.pacts[0]!.agentId).toBe(a.agentId)
  })

  it('funds a wallet from the testnet faucet, once per window', async () => {
    const rt = make()
    const address = privateKeyToAccount(generatePrivateKey()).address
    const post = () =>
      json(rt, '/v1/faucet', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address }) })

    const first = await post()
    expect(first.status).toBe(200)
    expect(await rt.rail.balanceOf(address)).toBe(parseAmount('100'))

    const second = await post()
    expect(second.status).toBe(429)
    expect(await rt.rail.balanceOf(address)).toBe(parseAmount('100'))
  })

  it('rejects a faucet request for something that is not an address', async () => {
    const rt = make()
    const res = await json(rt, '/v1/faucet', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: 'nope' }) })
    expect(res.status).toBe(400)
  })

  it('runs the Chaos Lab for a wallet: the gateway arms the scenario, the wallet pays', async () => {
    const rt = make()
    const { agentId, client } = walletAgent(rt)
    const run = await json<{ pactId: string; state: string; maxAmount: string }>(rt, '/v1/lab/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scenario: 'incomplete', serviceId: 'sec-filings', company: 'Apple', count: 4, agentId }),
    })
    expect(run.status).toBe(202)
    expect(run.body.state).toBe('CREATED')
    expect(rt.repo.getPact(run.body.pactId)!.agent_id).toBe(agentId)

    await client.authorize(run.body.pactId, run.body.maxAmount)
    const res = await client.wait(run.body.pactId, { timeoutMs: 15_000 })
    expect(res.state).toBe('PROTECTED')
    expect(res.verified).toBe(false)
  })

  it('refuses Chaos Lab runs on behalf of a registered non-wallet agent', async () => {
    const rt = make()
    const run = await json(rt, '/v1/lab/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scenario: 'normal', serviceId: 'sec-filings', company: 'Apple', count: 2, agentId: 'agt_researchbot' }),
    })
    expect(run.status).toBe(400)
  })

  it('reports a wallet agent and its balance', async () => {
    const rt = make()
    const { agentId, address } = walletAgent(rt)
    const res = await json(rt, `/v1/agents/${agentId}`)
    expect(res.status).toBe(200)
    expect(res.body.agent.address.toLowerCase()).toBe(address.toLowerCase())
    expect(res.body.agent.balance).toBe('10.00')
  })
})
