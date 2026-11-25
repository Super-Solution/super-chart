import type { Datafeed, DatafeedMark, HistoryRequest, MarketBar, MarksRequest, Period, SymbolInfo } from '@supersolutions/super-chart-core'

/**
 * The one mock data source every example shares: no network, no credentials, deterministic history and a ticking last
 * bar. It touches no DOM and no browser global (only timers), so a web, React, Vue or native host can all use it.
 * Several markets on purpose, so every chart state can be tried: a large price, a tiny price, a currency pair, an
 * empty market and one that always fails.
 */
export const SYMBOLS: SymbolInfo[] = [
  { ticker: 'EQUITY', name: 'Synthetic equity (2 decimals)', exchange: 'LOCAL', pricePrecision: 2 },
  { ticker: 'COIN', name: 'Synthetic coin (6 decimals)', exchange: 'LOCAL', pricePrecision: 6 },
  { ticker: 'FX', name: 'Synthetic currency pair (5 decimals)', exchange: 'LOCAL', pricePrecision: 5 },
  { ticker: 'EMPTY', name: 'A market with no data', exchange: 'LOCAL' },
  { ticker: 'BROKEN', name: 'A market whose feed fails', exchange: 'LOCAL' }
]

/** The markets that always load: use these where an example should just show a chart. */
export const MARKETS: SymbolInfo[] = SYMBOLS.filter(symbol => symbol.ticker !== 'EMPTY' && symbol.ticker !== 'BROKEN')

export const PERIODS: Period[] = [
  { multiplier: 1, timespan: 'minute', text: '1m' }, { multiplier: 5, timespan: 'minute', text: '5m' },
  { multiplier: 15, timespan: 'minute', text: '15m' }, { multiplier: 1, timespan: 'hour', text: '1h' },
  { multiplier: 4, timespan: 'hour', text: '4h' }, { multiplier: 1, timespan: 'day', text: '1D' }
]

const UNITS: Record<string, number> = { minute: 60_000, hour: 3_600_000, day: 86_400_000 }
const BASE: Record<string, number> = { EQUITY: 182, COIN: 0.0042, FX: 1.0875, EMPTY: 1, BROKEN: 1 }
const stepOf = (period: Period): number => {
  const unit = UNITS[period.timespan]
  if (unit === undefined) throw new Error('The example feed supports minute, hour and day periods')
  return unit * period.multiplier
}

/** A smooth, repeatable price path: the same timestamp always gives the same bar. */
function bar (symbol: SymbolInfo, timestamp: number, step: number, wobble = 0): MarketBar {
  const base = BASE[symbol.ticker] ?? 100, index = timestamp / step
  const open = base * (1 + Math.sin(index * 0.071) * 0.09 + Math.sin(index * 0.0113) * 0.05 + Math.sin(index * 0.31) * 0.004)
  const close = open + base * (Math.sin(index * 0.23 + wobble) * 0.006)
  return {
    timestamp, open, close,
    high: Math.max(open, close) + base * (0.002 + Math.abs(Math.sin(index * 1.7)) * 0.004),
    low: Math.min(open, close) - base * (0.002 + Math.abs(Math.sin(index * 2.3)) * 0.004),
    volume: 800 + Math.round(Math.abs(Math.sin(index * 0.9)) * 1400)
  }
}

// Not DOMException: a native runtime may not have it, and the chart only looks at the name.
const abortError = (): Error => Object.assign(new Error('Aborted'), { name: 'AbortError' })
const delay = async (ms: number, signal?: AbortSignal): Promise<void> => {
  if (signal?.aborted === true) throw abortError()
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(abortError()) }, { once: true })
  })
}

const DAY = 86_400_000, MINUTE = 60_000
/**
 * Fictional events for `[from, to)`, the same every time: a headline every 53 minutes, a dividend every 30 days, and
 * every 91 days an earnings date with a guidance note on the same bar (so one bar can carry two marks). It is the shape
 * a real feed returns for `getMarks`, with nothing real in it.
 */
export function exampleMarks (symbol: SymbolInfo, from: number, to: number): DatafeedMark[] {
  const marks: DatafeedMark[] = []
  const add = (kind: string, time: number, mark: Omit<DatafeedMark, 'id' | 'time'>): void => { if (time >= from && time < to && marks.length < 900) marks.push({ id: `${symbol.ticker}:${kind}:${time}`, time, ...mark }) }
  for (let slot = Math.ceil(from / (53 * MINUTE)); slot * 53 * MINUTE < to && marks.length < 900; slot++) {
    const time = slot * 53 * MINUTE
    add('news', time, { label: 'N', text: `Headline ${slot} (fictional)`, tone: slot % 5 === 0 ? 'bear' : 'neutral', category: 'news' })
  }
  for (let day = Math.floor(from / DAY); day * DAY < to; day++) {
    if (day % 30 === 5) add('dividend', day * DAY, { label: 'Div 0.24', text: 'Dividend of 0.24 per share (fictional)', tone: 'bull', category: 'dividend' })
    if (day % 91 === 12) {
      add('earnings', day * DAY + 13.5 * 3_600_000, { label: 'Earnings', text: 'Quarterly results, beat the estimate (fictional)', tone: 'accent', category: 'earnings' })
      add('guidance', day * DAY + 13.5 * 3_600_000, { label: 'Guide', text: 'Outlook raised (fictional)', tone: 'accent', category: 'guidance' })
    }
  }
  return marks
}

export interface ExampleFeed {
  datafeed: Datafeed
  /** Turn the ticking last bar on or off (a quiet chart is easier to draw on). */
  setLive: (live: boolean) => void
  isLive: () => boolean
}

export function createFeed (): ExampleFeed {
  const timers = new Map<string, ReturnType<typeof setInterval>>()
  const anchor = Date.now()
  let live = true
  const datafeed: Datafeed = {
    async searchSymbols (search = '', request) {
      await delay(100, request?.signal)
      const query = search.toLowerCase()
      return SYMBOLS.filter(symbol => `${symbol.ticker} ${symbol.name}`.toLowerCase().includes(query))
    },
    resolvePeriod (period) {
      return UNITS[period.timespan] !== undefined && Number.isSafeInteger(period.multiplier) && period.multiplier > 0 && period.multiplier <= 1440
        ? { multiplier: period.multiplier, timespan: period.timespan, text: `${period.multiplier}${period.timespan === 'day' ? 'D' : period.timespan[0]}` } : null
    },
    async getHistoryKLineData (symbol, period, _from, to, request?: HistoryRequest) {
      await delay(160, request?.signal)
      if (symbol.ticker === 'BROKEN') throw new Error('The example feed was asked to fail (this is the BROKEN market)')
      if (symbol.ticker === 'EMPTY') return { bars: [], noData: true }
      const step = stepOf(period), newest = Math.floor(anchor / step) * step, oldest = newest - 5999 * step
      const end = request?.firstDataRequest === true ? newest : Math.min(newest, Math.ceil(to / step) * step - step)
      const start = Math.max(oldest, end - (Math.min(request?.countBack ?? 1000, 1000) - 1) * step)
      const bars: MarketBar[] = []
      for (let timestamp = start; timestamp <= end; timestamp += step) bars.push(bar(symbol, timestamp, step))
      return { bars, noData: start <= oldest }
    },
    async getMarks (symbol, _period, from, to, request?: MarksRequest) {
      await delay(120, request?.signal)
      if (symbol.ticker === 'BROKEN') throw new Error('The example feed was asked to fail (this is the BROKEN market)')
      return symbol.ticker === 'EMPTY' ? [] : exampleMarks(symbol, from, to)
    },
    subscribe (symbol, period, callback) {
      const id = `${symbol.ticker}:${period.text}`, step = stepOf(period)
      clearInterval(timers.get(id))
      let tick = 0
      timers.set(id, setInterval(() => {
        if (!live) return
        tick++
        callback(bar(symbol, Math.floor(Date.now() / step) * step, step, tick * 0.12))
      }, 300))
    },
    unsubscribe (symbol, period) {
      const id = `${symbol.ticker}:${period.text}`
      clearInterval(timers.get(id)); timers.delete(id)
    }
  }
  return { datafeed, setLive: value => { live = value }, isLive: () => live }
}
