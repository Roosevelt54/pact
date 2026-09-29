import { z } from 'zod'

const hexKey = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, 'must be a 0x-prefixed 32-byte hex private key')

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'must be a 0x-prefixed 20-byte address')

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PACT_API_PORT: z.coerce.number().int().positive().default(8787),
  PACT_PUBLIC_URL: z.string().url().default('http://localhost:8787'),
  PACT_WEB_ORIGIN: z.string().default('http://localhost:3000'),
  PACT_DB_PATH: z.string().default('./data/pact.db'),
  /** HMAC key binding MPP challenges to this server. >= 32 bytes. */
  MPP_SECRET_KEY: z.string().min(32).default('pact-dev-secret-change-me-0123456789abcdef'),
  /** `tempo` settles on Tempo Moderato through the TIP-1034 escrow; `local` uses the in-process ledger rail. */
  PACT_RAIL: z.enum(['tempo', 'local']).default('local'),
  TEMPO_RPC_URL: z.string().url().default('https://rpc.moderato.tempo.xyz'),
  TEMPO_TOKEN: address.default('0x20c0000000000000000000000000000000000000'),
  PACT_OPERATOR_PRIVATE_KEY: hexKey.optional(),
  DEMO_AGENT_PRIVATE_KEY: hexKey.optional(),
  DEMO_PROVIDER_PRIVATE_KEY: hexKey.optional(),
  DEMO_PROVIDER_B_PRIVATE_KEY: hexKey.optional(),
  /** Admin token required for operator-only endpoints (reconciliation, manual expiry sweep). */
  PACT_ADMIN_TOKEN: z.string().min(16).optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
})

export type Config = z.infer<typeof schema>

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`Invalid PACT configuration:\n${issues}`)
  }
  const config = parsed.data
  if (config.PACT_RAIL === 'tempo') {
    const missing = (
      ['PACT_OPERATOR_PRIVATE_KEY', 'DEMO_AGENT_PRIVATE_KEY', 'DEMO_PROVIDER_PRIVATE_KEY'] as const
    ).filter((k) => !config[k])
    if (missing.length)
      throw new Error(
        `PACT_RAIL=tempo requires ${missing.join(', ')}. Run \`npm run tempo:setup\` to generate and fund testnet keys.`,
      )
  }
  if (config.NODE_ENV === 'production' && config.MPP_SECRET_KEY.startsWith('pact-dev-secret'))
    throw new Error('MPP_SECRET_KEY must be set to a unique value in production.')
  return config
}
