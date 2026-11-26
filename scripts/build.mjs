#!/usr/bin/env node
// Build every package: esbuild for ESM JS, dts-bundle-generator for one .d.ts per entry.
// Usage: node scripts/build.mjs [--only core,web] [--no-dts]
import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { PACKAGES } from './packages.mjs'

const args = process.argv.slice(2)
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null
const withDts = !args.includes('--no-dts')
const root = resolve(import.meta.dirname, '..')
const require = createRequire(import.meta.url)
const declarationCli = withDts ? require.resolve('dts-bundle-generator/dist/bin/dts-bundle-generator.js') : null

for (const pkg of PACKAGES) {
  if (only !== null && !only.includes(pkg.dir)) continue
  const dir = join(root, pkg.path)
  if (!existsSync(join(dir, 'src'))) continue
  rmSync(join(dir, 'dist'), { recursive: true, force: true })
  const entryPoints = Object.fromEntries(Object.values(pkg.entries).map(([src, out]) => [out, join(dir, src)]))
  await build({
    entryPoints, outdir: join(dir, 'dist'), bundle: true, splitting: true, format: 'esm', platform: 'neutral',
    target: 'es2022', mainFields: ['module', 'main'], external: [`${pkg.name.split('/')[0]}/*`, ...(pkg.external ?? []), ...Object.keys(pkg.peers ?? {})], logLevel: 'warning', sourcemap: false
  })
  console.log(`js   ${pkg.name}: ${Object.keys(entryPoints).join(', ')}`)
  // The self-contained scripts read the workspace packages from source, not from their built chunks: a chunk keeps every
  // module's top-level statements together, so the bundler cannot drop what this entry never calls (about 4 KB gzip of core
  // in the engine script). Source modules are side-effect free, so unused ones go. The ESM build above is unaffected.
  const alias = {}
  for (const other of PACKAGES) for (const [subpath, [src]] of Object.entries(other.entries)) alias[`${other.name}${subpath === '.' ? '' : subpath.slice(1)}`] = join(root, other.path, src)
  for (const global of [...(pkg.global === undefined ? [] : [pkg.global]), ...(pkg.additionalGlobals ?? [])]) {
    // One self-contained script for pages without a bundler: window.<globalName>, core included.
    await build({
      entryPoints: { [global.file]: join(dir, global.entry) }, outdir: join(dir, 'dist'), bundle: true, format: 'iife', globalName: global.name,
      platform: 'browser', target: 'es2022', mainFields: ['module', 'main'], alias, minify: true, logLevel: 'warning'
    })
    console.log(`js   ${pkg.name}: ${global.file}.js (window.${global.name})`)
  }
  if (!withDts) continue
  const config = {
    compilationOptions: { preferredConfigPath: join(dir, 'tsconfig.json') },
    entries: Object.values(pkg.entries).map(([src, out]) => ({ filePath: join(dir, src), outFile: join(dir, 'dist', `${out}.d.ts`), output: { noBanner: true }, libraries: { inlinedLibraries: [], allowedTypesLibraries: [] } }))
  }
  mkdirSync(join(dir, 'dist'), { recursive: true })
  const cfgPath = join(dir, 'dist', '.dts-bundle.json')
  writeFileSync(cfgPath, JSON.stringify(config))
  const r = spawnSync(process.execPath, [declarationCli, '--config', cfgPath, '--silent'], { stdio: 'inherit', cwd: root })
  rmSync(cfgPath)
  if (r.error || r.status !== 0) { console.error(`dts  ${pkg.name} failed`, r.error ?? ''); process.exit(1) }
  console.log(`dts  ${pkg.name}`)
}
