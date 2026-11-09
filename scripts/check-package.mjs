#!/usr/bin/env node
// Verifies the built packages: manifest/registry agreement, layering, licence,
// banned runtime dependencies, export targets, packed contents and a plain-Node
// import of every entry that must run without a DOM, and a type-check of a consumer
// that imports every entry under both classic and NodeNext module resolution.
// Usage: node scripts/check-package.mjs   (after `node scripts/build.mjs`)
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { PACKAGES, VERSION, AUTHOR, LICENSE, nameOf } from './packages.mjs'

const root = resolve(import.meta.dirname, '..')
const problems = []
const fail = message => problems.push(message)
const BANNED = ['klinecharts', 'solid-js', 'react', 'vue']
const SIZE_BUDGET = { core: 1_000_000, superscript: 400_000, web: 600_000, 'chat-plugin': 200_000 }
const walk = dir => readdirSync(dir).flatMap(f => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p] })
const importsOf = text => [...text.matchAll(/(?:from|import)\s*\(?\s*["']([^"'.][^"']*)["']/g)].map(m => m[1])

for (const pkg of PACKAGES) {
  const dir = join(root, pkg.path)
  if (!existsSync(dir)) { fail(`${pkg.name}: ${pkg.path} is missing`); continue }
  const manifestPath = join(dir, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const at = message => fail(`${pkg.name}: ${message}`)
  if (manifest.name !== pkg.name) at(`package.json name is ${manifest.name}`)
  if (manifest.version !== VERSION) at(`version ${manifest.version} != ${VERSION}`)
  if (manifest.license !== LICENSE) at(`license ${manifest.license} != ${LICENSE}`)
  if (manifest.author !== AUTHOR) at(`author ${manifest.author} != ${AUTHOR}`)
  if (manifest.private === true) at('must not be private')
  if (!existsSync(join(dir, 'LICENSE')) || !readFileSync(join(dir, 'LICENSE'), 'utf8').includes('GNU GENERAL PUBLIC LICENSE')) at('LICENSE is not the GPL text')
  const expectedDeps = [...pkg.deps.map(nameOf), ...(pkg.external ?? [])].sort()
  const actualDeps = Object.keys(manifest.dependencies ?? {}).sort()
  if (JSON.stringify(expectedDeps) !== JSON.stringify(actualDeps)) at(`dependencies ${JSON.stringify(actualDeps)} != ${JSON.stringify(expectedDeps)}`)
  for (const name of [...actualDeps, ...Object.keys(manifest.peerDependencies ?? {})]) if (BANNED.some(b => name === b || name.startsWith(`${b}/`))) at(`banned dependency ${name}`)
  for (const [sub, [, out]] of Object.entries(pkg.entries)) {
    const entry = manifest.exports?.[sub]
    if (entry === undefined) { at(`exports["${sub}"] missing`); continue }
    for (const key of ['types', 'import']) {
      const target = entry[key]
      if (typeof target !== 'string' || !existsSync(join(dir, target))) at(`exports["${sub}"].${key} -> ${target} does not exist (run the build first)`)
    }
    if (entry.import !== `./dist/${out}.js`) at(`exports["${sub}"].import should be ./dist/${out}.js`)
  }
  // Layering: only declared dependencies may be imported, in source and in the build.
  const allowed = new Set([...expectedDeps, ...(pkg.external ?? [])])
  const sources = existsSync(join(dir, 'src')) ? walk(join(dir, 'src')).filter(f => /\.tsx?$/.test(f)) : []
  const built = existsSync(join(dir, 'dist')) ? walk(join(dir, 'dist')).filter(f => /\.(js|d\.ts)$/.test(f)) : []
  for (const file of [...sources, ...built]) {
    const rel = file.slice(root.length + 1)
    if (/\.test\.ts$/.test(file) || /testkit|legacy\.fixture/.test(file)) continue
    for (const spec of importsOf(readFileSync(file, 'utf8'))) {
      const base = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]
      if (base.startsWith('node:')) continue
      if (base === pkg.name) continue
      if (!allowed.has(base)) at(`${rel} imports "${spec}", which is not a declared dependency`)
      if (BANNED.includes(base)) at(`${rel} imports banned "${spec}"`)
    }
  }
  // Packed contents and size.
  const packed = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: dir, encoding: 'utf8' })
  if (packed.status !== 0) { at(`npm pack failed: ${packed.stderr.slice(0, 300)}`); continue }
  const info = JSON.parse(packed.stdout)[0]
  const names = info.files.map(f => f.path)
  for (const name of names) if (!/^(dist\/|LICENSE$|README\.md$|package\.json$)/.test(name)) at(`unexpected packed file ${name}`)
  if (!names.some(n => n.startsWith('dist/'))) at('no dist/ in the package')
  if (info.size > (SIZE_BUDGET[pkg.dir] ?? 500_000)) at(`tarball ${info.size} bytes exceeds the budget`)
  console.log(`ok   ${pkg.name}  ${names.length} files, ${(info.size / 1024).toFixed(0)} kB packed`)
}

// Plain-Node import of the entries that must not need a DOM.
const NODE_SAFE = [['core', ''], ['core', '/native'], ['core', '/indicators'], ['superscript', ''], ['superscript', '/scripts']]
for (const [dir, sub] of NODE_SAFE) {
  const spec = nameOf(dir) + sub
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `const m = await import(${JSON.stringify(spec)}); if (Object.keys(m).length === 0) throw new Error('no exports')`], { cwd: root, encoding: 'utf8' })
  if (r.status !== 0) fail(`plain Node cannot import ${spec}: ${r.stderr.split('\n').find(l => l.trim() !== '') ?? ''}`)
}

// Type-level consumer check: the declaration files must be self-contained and every export-map entry must resolve
// to types under classic and NodeNext resolution, with skipLibCheck off so a broken bundled .d.ts fails here.
// The scratch directory sits under node_modules/.cache so it finds the workspace links.
const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc')
if (existsSync(tsc)) {
  const specs = PACKAGES.flatMap(pkg => {
    const manifest = JSON.parse(readFileSync(join(root, pkg.path, 'package.json'), 'utf8'))
    return Object.keys(manifest.exports ?? {}).map(sub => pkg.name + sub.slice(1))
  })
  const cache = join(root, 'node_modules', '.cache')
  mkdirSync(cache, { recursive: true })
  const scratch = mkdtempSync(join(cache, 'consumer-'))
  try {
    writeFileSync(join(scratch, 'package.json'), '{"type":"module"}\n')
    writeFileSync(join(scratch, 'consumer.ts'), specs.map((spec, i) => `import * as m${i} from ${JSON.stringify(spec)}\n`).join('') + `export const all = [${specs.map((_, i) => `m${i}`).join(', ')}]\n`)
    for (const [label, module, moduleResolution] of [['classic', 'ESNext', 'Node'], ['NodeNext', 'NodeNext', 'NodeNext']]) {
      writeFileSync(join(scratch, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module, moduleResolution, strict: true, skipLibCheck: false, noEmit: true, lib: ['DOM', 'ES2022'], types: [] }, include: ['consumer.ts'] }))
      const r = spawnSync(process.execPath, [tsc, '-p', scratch], { cwd: root, encoding: 'utf8' })
      if (r.status !== 0) fail(`a TypeScript consumer of every entry fails under ${label} resolution: ${r.stdout.split('\n').find(l => l.includes('error')) ?? r.stderr.slice(0, 200)}`)
    }
  } finally { rmSync(scratch, { recursive: true, force: true }) }
}
if (problems.length > 0) { console.error(problems.map(p => `FAIL ${p}`).join('\n')); process.exit(1) }
console.log('package checks passed')
