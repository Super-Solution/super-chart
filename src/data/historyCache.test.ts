import type { MarketBar as KLineData } from '../core/types'
import { describe, expect, it } from 'vitest'

import type { SymbolInfo } from '../core/feed'

import { HistoryCache, historyKey, mergeKind } from './historyCache'

const sym = (ticker: string, extra: Partial<SymbolInfo> = {}): SymbolInfo => ({ ticker, ...extra })
const H1 = { multiplier: 1, timespan: 'hour' as const }
const H4 = { multiplier: 4, timespan: 'hour' as const }
const bar = (ts: number, close = 100): KLineData => ({ timestamp: ts, open: close, high: close + 1, low: close - 1, close, volume: 10 })

describe('SC-027: historyKey', () => {
  it('is the same for the same symbol and period', () => {
    expect(historyKey(sym('BTC'), H1)).toBe(historyKey(sym('BTC'), H1))
  })

  it('differs by period even for the same symbol', () => {
    expect(historyKey(sym('BTC'), H1)).not.toBe(historyKey(sym('BTC'), H4))
  })

  it('never collapses two symbols that share a ticker but differ by priceCurrency (crypto vs. tradfi vs. demo)', () => {
    const crypto = historyKey(sym('BTC', { priceCurrency: 'USDT' }), H1)
    const tradfi = historyKey(sym('BTC', { priceCurrency: 'USD' }), H1)
    const demo = historyKey(sym('BTC', { priceCurrency: 'DEMO' }), H1)
    expect(new Set([crypto, tradfi, demo]).size).toBe(3)
  })

  it('differs by exchange, market and type too', () => {
    const a = historyKey(sym('BTC', { exchange: 'binance' }), H1)
    const b = historyKey(sym('BTC', { exchange: 'coinbase' }), H1)
    expect(a).not.toBe(b)
  })
})

describe('SC-027: HistoryCache', () => {
  it('a fresh entry is returned by get', () => {
    const cache = new HistoryCache()
    const key = historyKey(sym('BTC'), H1)
    cache.set(key, { bars: [bar(1000)], more: true, at: 1000 })
    expect(cache.get(key, 1000)?.bars.length).toBe(1)
  })

  it('an entry older than ttlMs is dropped (the chart waits for the datafeed instead)', () => {
    const cache = new HistoryCache({ ttlMs: 1000 })
    const key = historyKey(sym('BTC'), H1)
    cache.set(key, { bars: [bar(0)], more: true, at: 0 })
    expect(cache.get(key, 500)).toBeDefined()
    expect(cache.get(key, 1500)).toBeUndefined()
  })

  it('an entry with no bars is never stored (nothing useful to paint)', () => {
    const cache = new HistoryCache()
    const key = historyKey(sym('BTC'), H1)
    cache.set(key, { bars: [], more: false, at: 0 })
    expect(cache.size).toBe(0)
    expect(cache.get(key, 0)).toBeUndefined()
  })

  it('evicts the least recently used entry once max is exceeded', () => {
    const cache = new HistoryCache({ max: 2 })
    cache.set('a', { bars: [bar(1)], more: false, at: 0 })
    cache.set('b', { bars: [bar(1)], more: false, at: 0 })
    cache.set('c', { bars: [bar(1)], more: false, at: 0 })
    expect(cache.size).toBe(2)
    expect(cache.get('a', 0)).toBeUndefined()
    expect(cache.get('b', 0)).toBeDefined()
    expect(cache.get('c', 0)).toBeDefined()
  })

  it('a get() marks the entry most-recently-used, so eviction spares it', () => {
    const cache = new HistoryCache({ max: 2 })
    cache.set('a', { bars: [bar(1)], more: false, at: 0 })
    cache.set('b', { bars: [bar(1)], more: false, at: 0 })
    cache.get('a', 0) // touch a, so b becomes the least recently used
    cache.set('c', { bars: [bar(1)], more: false, at: 0 })
    expect(cache.get('a', 0)).toBeDefined()
    expect(cache.get('b', 0)).toBeUndefined()
    expect(cache.get('c', 0)).toBeDefined()
  })

  it('invalidate(symbol, period) drops exactly that pair', () => {
    const cache = new HistoryCache()
    const btc1h = historyKey(sym('BTC'), H1)
    const btc4h = historyKey(sym('BTC'), H4)
    cache.set(btc1h, { bars: [bar(1)], more: false, at: 0 })
    cache.set(btc4h, { bars: [bar(1)], more: false, at: 0 })
    cache.invalidate(sym('BTC'), H1)
    expect(cache.get(btc1h, 0)).toBeUndefined()
    expect(cache.get(btc4h, 0)).toBeDefined()
  })

  it('invalidate(symbol) drops every period of that symbol, not other symbols', () => {
    const cache = new HistoryCache()
    const btc1h = historyKey(sym('BTC'), H1)
    const btc4h = historyKey(sym('BTC'), H4)
    const eth1h = historyKey(sym('ETH'), H1)
    cache.set(btc1h, { bars: [bar(1)], more: false, at: 0 })
    cache.set(btc4h, { bars: [bar(1)], more: false, at: 0 })
    cache.set(eth1h, { bars: [bar(1)], more: false, at: 0 })
    cache.invalidate(sym('BTC'))
    expect(cache.get(btc1h, 0)).toBeUndefined()
    expect(cache.get(btc4h, 0)).toBeUndefined()
    expect(cache.get(eth1h, 0)).toBeDefined()
  })

  it('invalidate() with no arguments clears everything', () => {
    const cache = new HistoryCache()
    cache.set('a', { bars: [bar(1)], more: false, at: 0 })
    cache.set('b', { bars: [bar(1)], more: false, at: 0 })
    cache.invalidate()
    expect(cache.size).toBe(0)
  })
})

describe('SC-027: mergeKind', () => {
  it("'replace' when either side is empty", () => {
    expect(mergeKind([], [bar(1)])).toBe('replace')
    expect(mergeKind([bar(1)], [])).toBe('replace')
    expect(mergeKind([], [])).toBe('replace')
  })

  it("'tail' when the fresh answer reaches back into the shown bars and lines up with them", () => {
    const shown = [bar(1000), bar(2000), bar(3000)]
    const fresh = [bar(2000), bar(3000, 105), bar(4000)] // 3000's close changed (still open), 4000 is new
    expect(mergeKind(shown, fresh)).toBe('tail')
  })

  it("'replace' when there is a gap after the shown tail", () => {
    const shown = [bar(1000), bar(2000)]
    const fresh = [bar(5000), bar(6000)] // does not reach back to 2000
    expect(mergeKind(shown, fresh)).toBe('replace')
  })

  it("'replace' when the fresh answer's bars near the tail do not line up (a series re-anchored to \"now\")", () => {
    const shown = [bar(1000), bar(2000), bar(3000)]
    // Overlaps in range but at different timestamps: 2500 is not one of `shown`'s timestamps.
    const fresh = [bar(2500), bar(3500)]
    expect(mergeKind(shown, fresh)).toBe('replace')
  })

  it("'tail' when the fresh answer is exactly the same as shown (no-op refresh)", () => {
    const shown = [bar(1000), bar(2000)]
    const fresh = [bar(1000), bar(2000)]
    expect(mergeKind(shown, fresh)).toBe('tail')
  })
})
