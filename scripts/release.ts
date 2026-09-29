/**
 * Builds the SDK packages into publishable npm packages under .release/.
 *
 *   npm run release:pack                         # build + npm pack → .release/tarballs/*.tgz
 *   npm run release:publish                      # build + npm publish (you must be `npm login`-ed)
 *   npm run release:pack -- --scope=@yourorg     # publish under a different npm scope
 *   npm run release:pack -- --version=0.1.1      # override the version for every package
 *
 * The workspace keeps pointing at TypeScript sources for development. Only the
 * staged copies point at compiled `dist/` (ESM JavaScript + .d.ts), so consumers
 * need nothing but Node.js 20+.
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const OUT = join(ROOT, '.release')
const ORDER = ['core', 'verifier', 'receipts', 'tempo', 'mcp'] as const
const REPO = 'https://github.com/Roosevelt54/pact'

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]
const flag = (name: string) => process.argv.includes(`--${name}`)

const scope = arg('scope') ?? '@pact'
const versionOverride = arg('version')
const publish = flag('publish')
const otp = arg('otp')
if (!/^@[a-z0-9][a-z0-9-._]*$/.test(scope)) throw new Error(`invalid scope "${scope}"`)
if (otp && !/^\d{6,8}$/.test(otp)) throw new Error('invalid --otp (expected the 6-digit code from your authenticator)')
if (versionOverride && !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(versionOverride)) throw new Error(`invalid version "${versionOverride}"`)

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
// npm is a .cmd shim on Windows and needs a shell; node does not (and a shell would split "Program Files").
const run = (cmd: string, args: string[], cwd = ROOT) =>
  execFileSync(cmd, args, { cwd, stdio: 'inherit', shell: cmd === npm && process.platform === 'win32' })

// Lets a failed publish be re-run: packages that already went up are skipped.
function isPublished(name: string, version: string) {
  try {
    execFileSync(npm, ['view', `${name}@${version}`, 'version'], { stdio: 'pipe', shell: process.platform === 'win32' })
      .toString()
      .trim()
    return true
  } catch {
    return false
  }
}

type Manifest = {
  name: string
  version: string
  description: string
  keywords?: string[]
  dependencies?: Record<string, string>
  bin?: Record<string, string>
}

const rename = (name: string) => (scope === '@pact' ? name : name.replace(/^@pact\//, `${scope}/`))

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

rmSync(OUT, { recursive: true, force: true })
mkdirSync(join(OUT, 'tarballs'), { recursive: true })

const versions = new Map<string, string>()
for (const pkg of ORDER) {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'packages', pkg, 'package.json'), 'utf8')) as Manifest
  versions.set(manifest.name, versionOverride ?? manifest.version)
}

for (const pkg of ORDER) {
  const srcDir = join(ROOT, 'packages', pkg)
  const stage = join(OUT, pkg)
  const manifest = JSON.parse(readFileSync(join(srcDir, 'package.json'), 'utf8')) as Manifest
  const version = versions.get(manifest.name)!
  mkdirSync(stage, { recursive: true })

  // Resolve sibling packages to the declarations already built in earlier iterations,
  // so each package compiles against the published shape of its dependencies.
  const posix = (p: string) => p.replaceAll('\\', '/') // tsconfig globs require forward slashes
  const paths = Object.fromEntries(
    ORDER.slice(0, ORDER.indexOf(pkg)).map((dep) => [`@pact/${dep}`, [posix(join(OUT, dep, 'dist', 'index.d.ts'))]]),
  )
  const tsconfig = {
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      lib: ['ES2023', 'DOM'],
      types: ['node'],
      strict: true,
      skipLibCheck: true,
      esModuleInterop: true,
      declaration: true,
      sourceMap: true,
      rootDir: posix(join(srcDir, 'src')),
      outDir: posix(join(stage, 'dist')),
      paths,
    },
    include: [posix(join(srcDir, 'src')) + '/**/*.ts'],
    exclude: [posix(join(srcDir, 'src')) + '/**/*.test.ts'],
  }
  const tsconfigPath = join(stage, 'tsconfig.json')
  writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2))
  console.log(`\n▸ building ${rename(manifest.name)}@${version}`)
  run(process.execPath, [join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', tsconfigPath])
  rmSync(tsconfigPath)

  if (scope !== '@pact')
    for (const file of walk(join(stage, 'dist')).filter((f) => /\.(js|d\.ts)$/.test(f)))
      writeFileSync(file, readFileSync(file, 'utf8').replace(/(['"])@pact\//g, `$1${scope}/`))

  const dependencies = Object.fromEntries(
    Object.entries(manifest.dependencies ?? {}).map(([dep, range]) =>
      dep.startsWith('@pact/') ? [rename(dep), `^${versions.get(dep)}`] : [dep, range],
    ),
  )
  const published = {
    name: rename(manifest.name),
    version,
    description: manifest.description,
    keywords: ['tempo', 'mpp', 'machine-payments', 'ai-agents', 'pact', ...(manifest.keywords ?? [])].filter(
      (k, i, a) => a.indexOf(k) === i,
    ),
    license: 'MIT',
    type: 'module',
    repository: { type: 'git', url: `git+${REPO}.git`, directory: `packages/${pkg}` },
    homepage: `${REPO}/tree/main/packages/${pkg}#readme`,
    bugs: `${REPO}/issues`,
    engines: { node: '>=20' },
    sideEffects: false,
    exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' }, './package.json': './package.json' },
    types: './dist/index.d.ts',
    ...(manifest.bin ? { bin: Object.fromEntries(Object.keys(manifest.bin).map((k) => [k, './dist/bin.js'])) } : {}),
    files: ['dist', 'README.md', 'LICENSE'],
    dependencies,
    publishConfig: { access: 'public' },
  }
  writeFileSync(join(stage, 'package.json'), JSON.stringify(published, null, 2) + '\n')
  for (const f of ['README.md', 'LICENSE']) {
    const from = existsSync(join(srcDir, f)) ? join(srcDir, f) : join(ROOT, f)
    copyFileSync(from, join(stage, f))
  }

  if (!publish) run(npm, ['pack', '--pack-destination', join(OUT, 'tarballs')], stage)
  else if (isPublished(published.name, published.version)) console.log(`  ${published.name}@${published.version} already on npm, skipping`)
  else run(npm, ['publish', '--access', 'public', ...(otp ? [`--otp=${otp}`] : [])], stage)
}

console.log(
  publish
    ? `\n✓ published ${ORDER.length} packages under ${scope}`
    : `\n✓ packed ${ORDER.length} packages into .release/tarballs — install them anywhere with:\n  npm install ${join(OUT, 'tarballs')}/*.tgz`,
)
