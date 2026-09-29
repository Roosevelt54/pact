import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { json, labRun, TERMINAL, testRuntime, waitForState, type TestRuntime } from './helpers.js'

let rt: TestRuntime
beforeEach(() => {
  rt = testRuntime()
})
afterEach(async () => {
  await rt.engine.idle()
  await rt.provider.idle()
  rt.close()
})

const balances = async () => {
  const s = rt.repo.getService('sec-filings')!
  return {
    agent: await rt.rail.balanceOf(rt.agent.address),
    provider: await rt.rail.balanceOf(s.provider_address as `0x${string}`),
  }
}

async function run(scenario: string, extra: Record<string, unknown> = {}) {
  const pactId = await labRun(rt, { scenario, ...extra })
  await waitForState(rt, pactId, TERMINAL)
  return (await json(rt, `/v1/pacts/${pactId}`)).body.pact
}

describe('PAY → PROVE → SETTLE on the local rail', () => {
  it('settles verified work: provider captures the price, agent gets the unused authorization back', async () => {
    const before = await balances()
    const pact = await run('normal')
    expect(pact.state).toBe('SETTLED')
    expect(pact.verification.verdict).toBe('PASS')
    expect(pact.authorization.deposit).toBe('0.50')
    expect(pact.settlement).toMatchObject({ kind: 'capture', status: 'confirmed', capture: '0.40', refund: '0.10' })
    const after = await balances()
    expect(after.provider - before.provider).toBe(400_000n)
    expect(before.agent - after.agent).toBe(400_000n)
    expect(pact.receiptId).toMatch(/^wr_/)
    const types = pact.timeline.map((e: { type: string }) => e.type)
    expect(types).toEqual([
      'pact.created',
      'payment.challenge_issued',
      'payment.authorized',
      'work.dispatched',
      'work.delivered',
      'verification.completed',
      'settlement.started',
      'settlement.confirmed',
      'receipt.issued',
    ])
  })

  it.each([
    ['incomplete', 'min_items'],
    ['malformed', 'json_parse'],
    ['wrong', 'echo_fields'],
    ['duplicate', 'unique_items'],
    ['forged', 'provider_signature'],
    ['http_error', 'http_ok'],
    ['replay', 'request_bound'],
  ])('protects the agent when the provider returns a %s result', async (scenario, reason) => {
    const before = await balances()
    const pact = await run(scenario)
    expect(pact.state).toBe('PROTECTED')
    expect(pact.verification.verdict).toBe('FAIL')
    expect(pact.verification.reasons).toContain(reason)
    expect(pact.settlement).toMatchObject({ kind: 'refund', capture: '0.00', refund: '0.50', status: 'confirmed' })
    const after = await balances()
    expect(after.agent).toBe(before.agent)
    expect(after.provider).toBe(before.provider)
  })

  it('detects a signed result replayed from an earlier pact for the identical request', async () => {
    await run('normal', { company: 'Apple' })
    const pact = await run('replay', { company: 'Apple' })
    expect(pact.state).toBe('PROTECTED')
    // Same request content → same request digest; the replay is caught because the
    // provider's signature and echo are bound to the earlier pact id.
    expect(pact.verification.reasons).toEqual(['pact_bound', 'provider_signature'])
  })

  it('flags a result replayed across different requests', async () => {
    await run('normal', { company: 'Apple', count: 4 })
    const pact = await run('replay', { company: 'Apple', count: 3 })
    expect(pact.state).toBe('PROTECTED')
    expect(pact.verification.reasons).toEqual(expect.arrayContaining(['pact_bound', 'request_bound', 'provider_signature']))
  })

  it('does not treat identical data from two independent providers as a replay', async () => {
    const atlas = await run('normal', { serviceId: 'sec-filings-atlas', company: 'NVIDIA', count: 4 })
    const northwind = await run('normal', { serviceId: 'sec-filings', company: 'NVIDIA', count: 4 })
    expect(atlas.state).toBe('SETTLED')
    expect(northwind.work.resultDigest).toBe(atlas.work.resultDigest)
    expect(northwind.state).toBe('SETTLED')
  })

  it('refunds on provider timeout', async () => {
    const pact = await run('timeout')
    expect(pact.state).toBe('PROTECTED')
    expect(pact.verification.reasons).toEqual(['delivered'])
    expect(pact.work.transportError).toBe('timeout')
  }, 20_000)

  it('refunds a correct result that arrives after the latency limit', async () => {
    const pact = await run('delayed')
    expect(pact.state).toBe('PROTECTED')
    expect(pact.verification.reasons).toEqual(['deadline'])
  }, 20_000)

  it('retries with another provider and links the pacts', async () => {
    const failed = await run('incomplete')
    const retry = await run('normal', { serviceId: 'sec-filings-atlas', retryOf: failed.id })
    expect(retry.state).toBe('SETTLED')
    expect(retry.retryOf).toBe(failed.id)
    expect(retry.settlement.capture).toBe('0.42')
    const again = (await json(rt, `/v1/pacts/${failed.id}`)).body.pact
    expect(again.retries.map((r: { id: string }) => r.id)).toEqual([retry.id])
  })

  it('derives metrics from settled facts only', async () => {
    await run('normal')
    await run('incomplete')
    const m = (await json(rt, '/v1/metrics')).body
    expect(m).toMatchObject({ settled: '0.40', protected: '0.40', authorized: '1.00', pacts: 2, passRate: 0.5 })
  })
})

describe('async jobs', () => {
  it('correlates an async callback to the pact and settles', async () => {
    const pactId = await labRun(rt, { scenario: 'normal', serviceId: 'market-report', sections: 4 })
    await waitForState(rt, pactId, TERMINAL)
    const pact = (await json(rt, `/v1/pacts/${pactId}`)).body.pact
    expect(pact.state).toBe('SETTLED')
    expect(pact.work.jobId).toMatch(/^job_/)
    expect(pact.timeline.map((e: { type: string }) => e.type)).toContain('work.accepted')
    expect(pact.settlement.capture).toBe('1.20')
  })

  it('ignores a duplicate callback and settles exactly once', async () => {
    const pactId = await labRun(rt, { scenario: 'duplicate_callback', serviceId: 'market-report' })
    await waitForState(rt, pactId, TERMINAL)
    await rt.provider.idle()
    const pact = (await json(rt, `/v1/pacts/${pactId}`)).body.pact
    expect(pact.state).toBe('SETTLED')
    expect(pact.work.duplicateDeliveries).toBe(1)
    expect(pact.payments.filter((p: { kind: string }) => p.kind === 'captured')).toHaveLength(1)
  })

  it('rejects a forged callback and refunds once the job deadline passes', async () => {
    const pactId = await labRun(rt, { scenario: 'forged', serviceId: 'market-report' })
    await waitForState(rt, pactId, ['EXECUTING'])
    await rt.provider.idle()
    expect(rt.repo.getPact(pactId)!.state).toBe('EXECUTING')
    rt.engine.sweepExpired(Date.now() + 60_000)
    const pact = await waitForState(rt, pactId, TERMINAL)
    expect(pact.state).toBe('PROTECTED')
    expect(rt.repo.listAudit({ pactId }).map((e) => e.type)).toContain('work.callback_rejected')
  })
})
