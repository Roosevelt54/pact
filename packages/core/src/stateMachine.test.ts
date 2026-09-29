import { describe, expect, it } from 'vitest'

import { assertTransition, canTransition, isTerminal, PACT_STATES } from './stateMachine.js'

describe('pact state machine', () => {
  it('follows the happy path PAY → PROVE → SETTLE', () => {
    const path = ['CREATED', 'AUTHORIZED', 'EXECUTING', 'VERIFYING', 'VERIFIED', 'SETTLING', 'SETTLED'] as const
    for (let i = 0; i < path.length - 1; i++) expect(canTransition(path[i]!, path[i + 1]!)).toBe(true)
  })

  it('routes rejected and expired work to protection', () => {
    expect(canTransition('VERIFYING', 'REJECTED')).toBe(true)
    expect(canTransition('REJECTED', 'SETTLING')).toBe(true)
    expect(canTransition('EXECUTING', 'EXPIRED')).toBe(true)
    expect(canTransition('EXPIRED', 'SETTLING')).toBe(true)
    expect(canTransition('SETTLING', 'PROTECTED')).toBe(true)
  })

  it('forbids skipping verification or settling twice', () => {
    expect(canTransition('AUTHORIZED', 'SETTLING')).toBe(false)
    expect(canTransition('EXECUTING', 'VERIFIED')).toBe(false)
    expect(canTransition('SETTLED', 'SETTLING')).toBe(false)
    expect(canTransition('PROTECTED', 'SETTLING')).toBe(false)
    expect(canTransition('REJECTED', 'VERIFIED')).toBe(false)
    expect(() => assertTransition('SETTLED', 'SETTLING')).toThrow(/SETTLED → SETTLING/)
  })

  it('marks only settlement outcomes as terminal', () => {
    const terminal = PACT_STATES.filter(isTerminal)
    expect(terminal.sort()).toEqual(['PROTECTED', 'SETTLED'])
  })
})
