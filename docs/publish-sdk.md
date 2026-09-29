# Publish the SDK to npm

"Hosting the SDK" means publishing it to the **npm registry** — the public package store that
`npm install` downloads from. Nothing needs a server. Once published, anyone can run:

```bash
npm install @pact/tempo viem
```

The repo already contains a release pipeline that compiles the five SDK packages to plain JavaScript
plus TypeScript type definitions, so users need only Node.js 20+.

| Package | Who uses it |
|---|---|
| `@pact/tempo` | agents (`PactClient`) and API providers (`pactProvider`) — the main package |
| `@pact/verifier` | anyone writing or checking verification policies |
| `@pact/receipts` | anyone verifying Work Receipts offline |
| `@pact/mcp` | MCP servers and agents (`npx pact-mcp`) |
| `@pact/core` | shared primitives (installed automatically) |

## 1. Build and test locally — no account needed

```bash
npm run release:pack
```

This compiles everything into `.release/` and writes five installable files to `.release/tarballs/`.
To try them exactly as a user would, from any empty folder:

```bash
npm init -y
npm install C:/Users/LENOVO/pact/.release/tarballs/*.tgz viem
```

## 2. Create an npm account and an organization (one time)

1. Sign up at <https://www.npmjs.com/signup> and turn on two-factor authentication.
2. Packages named `@something/…` belong to an npm **organization** called `something`. Create one at
   <https://www.npmjs.com/org/create> — free for public packages.
   - Try the name **`pact`**. If it is taken, pick another, e.g. `pactpay` or `pact-tempo`.
3. In a terminal, sign in:

```bash
npm login
```

Check it worked:

```bash
npm whoami
```

## 3. Publish

If you got the `pact` organization:

```bash
npm run release:publish
```

If you used a different organization name, pass it as the scope. The script renames every package and
every internal import to match:

```bash
npm run release:publish -- --scope=@pactpay
```

npm will ask for your two-factor code. After a minute the packages appear at
`https://www.npmjs.com/package/@pact/tempo` (or your scope).

## 4. Update the docs

If you published under a different scope, replace `@pact/` with your scope in `README.md`, `docs/`
and the Control Center's `/docs` page so the install commands people copy are correct.

## 5. Releasing a new version

npm never lets you overwrite a version. Bump it, then publish:

```bash
npm run release:publish -- --version=0.1.1
```

Also update `"version"` in each `packages/*/package.json` so the repo matches what is on npm.

## What the pipeline guarantees

- ESM JavaScript + `.d.ts` in `dist/`; tests and TypeScript sources are not shipped.
- `@pact/*` dependencies between the packages are pinned to the published version.
- Each package ships its own README (the npm page) and the MIT licence.
- Verified during development: the packed tarballs installed into an empty project, imported from plain
  Node, type-checked under strict TypeScript, ran `npx pact-mcp`, and made a real paid request that
  settled on Tempo Moderato.
