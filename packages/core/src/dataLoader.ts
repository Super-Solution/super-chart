// SPDX-License-Identifier: GPL-3.0-or-later
// The one place that moves data between a Datafeed and the chart.
//
// It replaces a single `loading` boolean that froze the chart for good: a
// symbol or period change during any load was dropped (and every later one
// with it), a rejected request left the spinner up forever, a late response
// could land on the next symbol's chart, and the feed was never unsubscribed
// on dispose. What holds it together:
//
// - Generations. Every load of a (symbol, period) takes the next `reqGen`;
//   anything that resolves under an older generation (history, a scroll-back
//   page, a tick, a gap backfill) is dropped. `shownGen` is the generation
//   whose data is on screen; scroll-back and backfill only run when the two
//   agree, and always for the pair on screen, never the one being loaded.
// - Coalescing. Requests are started from a microtask, so a setSymbol and a
//   setPeriod in the same tick load the final pair once.
// - Strictly paired subscriptions. Hosts implement unsubscribe() as "retire
//   the current subscription" (it takes no arguments in several of them), so
//   exactly the pair that was subscribed is unsubscribed, once, before the
//   next subscribe, and on dispose.
// - Every request settles the state: loading, then ready, empty or error.
//
// No Solid and no DOM here beyond what `env` provides, so it runs in unit
// tests against a fake chart.

import type { MarketBar } from './types'

import type { Datafeed, DatafeedSubscribeCallback, HistoryRequest, Period, SymbolInfo } from './feed'

import type { ChartDataPort, HistoryLoadRequest } from './chartPort'
import { createRuntimeEnvironment, type LoaderEnv } from './loaderEnvironment'
import { TickCoalescer } from './coalesce'
import { HistoryCache, historyKey, mergeKind, type HistoryCacheOptions } from './historyCache'
import { decideUnit, normalizeBars, olderThan, type BarIssues, type TimeUnit } from './normalizeBars'
import { prependReplay, replayApply, replayAtEnd, replayBars, startReplay, stepReplay, tickReplay, type ReplayState } from './replay'
import { addPeriods, requestRange } from './requestRange'

/**
 * What a datafeed may resolve getHistoryKLineData with besides a plain array
 * (types.ts's HistoryResult): `{ bars, noData }`. A plain array is unwrapped
 * as `{ bars: list, noData: false }` (unchanged from before this existed).
 */
function unwrapHistory (raw: unknown): { bars: unknown, noData: boolean } {
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw) && Array.isArray((raw as { bars?: unknown }).bars)) {
    const r = raw as { bars: unknown[], noData?: boolean }
    return { bars: r.bars, noData: r.noData === true }
  }
  return { bars: raw, noData: false }
}

/** The initial load's state: what the chart shows the user. */
export type DataState = 'idle' | 'loading' | 'ready' | 'empty' | 'error'

/** Which request failed: the initial history, a scroll-back page, or a gap backfill. */
export type LoadPhase = 'initial' | 'more' | 'sync'

export interface DataLoadError {
  phase: LoadPhase
  symbol: SymbolInfo
  period: Period
  /** What the datafeed rejected with (or threw), or a timeout Error. */
  error: unknown
  /** True when the request did not settle in time (the initial load or a gap backfill). */
  timeout: boolean
}

export interface DataStatus {
  state: DataState
  /** A scroll-back page is being fetched. */
  loadingMore: boolean
  /** Set in the 'error' state. */
  error: DataLoadError | null
}

/** The part of a klinecharts Chart the loader drives (9.7 has no setLoadDataCallback). */
export type LoaderChart = ChartDataPort<MarketBar>
export type LoadDataRequest = HistoryLoadRequest<MarketBar>


export interface LoaderOptions {
  datafeed: Datafeed
  /** Bars per history request. @default 500 */
  count?: number
  /** 0 (default): ticks are applied once per frame. More: at most once per that many ms. */
  tickThrottleMs?: number
  /** An initial load still pending after this long shows the error state. @default 20000 */
  loadTimeoutMs?: number
  /** Minimum time between two gap backfills. @default 30000 */
  syncMinIntervalMs?: number
  /**
   * A gap backfill still pending after this long is given up: the live bars it
   * held are applied (with the hole), so a stalled request never stops live
   * updates. @default 10000
   */
  syncTimeoutMs?: number
  /** Retry delay after a failed scroll-back page, doubled per failure up to the max. */
  moreRetryMs?: { base: number, max: number }
  /**
   * A per-instance LRU of the bars last shown for a (symbol, period), so
   * switching back (1H -> 4H -> 1H) paints at once from cache while the
   * datafeed is still asked (it is the hosts' own change signal, and its
   * answer is merged in — never skipped). `false` (the default here; a host
   * option turns it on): no cache. See src/data/historyCache.ts.
   */
  historyCache?: HistoryCacheOptions | false
  env?: Partial<LoaderEnv>
}

export interface LoaderEvents {
  status: DataStatus
  error: DataLoadError
  /** True when a replay starts, false when it ends (exit, or a new load cancels it). */
  replay: boolean
  /**
   * The bars an initial load (a symbol/period change or reload()) is about to
   * apply, fired synchronously just before they are: the one place a host can
   * derive something (e.g. price precision, src/data/precision.ts) from the
   * bars a fresh pair will show before they are drawn. Not fired for
   * scroll-back pages, gap backfills, replay or live ticks.
   */
  bars: { bars: readonly MarketBar[], symbol: SymbolInfo, period: Period }
}

interface Pair {
  symbol: SymbolInfo
  period: Period
}


function lastTimestamp (chart: LoaderChart | null): number | undefined {
  if (chart?.getLastTimestamp !== undefined) return chart.getLastTimestamp()
  const list = chart?.getDataList()
  return list !== undefined && list.length > 0 ? list[list.length - 1].timestamp : undefined
}

/**
 * True when consecutive bars are two or more periods apart somewhere: the feed
 * has holes of its own (a market that closes overnight or at weekends, a thinly
 * traded pair that skips empty bars). A backfill could not close such a hole,
 * so a live bar after one is appended as it is.
 */
export function hasHoles (bars: readonly MarketBar[], period: Pick<Period, 'multiplier' | 'timespan'>): boolean {
  for (let i = 1; i < bars.length; i++) {
    const edge = addPeriods(period, bars[i - 1].timestamp, 2)
    if (Number.isFinite(edge) && bars[i].timestamp >= edge) {
      return true
    }
  }
  return false
}

function describe (pair: Pair): string {
  return `${String(pair.symbol?.ticker)} ${String(pair.period?.text ?? `${pair.period?.multiplier} ${pair.period?.timespan}`)}`
}

export class DataLoader {
  private readonly _env: LoaderEnv
  private readonly _datafeed: Datafeed
  private readonly _count: number
  private readonly _timeoutMs: number
  private readonly _syncMinMs: number
  private readonly _syncTimeoutMs: number
  private readonly _moreRetry: { base: number, max: number }
  private readonly _coalescer: TickCoalescer
  private readonly _cache: HistoryCache | null

  private _chart: LoaderChart | null = null
  // AbortSignal handed to the datafeed per in-flight request kind (SC-028):
  // aborted when a fresher request of the same kind supersedes it, and on
  // dispose. A datafeed that ignores it is unaffected: its answer is simply
  // discarded if it is no longer current, exactly as before this existed.
  private _reqAbort: AbortController | null = null
  private _moreAbort: AbortController | null = null
  private _syncAbort: AbortController | null = null
  private _disposed = false
  private _detach: Array<() => void> = []
  private readonly _listeners: { [K in keyof LoaderEvents]: Set<(value: LoaderEvents[K]) => void> } = {
    status: new Set(), error: new Set(), replay: new Set(), bars: new Set()
  }

  // Requests
  private _pending: Pair | null = null
  private _scheduled = false
  private _current: Pair | null = null
  private _reqGen = 0
  private _shownGen = 0
  private _shown: Pair | null = null
  private _subscribed: Pair | null = null
  private _status: DataStatus = { state: 'idle', loadingMore: false, error: null }
  private _unit: TimeUnit | undefined
  private _more = false

  // Scroll-back
  private _moreGen = 0
  private _moreFailures = 0
  private _moreTimer: unknown = null
  private _loadUntilBusy = false
  private _pendingOlderPage: ((page: { bars: MarketBar[], more: boolean } | null) => void) | null = null

  // Gap backfill
  private _syncGen = 0
  private _syncing = false
  private _syncTimer: unknown = null
  private _held: MarketBar[] = []
  private _lastSyncAt = -Infinity
  private _hiddenAt: number | null = null
  /** The pair's history has holes of its own: a live bar after a gap is not backfilled. */
  private _sparse = false

  // Replay
  private _replay: ReplayState | null = null

  private readonly _warned = new Set<string>()

  constructor (options: LoaderOptions) {
    this._env = createRuntimeEnvironment(options.env)
    this._datafeed = options.datafeed
    this._count = options.count ?? 500
    this._timeoutMs = options.loadTimeoutMs ?? 20_000
    this._syncMinMs = options.syncMinIntervalMs ?? 30_000
    this._syncTimeoutMs = options.syncTimeoutMs ?? 10_000
    this._moreRetry = options.moreRetryMs ?? { base: 1000, max: 30_000 }
    this._coalescer = new TickCoalescer(bars => { this._applyTicks(bars) }, this._env, Math.max(0, options.tickThrottleMs ?? 0))
    this._cache = options.historyCache === undefined || options.historyCache === false ? null : new HistoryCache(options.historyCache)
  }

  // ---- public ---------------------------------------------------------------

  /** Listen to an event; returns the function that stops listening. */
  on<K extends keyof LoaderEvents> (type: K, fn: (value: LoaderEvents[K]) => void): () => void {
    this._listeners[type].add(fn)
    return () => { this._listeners[type].delete(fn) }
  }

  get status (): DataStatus {
    return this._status
  }

  /** The symbol and period whose data is on screen (null before the first load settles). */
  get shown (): Readonly<Pair> | null {
    return this._shown
  }

  get disposed (): boolean {
    return this._disposed
  }

  /**
   * Give the loader its chart: registers the scroll-back callback (9.8's
   * setLoadDataCallback when there is one, loadMore otherwise) and the
   * visibility / online listeners, and starts a request made before mount.
   */
  attach (chart: LoaderChart): void {
    if (this._disposed || this._chart !== null) {
      return
    }
    this._chart = chart
    if (typeof chart.setLoadDataCallback === 'function') {
      // klinecharts 9.8 also asks for newer data ('backward') whenever the view
      // reaches the last bar, and holds its loading flag until answered: an
      // unanswered 'backward' would block every scroll-back request.
      chart.setLoadDataCallback(params => {
        if (params.type !== 'forward') {
          params.callback([], false)
          return
        }
        this._loadOlder(params.data?.timestamp ?? null, (bars, more) => { params.callback(bars, more) })
      })
    } else if (typeof chart.loadMore === 'function') {
      chart.loadMore(timestamp => {
        this._loadOlder(timestamp ?? null, (bars, more) => { this._chart?.applyMoreData(bars, more) })
      })
    }
    this._listen()
    if (this._pending !== null) {
      this._schedule()
    }
  }

  /** Load `symbol` and `period`. Calls in the same tick load the last pair once. */
  request (symbol: SymbolInfo, period: Period): void {
    if (this._disposed) {
      return
    }
    this._pending = { symbol, period }
    this._schedule()
  }

  /** Load the current pair again (a new request, new data). */
  reload (): void {
    if (this._disposed) {
      return
    }
    this._pending = this._pending ?? this._current
    if (this._pending !== null) {
      this._schedule()
    }
  }

  /**
   * Catch up on bars missed while the page slept or was offline: one history
   * request from the last bar, merged by timestamp. Rate-limited; skipped
   * during replay and while a load is in flight.
   */
  resync (): void {
    if (this._canSync()) {
      this._startSync(null)
    }
  }

  /**
   * Seed the history cache for `symbol`/`period` from bars a host already
   * has, so a later request() (a symbol/period change, not the pair on
   * screen right now) can paint instantly. A no-op when historyCache is off.
   */
  primeHistory (symbol: SymbolInfo, period: Period, bars: readonly MarketBar[]): void {
    if (this._cache === null || bars.length === 0) {
      return
    }
    const { bars: normalized } = normalizeBars(bars.slice())
    this._cache.set(historyKey(symbol, period), { bars: normalized, more: true, at: this._env.now() })
  }

  /**
   * Drop cached history: one pair (`symbol` and `period`), every period of a
   * symbol (`symbol` only), or everything (no arguments). A no-op when
   * historyCache is off.
   */
  invalidateHistory (symbol?: SymbolInfo, period?: Period): void {
    this._cache?.invalidate(symbol, period)
  }

  /**
   * SC-141: page older bars in, directly (not through a klinecharts scroll),
   * until the shown pair's first bar reaches `timestamp` or one of these
   * stops it: an empty (or `noData`) page, `capPages` pages (default 20), the
   * symbol/period changing, or dispose. One call at a time — a second call
   * while one is running resolves `{ covered: false }` at once, rather than
   * race a concurrent one (or a live user scroll) over the same scroll-back
   * bookkeeping (`_moreGen` and klinecharts' own loading flag).
   */
  async loadUntil (timestamp: number, capPages = 20): Promise<{ covered: boolean }> {
    if (this._disposed || this._chart === null || this._shownGen !== this._reqGen || this._loadUntilBusy) {
      return { covered: false }
    }
    this._loadUntilBusy = true
    const gen = this._reqGen
    try {
      for (let i = 0; i < capPages; i++) {
        if (!this._isCurrent(gen) || this._shownGen !== gen || this._chart === null) {
          return { covered: false }
        }
        const list = this._chart.getDataList()
        const firstTs = list.length > 0 ? list[0].timestamp : null
        if (firstTs !== null && firstTs <= timestamp) {
          return { covered: true }
        }
        if (!this._more || firstTs === null) {
          return { covered: false }
        }
        const page = await this._awaitOlderPage(firstTs)
        if (page === null || !this._isCurrent(gen) || this._shownGen !== gen || this._chart === null) {
          return { covered: false }
        }
        if (page.bars.length === 0) {
          return { covered: false }
        }
        this._chart.applyMoreData(page.bars, page.more)
      }
      const list = this._chart?.getDataList() ?? []
      return { covered: list.length > 0 && list[0].timestamp <= timestamp }
    } finally {
      this._loadUntilBusy = false
    }
  }

  /** One _loadOlder round trip as a promise, bounded by the load timeout so a stolen answer cannot hang loadUntil forever. */
  private async _awaitOlderPage (firstTs: number): Promise<{ bars: MarketBar[], more: boolean } | null> {
    return await new Promise(resolve => {
      let settled = false
      let timer: unknown = null
      const finish = (result: { bars: MarketBar[], more: boolean } | null): void => {
        if (settled) {
          return
        }
        settled = true
        if (timer !== null) {
          this._env.clearTimeout(timer)
        }
        if (this._pendingOlderPage === finish) {
          this._pendingOlderPage = null
        }
        resolve(result)
      }
      // _cancelMore() (a symbol/period change superseding this pair, or
      // dispose) calls this at once: without it, an answer _loadOlder itself
      // will now silently drop (moreGen has moved on) would only surface
      // through this timeout, minutes later on a slow feed.
      this._pendingOlderPage = finish
      timer = this._env.setTimeout(() => { finish(null) }, this._timeoutMs)
      this._loadOlder(firstTs, (bars, more) => { finish({ bars, more }) })
    })
  }

  /** Stop everything: unsubscribes the active pair, drops pending work, removes listeners. */
  dispose (): void {
    if (this._disposed) {
      return
    }
    this._disposed = true
    this._reqGen++
    this._pending = null
    this._retire()
    this._replay = null
    for (const detach of this._detach) {
      detach()
    }
    this._detach = []
    this._chart = null
    for (const set of Object.values(this._listeners)) {
      set.clear()
    }
  }

  // ---- replay ---------------------------------------------------------------

  get replaying (): boolean {
    return this._replay !== null
  }

  /** True when the replay head is on the newest bar (or there is no replay). */
  get replayAtEnd (): boolean {
    return this._replay === null || replayAtEnd(this._replay)
  }

  /** The replay head, or null when there is no replay running. */
  get replayInfo (): { index: number, length: number, timestamp: number } | null {
    const state = this._replay
    if (state === null) {
      return null
    }
    return { index: state.idx, length: state.full.length, timestamp: state.full[state.idx]?.timestamp ?? NaN }
  }

  /**
   * Start a replay of the data on screen. Live ticks and scroll-back pages
   * go into the replay's series until it ends. `at` is a data index into the
   * data currently on screen; the default (60% of the way in) is unchanged.
   * False when there is nothing to replay.
   */
  enterReplay (at?: number): boolean {
    const chart = this._chart
    if (chart === null || this._disposed || this._replay !== null || this._shownGen !== this._reqGen || this._status.state !== 'ready') {
      return false
    }
    this._coalescer.flush()
    let state = startReplay(chart.getDataList(), at)
    if (state === null) {
      return false
    }
    // A gap backfill in flight is abandoned; the ticks it held go into the replay.
    for (const bar of this._abandonSync()) {
      state = tickReplay(state, bar)
    }
    this._replay = state
    chart.applyNewData(replayBars(state), this._more)
    this._emit('replay', true)
    return true
  }

  /** Move the replay head `dir` bars (1 forward, -1 back). */
  replayStep (dir: number): void {
    const prev = this._replay
    const chart = this._chart
    if (prev === null || chart === null) {
      return
    }
    const next = stepReplay(prev, dir)
    const apply = replayApply(prev, next, lastTimestamp(chart))
    this._replay = next
    if (apply.kind === 'append') {
      chart.updateData(apply.bar)
    } else if (apply.kind === 'rebuild') {
      chart.applyNewData(apply.bars, this._more)
    }
  }

  /** End the replay and show every bar, including what arrived during it. */
  exitReplay (): void {
    this._endReplay(true)
  }

  // ---- loading --------------------------------------------------------------

  private _schedule (): void {
    if (this._scheduled) {
      return
    }
    this._scheduled = true
    this._env.queueMicrotask(() => {
      this._scheduled = false
      this._start()
    })
  }

  private _isCurrent (gen: number): boolean {
    return !this._disposed && gen === this._reqGen
  }

  /** The datafeed's history promise; a synchronous throw becomes a rejection. */
  private async _fetch (pair: Pair, from: number, to: number, ctx: HistoryRequest): Promise<unknown> {
    return await this._datafeed.getHistoryKLineData(pair.symbol, pair.period, from, to, ctx)
  }

  private _start (): void {
    const pair = this._pending
    if (this._disposed || pair === null || this._chart === null) {
      return
    }
    this._pending = null
    this._current = pair
    const gen = ++this._reqGen
    this._endReplay(false)
    this._retire()
    this._unit = undefined
    this._sparse = false
    this._setStatus({ state: 'loading', loadingMore: false, error: null })
    // A cached pair paints at once (still under 'loading': the datafeed is
    // always still asked, below, and _show reconciles its answer with this).
    let cachedBars: readonly MarketBar[] | null = null
    if (this._cache !== null) {
      const entry = this._cache.get(historyKey(pair.symbol, pair.period), this._env.now())
      if (entry !== undefined) {
        cachedBars = entry.bars
        this._chart.applyNewData(entry.bars.slice(), entry.more)
      }
    }
    const [from, to] = requestRange(pair.period, this._env.now(), this._count)
    let timedOut = false
    // _retire() (above) already aborted and cleared any previous _reqAbort.
    const controller = new AbortController()
    this._reqAbort = controller
    const ctx: HistoryRequest = { signal: controller.signal, firstDataRequest: true, countBack: this._count }
    const timer = this._env.setTimeout(() => {
      if (this._isCurrent(gen) && this._shownGen !== gen) {
        timedOut = true
        // The timeout clears the chart. A late successful answer must restore
        // its complete history instead of merging into that discarded cache.
        cachedBars = null
        this._failInitial(gen, pair, new Error(`[super-chart] the history request for ${describe(pair)} did not settle within ${this._timeoutMs} ms`), true)
      }
    }, this._timeoutMs)
    this._fetch(pair, from, to, ctx).then(list => {
      this._env.clearTimeout(timer)
      if (this._isCurrent(gen)) {
        // Also after a timeout: a late answer is still the answer.
        try {
          this._show(gen, pair, list, cachedBars)
        } catch (e) {
          // The chart refused the bars (or a hook threw after the status moved on). Left
          // alone this was an unhandled rejection with no live subscription and no error
          // reported to the host; surface it like any other failed initial load instead.
          this._env.warn(`[super-chart] showing the history of ${describe(pair)} threw.`, e)
          try {
            this._failInitial(gen, pair, e, false)
          } catch (inner) {
            this._env.warn('[super-chart] reporting that failure threw as well.', inner)
          }
        }
      }
    }, error => {
      this._env.clearTimeout(timer)
      if (this._isCurrent(gen) && !timedOut) {
        this._failInitial(gen, pair, error, false)
      }
    })
  }

  private _show (gen: number, pair: Pair, raw: unknown, cachedBars: readonly MarketBar[] | null): void {
    const chart = this._chart
    if (chart === null) {
      return
    }
    const { bars: rawBars, noData } = unwrapHistory(raw)
    const { bars, unit, issues } = normalizeBars(rawBars)
    this._unit = bars.length > 0 ? unit : undefined
    this._report(issues)
    this._more = bars.length > 0 && !noData
    this._sparse = hasHoles(bars, pair.period)
    // Shown before applyNewData: when the bars do not fill the view, klinecharts
    // asks for older bars from inside applyNewData (9.7 loadMore, 9.8 'forward'),
    // and holds its loading flag until that request is answered. Asked while
    // this load still looked pending, it went unanswered and scroll-back never
    // fired again for the pair.
    this._shownGen = gen
    this._shown = pair
    this._setStatus({ state: bars.length > 0 ? 'ready' : 'empty', loadingMore: false, error: null })
    // Before the bars are drawn: the one hook a host can derive a per-symbol
    // display value (price precision) from without a second frame's delay.
    this._emit('bars', { bars, symbol: pair.symbol, period: pair.period })
    // A cached pair was already painted in full in _start(); if the fresh
    // answer's tail lines up with it, merge only the changed/new bars with
    // updateData so the user's scroll and zoom survive the revisit. Anything
    // else (no cache, a gap, or an answer that does not line up, e.g. a mock
    // feed re-anchored to "now") replaces the data as before.
    if (cachedBars !== null && cachedBars.length > 0 && mergeKind(cachedBars, bars) === 'tail') {
      const cutoff = cachedBars[cachedBars.length - 1].timestamp
      const tail = bars.filter(bar => bar.timestamp >= cutoff)
      if (chart.updateDataBatch !== undefined) {
        chart.updateDataBatch(tail, this._more)
      } else {
        for (const bar of tail) chart.updateData(bar)
      }
    } else {
      chart.applyNewData(bars, this._more)
    }
    if (this._cache !== null) {
      this._cache.set(historyKey(pair.symbol, pair.period), { bars, more: this._more, at: this._env.now() })
    }
    if (this._subscribed === null) {
      this._subscribe(gen, pair)
    }
  }

  private _failInitial (gen: number, pair: Pair, error: unknown, timeout: boolean): void {
    this._more = false
    this._shownGen = gen
    this._shown = pair
    const e: DataLoadError = { phase: 'initial', symbol: pair.symbol, period: pair.period, error, timeout }
    this._setStatus({ state: 'error', loadingMore: false, error: e })
    // Clear the old pair's bars: the new pair's label must not sit over them.
    this._chart?.applyNewData([], false)
    this._emitError(e)
  }

  private _subscribe (gen: number, pair: Pair): void {
    const callback = (data: MarketBar | MarketBar[]): void => {
      if (this._isCurrent(gen)) {
        this._onTick(data)
      }
    }
    try {
      this._datafeed.subscribe(pair.symbol, pair.period, callback as DatafeedSubscribeCallback)
      this._subscribed = pair
    } catch (e) {
      this._env.warn(`[super-chart] datafeed.subscribe threw for ${describe(pair)}; no live updates.`, e)
    }
  }

  /** Unsubscribe the active pair (once) and drop all pending work of the old generation. */
  private _retire (): void {
    const active = this._subscribed
    this._subscribed = null
    if (active !== null) {
      try {
        this._datafeed.unsubscribe(active.symbol, active.period)
      } catch (e) {
        this._env.warn(`[super-chart] datafeed.unsubscribe threw for ${describe(active)}.`, e)
      }
    }
    this._coalescer.cancel()
    this._abandonSync()
    this._cancelMore()
    this._reqAbort?.abort()
    this._reqAbort = null
  }

  /** Drop a scroll-back page in flight (or waiting out its backoff): the data it would extend is gone. */
  private _cancelMore (): void {
    this._moreGen++
    this._moreFailures = 0
    if (this._moreTimer !== null) {
      this._env.clearTimeout(this._moreTimer)
      this._moreTimer = null
    }
    this._moreAbort?.abort()
    this._moreAbort = null
    // Wake a loadUntil() waiting on this generation's page at once: its
    // _loadOlder answer, whenever it arrives, will now be dropped silently
    // (moreGen has moved on), and loadUntil's own gen check (above, in its
    // loop) needs a settled promise to reach.
    const pending = this._pendingOlderPage
    this._pendingOlderPage = null
    pending?.(null)
    this._chart?.cancelHistoryLoad?.()
  }

  // ---- scroll-back ----------------------------------------------------------

  /**
   * klinecharts asks for bars older than `timestamp` (its first bar). The
   * request's `to` is that timestamp, exclusive; the page is reduced to bars
   * strictly older than the chart's first bar (feeds that ignore the range or
   * include `to` would otherwise prepend copies), and an empty page ends
   * paging.
   */
  private _loadOlder (timestamp: number | null, answer: (bars: MarketBar[], more: boolean) => void): void {
    const pair = this._shown
    // A load for another pair is under way: its applyNewData resets
    // klinecharts' loading flag, and an answer now would land on the wrong data.
    if (this._disposed || pair === null || this._shownGen !== this._reqGen) {
      return
    }
    if (timestamp === null) {
      answer([], false)
      return
    }
    const gen = this._reqGen
    const moreGen = ++this._moreGen
    const [from, to] = requestRange(pair.period, timestamp, this._count)
    this._setLoadingMore(true)
    this._moreAbort?.abort()
    const controller = new AbortController()
    this._moreAbort = controller
    // `before` is the same instant as `to` here: the chart's oldest loaded
    // bar, which this page must not include (see the doc above).
    const ctx: HistoryRequest = { signal: controller.signal, firstDataRequest: false, countBack: this._count, before: timestamp }
    this._fetch(pair, from, to, ctx).then(raw => {
      if (!this._isCurrent(gen) || moreGen !== this._moreGen) {
        return
      }
      this._setLoadingMore(false)
      this._moreFailures = 0
      const { bars: rawBars, noData } = unwrapHistory(raw)
      if (this._unit === undefined) {
        this._unit = decideUnit(rawBars)
      }
      const { bars, issues } = normalizeBars(rawBars, this._unit ?? 1)
      this._report(issues)
      const list = this._chart?.getDataList()
      const page = olderThan(bars, list !== undefined && list.length > 0 ? list[0].timestamp : timestamp)
      this._more = page.length > 0 && !noData
      if (this._replay !== null) {
        this._replay = prependReplay(this._replay, page)
      }
      answer(page, this._more)
    }, error => {
      if (!this._isCurrent(gen) || moreGen !== this._moreGen) {
        return
      }
      this._setLoadingMore(false)
      this._emitError({ phase: 'more', symbol: pair.symbol, period: pair.period, error, timeout: false })
      // Release klinecharts' loading flag after a backoff, never at once: at
      // the left edge, klinecharts 9.1-9.7 asks again synchronously, which
      // would hammer a failing feed in a tight loop.
      const delay = Math.min(this._moreRetry.base * 2 ** this._moreFailures, this._moreRetry.max)
      this._moreFailures++
      this._moreTimer = this._env.setTimeout(() => {
        this._moreTimer = null
        if (this._isCurrent(gen) && moreGen === this._moreGen) {
          answer([], true)
        }
      }, delay)
    })
  }

  // ---- live ticks -----------------------------------------------------------

  private _onTick (data: MarketBar | MarketBar[]): void {
    const raw = Array.isArray(data) ? data : [data]
    if (raw.length === 0) {
      return
    }
    if (this._unit === undefined) {
      this._unit = decideUnit(raw)
    }
    const { bars, issues } = normalizeBars(raw, this._unit ?? 1)
    this._report(issues)
    for (const bar of bars) {
      this._routeTick(bar)
    }
  }

  private _routeTick (bar: MarketBar): void {
    if (this._replay !== null) {
      this._replay = tickReplay(this._replay, bar)
      return
    }
    if (this._syncing) {
      this._hold(bar)
      return
    }
    const last = this._coalescer.lastTs() ?? lastTimestamp(this._chart)
    if (last !== undefined && bar.timestamp < last) {
      this._warnOnce('late', '[super-chart] a live bar older than the newest bar was ignored (klinecharts cannot update an older bar in place).')
      return
    }
    if (last !== undefined && !this._sparse && this._isGap(last, bar.timestamp) && this._canSync()) {
      this._startSync(bar)
      return
    }
    this._coalescer.push(bar)
  }

  private _applyTicks (bars: MarketBar[]): void {
    const chart = this._chart
    if (chart === null || this._disposed) {
      return
    }
    if (chart.updateDataBatch !== undefined) {
      chart.updateDataBatch(bars)
    } else {
      for (const bar of bars) chart.updateData(bar)
    }
    // An empty history followed by live bars: the chart has data now, and
    // "No data" must not stay over it.
    if (this._status.state === 'empty' && chart.getDataList().length > 0) {
      this._setStatus({ ...this._status, state: 'ready' })
    }
  }

  // ---- gap backfill ---------------------------------------------------------

  /** A bar at least two periods after the last one: at least one bar is missing. */
  private _isGap (last: number, ts: number): boolean {
    const period = this._shown?.period
    if (period === undefined) {
      return false
    }
    const edge = addPeriods(period, last, 2)
    return Number.isFinite(edge) && ts >= edge
  }

  private _canSync (): boolean {
    return !this._disposed && this._chart !== null && this._shown !== null &&
      this._shownGen === this._reqGen && this._replay === null && !this._syncing &&
      this._subscribed !== null && (this._status.state === 'ready' || this._status.state === 'empty') &&
      this._env.now() - this._lastSyncAt >= this._syncMinMs
  }

  /** Hold a tick while a backfill runs (the same timestamp replaces, older is dropped). */
  private _hold (bar: MarketBar): void {
    const last = this._held[this._held.length - 1]
    if (last === undefined || bar.timestamp > last.timestamp) {
      this._held.push(bar)
    } else if (bar.timestamp === last.timestamp) {
      this._held[this._held.length - 1] = bar
    }
  }

  /** Stop a backfill in flight; returns the ticks it held. */
  private _abandonSync (): MarketBar[] {
    const held = this._held
    this._syncGen++
    this._syncing = false
    this._held = []
    if (this._syncTimer !== null) {
      this._env.clearTimeout(this._syncTimer)
      this._syncTimer = null
    }
    this._syncAbort?.abort()
    this._syncAbort = null
    return held
  }

  /**
   * A backfill failed or timed out: apply the ticks it held, with the hole
   * (what happened before backfills existed), and report it.
   */
  private _giveUpSync (pair: Pair, error: unknown, timeout: boolean): void {
    for (const bar of this._abandonSync()) {
      this._coalescer.push(bar)
    }
    this._emitError({ phase: 'sync', symbol: pair.symbol, period: pair.period, error, timeout })
  }

  /**
   * Fetch from the last bar (inclusive: its OHLC is partial) to now, then
   * append in timestamp order: the bars that close the hole, then the held
   * tick(s). If the answer does not reach back to the last bar (the hole is
   * wider than one window), the latest window replaces the data instead.
   * Live ticks are held while it runs, so it gives up after `syncTimeoutMs`.
   */
  private _startSync (tick: MarketBar | null): void {
    const pair = this._shown
    const chart = this._chart
    if (pair === null || chart === null) {
      return
    }
    const gen = this._reqGen
    const syncGen = ++this._syncGen
    this._coalescer.flush()
    this._syncing = true
    this._held = tick !== null ? [tick] : []
    const now = this._env.now()
    this._lastSyncAt = now
    const lastTs = lastTimestamp(chart)
    const from = lastTs ?? requestRange(pair.period, now, this._count)[0]
    this._syncTimer = this._env.setTimeout(() => {
      this._syncTimer = null
      if (this._isCurrent(gen) && syncGen === this._syncGen) {
        this._giveUpSync(pair, new Error(`[super-chart] the backfill request for ${describe(pair)} did not settle within ${this._syncTimeoutMs} ms`), true)
      }
    }, this._syncTimeoutMs)
    this._syncAbort?.abort()
    const controller = new AbortController()
    this._syncAbort = controller
    const ctx: HistoryRequest = { signal: controller.signal, firstDataRequest: false, countBack: this._count }
    this._fetch(pair, Math.min(from, now), now, ctx).then(raw => {
      if (!this._isCurrent(gen) || syncGen !== this._syncGen) {
        return
      }
      const held = this._abandonSync()
      const { bars: rawBars, noData } = unwrapHistory(raw)
      if (this._unit === undefined) {
        this._unit = decideUnit(rawBars)
      }
      const { bars, issues } = normalizeBars(rawBars, this._unit ?? 1)
      this._report(issues)
      const before = held.length > 0 ? held[0].timestamp : Infinity
      const cur = lastTimestamp(chart)
      if (bars.length > 0 && cur !== undefined && bars[0].timestamp <= cur) {
        for (const bar of bars) {
          if ((cur === undefined || bar.timestamp >= cur) && bar.timestamp < before) {
            this._coalescer.push(bar)
          }
        }
      } else if (bars.length > 0) {
        this._coalescer.cancel()
        // A scroll-back page in flight belongs to the data being replaced.
        this._cancelMore()
        const window = bars.filter(bar => bar.timestamp < before)
        this._more = window.length > 0 && !noData
        this._sparse = hasHoles(window, pair.period)
        // Status first: applyNewData may ask for older bars at once (see _show).
        this._setStatus({ state: window.length > 0 || held.length > 0 ? 'ready' : 'empty', loadingMore: false, error: null })
        chart.applyNewData(window, this._more)
      }
      for (const bar of held) {
        this._coalescer.push(bar)
      }
    }, error => {
      if (!this._isCurrent(gen) || syncGen !== this._syncGen) {
        return
      }
      this._giveUpSync(pair, error, false)
    })
  }

  private _listen (): void {
    const doc = this._env.visibility
    if (doc !== undefined) {
      const onVisibility = (): void => {
        this._coalescer.visibilityChanged()
        if (doc.hidden) {
          this._hiddenAt = this._env.now()
          return
        }
        const hiddenAt = this._hiddenAt
        this._hiddenAt = null
        const period = this._shown?.period
        if (hiddenAt === null || period === undefined) {
          return
        }
        // Back after more than one period: bars were probably missed.
        const edge = addPeriods(period, hiddenAt, 1)
        if (Number.isFinite(edge) && this._env.now() >= edge) {
          this.resync()
        }
      }
      doc.addEventListener('visibilitychange', onVisibility)
      this._detach.push(() => { doc.removeEventListener('visibilitychange', onVisibility) })
    }
    const win = this._env.connectivity
    if (win !== undefined) {
      const onOnline = (): void => {
        if (this._status.state === 'error') {
          this.reload()
        } else {
          this.resync()
        }
      }
      win.addEventListener('online', onOnline)
      this._detach.push(() => { win.removeEventListener('online', onOnline) })
    }
  }

  // ---- replay internals -----------------------------------------------------

  private _endReplay (restore: boolean): void {
    const state = this._replay
    if (state === null) {
      return
    }
    this._replay = null
    if (restore) {
      this._chart?.applyNewData(state.full.slice(), this._more)
    }
    this._emit('replay', false)
  }

  // ---- status and events ----------------------------------------------------

  private _setStatus (status: DataStatus): void {
    this._status = status
    this._emit('status', status)
  }

  private _setLoadingMore (loadingMore: boolean): void {
    if (this._status.loadingMore !== loadingMore) {
      this._setStatus({ ...this._status, loadingMore })
    }
  }

  private _emit<K extends keyof LoaderEvents> (type: K, value: LoaderEvents[K]): void {
    for (const fn of [...this._listeners[type]]) {
      try {
        fn(value)
      } catch (e) {
        this._env.warn(`[super-chart] a ${type} listener threw.`, e)
      }
    }
  }

  private _emitError (e: DataLoadError): void {
    const what = e.phase === 'initial' ? 'history' : e.phase === 'more' ? 'older history' : 'missed bars'
    this._env.warn(`[super-chart] loading ${what} for ${describe(e)} failed.`, e.error)
    this._emit('error', e)
  }

  private _warnOnce (kind: string, message: string): void {
    if (!this._warned.has(kind)) {
      this._warned.add(kind)
      this._env.warn(message)
    }
  }

  /** One console warning per kind of data fix, per chart. */
  private _report (issues: BarIssues): void {
    if (issues.notArray) {
      this._warnOnce('notArray', '[super-chart] the datafeed returned something that is not an array of bars; treated as no data.')
    }
    if (issues.seconds) {
      this._warnOnce('seconds', '[super-chart] bar timestamps look like seconds; converted to milliseconds.')
    }
    if (issues.coerced) {
      this._warnOnce('coerced', '[super-chart] bar fields that were not numbers (numeric strings) were converted to numbers.')
    }
    if (issues.unsorted) {
      this._warnOnce('unsorted', '[super-chart] bars were not in ascending time order; sorted.')
    }
    if (issues.duplicates > 0) {
      this._warnOnce('duplicates', '[super-chart] bars with duplicate timestamps; the last of each was kept.')
    }
    if (issues.dropped > 0) {
      this._warnOnce('dropped', `[super-chart] dropped ${issues.dropped} bar(s) with a missing or non-finite timestamp, open, high, low or close.`)
    }
  }
}
