import type { Datafeed, MarketBar, Period, SymbolInfo } from '@supersolutions/super-chart-core'

/** Two synthetic markets and a ticking feed: no network, no credentials. */
export const SYMBOLS: SymbolInfo[] = [
  { ticker: 'ALPHA', name: 'Synthetic large-price market', exchange: 'LOCAL', pricePrecision: 2 },
  { ticker: 'BETA', name: 'Synthetic small-price market', exchange: 'LOCAL', pricePrecision: 4 }
]
const UNIT: Record<string, number> = { minute: 60_000, hour: 3_600_000, day: 86_400_000 }
const step = (period: Period): number => (UNIT[period.timespan] ?? 60_000) * period.multiplier
const base = (symbol: SymbolInfo): number => symbol.ticker === 'BETA' ? 0.8 : 120
function bar (symbol: SymbolInfo, timestamp: number, size: number, wiggle = 0): MarketBar {
  const index = timestamp / size, price = base(symbol), open = price * (1 + Math.sin(index * 0.07) * 0.1)
  const close = open + price * Math.sin(index * 0.23 + wiggle) * 0.01
  return { timestamp, open, close, high: Math.max(open, close) + price * 0.004, low: Math.min(open, close) - price * 0.004, volume: 1000 + Math.abs(Math.sin(index)) * 800 }
}

// One feed object for the whole app: a new feed would be a new data source, and the chart would mount again.
const timers = new Map<string, number>()
export const datafeed: Datafeed = {
  searchSymbols: async (query = '') => SYMBOLS.filter(symbol => `${symbol.ticker} ${symbol.name}`.toLowerCase().includes(query.toLowerCase())),
  resolvePeriod: period => UNIT[period.timespan] === undefined ? null : { ...period, text: `${period.multiplier} ${period.timespan}` },
  getHistoryKLineData: async (symbol, period, _from, to, request) => {
    const size = step(period), newest = Math.floor(Date.now() / size) * size
    const end = request?.firstDataRequest === true ? newest : Math.min(newest, Math.ceil(to / size) * size - size)
    const count = Math.min(request?.countBack ?? 500, 500)
    return { bars: Array.from({ length: count }, (_, i) => bar(symbol, end - (count - 1 - i) * size, size)), noData: false }
  },
  subscribe: (symbol, period, callback) => {
    const key = `${symbol.ticker}:${period.multiplier}${period.timespan}`, size = step(period)
    window.clearInterval(timers.get(key))
    let tick = 0
    timers.set(key, window.setInterval(() => callback(bar(symbol, Math.floor(Date.now() / size) * size, size, ++tick * 0.1)), 500))
  },
  unsubscribe: (symbol, period) => {
    const key = `${symbol.ticker}:${period.multiplier}${period.timespan}`
    window.clearInterval(timers.get(key)); timers.delete(key)
  }
}
