import { describe, expect, it } from 'vitest'

import { formatAmount, parseAmount } from './money.js'

describe('money', () => {
  it('parses decimal strings into 6-decimal base units', () => {
    expect(parseAmount('0.40')).toBe(400_000n)
    expect(parseAmount('1')).toBe(1_000_000n)
    expect(parseAmount('0.000001')).toBe(1n)
    expect(parseAmount('25.5')).toBe(25_500_000n)
  })

  it('rejects malformed, negative and over-precise amounts', () => {
    for (const bad of ['', '-1', '1.0000001', 'abc', '1e6', '0x10', ' 1', '1.']) {
      expect(() => parseAmount(bad)).toThrow()
    }
  })

  it('formats base units with at least two decimals', () => {
    expect(formatAmount(400_000n)).toBe('0.40')
    expect(formatAmount(1n)).toBe('0.000001')
    expect(formatAmount(25_500_000n)).toBe('25.50')
    expect(formatAmount(0n)).toBe('0.00')
  })

  it('round-trips', () => {
    for (const v of ['0.40', '12.345678', '0.08']) expect(formatAmount(parseAmount(v))).toBe(v)
  })
})
