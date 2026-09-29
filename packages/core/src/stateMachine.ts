export const PACT_STATES = [
  'CREATED',
  'AUTHORIZED',
  'EXECUTING',
  'VERIFYING',
  'VERIFIED',
  'REJECTED',
  'EXPIRED',
  'SETTLING',
  'SETTLED',
  'PROTECTED',
] as const

export type PactState = (typeof PACT_STATES)[number]

const TRANSITIONS: Record<PactState, readonly PactState[]> = {
  CREATED: ['AUTHORIZED', 'EXPIRED'],
  AUTHORIZED: ['EXECUTING', 'EXPIRED'],
  EXECUTING: ['VERIFYING', 'EXPIRED'],
  VERIFYING: ['VERIFIED', 'REJECTED'],
  VERIFIED: ['SETTLING'],
  REJECTED: ['SETTLING'],
  EXPIRED: ['SETTLING'],
  SETTLING: ['SETTLED', 'PROTECTED'],
  SETTLED: [],
  PROTECTED: [],
}

export class InvalidTransitionError extends Error {
  override readonly name = 'InvalidTransitionError'
  constructor(
    readonly from: PactState,
    readonly to: PactState,
  ) {
    super(`invalid pact transition ${from} → ${to}`)
  }
}

export const canTransition = (from: PactState, to: PactState): boolean => TRANSITIONS[from].includes(to)

export function assertTransition(from: PactState, to: PactState): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to)
}

export const isTerminal = (state: PactState): boolean => TRANSITIONS[state].length === 0

/** States in which a passed deadline moves the pact to EXPIRED. */
export const EXPIRABLE_STATES: readonly PactState[] = ['CREATED', 'AUTHORIZED', 'EXECUTING']
