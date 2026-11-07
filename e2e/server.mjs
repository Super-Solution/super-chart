// Static local server for the built owned package and existing browser cases.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const port = Number(process.env.SC_E2E_PORT ?? 4179)
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
}

// The cases import the built package as /dist/<entry>.js. The build is now one
// package per layer, so those URLs redirect to each package's dist (a redirect keeps the chunk base URL right), and an
// import map resolves the packages' own bare imports. No case file changes.
const DIST = {
  '/dist/super-chart.js': '/packages/bindings/web/dist/index.js',
  '/dist/super-chart.umd.js': '/packages/bindings/web/dist/super-chart.global.js',
  '/dist/annotations.js': '/packages/bindings/web/dist/annotations.js',
  '/dist/overlays.js': '/packages/bindings/web/dist/overlays.js',
  '/dist/core.js': '/packages/core/dist/index.js',
  '/dist/native.js': '/packages/core/dist/native.js',
  '/dist/indicators.js': '/packages/core/dist/indicators.js',
  '/dist/superscript.js': '/packages/superscript/dist/index.js',
  '/dist/scripts.js': '/packages/superscript/dist/scripts.js'
}
const IMPORT_MAP = '<script type="importmap">' + JSON.stringify({ imports: {
  '@supersolutions/super-chart-core': '/packages/core/dist/index.js',
  '@supersolutions/super-chart-core/native': '/packages/core/dist/native.js',
  '@supersolutions/super-chart-core/indicators': '/packages/core/dist/indicators.js',
  '@supersolutions/super-chart-superscript': '/packages/superscript/dist/index.js',
  '@supersolutions/super-chart-superscript/scripts': '/packages/superscript/dist/scripts.js',
  '@supersolutions/super-chart-web': '/packages/bindings/web/dist/index.js',
  '@supersolutions/super-chart-web/annotations': '/packages/bindings/web/dist/annotations.js',
  '@supersolutions/super-chart-web/overlays': '/packages/bindings/web/dist/overlays.js'
} }) + '</script>'

createServer(async (req, res) => {
  const requested = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname))
  if (DIST[requested] !== undefined) { res.writeHead(302, { location: DIST[requested] }).end(); return }
  const path = requested
  const file = join(root, path)
  if (file !== root && !file.startsWith(root + sep)) {
    res.writeHead(403).end()
    return
  }
  try {
    let body = await readFile(file)
    if (extname(file) === '.html') body = Buffer.from(String(body).replace('<head>', `<head>${IMPORT_MAP}`))
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
    res.end(body)
  } catch {
    res.writeHead(404).end(`not found: ${path}`)
  }
}).listen(port, '127.0.0.1', () => { console.log(`super-chart e2e server on http://127.0.0.1:${port}`) })
