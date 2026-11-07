// Test doubles for the data loader: a fake environment (timers, frames,
// visibility), a klinecharts-like chart and a datafeed whose requests the test
// resolves by hand. Not part of the package (only *.test.ts import it).

import type { LoadDataRequest, LoaderChart } from './dataLoader'
import type { LoaderEnv } from './loaderEnvironment'
import type { Datafeed, Period, SymbolInfo } from './feed'
import type { MarketBar as KLineData } from './types'

export const T0 = 1_790_000_000_000 - (1_790_000_000_000 % 3_600_000)
export const HOUR = 3_600_000
export const H1: Period = { multiplier: 1, timespan: 'hour', text: '1H' }
export const H4: Period = { multiplier: 4, timespan: 'hour', text: '4H' }
export const D1: Period = { multiplier: 1, timespan: 'day', text: 'D' }
export const sym = (ticker: string, extra: Partial<SymbolInfo> = {}): SymbolInfo => ({ ticker, pricePrecision: 2, ...extra })

export function bar (ts: number, close = 100, extra: Partial<KLineData> = {}): KLineData {
  return { timestamp: ts, open: close, high: close + 1, low: close - 1, close, volume: 10, ...extra }
}

/** `n` hourly bars ending with the bar that opens at `lastTs`. */
export function hours (n: number, lastTs: number, close = 100): KLineData[] {
  return Array.from({ length: n }, (_, i) => bar(lastTs - (n - 1 - i) * HOUR, close + i * 0.01))
}

/** Let promise callbacks and queued microtasks run. */
export async function settle (): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise<void>(resolve => { setTimeout(resolve, 0) })
  }
}

type Listener = () => void

export type FakeEnv = ReturnType<typeof fakeEnv>
export type FakeChart = ReturnType<typeof fakeChart>
export type DeferredFeed = ReturnType<typeof deferredFeed>

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function fakeEnv (now = T0 + 30 * 60_000) {
  let clock = now
  let seq = 0
  let hidden = false
  const timers = new Map<number, { at: number, fn: () => void }>()
  const frames = new Map<number, () => void>()
  const docListeners = new Map<string, Set<Listener>>()
  const winListeners = new Map<string, Set<Listener>>()
  const warnings: string[] = []
  const add = (map: Map<string, Set<Listener>>) => (type: string, fn: Listener): void => {
    const set = map.get(type) ?? new Set<Listener>()
    set.add(fn)
    map.set(type, set)
  }
  const remove = (map: Map<string, Set<Listener>>) => (type: string, fn: Listener): void => { map.get(type)?.delete(fn) }
  const env: LoaderEnv = {
    now: () => clock,
    setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { at: clock + ms, fn }); return id },
    clearTimeout: handle => { timers.delete(handle as number) },
    requestFrame: fn => { const id = ++seq; frames.set(id, fn); return id },
    cancelFrame: handle => { frames.delete(handle as number) },
    hidden: () => hidden,
    queueMicrotask: fn => { queueMicrotask(fn) },
    visibility: {
      get hidden () { return hidden },
      addEventListener: add(docListeners),
      removeEventListener: remove(docListeners)
    },
    connectivity: { addEventListener: add(winListeners), removeEventListener: remove(winListeners) },
    warn: (...args: unknown[]) => { warnings.push(args.map(String).join(' ')) }
  }
  return {
    env,
    warnings,
    get now () { return clock },
    /** Move the clock and run every timer that is due, in order. */
    advance (ms: number): void {
      const until = clock + ms
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at !== b[1].at ? a[1].at - b[1].at : a[0] - b[0])[0]
        if (due === undefined) break
        timers.delete(due[0])
        clock = Math.max(clock, due[1].at)
        due[1].fn()
      }
      clock = until
    },
    /** Run the animation frames requested so far. */
    frame (): void {
      const pending = [...frames.values()]
      frames.clear()
      for (const fn of pending) fn()
    },
    get frames () { return frames.size },
    get timers () { return timers.size },
    setHidden (value: boolean): void {
      hidden = value
      for (const fn of [...(docListeners.get('visibilitychange') ?? [])]) fn()
    },
    online (): void {
      for (const fn of [...(winListeners.get('online') ?? [])]) fn()
    },
    listenerCount (): number {
      let n = 0
      for (const set of [...docListeners.values(), ...winListeners.values()]) n += set.size
      return n
    }
  }
}

/**
 * A chart that behaves like klinecharts' data store where it matters: applyNewData
 * replaces the data and resets the loading flag, updateData appends a newer bar,
 * replaces the last one or ignores an older one, and scroll-back fires only when
 * there is more data and nothing is loading. `kind` picks 9.7's loadMore or 9.8's
 * setLoadDataCallback. With `viewSize`, applyNewData asks for older bars at once
 * (synchronously, from inside the call) when the bars do not fill the view, as
 * klinecharts 9.7 and 9.8 do: the view's first visible index is then 0.
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function fakeChart (kind: 'loadMore' | 'callback' = 'loadMore', opts: { viewSize?: number } = {}) {
  let list: KLineData[] = []
  let more = true
  let loading = false
  let loadMoreCb: ((ts: number | null) => void) | null = null
  let loadDataCb: ((params: LoadDataRequest) => void) | null = null
  const calls = { applyNewData: [] as KLineData[][], applyMoreData: [] as KLineData[][], updateData: [] as KLineData[], backwardAnswers: [] as Array<{ data: KLineData[], more?: boolean }> }
  const prepend = (data: KLineData[], m: boolean | undefined, dflt: boolean): void => {
    list = data.concat(list)
    more = m ?? dflt
    loading = false
  }
  /** The view reached the first bar: klinecharts asks for older data if it may. */
  const askOlder = (): boolean => {
    if (!more || loading || list.length === 0) return false
    loading = true
    if (loadMoreCb !== null) {
      loadMoreCb(list[0].timestamp)
    } else if (loadDataCb !== null) {
      loadDataCb({ type: 'forward', data: list[0], callback: (data, m) => { prepend(data, m, false) } })
    }
    return true
  }
  const chart: LoaderChart = {
    applyNewData: (data, m) => {
      calls.applyNewData.push(data.slice())
      list = data.slice()
      more = m ?? true
      loading = false
      if (opts.viewSize !== undefined && list.length < opts.viewSize) askOlder()
    },
    applyMoreData: (data, m) => { calls.applyMoreData.push(data.slice()); prepend(data, m, true) },
    updateData: b => {
      calls.updateData.push(b)
      const last = list[list.length - 1]
      if (last === undefined || b.timestamp > last.timestamp) list.push(b)
      else if (b.timestamp === last.timestamp) list[list.length - 1] = b
    },
    getDataList: () => list
  }
  if (kind === 'loadMore') {
    chart.loadMore = cb => { loadMoreCb = cb }
  } else {
    chart.setLoadDataCallback = cb => { loadDataCb = cb }
  }
  return {
    chart,
    calls,
    get list () { return list },
    get more () { return more },
    get loading () { return loading },
    timestamps: () => list.map(b => b.timestamp),
    /** The view reached the first bar: klinecharts asks for older data if it may. */
    scrollToStart: askOlder,
    /** klinecharts 9.8 asks for newer data when the view reaches the last bar. */
    reachEnd (): void {
      loadDataCb?.({ type: 'backward', data: list[list.length - 1] ?? null, callback: (data, m) => { calls.backwardAnswers.push({ data, more: m }) } })
    }
  }
}

export interface HistoryCall {
  ticker: string
  period: string
  from: number
  to: number
  /** SC-028: what the loader asked for besides the range (undefined for a caller not passing one). */
  ctx?: { firstDataRequest: boolean, countBack: number, before?: number, aborted: () => boolean }
  resolve: (bars: unknown) => void
  reject: (error: unknown) => void
}

/** A datafeed whose history requests stay pending until the test settles them. */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function deferredFeed () {
  const history: HistoryCall[] = []
  const log: string[] = []
  let listener: ((data: KLineData | KLineData[]) => void) | null = null
  const listeners: Array<(data: KLineData | KLineData[]) => void> = []
  const datafeed: Datafeed = {
    searchSymbols: async () => [],
    getHistoryKLineData: async (symbol, period, from, to, request) => await new Promise((resolve, reject) => {
      const ctx = request === undefined
        ? undefined
        : { firstDataRequest: request.firstDataRequest, countBack: request.countBack, before: request.before, aborted: () => request.signal.aborted }
      history.push({ ticker: symbol.ticker, period: period.text, from, to, ctx, resolve: resolve as (b: unknown) => void, reject })
    }),
    subscribe: (symbol, period, callback) => {
      log.push(`sub ${symbol.ticker} ${period.text}`)
      listener = callback
      listeners.push(callback)
    },
    unsubscribe: (symbol, period) => { log.push(`unsub ${symbol.ticker} ${period.text}`) }
  }
  return {
    datafeed,
    history,
    log,
    listeners,
    /** Push a tick through the latest subscribe callback. */
    tick: (data: KLineData | KLineData[]) => { listener?.(data) },
    fetched: () => history.map(h => `${h.ticker} ${h.period}`),
    last: () => history[history.length - 1]
  }
}
