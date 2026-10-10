// Pure-JS sha256 so digests compute identically in Node, browsers and edge runtimes.
import { sha256 } from '@noble/hashes/sha2'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils'

/** Deterministic JSON: sorted keys, no undefined, bigint as decimal string. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value))
}

function normalize(value: unknown): unknown {
  if (value === null) return null
  switch (typeof value) {
    case 'bigint':
      return value.toString()
    case 'number':
      if (!Number.isFinite(value)) throw new Error('non-finite number cannot be canonicalized')
      return value
    case 'string':
    case 'boolean':
      return value
    case 'object': {
      if (Array.isArray(value)) return value.map(normalize)
      const out: Record<string, unknown> = {}
      for (const key of Object.keys(value as object).sort()) {
        const v = (value as Record<string, unknown>)[key]
        if (v !== undefined) out[key] = normalize(v)
      }
      return out
    }
    default:
      throw new Error(`cannot canonicalize ${typeof value}`)
  }
}

export type Digest = `sha256:${string}`

/** sha256 over raw string bytes, or over canonical JSON for any other value. */
export function digest(value: unknown): Digest {
  const input = typeof value === 'string' ? value : canonicalJson(value)
  return `sha256:${bytesToHex(sha256(utf8ToBytes(input)))}`
}
