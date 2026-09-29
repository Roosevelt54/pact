import { Challenge } from 'mppx'
import type { Address, Hex } from 'viem'
import { generatePrivateKey } from 'viem/accounts'
import { afterEach, describe, expect, it } from 'vitest'

import { buildCredentialHeader, challengeFromResponse, issueChallenge, serializeChallenge } from '@pact/tempo'
import { LocalPayer, LocalRail } from '../apps/gateway/src/rails/local.js'
import { RailError, type SettlementRail } from '@pact/tempo'
import { DEMO_AGENT_ID } from '../apps/gateway/src/runtime.js'
import { createTempoContext } from '@pact/tempo'
import { json, labRun, TERMINAL, tempDbPath, testRuntime, waitForState, type TestRuntime } from './helpers.js'

const runtimes: TestRuntime[] = []
const make = (opts?: Parameters<typeof testRuntime>[0]) => {
  const rt = testRuntime(opts)
  runtimes.push(rt)
  return rt
}
afterEach(async () => {
  for (const rt of runtimes.splice(0)) {
    await rt.engine.idle()
    await rt.provider.idle()
    rt.close()
  }
})

const ctx = createTempoContext('http://127.0.0.1:1', '0x20c0000000000000000000000000000000000000')
const agentPayer = (rt: TestRuntime) => new LocalPayer(rt.repo, ctx, rt.repo.getSetting('key:agent') as Hex)

async function createPact(
  rt: TestRuntime,
  request: Record<string, unknown> = { company: 'NVIDIA', count: 4 },
  key: string = crypto.randomUUID(),
) {
  return json(rt, '/v1/pacts', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': key },
    body: JSON.stringify({ agentId: DEMO_AGENT_ID, serviceId: 'sec-filings', request, maxAmount: '0.50' }),
  })
}

async function challengeFor(rt: TestRuntime, pactId: string) {
  const res = await rt.app.request(`/v1/pacts/${pactId}/authorize`, { method: 'POST' })
  expect(res.status).toBe(402)
  return challengeFromResponse(res)
}

async function credentialFor(rt: TestRuntime, pactId: string, payer = agentPayer(rt), saltPact = pactId) {
  const challenge = await challengeFor(rt, pactId)
  const req = challenge.request as { recipient: Address; amount: string; methodDetails: { operator: Address } }
  const payload = await payer.openAndSign({
    pactId: saltPact,
    payee: req.recipient,
    operator: req.methodDetails.operator,
    deposit: 500_000n,
    amount: BigInt(req.amount),
  })
  return { challenge, payload, header: buildCredentialHeader(challenge, payload) }
}

const authorize = (rt: TestRuntime, pactId: string, header: string) =>
  json(rt, `/v1/pacts/${pactId}/authorize`, { method: 'POST', headers: { authorization: header } })

describe('MPP authorization', () => {
  it('answers with a spec-shaped 402 session challenge', async () => {
    const rt = make()
    const { body } = await createPact(rt)
    const res = await rt.app.request(`/v1/pacts/${body.pact.id}/authorize`, { method: 'POST' })
    expect(res.status).toBe(402)
    const header = res.headers.get('www-authenticate')!
    expect(header.startsWith('Payment ')).toBe(true)
    const challenge = Challenge.deserialize(header)
    expect(challenge).toMatchObject({ method: 'tempo', intent: 'session' })
    expect(challenge.request).toMatchObject({ amount: '400000', currency: '0x20c0000000000000000000000000000000000000' })
  })

  it('rejects a challenge minted with a different secret', async () => {
    const rt = make()
    const pactId = (await createPact(rt)).body.pact.id
    const real = await challengeFor(rt, pactId)
    const forged = issueChallenge({
      secretKey: 'attacker-secret-attacker-secret-attacker',
      realm: real.realm,
      pactId,
      request: real.request as never,
      expiresAt: new Date(Date.now() + 60_000),
      description: 'forged',
    })
    const payload = await agentPayer(rt).openAndSign({
      pactId,
      payee: (real.request as { recipient: Address }).recipient,
      operator: rt.rail.info.operator,
      deposit: 500_000n,
      amount: 400_000n,
    })
    const res = await authorize(rt, pactId, buildCredentialHeader(forged, payload))
    expect(res.status).toBe(402)
    expect(res.body.error.code).toBe('invalid_challenge')
    expect(rt.repo.getPact(pactId)!.state).toBe('CREATED')
    expect(serializeChallenge(forged)).not.toBe(serializeChallenge(real))
  })

  it('rejects a credential issued for another pact', async () => {
    const rt = make()
    const a = (await createPact(rt)).body.pact.id
    const b = (await createPact(rt, { company: 'Tesla', count: 2 })).body.pact.id
    const { header } = await credentialFor(rt, a)
    await challengeFor(rt, b)
    const res = await authorize(rt, b, header)
    expect(res.body.error.code).toBe('challenge_pact_mismatch')
  })

  it('rejects a channel whose salt does not commit to the pact', async () => {
    const rt = make()
    const a = (await createPact(rt)).body.pact.id
    const b = (await createPact(rt, { company: 'Tesla', count: 2 })).body.pact.id
    const { header } = await credentialFor(rt, b, agentPayer(rt), a)
    const res = await authorize(rt, b, header)
    expect(res.body.error.code).toBe('channel_not_bound')
  })

  it('rejects a voucher whose amount was altered after signing', async () => {
    const rt = make()
    const pactId = (await createPact(rt)).body.pact.id
    const challenge = await challengeFor(rt, pactId)
    const req = challenge.request as { recipient: Address; methodDetails: { operator: Address } }
    const payload = await agentPayer(rt).openAndSign({
      pactId,
      payee: req.recipient,
      operator: req.methodDetails.operator,
      deposit: 500_000n,
      amount: 1n,
    })
    payload.voucher.cumulativeAmount = '400000'
    const res = await authorize(rt, pactId, buildCredentialHeader(challenge, payload))
    expect(res.body.error.code).toBe('invalid_voucher')
    expect(rt.repo.getPact(pactId)!.state).toBe('CREATED')
  })

  it('rejects a channel funded by a wallet that is not the agent', async () => {
    const rt = make()
    const pactId = (await createPact(rt)).body.pact.id
    const stranger = new LocalPayer(rt.repo, ctx, generatePrivateKey())
    rt.repo.db
      .prepare('INSERT INTO local_ledger (address, balance) VALUES (?, ?)')
      .run(stranger.address.toLowerCase(), '10000000')
    const { header } = await credentialFor(rt, pactId, stranger)
    const res = await authorize(rt, pactId, header)
    expect(res.body.error.code).toBe('wrong_payer')
  })

  it('treats a replayed credential as idempotent and dispatches once', async () => {
    const rt = make()
    const pactId = (await createPact(rt)).body.pact.id
    const { header } = await credentialFor(rt, pactId)
    const first = await authorize(rt, pactId, header)
    const second = await authorize(rt, pactId, header)
    expect(first.status).toBe(200)
    expect(first.headers.get('payment-receipt')).toBeTruthy()
    expect(second.status).toBe(200)
    expect(second.body.replay).toBe(true)
    await waitForState(rt, pactId, TERMINAL)
    const dispatched = rt.repo.listAudit({ pactId }).filter((e) => e.type === 'work.dispatched')
    expect(dispatched).toHaveLength(1)
  })
})

describe('idempotency and duplicate protection', () => {
  it('returns the same pact for a repeated idempotency key and refuses key reuse for another request', async () => {
    const rt = make()
    const a = await createPact(rt, { company: 'NVIDIA', count: 4 }, 'key-1')
    const b = await createPact(rt, { company: 'NVIDIA', count: 4 }, 'key-1')
    const c = await createPact(rt, { company: 'NVIDIA', count: 5 }, 'key-1')
    expect(a.status).toBe(201)
    expect(b.status).toBe(200)
    expect(b.body.pact.id).toBe(a.body.pact.id)
    expect(c.status).toBe(409)
    expect(c.body.error.code).toBe('idempotency_conflict')
  })

  it('never settles twice', async () => {
    const rt = make()
    const pactId = await labRun(rt, { scenario: 'normal' })
    await waitForState(rt, pactId, TERMINAL)
    const provider = rt.repo.getService('sec-filings')!.provider_address as Address
    const before = await rt.rail.balanceOf(provider)
    await rt.engine.settle(pactId)
    rt.repo.db.prepare("UPDATE pacts SET state = 'SETTLING' WHERE id = ?").run(pactId)
    await rt.engine.settle(pactId)
    const auth = rt.repo.getAuthorization(pactId)!
    await expect(
      rt.rail.close({
        descriptor: JSON.parse(auth.descriptor),
        channelId: auth.channel_id as Hex,
        voucherAmount: 400_000n,
        signature: auth.voucher_sig as Hex,
        captureAmount: 400_000n,
        openTxHash: null,
      }),
    ).rejects.toThrow(/already closed/)
    expect(await rt.rail.balanceOf(provider)).toBe(before)
    expect(rt.repo.listPaymentEvents(pactId).filter((e) => e.kind === 'captured')).toHaveLength(1)
  })

  it('rejects unauthenticated delivery callbacks without changing state', async () => {
    const rt = make()
    const pactId = await labRun(rt, { scenario: 'timeout', serviceId: 'market-report' })
    await waitForState(rt, pactId, ['EXECUTING'])
    const res = await json(rt, `/v1/pacts/${pactId}/deliver`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-pact-signature': '0xdeadbeef' },
      body: '{"market":"x","sections":[]}',
    })
    expect(res.status).toBe(401)
    expect(rt.repo.getPact(pactId)!.state).toBe('EXECUTING')
    expect(rt.repo.getWorkItem(pactId)!.status).toBe('accepted')
  })
})

describe('work receipts', () => {
  it('verifies an issued receipt and rejects altered or re-labelled copies', async () => {
    const rt = make()
    const pactId = await labRun(rt, { scenario: 'normal' })
    await waitForState(rt, pactId, TERMINAL)
    const receiptId = rt.repo.getReceiptByPact(pactId)!.id
    const ok = await json(rt, `/v1/receipts/${receiptId}/verify`)
    expect(ok.body.valid).toBe(true)

    const { receipt } = (await json(rt, `/v1/receipts/${receiptId}`)).body
    const altered = { ...receipt, settlement: { ...receipt.settlement, captureAmount: '0.00' } }
    const bad = await json(rt, '/v1/receipts/verify', { method: 'POST', body: JSON.stringify(altered) })
    expect(bad.body.valid).toBe(false)
    expect(bad.body.checks.digestMatches).toBe(false)

    const relabelled = { ...receipt, receiptId: 'wr_00000000000000000000' }
    const bad2 = await json(rt, '/v1/receipts/verify', { method: 'POST', body: JSON.stringify(relabelled) })
    expect(bad2.body.valid).toBe(false)
    expect(bad2.body.checks.idMatches).toBe(false)
  })
})

class FlakyRail implements SettlementRail {
  failures = 0
  constructor(
    private readonly inner: SettlementRail,
    private failuresLeft: number,
  ) {}
  get info() {
    return this.inner.info
  }
  verifyChannel(p: Parameters<SettlementRail['verifyChannel']>[0]) {
    return this.inner.verifyChannel(p)
  }
  verifyVoucher(p: Parameters<SettlementRail['verifyVoucher']>[0]) {
    return this.inner.verifyVoucher(p)
  }
  async close(p: Parameters<SettlementRail['close']>[0]) {
    if (this.failuresLeft-- > 0) {
      this.failures++
      throw new RailError('close_failed', 'RPC unavailable', true)
    }
    return this.inner.close(p)
  }
  findClose(p: Parameters<SettlementRail['findClose']>[0]) {
    return this.inner.findClose(p)
  }
  txUrl(h: string | null) {
    return this.inner.txUrl(h)
  }
  balanceOf(a: Address) {
    return this.inner.balanceOf(a)
  }
}

describe('failure recovery', () => {
  it('retries settlement through transient chain failures', async () => {
    let flaky: FlakyRail | null = null
    const rt = make({
      settleRetryDelaysMs: [20, 20, 20],
      rail: (repo, operator) => (flaky = new FlakyRail(new LocalRail(repo, ctx, operator), 2)),
    })
    const pactId = await labRun(rt, { scenario: 'normal' })
    const pact = await waitForState(rt, pactId, TERMINAL)
    expect(pact.state).toBe('SETTLED')
    expect(flaky!.failures).toBe(2)
    expect(rt.repo.getSettlement(pactId)!.attempts).toBe(3)
    expect(rt.repo.listFailures(pactId).filter((f) => f.stage === 'settle')).toHaveLength(2)
  })

  it('resumes a pact stuck mid-settlement after a process restart', async () => {
    const dbPath = tempDbPath()
    const first = testRuntime({
      dbPath,
      settleRetryDelaysMs: [],
      rail: (repo, operator) => new FlakyRail(new LocalRail(repo, ctx, operator), 99),
    })
    const pactId = await labRun(first, { scenario: 'incomplete' })
    await waitForState(first, pactId, ['SETTLING'])
    await first.engine.idle()
    expect(first.repo.getPact(pactId)!.state).toBe('SETTLING')
    first.close()

    const second = make({ dbPath })
    second.engine.recover()
    const pact = await waitForState(second, pactId, TERMINAL)
    expect(pact.state).toBe('PROTECTED')
    expect(second.repo.getReceiptByPact(pactId)).toBeTruthy()
  })

  it('refunds a channel whose authorization arrives after the pact expired', async () => {
    const rt = make()
    const pactId = (await createPact(rt)).body.pact.id
    const payer = agentPayer(rt)
    const before = await rt.rail.balanceOf(payer.address)
    const { header } = await credentialFor(rt, pactId, payer)
    expect(await rt.rail.balanceOf(payer.address)).toBe(before - 500_000n)
    rt.engine.sweepExpired(Date.now() + 11 * 60_000)
    expect(rt.repo.getPact(pactId)!.state).toBe('EXPIRED')
    const res = await authorize(rt, pactId, header)
    expect(res.status).toBe(410)
    expect(await rt.rail.balanceOf(payer.address)).toBe(before)
    expect(rt.repo.listAudit({ pactId }).map((e) => e.type)).toContain('payment.late_authorization_refunded')
  })

  it('lets a refreshed client resume the live event stream from its last seen event', async () => {
    const rt = make()
    const pactId = await labRun(rt, { scenario: 'normal' })
    await waitForState(rt, pactId, TERMINAL)
    const all = rt.repo.listAudit({ pactId })
    const resumeFrom = all[3]!.seq
    const res = await rt.app.request('/v1/events', { headers: { 'last-event-id': String(resumeFrom) } })
    const reader = res.body!.getReader()
    let text = ''
    while (!text.includes('receipt.issued')) {
      const { value, done } = await reader.read()
      if (done) break
      text += new TextDecoder().decode(value)
    }
    await reader.cancel()
    const ids = [...text.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]))
    expect(ids[0]).toBe(resumeFrom + 1)
    expect(ids.every((id) => id > resumeFrom)).toBe(true)
  })
})
