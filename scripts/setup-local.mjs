#!/usr/bin/env node
// Local development only: build the actual unpublished protocol from a sibling checkout.
// No published manifest is rewritten, and no local tarball enters a committed lockfile.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const argument = process.argv[2]
if (!argument || process.argv.length !== 3) throw new Error('Usage: npm run setup:local -- <super-chat checkout or packages/protocol directory>')
const npm = process.env.npm_execpath
if (!npm) throw new Error('Run through npm run setup:local so the current npm CLI can be reused on every platform')
const input = resolve(argument)
const source = existsSync(join(input, 'packages/protocol/package.json')) ? join(input, 'packages/protocol') : input
const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
const plugin = JSON.parse(readFileSync(join(root, 'packages/integrations/chat-plugin/package.json'), 'utf8'))
const name = '@supersolutions/super-protocol'
if (manifest.name !== name || manifest.version !== plugin.dependencies[name]) throw new Error('Protocol source name/version must match the chat plugin dependency')
if (existsSync(join(root, 'package-lock.json'))) throw new Error('Local bootstrap leaves a registry lockfile untouched; use npm ci for the published dependency or a separate checkout for local protocol development')
function run (args, cwd, capture = false) {
  const result = spawnSync(process.execPath, [npm, ...args], { cwd, stdio: capture ? 'pipe' : 'inherit', encoding: 'utf8', env: { ...process.env, npm_config_cache: join(root, '.local-deps/npm-cache') } })
  if (result.error) throw result.error
  if (result.status !== 0) {
    if (capture) process.stderr.write(result.stderr ?? '')
    throw new Error(`npm ${args[0]} failed (${result.status})`)
  }
  return result.stdout
}
const cache = join(root, '.local-deps')
mkdirSync(cache, { recursive: true })
const stage = mkdtempSync(join(cache, 'protocol-'))
// Preserve the upstream build config, licence and real sources. The sibling stays read-only.
for (const file of ['package.json', 'LICENSE', 'NOTICE', 'README.md', 'tsup.config.ts', 'src']) cpSync(join(source, file), join(stage, file), { recursive: true })
writeFileSync(join(stage, 'tsconfig.json'), JSON.stringify({
  extends: join(source, 'tsconfig.json').replaceAll('\\', '/'),
  compilerOptions: { rootDir: './src', outDir: './dist' },
  include: ['src'], exclude: ['src/**/*.test.ts']
}, null, 2) + '\n')
const commit = spawnSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' })
console.log(`Building ${name}@${manifest.version} from ${source}${commit.status === 0 ? ` (${commit.stdout.trim()})` : ''}`)
run(['install', '--no-audit', '--no-fund'], stage)
run(['run', 'build'], stage)
const packed = JSON.parse(run(['pack', '--ignore-scripts', '--json', '--pack-destination', cache], stage, true))[0]
if (!packed?.filename || basename(packed.filename) !== packed.filename) throw new Error('Unexpected npm pack filename')
run(['install', '--no-save', '--package-lock=false', '--no-audit', '--no-fund', join(cache, packed.filename)], root)
writeFileSync(join(cache, 'protocol-source.json'), JSON.stringify({
  name, version: manifest.version, source, commit: commit.status === 0 ? commit.stdout.trim() : null,
  tarball: join(cache, packed.filename), integrity: packed.integrity, installedAt: new Date().toISOString()
}, null, 2) + '\n')
// Only delete this invocation's generated staging directory, never the source checkout.
if (dirname(stage) !== cache || !basename(stage).startsWith('protocol-') || realpathSync(stage) !== stage) throw new Error('Unexpected staging location; retained for inspection')
rmSync(stage, { recursive: true })
console.log('Local workspace installed. Run npm run typecheck, npm run build, npm run lint, and npm test. Nothing was published.')
