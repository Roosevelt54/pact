/**
 * pactProvider — the provider side of PACT.
 *
 * The gateway dispatches paid work with `x-pact-*` headers. A provider answers
 * with its result plus an EIP-191 attestation over (pact, request, result
 * digest). That signature is what lets the verifier prove *this* provider
 * delivered *this* result for *this* paid request.
 *
 *   const provider = pactProvider({ account, gateway: 'https://pact.example.com' })
 *   app.post('/filings', (c) => provider.protect(async (input) => lookupFilings(input))(c.req.raw))
 */
import type { Account } from 'viem'

import { digest } from '@pact/core'
import { providerMessage } from '@pact/verifier'

import type { FetchLike } from './client.js'

export const PACT_HEADERS = {
  pactId: 'x-pact-id',
  requestDigest: 'x-pact-request-digest',
  resultDigest: 'x-pact-result-digest',
  signature: 'x-pact-signature',
  deadline: 'x-pact-deadline',
  callback: 'x-pact-callback',
} as const

export type PactContext = {
  pactId: string
  requestDigest: string
  deadline: string | null
  callbackUrl: string | null
}

export type ProviderOptions = {
  account: Account
  /** Gateway base URL. When set, `protect` confirms the pact is funded before doing work. */
  gateway?: string
  fetch?: FetchLike
}

export class ProviderError extends Error {
  override readonly name = 'ProviderError'
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export function pactProvider(o: ProviderOptions) {
  const http: FetchLike = o.fetch ?? ((url, init) => fetch(url, init))
  if (!o.account.signMessage) throw new Error('provider account must be able to sign messages')

  const context = (req: Request): PactContext | null => {
    const pactId = req.headers.get(PACT_HEADERS.pactId)
    const requestDigest = req.headers.get(PACT_HEADERS.requestDigest)
    if (!pactId || !requestDigest || !/^pact_[0-9a-f]{20}$/.test(pactId)) return null
    return {
      pactId,
      requestDigest,
      deadline: req.headers.get(PACT_HEADERS.deadline),
      callbackUrl: req.headers.get(PACT_HEADERS.callback),
    }
  }

  /** Signs an exact response body for a pact. Returns the headers to attach. */
  const attest = async (ctx: PactContext, body: string, signer: Account = o.account) => {
    const resultDigest = digest(body)
    const signature = await signer.signMessage!({ message: providerMessage(ctx.pactId, ctx.requestDigest, resultDigest) })
    return {
      [PACT_HEADERS.pactId]: ctx.pactId,
      [PACT_HEADERS.requestDigest]: ctx.requestDigest,
      [PACT_HEADERS.resultDigest]: resultDigest,
      [PACT_HEADERS.signature]: signature,
    }
  }

  const serialize = (data: unknown) => (typeof data === 'string' ? data : JSON.stringify(data))

  /** A signed JSON response for synchronous work. */
  const respond = async (ctx: PactContext, data: unknown, init: ResponseInit = {}) => {
    const body = serialize(data)
    return new Response(body, {
      ...init,
      headers: { 'content-type': 'application/json; charset=utf-8', ...(await attest(ctx, body)) },
    })
  }

  /** Delivers an asynchronous result to the gateway callback carried by the pact. */
  const deliver = async (ctx: PactContext, data: unknown) => {
    if (!ctx.callbackUrl) throw new ProviderError(400, 'pact has no callback URL')
    const body = serialize(data)
    return http(ctx.callbackUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8', ...(await attest(ctx, body)) },
      body,
    })
  }

  /** Confirms with the gateway that the pact is funded and currently executing for this provider. */
  const confirm = async (ctx: PactContext) => {
    if (!o.gateway) return true
    const res = await http(`${o.gateway.replace(/\/$/, '')}/v1/pacts/${ctx.pactId}`)
    if (!res.ok) return false
    const { pact } = (await res.json()) as {
      pact: { state: string; requestDigest: string; service: { providerAddress: string } }
    }
    return (
      pact.state === 'EXECUTING' &&
      pact.requestDigest === ctx.requestDigest &&
      pact.service.providerAddress.toLowerCase() === o.account.address.toLowerCase()
    )
  }

  /**
   * Wraps a handler so it only runs for funded pacts and every result it returns
   * is attested. Works with any fetch-style router (Hono, Next.js, Bun, Deno).
   */
  const protect =
    <I = unknown>(handler: (input: I, ctx: PactContext) => Promise<unknown> | unknown) =>
    async (req: Request): Promise<Response> => {
      const ctx = context(req)
      if (!ctx) return Response.json({ error: 'missing or invalid x-pact headers' }, { status: 400 })
      if (!(await confirm(ctx).catch(() => false)))
        return Response.json({ error: 'pact is not funded or not executing' }, { status: 402 })
      const payload = (await req.json().catch(() => null)) as { request?: I } | null
      if (!payload || payload.request === undefined) return Response.json({ error: 'missing request' }, { status: 400 })
      try {
        return await respond(ctx, await handler(payload.request, ctx))
      } catch (error) {
        const status = error instanceof ProviderError ? error.status : 500
        return Response.json({ error: (error as Error).message }, { status })
      }
    }

  return { address: o.account.address, context, attest, respond, deliver, confirm, protect }
}

export type PactProvider = ReturnType<typeof pactProvider>
