import type { Datafeed, DatafeedSubscribeCallback, HistoryRequest, HistoryResult, MarketBar, Period, SymbolInfo } from '@supersolutions/super-chart-core'

/** A Datafeed over the HTTP contract in docs/DATAFEED-HTTP.md. Point `baseUrl` at your own server or the Super Solution relay. */
export interface HttpDatafeedOptions {
  baseUrl: string
  /** Sent as `Authorization: Bearer <token>`. Called for every request so a short-lived token can be refreshed. */
  token?: () => string | Promise<string>
  /** How often the newest bar is polled while subscribed. Default 5000 ms. */
  pollMs?: number
  fetch?: typeof fetch
}

const UNIT: Record<string, string> = { second: 's', minute: 'm', hour: 'h', day: 'd', week: 'w', month: 'M', year: 'y' }

/** 1 minute -> "1m", 4 hours -> "4h", 1 month -> "1M". */
export function periodToken (period: Pick<Period, 'multiplier' | 'timespan'>): string {
  const unit = UNIT[period.timespan]
  if (unit === undefined) throw new Error(`Unsupported timespan "${period.timespan}".`)
  return `${period.multiplier}${unit}`
}

export class HttpDatafeedError extends Error {
  constructor (readonly status: number, readonly code: string, message: string) {
    super(message)
    this.name = 'HttpDatafeedError'
  }
}

export function createHttpDatafeed (options: HttpDatafeedOptions): Datafeed {
  const base = options.baseUrl.replace(/\/+$/, '')
  const doFetch = options.fetch ?? fetch
  const timers = new Map<string, ReturnType<typeof setInterval>>()

  async function get<T> (path: string, params: Record<string, string | number | undefined>, signal?: AbortSignal): Promise<T> {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') query.set(key, String(value))
    const headers: Record<string, string> = { accept: 'application/json' }
    if (options.token !== undefined) headers.authorization = `Bearer ${await options.token()}`
    const response = await doFetch(`${base}${path}?${query}`, { headers, signal })
    if (response.ok) return await response.json() as T
    let code = 'http_error', message = `HTTP ${response.status}`
    try {
      const body = await response.json() as { error?: { code?: string, message?: string } }
      code = body.error?.code ?? code
      message = body.error?.message ?? message
    } catch { /* not JSON: keep the status text */ }
    throw new HttpDatafeedError(response.status, code, message)
  }

  const identity = (symbol: SymbolInfo, period: Period): Record<string, string | undefined> =>
    ({ ticker: symbol.ticker, market: symbol.market, exchange: symbol.exchange, period: periodToken(period) })

  return {
    async searchSymbols (search, request) {
      const body = await get<{ symbols: SymbolInfo[] }>('/v1/symbols', { search }, request?.signal)
      return body.symbols
    },

    async getHistoryKLineData (symbol, period, from, to, request?: HistoryRequest): Promise<HistoryResult> {
      const body = await get<{ bars: MarketBar[], noData?: boolean }>(
        '/v1/bars', { ...identity(symbol, period), from, to, limit: request?.countBack }, request?.signal)
      return { bars: body.bars, noData: body.noData === true }
    },

    // Polling keeps the contract usable behind any proxy; a relay may also offer a stream (see the doc).
    subscribe (symbol: SymbolInfo, period: Period, callback: DatafeedSubscribeCallback) {
      const key = `${symbol.ticker}|${periodToken(period)}`
      let newest = 0
      let busy = false
      const tick = async (): Promise<void> => {
        if (busy) return
        busy = true
        try {
          const body = await get<{ bars: MarketBar[] }>('/v1/bars', { ...identity(symbol, period), from: newest || undefined, limit: newest === 0 ? 1 : 50 })
          if (body.bars.length > 0) {
            newest = body.bars[body.bars.length - 1].timestamp
            callback(body.bars)
          }
        } catch { /* a failed poll is retried on the next tick */ } finally { busy = false }
      }
      timers.set(key, setInterval(() => { void tick() }, options.pollMs ?? 5000))
    },

    unsubscribe (symbol: SymbolInfo, period: Period) {
      const key = `${symbol.ticker}|${periodToken(period)}`
      clearInterval(timers.get(key))
      timers.delete(key)
    }
  }
}
