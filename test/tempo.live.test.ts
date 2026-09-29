/**
 * Live end-to-end on Tempo Moderato. Opt-in: `PACT_TEMPO_LIVE=1 npm test -- tempo.live`
 * Requires funded keys in .env (`npm run tempo:setup`).
 */
import { afterAll, describe, expect, it } from 'vitest'

import { loadConfig } from '../apps/gateway/src/config.js'
import { createRuntime } from '../apps/gateway/src/runtime.js'
import { json, labRun, TERMINAL, tempDbPath, waitForState } from './helpers.js'

try {
  process.loadEnvFile('.env')
} catch {
  /* optional */
}

const live = process.env.PACT_TEMPO_LIVE === '1'

describe.skipIf(!live)('Tempo Moderato live', () => {
  const rt = live
    ? createRuntime(
        loadConfig({
          ...process.env,
          NODE_ENV: 'test',
          PACT_RAIL: 'tempo',
          PACT_DB_PATH: tempDbPath(),
          PACT_PUBLIC_URL: 'http://pact.test',
        }),
      )
    : null!
  afterAll(() => rt?.close())

  it('captures the price on-chain for verified work', async () => {
    const pactId = await labRun(rt, { scenario: 'normal' })
    await waitForState(rt, pactId, TERMINAL, 90_000)
    const { pact } = (await json(rt, `/v1/pacts/${pactId}`)).body
    expect(pact.state).toBe('SETTLED')
    expect(pact.authorization.openTx).toMatch(/^0x[0-9a-f]{64}$/)
    expect(pact.settlement.txHash).toMatch(/^0x[0-9a-f]{64}$/)
    expect(pact.settlement.txUrl).toContain('explore.testnet.tempo.xyz/tx/')
    expect(pact.settlement).toMatchObject({ capture: '0.40', refund: '0.10' })
  }, 120_000)

  it('refunds the full authorization on-chain for failed work', async () => {
    const pactId = await labRun(rt, { scenario: 'wrong' })
    await waitForState(rt, pactId, TERMINAL, 90_000)
    const { pact } = (await json(rt, `/v1/pacts/${pactId}`)).body
    expect(pact.state).toBe('PROTECTED')
    expect(pact.settlement).toMatchObject({ capture: '0.00', refund: '0.50' })
    expect(pact.settlement.txHash).toMatch(/^0x[0-9a-f]{64}$/)
  }, 120_000)
})
