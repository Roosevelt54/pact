import { serve } from '@hono/node-server'

import { loadConfig } from './config.js'
import { createRuntime } from './runtime.js'

try {
  process.loadEnvFile('.env')
} catch {
  /* optional */
}

const config = loadConfig()
const runtime = createRuntime(config)
runtime.engine.start()

const server = serve({ fetch: runtime.app.fetch, port: config.PACT_API_PORT }, (info) => {
  const rail = runtime.rail.info
  console.log(`PACT gateway listening on http://localhost:${info.port}`)
  console.log(`  rail      ${rail.label}`)
  console.log(`  operator  ${rail.operator}`)
  console.log(`  agent     ${runtime.agent.address}`)
})

const shutdown = () => {
  console.log('shutting down…')
  server.close()
  runtime.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
