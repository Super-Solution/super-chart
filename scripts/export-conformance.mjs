#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright 2026 SUPER SOLUTION LABS INC
// Writes conformance/indicators.v1.json: language-neutral cases generated from the TypeScript
// reference (packages/core/src/ta.ts). Go and Python ports must reproduce every series within the
// stated tolerance. With --check it regenerates in memory and fails if the file drifted.
// Usage: node scripts/export-conformance.mjs [--check]
import { build } from 'esbuild'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const out = mkdtempSync(join(tmpdir(), 'sc-conformance-'))
await build({ entryPoints: [join(root, 'packages/core/src/ta.ts')], outfile: join(out, 'ta.mjs'), bundle: true, format: 'esm', platform: 'node', logLevel: 'error' })
const ta = await import(pathToFileURL(join(out, 'ta.mjs')).href)
rmSync(out, { recursive: true, force: true })

let seed = 20261107
const rand = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n }
const pick = items => items[rand(items.length)]
const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d

/** A random-walk price series; `gaps` puts nulls at the start and in the middle. */
function walk(n, gaps) {
  let price = 100 + rand(900)
  const series = []
  for (let i = 0; i < n; i++) {
    price = Math.max(0.5, price * (1 + (rand(2001) - 1000) / 40000))
    series.push(round(price, pick([2, 4, 8])))
  }
  if (gaps) {
    for (let i = 0; i < rand(4); i++) series[i] = null
    const at = 10 + rand(Math.max(1, n - 20))
    for (let i = 0; i < 1 + rand(3); i++) series[at + i] = null
  }
  return series
}
const candles = (n, gaps) => {
  const close = walk(n, gaps)
  const high = close.map(c => c == null ? null : round(c * (1 + rand(300) / 10000), 4))
  const low = close.map(c => c == null ? null : round(c * (1 - rand(300) / 10000), 4))
  return { high, low, close }
}

const cases = []
const finiteOnly = (value, fn) => {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`${fn} produced ${value}; JSON cannot carry it`)
  if (value && typeof value === 'object') for (const item of Object.values(value)) finiteOnly(item, fn)
}
const add = (fn, args, run, tolerance = 1e-12) => {
  const expect = run(args)
  finiteOnly(expect, fn)
  cases.push({ fn, args, tolerance, expect })
}
for (const fn of ['sma', 'ema', 'rma', 'rsi']) {
  for (const len of [1, 2, 5, 9, 14, 20]) {
    add(fn, { src: walk(pick([30, 60, 120]), false), len }, a => ta[fn](a.src, a.len))
    add(fn, { src: walk(pick([40, 90]), true), len }, a => ta[fn](a.src, a.len))
  }
  for (const len of [0, -3, 2.5]) add(fn, { src: walk(20, false), len }, a => ta[fn](a.src, a.len))
  add(fn, { src: walk(4, false), len: 14 }, a => ta[fn](a.src, a.len))
  add(fn, { src: [], len: 5 }, a => ta[fn](a.src, a.len))
}
// Constant and strictly monotonic series hit the RSI edge cases (all gains, no gains, flat).
for (const src of [Array(30).fill(10), Array.from({ length: 30 }, (_, i) => 10 + i), Array.from({ length: 30 }, (_, i) => 100 - i)]) add('rsi', { src, len: 14 }, a => ta.rsi(a.src, a.len))
for (const [len, mult] of [[5, 2], [20, 2], [20, 1.5], [10, 0.5]]) {
  add('stdev', { src: walk(80, false), len }, a => ta.stdev(a.src, a.len), 1e-9)
  add('bollinger', { src: walk(80, len === 10), len, mult }, a => ta.bollinger(a.src, a.len, a.mult), 1e-9)
}
for (const [fast, slow, signal] of [[12, 26, 9], [3, 6, 4], [5, 35, 5], [1, 2, 1]]) {
  add('macd', { src: walk(120, false), fast, slow, signal }, a => ta.macd(a.src, a.fast, a.slow, a.signal))
  add('macd', { src: walk(100, true), fast, slow, signal }, a => ta.macd(a.src, a.fast, a.slow, a.signal))
}
for (const len of [1, 5, 14]) {
  const c = candles(60, false)
  add('trueRange', c, a => ta.trueRange(a.high, a.low, a.close))
  add('atr', { ...c, len }, a => ta.atr(a.high, a.low, a.close, a.len))
  add('atr', { ...candles(70, true), len }, a => ta.atr(a.high, a.low, a.close, a.len))
}

// ---- second batch: moving averages, extremes, signals, OHLCV indicators --------------------------
const volume = n => Array.from({ length: n }, () => pick([0, 0, 1, rand(5000), rand(100000)]))
/** A coarse series on a 5-point grid so that two of them tie and cross often. */
const coarse = (n, gaps) => {
  const series = Array.from({ length: n }, () => pick([10, 11, 12, 13, 14]))
  if (gaps) { series[2] = null; series[7 + rand(5)] = null }
  return series
}
for (const len of [1, 2, 5, 9, 14, 20]) {
  add('wma', { src: walk(pick([30, 60, 120]), false), len }, a => ta.wma(a.src, a.len))
  add('wma', { src: walk(pick([40, 90]), true), len }, a => ta.wma(a.src, a.len))
  add('highest', { src: walk(pick([30, 80]), false), len }, a => ta.highest(a.src, a.len))
  add('highest', { src: walk(70, true), len }, a => ta.highest(a.src, a.len))
  add('lowest', { src: walk(pick([30, 80]), false), len }, a => ta.lowest(a.src, a.len))
  add('lowest', { src: walk(70, true), len }, a => ta.lowest(a.src, a.len))
  add('dev', { src: walk(60, len % 2 === 0), len }, a => ta.dev(a.src, a.len), 1e-9)
}
for (const len of [0, -2, 1.5]) for (const fn of ['wma', 'highest', 'lowest', 'dev', 'hma']) add(fn, { src: walk(20, false), len }, a => ta[fn](a.src, a.len))
for (const fn of ['wma', 'highest', 'lowest', 'hma']) { add(fn, { src: [], len: 3 }, a => ta[fn](a.src, a.len)); add(fn, { src: walk(3, false), len: 9 }, a => ta[fn](a.src, a.len)) }
for (const len of [1, 2, 3, 4, 9, 16, 20, 49]) {
  add('hma', { src: walk(120, false), len }, a => ta.hma(a.src, a.len), 1e-9)
  add('hma', { src: walk(100, true), len }, a => ta.hma(a.src, a.len), 1e-9)
}
for (const len of [1, 3, 10, 20]) {
  const n = pick([40, 80])
  add('vwma', { src: walk(n, false), volume: volume(n), len }, a => ta.vwma(a.src, a.volume, a.len), 1e-9)
  add('vwma', { src: walk(n, true), volume: volume(n), len }, a => ta.vwma(a.src, a.volume, a.len), 1e-9)
}
add('vwma', { src: walk(30, false), volume: Array(30).fill(0), len: 5 }, a => ta.vwma(a.src, a.volume, a.len))
for (const len of [1, 2, 3, 10, 50]) {
  add('change', { src: walk(30, false), len }, a => ta.change(a.src, a.len))
  add('change', { src: walk(30, true), len }, a => ta.change(a.src, a.len))
  add('mom', { src: walk(30, true), len }, a => ta.mom(a.src, a.len))
  add('roc', { src: walk(30, false), len }, a => ta.roc(a.src, a.len))
  add('roc', { src: [5, 0, 3, null, 0, 2, 4, 0, 1], len }, a => ta.roc(a.src, a.len))
}
for (const fn of ['crossover', 'crossunder', 'cross']) {
  for (let i = 0; i < 6; i++) add(fn, { a: coarse(40, i % 2 === 1), b: coarse(40, i % 3 === 0) }, x => ta[fn](x.a, x.b))
  add(fn, { a: [], b: [] }, x => ta[fn](x.a, x.b))
}
for (let i = 0; i < 4; i++) add('cum', { src: walk(30, i % 2 === 1) }, a => ta.cum(a.src))
add('cum', { src: [], }, a => ta.cum(a.src))
for (let i = 0; i < 6; i++) {
  const cond = Array.from({ length: 30 }, () => pick([0, 0, 0, 1, null, 2, -1]))
  add('barssince', { cond }, a => ta.barssince(a.cond))
}
add('barssince', { cond: [] }, a => ta.barssince(a.cond))
for (const gaps of [false, true, false, true]) {
  const n = 60, c = candles(n, gaps)
  add('obv', { close: c.close, volume: volume(n) }, a => ta.obv(a.close, a.volume), 1e-9)
  add('vwap', { ...c, volume: volume(n) }, a => ta.vwap(a.high, a.low, a.close, a.volume), 1e-9)
  for (const len of [1, 5, 14, 20]) {
    add('cci', { ...candles(n, gaps), len }, a => ta.cci(a.high, a.low, a.close, a.len), 1e-9)
    add('mfi', { ...candles(n, gaps), volume: volume(n), len }, a => ta.mfi(a.high, a.low, a.close, a.volume, a.len), 1e-9)
    add('stochK', { ...candles(n, gaps), len }, a => ta.stochK(a.high, a.low, a.close, a.len), 1e-9)
  }
  add('sar', { ...c, start: 0.02, inc: 0.02, max: 0.2 }, a => ta.sar(a.high, a.low, a.start, a.inc, a.max), 1e-9)
  add('sar', { ...candles(n, gaps), start: 0.01, inc: 0.03, max: 0.3 }, a => ta.sar(a.high, a.low, a.start, a.inc, a.max), 1e-9)
}
add('sar', { high: [1], low: [0], start: 0.02, inc: 0.02, max: 0.2 }, a => ta.sar(a.high, a.low, a.start, a.inc, a.max))
add('sar', { high: [], low: [], start: 0.02, inc: 0.02, max: 0.2 }, a => ta.sar(a.high, a.low, a.start, a.inc, a.max))
// A steady trend pushes the acceleration factor into its cap, then a reversal resets it.
const trendHigh = Array.from({ length: 40 }, (_, i) => (i < 30 ? 100 + i * 2 : 160 - (i - 30) * 6))
add('sar', { high: trendHigh, low: trendHigh.map(x => x - 1.5), start: 0.02, inc: 0.05, max: 0.15 }, a => ta.sar(a.high, a.low, a.start, a.inc, a.max), 1e-9)
add('sar', { high: trendHigh.map(x => 300 - x), low: trendHigh.map(x => 300 - x - 1.5), start: 0.02, inc: 0.05, max: 0.15 }, a => ta.sar(a.high, a.low, a.start, a.inc, a.max), 1e-9)
for (const len of [1, 3, 14]) {
  add('stoch', { src: walk(60, false), len }, a => ta.stoch(a.src, a.len), 1e-9)
  add('stoch', { src: Array(20).fill(5), len }, a => ta.stoch(a.src, a.len))
}
for (const [rsiLen, stochLen, kLen, dLen] of [[14, 14, 3, 3], [5, 5, 1, 1], [7, 3, 2, 4], [2, 2, 2, 2]]) {
  add('stochRsi', { src: walk(120, false), rsiLen, stochLen, kLen, dLen }, a => ta.stochRsi(a.src, a.rsiLen, a.stochLen, a.kLen, a.dLen), 1e-9)
  add('stochRsi', { src: walk(100, true), rsiLen, stochLen, kLen, dLen }, a => ta.stochRsi(a.src, a.rsiLen, a.stochLen, a.kLen, a.dLen), 1e-9)
}
for (const [len, mult] of [[5, 2], [20, 2], [20, 1.5], [10, 0.5]]) {
  add('bbPercent', { src: walk(80, false), len, mult }, a => ta.bbPercent(a.src, a.len, a.mult), 1e-9)
  add('bbPercent', { src: walk(80, true), len, mult }, a => ta.bbPercent(a.src, a.len, a.mult), 1e-9)
}
add('bbPercent', { src: Array(30).fill(7), len: 5, mult: 2 }, a => ta.bbPercent(a.src, a.len, a.mult))
for (const [len, mult, atrLen] of [[20, 2, 10], [5, 1.5, 5], [3, 1, 2]]) {
  add('keltner', { ...candles(70, false), len, mult, atrLen }, a => ta.keltner(a.high, a.low, a.close, a.len, a.mult, a.atrLen), 1e-9)
  add('keltner', { ...candles(70, true), len, mult, atrLen }, a => ta.keltner(a.high, a.low, a.close, a.len, a.mult, a.atrLen), 1e-9)
}

const text = `${JSON.stringify({
  version: 1,
  note: 'Generated by scripts/export-conformance.mjs from packages/core/src/ta.ts. Series hold numbers or null. Compare each value with abs(got - want) <= tolerance * max(1, abs(want)); null must match null.',
  cases
})}\n`
const file = join(root, 'conformance', 'indicators.v1.json')
if (process.argv.includes('--check')) {
  if (readFileSync(file, 'utf8') !== text) { console.error('conformance/indicators.v1.json drifted from packages/core/src/ta.ts; rerun without --check and review the diff'); process.exit(1) }
  console.log(`conformance/indicators.v1.json matches the reference (${cases.length} cases)`)
} else {
  writeFileSync(file, text)
  const counts = {}
  for (const c of cases) counts[c.fn] = (counts[c.fn] ?? 0) + 1
  console.log(`${cases.length} cases`, counts)
}
