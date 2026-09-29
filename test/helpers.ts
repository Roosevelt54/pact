import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { loadConfig } from '../apps/gateway/src/config.js'
import { createRuntime } from '../apps/gateway/src/runtime.js'

export const PUBLIC_URL = 'http://pact.test'
export const ADMIN_TOKEN = 'test-admin-token-0123456789'

export function testRuntime(opts: Parameters<typeof createRuntime>[1] & { dbPath?: string } = {}) {
  const config = loadConfig({
    NODE_ENV: 'test',
    PACT_RAIL: 'local',
    PACT_DB_PATH: opts.dbPath ?? ':memory:',
    PACT_PUBLIC_URL: PUBLIC_URL,
    PACT_WEB_ORIGIN: 'http://localhost:3000',
    MPP_SECRET_KEY: 'test-secret-key-0123456789abcdef-0123456789',
    PACT_ADMIN_TOKEN: ADMIN_TOKEN,
  })
  return createRuntime(config, { provider: { delayedMs: 4_600, timeoutMs: 20_000, reportDelayMs: 30 }, ...opts })
}

export const tempDbPath = () => join(mkdtempSync(join(tmpdir(), 'pact-')), 'pact.db')

export type TestRuntime = ReturnType<typeof testRuntime>

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function json<T = Record<string, any>>(rt: TestRuntime, path: string, init?: RequestInit) {
  const res = await rt.app.request(path, init)
  return { status: res.status, headers: res.headers, body: (await res.json().catch(() => null)) as T }
}

export async function waitForState(rt: TestRuntime, pactId: string, states: string[], timeoutMs = 15_000) {
  const start = Date.now()
  for (;;) {
    const pact = rt.repo.getPact(pactId)
    if (pact && states.includes(pact.state)) {
      await rt.engine.idle()
      return rt.repo.getPact(pactId)!
    }
    if (Date.now() - start > timeoutMs) throw new Error(`pact ${pactId} stuck in ${pact?.state}`)
    await new Promise((r) => setTimeout(r, 20))
  }
}

export async function labRun(rt: TestRuntime, body: Record<string, unknown>, key?: string) {
  const res = await json<{ pactId: string; state: string }>(rt, '/v1/lab/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) },
    body: JSON.stringify(body),
  })
  if (res.status !== 202) throw new Error(`lab run failed ${res.status} ${JSON.stringify(res.body)}`)
  return res.body.pactId
}

export const TERMINAL = ['SETTLED', 'PROTECTED']
