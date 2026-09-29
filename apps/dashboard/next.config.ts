import type { NextConfig } from 'next'

const api = (process.env.PACT_API_URL ?? 'http://localhost:8787').replace(/\/$/, '')

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The /api rewrite proxies the gateway's SSE stream; gzip would buffer it in the browser.
  compress: false,
  outputFileTracingIncludes: { '/docs/[slug]': ['../../docs/**/*.md'], '/docs': ['../../docs/**/*.md'] },
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${api}/:path*` }]
  },
}

export default config
