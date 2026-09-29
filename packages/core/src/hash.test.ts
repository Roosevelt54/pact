import { describe, expect, it } from 'vitest'

import { canonicalJson, digest } from './hash.js'

describe('hash', () => {
  it('canonicalizes key order recursively', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 1, e: 0 }] } })).toBe(
      '{"a":{"c":[3,{"e":0,"f":1}],"d":2},"b":1}',
    )
  })

  it('drops undefined and encodes bigint as string', () => {
    expect(canonicalJson({ a: undefined, b: 10n })).toBe('{"b":"10"}')
  })

  it('produces stable sha256 digests independent of key order', () => {
    const a = digest({ x: 1, y: 'z' })
    const b = digest({ y: 'z', x: 1 })
    expect(a).toBe(b)
    expect(a).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('digests raw strings byte-exactly', () => {
    expect(digest('abc')).toBe('sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('rejects non-finite numbers', () => {
    expect(() => canonicalJson({ n: Number.NaN })).toThrow()
  })
})
