import { gunzipSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '../..')
const legacyTar = process.env.SUPER_CHART_LEGACY_TGZ ?? resolve(homedir(), 'AppData/Local/npm-cache/_cacache/content-v2/sha512/98/3c/c9ba82a854f214c5263ce715258ec416a476551f9c8948cf710064abdd356d44d6d46b359eaa19a5aa2264d6147751a9b661118d2407749f161c3e679e4b')
const legacyEngine = process.env.SUPER_CHART_LEGACY_ENGINE ?? resolve(homedir(), '.bun/install/cache/klinecharts@9.8.12@@@1/dist/umd/klinecharts.min.js')
// Reuse the previously published package in memory; do not install or copy it.
const tar = gunzipSync(readFileSync(legacyTar))
const members = new Map<string, Uint8Array>()
for (let offset = 0; offset + 512 <= tar.length;) {
  const name = tar.subarray(offset, offset + 100).toString().replace(/\0.*$/, '')
  if (!name) break
  const size = parseInt(tar.subarray(offset + 124, offset + 136).toString().replace(/\0.*$/, '').trim(), 8)
  if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > tar.length) throw new Error('Invalid legacy package archive')
  if (['package/dist/klinecharts-pro.umd.js', 'package/dist/klinecharts-pro.css'].includes(name)) members.set(name, tar.subarray(offset + 512, offset + 512 + size))
  offset += 512 + Math.ceil(size / 512) * 512
}
for (const name of ['package/dist/klinecharts-pro.umd.js', 'package/dist/klinecharts-pro.css']) if (!members.has(name)) throw new Error('Missing legacy member: ' + name)
const compileOwned = (baseline = false) => {
  const command = [process.execPath, resolve(import.meta.dir, 'build-owned.ts'), root]
  if (baseline) command.push('--baseline')
  const result = Bun.spawnSync(command)
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
  return result.stdout
}
const ownedBefore = compileOwned(true)
const ownedAfter = compileOwned()
const build = await Bun.build({ entrypoints: [resolve(import.meta.dir, 'frame.ts')], target: 'browser', minify: true, external: ['/owned-before.js','/owned-after.js'], plugins: [{ name: 'workspace-source', setup(builder) { builder.onResolve({filter: /^\/owned-/}, args => ({path:args.path,external:true})); builder.onResolve({ filter: /^@supersolutions\/super-chart-(core|web)$/ }, args => ({ path: resolve(root, args.path.endsWith('-core') ? 'packages/core/src/index.ts' : 'packages/bindings/web/src/index.ts') })) } }] })
if (!build.success) throw new Error(build.logs.join('\n'))
const assets = new Map<string, { body: any, type: string }>([
  ['/', { body: Bun.file(resolve(import.meta.dir, 'index.html')), type: 'text/html; charset=utf-8' }],
  ['/bench.html', { body: Bun.file(resolve(import.meta.dir, 'bench.html')), type: 'text/html; charset=utf-8' }],
  ['/owned-before.js', {body:ownedBefore,type:'text/javascript; charset=utf-8'}],
  ['/owned-after.js', {body:ownedAfter,type:'text/javascript; charset=utf-8'}],
  ['/frame.html', { body: Bun.file(resolve(import.meta.dir, 'frame.html')), type: 'text/html; charset=utf-8' }],
  ['/frame.js', { body: build.outputs[0], type: 'text/javascript; charset=utf-8' }],
  ['/legacy-engine.js', { body: Bun.file(legacyEngine), type: 'text/javascript; charset=utf-8' }],
  ['/legacy-pro.js', { body: members.get('package/dist/klinecharts-pro.umd.js')!, type: 'text/javascript; charset=utf-8' }],
  ['/legacy.css', { body: members.get('package/dist/klinecharts-pro.css')!, type: 'text/css; charset=utf-8' }]
])
const server = Bun.serve({
  hostname: '127.0.0.1', port: Number(process.env.PORT ?? 4317),
  fetch(request) {
    const path = new URL(request.url).pathname
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 })
    const asset = assets.get(path)
    if (!asset) return new Response('Not found', { status: 404 })
    return new Response(request.method === 'HEAD' ? null : asset.body, { headers: {
      'Content-Type': asset.type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; frame-src 'self'; object-src 'none'; base-uri 'none'"
    } })
  }
})
console.log('Super Chart comparison: ' + server.url)
console.log('Local synthetic data only. No dependencies installed; legacy bundle reused from cache.')
