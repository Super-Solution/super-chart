import type { Datafeed, DatafeedSubscribeCallback, HistoryRequest, HistoryResult, MarketBar, Period, SymbolInfo } from '@supersolutions/super-chart-core'

/** A Datafeed over the HTTP contract in docs/DATAFEED-HTTP.md. Point `baseUrl` at your own server or the Super Solution relay. */
export interface HttpDatafeedOptions {
  baseUrl: string
  /** Sent as `Authorization: Bearer <token>`. Called for every request so a short-lived token can be refreshed. */
  token?: () => string | Promise<string>
  /** How often the newest bar is polled while subscribed. Default 5000 ms. */
  pollMs?: number
  /** Give up on a request after this long (a hung server must not stall polling for good). Default 10000 ms; 0 disables. */
  timeoutMs?: number
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
  const subscriptions = new Map<string, { timer: ReturnType<typeof setInterval>, abort: AbortController }>()
  const timeoutMs = options.timeoutMs ?? 10_000

  /** The caller's signal and the request timeout as one signal. */
  function withTimeout (signal?: AbortSignal): { signal: AbortSignal | undefined, done: () => void } {
    if (timeoutMs <= 0) return { signal, done: () => {} }
    const controller = new AbortController()
    const abort = (): void => controller.abort(signal?.reason)
    if (signal?.aborted === true) abort()
    else signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(() => controller.abort(new Error(`Request timed out after ${timeoutMs} ms`)), timeoutMs)
    return { signal: controller.signal, done: () => { clearTimeout(timer); signal?.removeEventListener('abort', abort) } }
  }

  async function get<T> (path: string, params: Record<string, string | number | undefined>, signal?: AbortSignal): Promise<T> {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') query.set(key, String(value))
    const headers: Record<string, string> = { accept: 'application/json' }
    if (options.token !== undefined) headers.authorization = `Bearer ${await options.token()}`
    const guarded = withTimeout(signal)
    try {
      return await read<T>(await doFetch(`${base}${path}?${query}`, { headers, signal: guarded.signal }))
    } finally { guarded.done() }
  }

  async function read<T> (response: Response): Promise<T> {
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

  // The same fields identify a market on the wire, so two symbols that share a ticker do not share a subscription.
  const subscriptionKey = (symbol: SymbolInfo, period: Period): string => JSON.stringify([symbol.ticker, symbol.market, symbol.exchange, periodToken(period)])
  const stop = (key: string): void => {
    const active = subscriptions.get(key)
    if (active === undefined) return
    clearInterval(active.timer)
    active.abort.abort()
    subscriptions.delete(key)
  }

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
      const key = subscriptionKey(symbol, period)
      // A second subscribe for the same market replaces the first instead of leaking its timer.
      stop(key)
      const abort = new AbortController()
      let newest = 0
      let busy = false
      const tick = async (): Promise<void> => {
        if (busy) return
        busy = true
        try {
          const body = await get<{ bars: MarketBar[] }>('/v1/bars', { ...identity(symbol, period), from: newest || undefined, limit: newest === 0 ? 1 : 50 }, abort.signal)
          // An unsubscribe during the request must not deliver a late bar to a chart that has moved on.
          if (!abort.signal.aborted && body.bars.length > 0) {
            newest = body.bars[body.bars.length - 1].timestamp
            callback(body.bars)
          }
        } catch { /* a failed poll is retried on the next tick */ } finally { busy = false }
      }
      subscriptions.set(key, { timer: setInterval(() => { void tick() }, options.pollMs ?? 5000), abort })
    },

    unsubscribe (symbol: SymbolInfo, period: Period) {
      stop(subscriptionKey(symbol, period))
    }
  }
}
