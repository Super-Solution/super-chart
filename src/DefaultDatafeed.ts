/**
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at

 * http://www.apache.org/licenses/LICENSE-2.0

 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { MarketBar } from './core/types'

import { UNIT_MS } from './data/requestRange'
import type { Datafeed, SymbolInfo, Period, DatafeedSubscribeCallback, HistoryRequest, SearchRequest } from './core/feed'

/**
 * A reference Datafeed against Polygon.io, kept for the shape of the
 * interface it implements, not as production code: no host imports it (each
 * of SupWallet, Broker and ProjectX has its own datafeed). Implement
 * `Datafeed` against your own feed instead — see the README's example.
 *
 * @deprecated reference only; write your own Datafeed (see the README).
 */
export default class DefaultDatafeed implements Datafeed {
  constructor (apiKey: string) {
    this._apiKey = apiKey
  }

  private readonly _apiKey: string

  private _prevSymbolMarket?: string

  private _ws?: WebSocket

  private _authed = false

  /** Sent as soon as the socket is open and authenticated; queued before that. */
  private _sendQueue: string[] = []

  // One live callback per ticker (Polygon's channels are per-ticker; a chart
  // only ever has one active symbol, but keying by ticker rather than a
  // single slot means an unsubscribe() cannot silently drop a *different*
  // ticker's callback, and a stale ticker's aggregate frames are ignored
  // instead of reaching a callback for a symbol that moved on).
  private readonly _callbacks = new Map<string, { period: Period, callback: DatafeedSubscribeCallback }>()

  // Aggregate-minute bars accumulated into the subscribed period's own bucket
  // (Polygon's AM. channel is always one-minute bars; a 1H or 1D chart needs
  // them combined, not applied one by one).
  private readonly _buckets = new Map<string, MarketBar & { bucketStart: number }>()

  async searchSymbols (search?: string, request?: SearchRequest): Promise<SymbolInfo[]> {
    const query = encodeURIComponent(search ?? '')
    const response = await fetch(
      `https://api.polygon.io/v3/reference/tickers?apiKey=${encodeURIComponent(this._apiKey)}&active=true&search=${query}`,
      { signal: request?.signal }
    )
    if (!response.ok) {
      return []
    }
    const result = await response.json()
    return ((result.results ?? []) as any[]).map((data: any) => ({
      ticker: data.ticker,
      name: data.name,
      shortName: data.ticker,
      market: data.market,
      exchange: data.primary_exchange,
      priceCurrency: data.currency_name,
      type: data.type
    }))
  }

  async getHistoryKLineData (symbol: SymbolInfo, period: Period, from: number, to: number, request?: HistoryRequest): Promise<MarketBar[]> {
    const response = await fetch(
      `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(symbol.ticker)}/range/${period.multiplier}/${period.timespan}/${from}/${to}?apiKey=${encodeURIComponent(this._apiKey)}`,
      { signal: request?.signal }
    )
    if (!response.ok) {
      return []
    }
    const result = await response.json()
    return ((result.results ?? []) as any[]).map((data: any) => ({
      timestamp: data.t,
      open: data.o,
      high: data.h,
      low: data.l,
      close: data.c,
      volume: data.v,
      turnover: data.vw
    }))
  }

  subscribe (symbol: SymbolInfo, period: Period, callback: DatafeedSubscribeCallback): void {
    this._callbacks.set(symbol.ticker, { period, callback })
    if (this._prevSymbolMarket !== symbol.market || this._ws === undefined) {
      this._ws?.close()
      this._authed = false
      this._sendQueue = []
      const ws = new WebSocket(`wss://socket.polygon.io/${symbol.market}`)
      this._ws = ws
      ws.onopen = () => {
        this._raw({ action: 'auth', params: this._apiKey })
      }
      ws.onmessage = event => {
        const frames = this._parseFrames(event.data)
        for (const frame of frames) {
          if (frame.ev === 'status') {
            if (frame.status === 'auth_success') {
              this._authed = true
              this._flushQueue()
              // (Re)subscribe every ticker this instance still cares about:
              // covers both a fresh connection and a reconnect after one drops.
              for (const ticker of this._callbacks.keys()) {
                this._send({ action: 'subscribe', params: `AM.${ticker}` })
              }
            }
            continue
          }
          if (frame.ev === 'AM' || frame.ev === 'A') {
            this._onAggregate(frame)
          }
        }
      }
    } else {
      this._send({ action: 'subscribe', params: `AM.${symbol.ticker}` })
    }
    this._prevSymbolMarket = symbol.market
  }

  unsubscribe (symbol: SymbolInfo, period: Period): void {
    this._callbacks.delete(symbol.ticker)
    this._buckets.delete(symbol.ticker)
    this._send({ action: 'unsubscribe', params: `AM.${symbol.ticker}` })
  }

  // ---- WebSocket plumbing -----------------------------------------------

  /** JSON-encode and send, queuing until the socket is open and authenticated. */
  private _send (payload: Record<string, unknown>): void {
    this._raw(payload)
  }

  /** Like _send, but usable before auth (the auth frame itself). */
  private _raw (payload: Record<string, unknown>): void {
    const text = JSON.stringify(payload)
    const ws = this._ws
    // OPEN and (for anything but the auth frame itself) authenticated:
    // sending while CONNECTING throws InvalidStateError in the browser.
    if (ws !== undefined && ws.readyState === WebSocket.OPEN && (this._authed || payload.action === 'auth')) {
      ws.send(text)
    } else {
      this._sendQueue.push(text)
    }
  }

  private _flushQueue (): void {
    const ws = this._ws
    if (ws === undefined || ws.readyState !== WebSocket.OPEN) {
      return
    }
    const queue = this._sendQueue
    this._sendQueue = []
    for (const text of queue) {
      ws.send(text)
    }
  }

  /** Polygon sends an array of frames (or, rarely, one object); always returns an array. */
  private _parseFrames (data: unknown): any[] {
    try {
      const parsed = typeof data === 'string' ? JSON.parse(data) : data
      return Array.isArray(parsed) ? parsed : [parsed]
    } catch {
      return []
    }
  }

  /** Roll a one-minute Polygon aggregate into the subscribed period's own bucket. */
  private _onAggregate (frame: any): void {
    const ticker: string | undefined = frame.sym
    if (ticker === undefined) {
      return
    }
    const entry = this._callbacks.get(ticker)
    if (entry === undefined) {
      return
    }
    const bar: MarketBar = { timestamp: frame.s, open: frame.o, high: frame.h, low: frame.l, close: frame.c, volume: frame.v, turnover: frame.vw }
    const unit = UNIT_MS[entry.period.timespan]
    const bucketMs = unit !== undefined ? unit * entry.period.multiplier : UNIT_MS.minute
    const bucketStart = Math.floor(bar.timestamp / bucketMs) * bucketMs
    const current = this._buckets.get(ticker)
    if (current === undefined || current.bucketStart !== bucketStart) {
      const next = { ...bar, timestamp: bucketStart, bucketStart }
      this._buckets.set(ticker, next)
      entry.callback({ timestamp: next.timestamp, open: next.open, high: next.high, low: next.low, close: next.close, volume: next.volume, turnover: next.turnover })
      return
    }
    const merged = {
      ...current,
      high: Math.max(current.high, bar.high),
      low: Math.min(current.low, bar.low),
      close: bar.close,
      volume: (current.volume ?? 0) + (bar.volume ?? 0)
    }
    this._buckets.set(ticker, merged)
    entry.callback({ timestamp: merged.timestamp, open: merged.open, high: merged.high, low: merged.low, close: merged.close, volume: merged.volume, turnover: merged.turnover })
  }
}
