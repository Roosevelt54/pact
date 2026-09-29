import type { AddressInfo } from 'node:net'
import { serve, type ServerType } from '@hono/node-server'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createFxProvider, FX_POLICY, fxServiceRegistration } from '@pact/example-basic-api'

import { ADMIN_TOKEN, json, PUBLIC_URL, testRuntime, type TestRuntime } from './helpers.js'

let rt: TestRuntime
let server: ServerType
let endpoint: string
const account = privateKeyToAccount(generatePrivateKey())

beforeAll(async () => {
  rt = testRuntime()
  const { app } = createFxProvider({ account, gateway: PUBLIC_URL, fetch: rt.route })
  await new Promise<void>((resolve) => {
    server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, () => resolve())
  })
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/rates`
})
afterAll(async () => {
  await rt.engine.idle()
  server.close()
  rt.close()
})

const admin = (path: string, body: unknown, token: string | null = ADMIN_TOKEN) =>
  json(rt, path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { 'x-admin-token': token } : {}) },
    body: JSON.stringify(body),
  })

describe('protecting an external API', () => {
  it('requires the admin token to register policies and services', async () => {
    expect((await admin('/v1/admin/policies', FX_POLICY, null)).status).toBe(403)
    expect((await admin('/v1/admin/services', fxServiceRegistration(endpoint, account.address), 'wrong')).status).toBe(403)
  })

  it('validates registrations', async () => {
    const bad = await admin('/v1/admin/services', { ...fxServiceRegistration('ftp://x', account.address) })
    expect(bad.status).toBe(400)
  })

  it('registers a policy and service, then pays only for verified results', async () => {
    expect((await admin('/v1/admin/policies', FX_POLICY)).status).toBe(201)
    expect((await admin('/v1/admin/policies', FX_POLICY)).status).toBe(409)
    expect((await admin('/v1/admin/services', fxServiceRegistration(endpoint, account.address))).status).toBe(201)

    const ok = await rt.agent.fetch<{ rates: { symbol: string; rate: number }[] }>({
      service: 'fx-rates',
      input: { base: 'USD', symbols: ['EUR', 'NGN', 'GBP'] },
      maxAmount: '0.05',
      timeoutMs: 15_000,
    })
    expect(ok.verified).toBe(true)
    expect(ok.data?.rates.map((r) => r.symbol)).toEqual(['EUR', 'NGN', 'GBP'])
    expect(ok.settlement).toMatchObject({ captured: '0.02', refunded: '0.03' })

    const bad = await rt.agent.fetch({
      service: 'fx-rates',
      input: { base: 'USD', symbols: ['EUR', 'XXX'] },
      maxAmount: '0.05',
      timeoutMs: 15_000,
    })
    expect(bad.verified).toBe(false)
    expect(bad.reasons).toContain('http_ok')
    expect(bad.settlement).toMatchObject({ captured: '0.00', refunded: '0.05' })
  })
})
