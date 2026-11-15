#!/usr/bin/env node
// Reproducible browser benchmark. Drives demo/benchmark.html in headless Chromium and prints one JSON result
// (frame-interval percentiles for pan, zoom and live updates; long tasks; load time; market-switch latency and heap
// growth; DOM nodes left after dispose). Synthetic data only.
//
//   node scripts/benchmark.mjs [--bars 50000] [--indicators 5] [--steps 180] [--live-hz 50] [--live-seconds 4]
//                              [--switches 40] [--mobile] [--cpu-throttle 4] [--out results.json]
//
// Needs Playwright with a Chromium build (`npm i -D playwright` or an existing install on NODE_PATH). It starts its
// own Vite server on a free port. See docs/BENCHMARKS.md for how to read the numbers and what they do not mean.
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import { createServer } from 'vite'
import { resolve } from 'node:path'

const args = process.argv.slice(2)
const option = (name, fallback) => { const i = args.indexOf(`--${name}`); return i === -1 ? fallback : args[i + 1] }
const flag = name => args.includes(`--${name}`)
const config = {
  bars: Number(option('bars', 50000)), indicators: Number(option('indicators', 5)), steps: Number(option('steps', 180)),
  liveHz: Number(option('live-hz', 50)), liveSeconds: Number(option('live-seconds', 4)), switches: Number(option('switches', 40))
}
const root = resolve(import.meta.dirname, '..')
const require = createRequire(import.meta.url)
let playwright
try { playwright = require('playwright') } catch { try { playwright = require(require.resolve('playwright', { paths: [process.env.NODE_PATH ?? '', root] })) } catch { console.error('Playwright is not installed: npm i -D playwright, then npx playwright install chromium'); process.exit(2) } }

const server = await createServer({ root, server: { port: 0, host: '127.0.0.1' }, logLevel: 'error' })
await server.listen()
const url = `http://127.0.0.1:${server.httpServer.address().port}/demo/benchmark.html`
// --expose-gc lets the page collect before it reads the heap; --enable-precise-memory-info makes usedJSHeapSize exact.
const browser = await playwright.chromium.launch({ args: ['--js-flags=--expose-gc', '--enable-precise-memory-info'] })
try {
  const mobile = flag('mobile') ? playwright.devices['Pixel 7'] : { viewport: { width: 1280, height: 800 } }
  const context = await browser.newContext({ ...mobile, deviceScaleFactor: mobile.deviceScaleFactor ?? 1 })
  const page = await context.newPage()
  const failures = []
  page.on('pageerror', error => failures.push(String(error)))
  if (flag('mobile') || option('cpu-throttle', null) !== null) {
    const client = await context.newCDPSession(page)
    await client.send('Emulation.setCPUThrottlingRate', { rate: Number(option('cpu-throttle', 4)) })
  }
  await page.goto(url)
  await page.waitForFunction(() => typeof window.runBenchmark === 'function')
  const result = await page.evaluate(configuration => window.runBenchmark(configuration), config)
  const output = { ...result, mobile: flag('mobile'), cpuThrottle: option('cpu-throttle', flag('mobile') ? '4' : '1'), pageErrors: failures }
  const text = JSON.stringify(output, null, 2)
  if (option('out', null) !== null) writeFileSync(option('out', null), text + '\n')
  console.log(text)
  if (failures.length > 0) process.exitCode = 1
} finally { await browser.close(); await server.close() }
