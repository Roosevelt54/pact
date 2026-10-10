import type { NextConfig } from 'next'

const api = (process.env.PACT_API_URL ?? 'http://localhost:8787').replace(/\/$/, '')

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The /api rewrite proxies the gateway's SSE stream; gzip would buffer it in the browser.
  compress: false,
  // The wallet flows pay through the same SDK agents use; these workspace packages ship TypeScript source.
  transpilePackages: ['@pact/tempo', '@pact/core', '@pact/receipts', '@pact/verifier'],
  outputFileTracingIncludes: {
    '/docs/[slug]': ['../../docs/**/*.md'],
    '/docs': ['../../docs/**/*.md'],
    '/(console)/docs/[slug]': ['../../docs/**/*.md'],
    '/(console)/docs': ['../../docs/**/*.md'],
  },
  // Workspace SDK sources use NodeNext-style `./x.js` specifiers that point at `.ts` files.
  webpack(cfg) {
    cfg.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] }
    return cfg
  },
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${api}/:path*` }]
  },
}

export default config
