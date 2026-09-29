'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

import type { PactEvent } from './types'

export const API = '/api'

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API}${path}`, { cache: 'no-store', ...init })
  } catch {
    throw new ApiError('network', 'The PACT gateway is unreachable.', 0)
  }
  const body = (await res.json().catch(() => null)) as (T & { error?: { code: string; message: string } }) | null
  if (!res.ok) throw new ApiError(body?.error?.code ?? `http_${res.status}`, body?.error?.message ?? `HTTP ${res.status}`, res.status)
  return body as T
}

/** Fetches `path`, refreshing on an interval and whenever `reload()` is called. Keeps last good data on error. */
export function useApi<T>(path: string | null, opts: { refreshMs?: number } = {}) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [loading, setLoading] = useState(true)
  const seq = useRef(0)

  const load = useCallback(async () => {
    if (!path) return
    const mine = ++seq.current
    try {
      const next = await api<T>(path)
      if (mine !== seq.current) return
      setData(next)
      setError(null)
    } catch (e) {
      if (mine !== seq.current) return
      setError(e as ApiError)
    } finally {
      if (mine === seq.current) setLoading(false)
    }
  }, [path])

  useEffect(() => {
    setLoading(true)
    void load()
    if (!opts.refreshMs) return
    const t = setInterval(() => void load(), opts.refreshMs)
    return () => clearInterval(t)
  }, [load, opts.refreshMs])

  return { data, error, loading, reload: load }
}

type EventsCtx = {
  status: 'connecting' | 'live' | 'offline'
  recent: PactEvent[]
  subscribe: (fn: (e: PactEvent) => void) => () => void
}

const EventsContext = createContext<EventsCtx>({ status: 'connecting', recent: [], subscribe: () => () => {} })

/** One EventSource per tab. The gateway replays from Last-Event-ID, so refreshes and reconnects lose nothing. */
export function EventsProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<EventsCtx['status']>('connecting')
  const [recent, setRecent] = useState<PactEvent[]>([])
  const listeners = useRef(new Set<(e: PactEvent) => void>())

  useEffect(() => {
    const source = new EventSource(`${API}/v1/events`)
    source.onopen = () => setStatus('live')
    source.onerror = () => setStatus(source.readyState === EventSource.CLOSED ? 'offline' : 'connecting')
    source.addEventListener('pact', (msg) => {
      try {
        const event = JSON.parse((msg as MessageEvent<string>).data) as PactEvent
        setRecent((prev) => (prev.some((p) => p.seq === event.seq) ? prev : [event, ...prev].slice(0, 120)))
        for (const fn of listeners.current) fn(event)
      } catch {
        /* ignore malformed frames */
      }
    })
    return () => source.close()
  }, [])

  const subscribe = useCallback((fn: (e: PactEvent) => void) => {
    listeners.current.add(fn)
    return () => {
      listeners.current.delete(fn)
    }
  }, [])

  return <EventsContext.Provider value={{ status, recent, subscribe }}>{children}</EventsContext.Provider>
}

export const useEvents = () => useContext(EventsContext)

/** Calls `fn` (debounced) whenever an event matching `filter` arrives. */
export function useOnEvent(fn: () => void, filter?: (e: PactEvent) => boolean, delayMs = 150) {
  const { subscribe } = useEvents()
  const fnRef = useRef(fn)
  const filterRef = useRef(filter)
  useEffect(() => {
    fnRef.current = fn
    filterRef.current = filter
  })
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null
    const off = subscribe((e) => {
      if (filterRef.current && !filterRef.current(e)) return
      if (t) clearTimeout(t)
      t = setTimeout(() => fnRef.current(), delayMs)
    })
    return () => {
      off()
      if (t) clearTimeout(t)
    }
  }, [subscribe, delayMs])
}
