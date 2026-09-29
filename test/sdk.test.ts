import { verifyMessage, type Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { afterEach, describe, expect, it } from 'vitest'

import { digest } from '@pact/core'
import { createTempoContext, pactProvider, PactClient, PactClientError } from '@pact/tempo'
import { providerMessage } from '@pact/verifier'

import { LocalPayer } from '../apps/gateway/src/rails/local.js'
import { DEMO_AGENT_ID } from '../apps/gateway/src/runtime.js'
import { PUBLIC_URL, testRuntime, type TestRuntime } from './helpers.js'

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

type Filings = { company: string; filings: { period: string }[] }

describe('PactClient', () => {
  it('pays, proves and settles in one fetch() and returns a verifiable receipt', async () => {
    const rt = make()
    const res = await rt.agent.fetch<Filings>({
      service: 'sec-filings',
      input: { company: 'Microsoft', count: 3 },
      maxAmount: '0.50',
      timeoutMs: 15_000,
    })
    expect(res.verified).toBe(true)
    expect(res.state).toBe('SETTLED')
    expect(res.data?.company).toBe('Microsoft')
    expect(res.data?.filings).toHaveLength(3)
    expect(res.settlement).toMatchObject({ captured: '0.40', refunded: '0.10' })
    const check = await rt.agent.verifyReceipt(res.receipt!)
    expect(check.valid).toBe(true)
  })

  it('reports unverified work as not verified and refunded', async () => {
    const rt = make()
    const pact = await rt.agent.create({ service: 'sec-filings', input: { company: 'Tesla', count: 4 }, maxAmount: '0.50' })
    rt.provider.arm(pact.id, 'wrong')
    await rt.agent.authorize(pact.id, '0.50')
    const res = await rt.agent.wait(pact.id, { timeoutMs: 15_000 })
    expect(res.verified).toBe(false)
    expect(res.state).toBe('PROTECTED')
    expect(res.reasons).toContain('echo_fields')
    expect(res.settlement).toMatchObject({ captured: '0.00', refunded: '0.50' })
  })

  it('refuses to pay above its own budget before any funds move', async () => {
    const rt = make()
    const before = await rt.rail.balanceOf(rt.agent.address)
    const pact = await rt.agent.create({ service: 'sec-filings', input: { company: 'Apple', count: 2 }, maxAmount: '0.50' })
    await expect(rt.agent.authorize(pact.id, '0.10')).rejects.toMatchObject({ code: 'over_budget' })
    expect(await rt.rail.balanceOf(rt.agent.address)).toBe(before)
    expect(rt.repo.getPact(pact.id)!.state).toBe('CREATED')
  })

  it('refuses a challenge that names an operator the agent does not trust', async () => {
    const rt = make()
    const client = new PactClient({
      gateway: PUBLIC_URL,
      agentId: DEMO_AGENT_ID,
      wallet: new LocalPayer(rt.repo, ctx, rt.repo.getSetting('key:agent') as Hex),
      trustedOperator: privateKeyToAccount(generatePrivateKey()).address,
      fetch: rt.route,
    })
    const pact = await client.create({ service: 'sec-filings', input: { company: 'Apple', count: 2 }, maxAmount: '0.50' })
    const err = await client.authorize(pact.id, '0.50').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PactClientError)
    expect((err as PactClientError).code).toBe('untrusted_operator')
  })
})

describe('pactProvider', () => {
  const account = privateKeyToAccount(generatePrivateKey())
  const pactId = 'pact_0123456789abcdef0123'
  const requestDigest = digest({ serviceId: 'svc', request: { q: 1 } })
  const headers = { 'x-pact-id': pactId, 'x-pact-request-digest': requestDigest, 'content-type': 'application/json' }

  it('attests the exact body with a signature that recovers to the provider', async () => {
    const provider = pactProvider({ account })
    const res = await provider.respond({ pactId, requestDigest, deadline: null, callbackUrl: null }, { answer: 42 })
    const body = await res.text()
    expect(res.headers.get('x-pact-result-digest')).toBe(digest(body))
    const ok = await verifyMessage({
      address: account.address,
      message: providerMessage(pactId, requestDigest, digest(body)),
      signature: res.headers.get('x-pact-signature') as Hex,
    })
    expect(ok).toBe(true)
  })

  it('protect() rejects requests without pact headers', async () => {
    const provider = pactProvider({ account })
    const res = await provider.protect(() => ({}))(new Request('http://p/x', { method: 'POST', body: '{}' }))
    expect(res.status).toBe(400)
  })

  it('protect() refuses work for pacts the gateway does not report as funded', async () => {
    const provider = pactProvider({
      account,
      gateway: 'http://gw',
      fetch: async () => Response.json({ pact: { state: 'CREATED', requestDigest, service: { providerAddress: account.address } } }),
    })
    let ran = false
    const res = await provider.protect(() => {
      ran = true
      return {}
    })(new Request('http://p/x', { method: 'POST', headers, body: JSON.stringify({ request: { q: 1 } }) }))
    expect(res.status).toBe(402)
    expect(ran).toBe(false)
  })

  it('protect() runs and attests funded work', async () => {
    const provider = pactProvider({
      account,
      gateway: 'http://gw',
      fetch: async () => Response.json({ pact: { state: 'EXECUTING', requestDigest, service: { providerAddress: account.address } } }),
    })
    const res = await provider.protect<{ q: number }>((input) => ({ doubled: input.q * 2 }))(
      new Request('http://p/x', { method: 'POST', headers, body: JSON.stringify({ request: { q: 21 } }) }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ doubled: 42 })
    expect(res.headers.get('x-pact-signature')).toMatch(/^0x/)
  })
})
