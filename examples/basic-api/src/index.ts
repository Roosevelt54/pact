/**
 * Run a PACT-protected API and register it with a gateway.
 *
 *   PACT_GATEWAY_URL=http://localhost:8787 PACT_ADMIN_TOKEN=... npm start -w @pact/example-basic-api
 */
import { serve } from '@hono/node-server'
import type { Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

import { createFxProvider, FX_POLICY, fxServiceRegistration } from './fxProvider.js'

const gateway = process.env.PACT_GATEWAY_URL ?? 'http://localhost:8787'
const port = Number(process.env.PORT ?? 8790)
const publicUrl = process.env.FX_PUBLIC_URL ?? `http://localhost:${port}`
const account = privateKeyToAccount((process.env.FX_PROVIDER_PRIVATE_KEY as Hex | undefined) ?? generatePrivateKey())

const { app } = createFxProvider({ account, gateway })
serve({ fetch: app.fetch, port }, () => console.log(`FX provider on ${publicUrl} as ${account.address}`))

const admin = process.env.PACT_ADMIN_TOKEN
if (admin) {
  const post = (path: string, body: unknown) =>
    fetch(`${gateway}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-token': admin },
      body: JSON.stringify(body),
    })
  const p = await post('/v1/admin/policies', FX_POLICY)
  console.log(`policy ${FX_POLICY.id}@${FX_POLICY.version}: ${p.status === 409 ? 'already published' : p.status}`)
  const s = await post('/v1/admin/services', fxServiceRegistration(`${publicUrl}/rates`, account.address))
  console.log(`service fx-rates: ${s.status}`)
} else {
  console.log('PACT_ADMIN_TOKEN not set: register the service with the gateway manually (see README).')
}
