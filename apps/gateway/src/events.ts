import { EventEmitter } from 'node:events'

import type { AuditRow, Repo } from './db/repo.js'

export type PactEvent = {
  seq: number
  pactId: string | null
  type: string
  actor: string
  data: Record<string, unknown>
  at: string
}

export const toEvent = (row: AuditRow): PactEvent => ({
  seq: row.seq,
  pactId: row.pact_id,
  type: row.type,
  actor: row.actor,
  data: JSON.parse(row.data) as Record<string, unknown>,
  at: new Date(row.created_at).toISOString(),
})

/** Every audit event is persisted first, then fanned out to live subscribers (SSE). */
export class EventBus {
  private readonly emitter = new EventEmitter()
  constructor(private readonly repo: Repo) {
    this.emitter.setMaxListeners(1000)
  }

  record(pactId: string | null, type: string, actor: string, data: Record<string, unknown> = {}): PactEvent {
    const event = toEvent(this.repo.addAudit({ pact_id: pactId, type, actor, data }))
    this.emitter.emit('event', event)
    return event
  }

  subscribe(fn: (e: PactEvent) => void): () => void {
    this.emitter.on('event', fn)
    return () => this.emitter.off('event', fn)
  }
}
