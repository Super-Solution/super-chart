import { EngineChart, ChartWorkspace } from '@supersolutions/super-chart-web'
import type { Datafeed, MarketBar, Period, SymbolInfo } from '@supersolutions/super-chart-core'

/**
 * Benchmark scenarios for scripts/benchmark.mjs. Synthetic data only; nothing here touches a network.
 * Every number is measured in this page with the browser's own clocks and returned as plain JSON.
 */
export interface BenchmarkConfig {
  bars: number
  indicators: number
  steps: number
  liveHz: number
  liveSeconds: number
  switches: number
}
interface Stats { count: number, p50: number, p95: number, p99: number, max: number, over25: number }
const stats = (values: number[]): Stats => {
  const sorted = [...values].sort((a, b) => a - b), at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0
  return { count: sorted.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: sorted[sorted.length - 1] ?? 0, over25: sorted.filter(value => value > 25).length }
}
const frame = async (): Promise<number> => await new Promise<number>(resolve => requestAnimationFrame(resolve))
const bar = (i: number): MarketBar => {
  const open = 100 + Math.sin(i / 47) * 8, close = 100 + Math.sin((i + 1) / 47) * 8
  return { timestamp: 1_700_000_000_000 + i * 60_000, open, close, high: Math.max(open, close) + 0.3, low: Math.min(open, close) - 0.3, volume: 100 + i % 99 }
}
interface Measured { frameGapMs: Stats, flushCpuMs: Stats }
/**
 * Runs `work` once per animation frame. `frameGapMs` is the interval between frames (headless Chromium is vsync-bound,
 * so a healthy chart reads ~16.7); `flushCpuMs` is the chart's own time to build and paint each flush, which is what
 * actually moves when the renderer gets slower or faster.
 */
async function paced (chart: EngineChart, steps: number, work: (step: number) => void): Promise<Measured> {
  const gaps: number[] = [], flush: number[] = []
  let last = await frame()
  for (let step = 0; step < steps; step++) { work(step); const now = await frame(); gaps.push(now - last); flush.push(chart.getMetrics().lastFrameMs); last = now }
  return { frameGapMs: stats(gaps), flushCpuMs: stats(flush) }
}
function longTasks (): { stop: () => { count: number, totalMs: number } } {
  const entries: number[] = []
  const observer = new PerformanceObserver(list => { for (const entry of list.getEntries()) entries.push(entry.duration) })
  try { observer.observe({ type: 'longtask', buffered: false }) } catch { /* not supported: reported as zero */ }
  return { stop: () => { observer.disconnect(); return { count: entries.length, totalMs: entries.reduce((a, b) => a + b, 0) } } }
}
const heap = (): number | null => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null
async function settle (): Promise<void> {
  const collect = (window as unknown as { gc?: () => void }).gc
  collect?.(); await frame(); await frame(); collect?.()
}

const INDICATORS = ['MA', 'EMA', 'BOLL', 'RSI', 'MACD', 'KDJ', 'VOL']
async function engineScenarios (config: BenchmarkConfig): Promise<Record<string, unknown>> {
  const host = document.getElementById('chart')!
  host.replaceChildren()
  const data = Array.from({ length: config.bars }, (_, i) => bar(i))
  const t0 = performance.now()
  const chart = new EngineChart(host, { count: 160 })
  chart.setData(data)
  for (let i = 0; i < config.indicators; i++) chart.addIndicator({ name: INDICATORS[i % INDICATORS.length] })
  await frame(); await frame()
  const result: Record<string, unknown> = { loadMs: performance.now() - t0 }
  const tasks = longTasks()
  const view = chart.view, span = 160
  result.pan = await paced(chart, config.steps, step => { const end = config.bars - 1 - step * 5; view.setViewport({ i0: end - span, i1: end }) })
  result.zoom = await paced(chart, config.steps, step => { const width = 60 + (step % 120) * 4, end = config.bars - 1; view.setViewport({ i0: end - width, i1: end }) })
  view.setViewport({ i0: config.bars - 1 - span, i1: config.bars - 1 })
  await frame()
  // High-frequency updates: one tick every 1000/Hz ms for `liveSeconds`, counting what actually ran.
  let ticks = 0, tick = 0
  const gaps: number[] = [], flush: number[] = []
  const interval = window.setInterval(() => { const next = bar(config.bars - 1); next.close += Math.sin(++tick / 9) * 0.1; chart.update(next); ticks++ }, 1000 / config.liveHz)
  let last = await frame()
  const until = performance.now() + config.liveSeconds * 1000
  while (performance.now() < until) { const now = await frame(); gaps.push(now - last); flush.push(chart.getMetrics().lastFrameMs); last = now }
  window.clearInterval(interval)
  result.live = { targetHz: config.liveHz, ticks, actualHz: ticks / config.liveSeconds, frameGapMs: stats(gaps), flushCpuMs: stats(flush) }
  result.longTasks = tasks.stop()
  await settle()
  result.heapBytes = heap()
  chart.dispose()
  return result
}

const SYMBOLS: SymbolInfo[] = [{ ticker: 'ALPHA', exchange: 'LOCAL', pricePrecision: 2 }, { ticker: 'BETA', exchange: 'LOCAL', pricePrecision: 2 }]
const feed: Datafeed = {
  searchSymbols: async () => SYMBOLS,
  resolvePeriod: period => ({ ...period, text: `${period.multiplier} ${period.timespan}` }),
  getHistoryKLineData: async (symbol, _period, _from, _to, request) => {
    const count = Math.min(request?.countBack ?? 1000, 1000), offset = symbol.ticker === 'BETA' ? 500 : 0
    return { bars: Array.from({ length: count }, (_, i) => bar(i + offset)), noData: true }
  },
  subscribe: () => {}, unsubscribe: () => {}
}
async function switchScenario (config: BenchmarkConfig): Promise<Record<string, unknown>> {
  const host = document.getElementById('chart')!
  host.replaceChildren()
  const period: Period = { multiplier: 1, timespan: 'minute', text: '1m' }
  const workspace = new ChartWorkspace(host, { datafeed: feed, symbol: SYMBOLS[0], period, chart: { indicators: [{ name: 'MA', params: [20] }, { name: 'VOL' }] } })
  await workspace.ready
  await settle()
  const before = heap(), latency: number[] = []
  for (let i = 0; i < config.switches; i++) {
    const started = performance.now()
    await workspace.setMarket(SYMBOLS[(i + 1) % 2], period)
    await frame()
    latency.push(performance.now() - started)
  }
  await settle()
  const after = heap(), dom = document.getElementsByTagName('*').length
  workspace.dispose()
  await settle()
  return { switches: stats(latency), heapBeforeBytes: before, heapAfterBytes: after, heapGrowthBytes: before === null || after === null ? null : after - before, domNodesWhileMounted: dom, domNodesAfterDispose: document.getElementsByTagName('*').length }
}

declare global { interface Window { runBenchmark: (config: BenchmarkConfig) => Promise<Record<string, unknown>> } }
window.runBenchmark = async config => {
  const engine = await engineScenarios(config)
  const switching = await switchScenario(config)
  const result = { config, userAgent: navigator.userAgent, devicePixelRatio: devicePixelRatio, viewport: [innerWidth, innerHeight], engine, switching }
  document.getElementById('out')!.textContent = JSON.stringify(result, null, 2)
  return result
}
