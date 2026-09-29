/** TIP-20 stablecoins on Tempo use 6 decimals. Amounts are carried as bigint base units. */
export const DECIMALS = 6
const SCALE = 10n ** BigInt(DECIMALS)
const AMOUNT_RE = /^(0|[1-9]\d{0,11})(\.\d{1,6})?$/

export function parseAmount(value: string): bigint {
  if (!AMOUNT_RE.test(value)) throw new Error(`invalid amount "${value}"`)
  const [whole, frac = ''] = value.split('.')
  return BigInt(whole!) * SCALE + BigInt((frac + '000000').slice(0, DECIMALS))
}

export function formatAmount(units: bigint): string {
  if (units < 0n) throw new Error('negative amount')
  const whole = units / SCALE
  const frac = (units % SCALE).toString().padStart(DECIMALS, '0').replace(/0+$/, '')
  return `${whole}.${frac.padEnd(2, '0')}`
}
