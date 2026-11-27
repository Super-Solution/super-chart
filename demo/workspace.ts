import { ChartWorkspace } from '@supersolutions/super-chart-web'
import type { Datafeed, Period, SymbolInfo, HistoryRequest } from '@supersolutions/super-chart-core'
import type { MarketBar } from '@supersolutions/super-chart-core'

// This example deliberately has no exchange requests or credentials.
const symbols: SymbolInfo[] = [
  { ticker: 'ALPHA', name: 'Synthetic large-price market', exchange: 'LOCAL', pricePrecision: 2 },
  { ticker: 'BETA', name: 'Synthetic small-price market', exchange: 'LOCAL', pricePrecision: 6 },
  { ticker: 'EMPTY', name: 'Empty market example', exchange: 'LOCAL' }
]
const units: Record<string, number> = { minute: 60_000, hour: 3_600_000, day: 86_400_000 }
const duration = (period: Period): number => {
  const unit = units[period.timespan]
  if (unit === undefined) throw new Error('This demo supports minute, hour and day intervals')
  return unit * period.multiplier
}
const key = (symbol: SymbolInfo, period: Period): string => `${symbol.ticker}:${period.multiplier}:${period.timespan}`
const subscriptions = new Map<string, number>()
const anchor = Date.now()
function candle (symbol: SymbolInfo, timestamp: number, step: number, phase = 0): MarketBar {
  const base = symbol.ticker === 'BETA' ? 0.003 : 120
  const index = timestamp / step
  const open = base * (1 + Math.sin(index * 0.071) * 0.13 + Math.sin(index * 0.013) * 0.04)
  const close = open + base * (Math.sin(index * 0.23 + phase) * 0.008)
  return { timestamp, open, high: Math.max(open, close) + base * 0.004, low: Math.min(open, close) - base * 0.004, close, volume: 1000 + Math.round(Math.abs(Math.sin(index)) * 800) }
}
async function pause (ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted === true) throw new DOMException('Aborted', 'AbortError')
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => { signal?.removeEventListener('abort', cancel); resolve() }, ms)
    const cancel = (): void => { window.clearTimeout(timer); signal?.removeEventListener('abort', cancel); reject(new DOMException('Aborted', 'AbortError')) }
    signal?.addEventListener('abort', cancel, { once: true })
  })
}
const feed: Datafeed = {
  async searchSymbols (search = '', request) {
    await pause(120, request?.signal)
    const query = search.toLowerCase()
    return symbols.filter(symbol => `${symbol.ticker} ${symbol.name}`.toLowerCase().includes(query))
  },
  resolvePeriod (period) {
    return units[period.timespan] !== undefined && Number.isSafeInteger(period.multiplier) && period.multiplier > 0 && period.multiplier <= 1440
      ? { ...period, text: `${period.multiplier} ${period.timespan}` } : null
  },
  async getHistoryKLineData (symbol, period, _from, to, request?: HistoryRequest) {
    await pause(180, request?.signal)
    if (symbol.ticker === 'EMPTY') return { bars: [], noData: true }
    const step = duration(period), newest = Math.floor(anchor / step) * step
    const oldest = newest - 4999 * step
    const end = request?.firstDataRequest === true ? newest : Math.min(newest, Math.ceil(to / step) * step - step)
    const start = Math.max(oldest, end - (Math.min(request?.countBack ?? 1000, 1000) - 1) * step)
    const bars: MarketBar[] = []
    for (let timestamp = start; timestamp <= end; timestamp += step) bars.push(candle(symbol, timestamp, step))
    return { bars, noData: start <= oldest }
  },
  subscribe (symbol, period, callback) {
    const id = key(symbol, period), existing = subscriptions.get(id)
    if (existing !== undefined) window.clearInterval(existing)
    let tick = 0
    const step = duration(period)
    subscriptions.set(id, window.setInterval(() => {
      tick++
      callback(candle(symbol, Math.floor(Date.now() / step) * step, step, tick * 0.1))
    }, 250))
  },
  unsubscribe (symbol, period) {
    const id = key(symbol, period), timer = subscriptions.get(id)
    if (timer !== undefined) window.clearInterval(timer)
    subscriptions.delete(id)
  }
}
// ?theme=light, ?layout=compact and ?rail=off try the default chrome without code changes.
const query = new URLSearchParams(window.location.search)
const workspace = new ChartWorkspace(document.querySelector<HTMLElement>('#workspace')!, {
  datafeed: feed, symbol: symbols[0], period: { multiplier: 1, timespan: 'minute', text: '1m' },
  theme: query.get('theme') ?? undefined,
  ui: { ...(query.has('layout') ? { layout: query.get('layout') as 'compact' } : {}), parts: { toolRail: query.get('rail') !== 'off' } },
  loader: { count: 1000, historyCache: { max: 6 } },
  chart: { count: 160, indicators: [{ name: 'MA', params: [20] }, { name: 'VOL' }], render: { timeZone: 'UTC' }, drawByHolding: true }
})
Object.assign(window, { workspace })
let disposed = false
const dispose = (): void => { disposed = true; workspace.dispose(); for (const timer of subscriptions.values()) window.clearInterval(timer); subscriptions.clear() }
window.addEventListener('pagehide', dispose, { once: true })
if (import.meta.hot !== undefined) import.meta.hot.dispose(dispose)
