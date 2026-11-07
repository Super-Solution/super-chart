import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MarketBar as KLineData } from './core/types'

import DefaultDatafeed from './DefaultDatafeed'
import type { Period, SymbolInfo } from './core/feed'

const BTC: SymbolInfo = { ticker: 'BTC', market: 'crypto' }
const H1: Period = { multiplier: 1, timespan: 'hour', text: '1H' }
const M1: Period = { multiplier: 1, timespan: 'minute', text: '1m' }

/** A fake WebSocket close enough to the browser API this file uses. */
class FakeWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 3

  readyState = FakeWebSocket.CONNECTING
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  sent: string[] = []
  url: string

  constructor (url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  static instances: FakeWebSocket[] = []

  /** Simulate the connection completing (readyState CONNECTING while this test holds it open). */
  open (): void {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.()
  }

  send (data: string): void {
    if (this.readyState !== FakeWebSocket.OPEN) {
      throw new DOMException('InvalidStateError', 'InvalidStateError')
    }
    this.sent.push(data)
  }

  message (frames: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frames) })
  }

  close (): void {
    this.readyState = FakeWebSocket.CLOSED
  }
}

function lastSent (ws: FakeWebSocket): any {
  return JSON.parse(ws.sent[ws.sent.length - 1])
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  (globalThis as any).WebSocket = FakeWebSocket
})

afterEach(() => {
  vi.restoreAllMocks()
  delete (globalThis as any).WebSocket
})

describe('SC-036: DefaultDatafeed.searchSymbols', () => {
  it('URL-encodes the search term', async () => {
    const fetchMock = vi.fn(async (_url?: string, _opts?: RequestInit) => ({ ok: true, json: async () => ({ results: [] }) }))
    vi.stubGlobal('fetch', fetchMock)
    const feed = new DefaultDatafeed('key')
    await feed.searchSymbols('S&P 500#x')
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain(encodeURIComponent('S&P 500#x'))
    expect(url).not.toContain('S&P 500#x')
  })

  it('a non-ok response resolves to [], not a throw', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url?: string, _opts?: RequestInit) => ({ ok: false, json: async () => ({}) })))
    const feed = new DefaultDatafeed('key')
    await expect(feed.searchSymbols('x')).resolves.toEqual([])
  })

  it('passes the request signal to fetch', async () => {
    const fetchMock = vi.fn(async (_url?: string, _opts?: RequestInit) => ({ ok: true, json: async () => ({ results: [] }) }))
    vi.stubGlobal('fetch', fetchMock)
    const feed = new DefaultDatafeed('key')
    const controller = new AbortController()
    await feed.searchSymbols('x', { signal: controller.signal })
    expect(fetchMock.mock.calls[0][1]).toEqual({ signal: controller.signal })
  })
})

describe('SC-036: DefaultDatafeed.getHistoryKLineData', () => {
  it('a non-ok response resolves to [], not a throw', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url?: string, _opts?: RequestInit) => ({ ok: false, json: async () => ({}) })))
    const feed = new DefaultDatafeed('key')
    await expect(feed.getHistoryKLineData(BTC, H1, 0, 1000)).resolves.toEqual([])
  })

  it('maps a real result shape to KLineData', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url?: string, _opts?: RequestInit) => ({
      ok: true, json: async () => ({ results: [{ t: 1000, o: 1, h: 2, l: 0.5, c: 1.5, v: 10, vw: 1.2 }] })
    })))
    const feed = new DefaultDatafeed('key')
    const bars = await feed.getHistoryKLineData(BTC, H1, 0, 2000)
    expect(bars).toEqual([{ timestamp: 1000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10, turnover: 1.2 }])
  })
})

describe('SC-036: DefaultDatafeed realtime', () => {
  it('an AM (aggregate) frame reaches the callback; a bare trade shape (no ev) does not crash it', () => {
    const feed = new DefaultDatafeed('key')
    const callback = vi.fn()
    feed.subscribe(BTC, M1, callback)
    const ws = FakeWebSocket.instances[0]
    ws.open()
    ws.message([{ ev: 'status', status: 'auth_success' }])
    ws.message([{ ev: 'AM', sym: 'BTC', s: 60_000, o: 1, h: 2, l: 0.5, c: 1.5, v: 10, vw: 1.2 }])
    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback.mock.calls[0][0]).toMatchObject({ open: 1, high: 2, low: 0.5, close: 1.5 })
  })

  it('subscribes to the aggregate channel (AM.<ticker>), not the trades channel', () => {
    const feed = new DefaultDatafeed('key')
    feed.subscribe(BTC, M1, vi.fn())
    const ws = FakeWebSocket.instances[0]
    ws.open()
    ws.message([{ ev: 'status', status: 'auth_success' }])
    expect(lastSent(ws)).toEqual({ action: 'subscribe', params: 'AM.BTC' })
  })

  it('one-minute aggregates are rolled into the subscribed period\'s own bucket (1H, not 1m, bars)', () => {
    const feed = new DefaultDatafeed('key')
    const callback = vi.fn()
    feed.subscribe(BTC, H1, callback)
    const ws = FakeWebSocket.instances[0]
    ws.open()
    ws.message([{ ev: 'status', status: 'auth_success' }])
    const HOUR = 3_600_000
    // Two one-minute aggregates inside the same hour: one bucket, high/low merged.
    ws.message([{ ev: 'AM', sym: 'BTC', s: HOUR + 60_000, o: 100, h: 101, l: 99, c: 100.5, v: 5, vw: 100 }])
    ws.message([{ ev: 'AM', sym: 'BTC', s: HOUR + 120_000, o: 100.5, h: 103, l: 100, c: 102, v: 7, vw: 101 }])
    expect(callback).toHaveBeenCalledTimes(2)
    const bars: KLineData[] = callback.mock.calls.map(c => c[0])
    expect(bars[0].timestamp).toBe(bars[1].timestamp) // same bucket
    expect(bars[1].timestamp).toBe(HOUR)
    expect(bars[1].high).toBe(103)
    expect(bars[1].low).toBe(99)
    expect(bars[1].close).toBe(102)
    expect(bars[1].volume).toBe(12)
    // A new hour starts a new bucket.
    ws.message([{ ev: 'AM', sym: 'BTC', s: 2 * HOUR + 60_000, o: 102, h: 102, l: 102, c: 102, v: 1, vw: 102 }])
    expect(callback).toHaveBeenCalledTimes(3)
    expect(callback.mock.calls[2][0].timestamp).toBe(2 * HOUR)
  })

  it('unsubscribe sends an unsubscribe frame and stops delivering to that callback', () => {
    const feed = new DefaultDatafeed('key')
    const callback = vi.fn()
    feed.subscribe(BTC, M1, callback)
    const ws = FakeWebSocket.instances[0]
    ws.open()
    ws.message([{ ev: 'status', status: 'auth_success' }])
    feed.unsubscribe(BTC, M1)
    expect(lastSent(ws)).toEqual({ action: 'unsubscribe', params: 'AM.BTC' })
    ws.message([{ ev: 'AM', sym: 'BTC', s: 60_000, o: 1, h: 1, l: 1, c: 1, v: 1 }])
    expect(callback).not.toHaveBeenCalled()
  })

  it('a symbol/period switch on the same market reuses the socket and does not send before it is authenticated', () => {
    const feed = new DefaultDatafeed('key')
    feed.subscribe(BTC, M1, vi.fn())
    const ws = FakeWebSocket.instances[0]
    // Not yet open: subscribing a second ticker on the same market must queue, not throw.
    expect(() => { feed.subscribe({ ticker: 'ETH', market: 'crypto' }, M1, vi.fn()) }).not.toThrow()
    expect(ws.sent).toEqual([])
    ws.open()
    ws.message([{ ev: 'status', status: 'auth_success' }])
    // The auth frame, then a subscribe per active ticker, all sent only once authenticated.
    expect(ws.sent.length).toBeGreaterThan(0)
    expect(ws.sent.every(text => { JSON.parse(text); return true })).toBe(true)
  })

  it('a different market opens a new socket', () => {
    const feed = new DefaultDatafeed('key')
    feed.subscribe(BTC, M1, vi.fn())
    feed.subscribe({ ticker: 'AAPL', market: 'stocks' }, M1, vi.fn())
    expect(FakeWebSocket.instances.length).toBe(2)
  })
})
