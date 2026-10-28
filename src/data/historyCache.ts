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

// A per-chart LRU of the bars last shown for a (symbol, period), so switching
// back (1H -> 4H -> 1H, BTC -> ETH -> BTC) paints at once. It never replaces a
// request: the loader still asks the datafeed on every change (hosts use that
// call as their change signal, and ignore `from`), then merges the answer.
//
// The key is every SymbolInfo field that identifies data, not just its display
// (src/data/keys.ts: ticker plus exchange, market, priceCurrency, type, ...;
// name, logo and timezone are display-only and never split an entry), and
// never the ticker alone: SupWallet's crypto, tradfi and demo charts share a
// ticker and differ only by priceCurrency.

import type { KLineData } from 'klinecharts'

import type { Period, SymbolInfo } from '../types'

import { periodKey, symbolKey } from './keys'

export interface HistoryCacheOptions {
  /** Entries kept (least recently used dropped first). @default 8 */
  max?: number
  /** An entry older than this is not painted (the chart waits for the datafeed). @default 600000 (10 min) */
  ttlMs?: number
}

export interface HistoryCacheEntry {
  /** Oldest first, normalized (ms timestamps, sorted, no duplicates). */
  bars: readonly KLineData[]
  /** More (older) history exists. */
  more: boolean
  /** When the bars were last current (ms). */
  at: number
}

/** The cache key of a pair. */
export function historyKey (symbol: SymbolInfo, period: Pick<Period, 'multiplier' | 'timespan'>): string {
  return `${symbolKey(symbol)}|${periodKey(period)}`
}

export class HistoryCache {
  private readonly _max: number
  private readonly _ttl: number
  private readonly _entries = new Map<string, HistoryCacheEntry>()

  constructor (options: HistoryCacheOptions = {}) {
    this._max = Math.max(1, Math.floor(options.max ?? 8))
    this._ttl = Math.max(0, options.ttlMs ?? 600_000)
  }

  get size (): number {
    return this._entries.size
  }

  /** A fresh entry (and mark it most recently used), or undefined. */
  get (key: string, now: number): HistoryCacheEntry | undefined {
    const entry = this._entries.get(key)
    if (entry === undefined) {
      return undefined
    }
    if (now - entry.at > this._ttl || entry.bars.length === 0) {
      this._entries.delete(key)
      return undefined
    }
    this._entries.delete(key)
    this._entries.set(key, entry)
    return entry
  }

  set (key: string, entry: HistoryCacheEntry): void {
    this._entries.delete(key)
    if (entry.bars.length === 0) {
      return
    }
    this._entries.set(key, entry)
    while (this._entries.size > this._max) {
      const oldest = this._entries.keys().next().value as string
      this._entries.delete(oldest)
    }
  }

  /** Drop one pair, every period of a symbol (`symbol` only), or everything (no arguments). */
  invalidate (symbol?: SymbolInfo, period?: Pick<Period, 'multiplier' | 'timespan'>): void {
    if (symbol === undefined) {
      this._entries.clear()
      return
    }
    if (period !== undefined) {
      this._entries.delete(historyKey(symbol, period))
      return
    }
    const prefix = `${symbolKey(symbol)}|`
    for (const key of [...this._entries.keys()]) {
      if (key.startsWith(prefix)) {
        this._entries.delete(key)
      }
    }
  }
}

function indexOfTimestamp (list: readonly KLineData[], ts: number): number {
  let lo = 0
  let hi = list.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const t = list[mid].timestamp
    if (t === ts) return mid
    if (t < ts) lo = mid + 1
    else hi = mid - 1
  }
  return -1
}

/**
 * How a fresh answer relates to the bars on screen (both oldest first):
 * 'tail' when it reaches back into them and every bar it has up to their
 * last timestamp is one they have (so only bars from that timestamp on are
 * new or changed); 'replace' when it does not line up (a gap after the
 * cached tail, or a feed whose bar times moved, like a series re-anchored to
 * "now" on every call).
 */
export function mergeKind (shown: readonly KLineData[], fresh: readonly KLineData[]): 'tail' | 'replace' {
  if (shown.length === 0 || fresh.length === 0) {
    return 'replace'
  }
  const last = shown[shown.length - 1].timestamp
  if (fresh[0].timestamp > last || fresh[fresh.length - 1].timestamp < last) {
    return 'replace'
  }
  for (const bar of fresh) {
    if (bar.timestamp > last) break
    if (indexOfTimestamp(shown, bar.timestamp) < 0) {
      return 'replace'
    }
  }
  return 'tail'
}
