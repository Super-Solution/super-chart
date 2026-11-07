import { describe, expect, it } from 'vitest'

import type { MarketBar as KLineData } from '../core/types'

import { DataLoader, hasHoles } from './loader'
import type { DataLoadError, DataStatus, LoaderOptions } from './loader'
import { requestRange } from './requestRange'
import { D1, H1, H4, HOUR, T0, bar, deferredFeed, fakeChart, fakeEnv, hours, settle, sym } from './testkit'
import type { DeferredFeed, FakeChart, FakeEnv } from './testkit'

interface Setup {
  env: FakeEnv
  feed: DeferredFeed
  c: FakeChart
  loader: DataLoader
  statuses: DataStatus[]
  errors: DataLoadError[]
  replays: boolean[]
}

function setup (opts: { kind?: 'loadMore' | 'callback', viewSize?: number, loader?: Partial<LoaderOptions> } = {}): Setup {
  const env = fakeEnv()
  const feed = deferredFeed()
  const c = fakeChart(opts.kind ?? 'loadMore', { viewSize: opts.viewSize })
  const loader = new DataLoader({ datafeed: feed.datafeed, env: env.env, ...opts.loader })
  const statuses: DataStatus[] = []
  const errors: DataLoadError[] = []
  const replays: boolean[] = []
  loader.on('status', s => { statuses.push(s) })
  loader.on('error', e => { errors.push(e) })
  loader.on('replay', r => { replays.push(r) })
  loader.attach(c.chart)
  return { env, feed, c, loader, statuses, errors, replays }
}

/** The newest bar of the latest window, aligned to the hour before "now". */
const LAST = T0

async function loaded (t: Setup, ticker = 'SUPER', period = H1, bars = hours(300, LAST)): Promise<void> {
  t.loader.request(sym(ticker), period)
  await settle()
  t.feed.last().resolve(bars)
  await settle()
}

describe('SC-016: symbol/period changes during a load never freeze the chart', () => {
  it('a change during the initial load: the final pair is fetched and drawn; the stale answer is dropped', async () => {
    const t = setup()
    t.loader.request(sym('SUPER'), H1)
    await settle()
    t.loader.request(sym('ETH'), H1)
    await settle()
    expect(t.feed.fetched()).toEqual(['SUPER 1H', 'ETH 1H'])
    t.feed.history[1].resolve(hours(50, LAST, 3000))
    await settle()
    t.feed.history[0].resolve(hours(50, LAST, 100)) // late SUPER answer
    await settle()
    expect(t.c.list[t.c.list.length - 1].close).toBeGreaterThan(2000)
    expect(t.c.calls.applyNewData.length).toBe(1)
    expect(t.loader.shown?.symbol.ticker).toBe('ETH')
    expect(t.feed.log).toEqual(['sub ETH 1H'])
    // ...and the loader is alive: a later idle change loads (it used to fetch nothing).
    t.loader.request(sym('BTC'), H4)
    await settle()
    expect(t.feed.fetched()).toEqual(['SUPER 1H', 'ETH 1H', 'BTC 4H'])
  })

  it('setSymbol and setPeriod in the same tick load the final pair once', async () => {
    const t = setup()
    await loaded(t)
    t.loader.request(sym('ETH'), H1)
    t.loader.request(sym('ETH'), H4)
    await settle()
    expect(t.feed.fetched()).toEqual(['SUPER 1H', 'ETH 4H'])
  })

  it('subscribe and unsubscribe strictly alternate, and unsubscribe names the subscribed pair', async () => {
    const t = setup()
    await loaded(t)
    t.loader.request(sym('ETH'), H1)
    await settle()
    t.loader.request(sym('BTC'), D1) // supersedes ETH before it resolves
    await settle()
    t.feed.history[1].resolve(hours(10, LAST))
    t.feed.history[2].resolve(hours(10, LAST))
    await settle()
    t.loader.dispose()
    expect(t.feed.log).toEqual(['sub SUPER 1H', 'unsub SUPER 1H', 'sub BTC D', 'unsub BTC D'])
  })

  it('a change during a scroll-back load: the page for the old pair is never prepended to the new data', async () => {
    const t = setup()
    await loaded(t)
    expect(t.c.scrollToStart()).toBe(true)
    await settle()
    expect(t.feed.fetched()).toEqual(['SUPER 1H', 'SUPER 1H'])
    t.loader.request(sym('ETH'), H4)
    await settle()
    t.feed.history[1].resolve(hours(100, LAST - 300 * HOUR)) // the old page arrives first
    t.feed.history[2].resolve(hours(40, LAST, 3000))
    await settle()
    expect(t.c.list.length).toBe(40)
    expect(t.c.calls.applyMoreData.length).toBe(0)
    expect(t.c.list.every(b => b.close > 2000)).toBe(true)
  })

  it('while a new pair loads, scroll-back uses nothing (and never the pending pair)', async () => {
    const t = setup()
    await loaded(t)
    t.loader.request(sym('ETH'), H4)
    await settle()
    t.c.scrollToStart()
    await settle()
    expect(t.feed.fetched()).toEqual(['SUPER 1H', 'ETH 4H'])
  })
})

describe('SC-017: a rejected or hung request always settles the state', () => {
  it('initial reject: error state (no spinner), data cleared, one error event, and the next change fetches once', async () => {
    const t = setup()
    await loaded(t)
    t.loader.request(sym('ETH'), H1)
    await settle()
    t.feed.last().reject(new Error('feed down'))
    await settle()
    expect(t.loader.status.state).toBe('error')
    expect(t.c.list).toEqual([])
    expect(t.errors.map(e => [e.phase, e.symbol.ticker, e.timeout, String(e.error)])).toEqual([['initial', 'ETH', false, 'Error: feed down']])
    expect(t.feed.log).toEqual(['sub SUPER 1H', 'unsub SUPER 1H'])
    t.loader.request(sym('ETH'), H4)
    await settle()
    expect(t.feed.fetched()).toEqual(['SUPER 1H', 'ETH 1H', 'ETH 4H'])
    t.feed.last().resolve(hours(20, LAST))
    await settle()
    expect(t.loader.status.state).toBe('ready')
    expect(t.c.list.length).toBe(20)
  })

  it('a datafeed that throws synchronously is handled like a rejection', async () => {
    const t = setup()
    t.feed.datafeed.getHistoryKLineData = () => { throw new Error('sync boom') }
    t.loader.request(sym('SUPER'), H1)
    await settle()
    expect(t.loader.status.state).toBe('error')
    expect(t.errors.length).toBe(1)
  })

  it('a hung request becomes an error after the timeout; a late answer is still shown', async () => {
    const t = setup({ loader: { loadTimeoutMs: 20_000 } })
    t.loader.request(sym('SUPER'), H1)
    await settle()
    t.env.advance(19_999)
    expect(t.loader.status.state).toBe('loading')
    t.env.advance(1)
    expect(t.loader.status.state).toBe('error')
    expect(t.errors[0].timeout).toBe(true)
    t.feed.last().resolve(hours(30, LAST))
    await settle()
    expect(t.loader.status.state).toBe('ready')
    expect(t.c.list.length).toBe(30)
    expect(t.feed.log).toEqual(['sub SUPER 1H'])
  })

  it('a hung request that rejects after the timeout: still one error and no second clear', async () => {
    const t = setup({ loader: { loadTimeoutMs: 20_000 } })
    t.loader.request(sym('SUPER'), H1)
    await settle()
    t.env.advance(20_000)
    expect(t.errors.length).toBe(1)
    const clears = t.c.calls.applyNewData.length
    t.feed.last().reject(new Error('late failure'))
    await settle()
    expect(t.errors.length).toBe(1)
    expect(t.c.calls.applyNewData.length).toBe(clears)
    expect(t.loader.status.state).toBe('error')
  })

  it('reload() retries the current pair after a failure', async () => {
    const t = setup()
    t.loader.request(sym('SUPER'), H1)
    await settle()
    t.feed.last().reject(new Error('x'))
    await settle()
    t.loader.reload()
    await settle()
    expect(t.feed.fetched()).toEqual(['SUPER 1H', 'SUPER 1H'])
    t.feed.last().resolve(hours(5, LAST))
    await settle()
    expect(t.loader.status.state).toBe('ready')
  })

  it.each(['loadMore', 'callback'] as const)('%s: a rejected scroll-back page emits once, re-arms only after a backoff, and retries', async kind => {
    const t = setup({ kind })
    await loaded(t)
    t.c.scrollToStart()
    await settle()
    expect(t.loader.status.loadingMore).toBe(true)
    t.feed.last().reject(new Error('page down'))
    await settle()
    expect(t.loader.status.loadingMore).toBe(false)
    expect(t.errors.map(e => e.phase)).toEqual(['more'])
    expect(t.c.loading).toBe(true) // not released at once (9.1-9.7 would loop at the left edge)
    t.env.advance(999)
    expect(t.c.loading).toBe(true)
    t.env.advance(1)
    expect(t.c.loading).toBe(false)
    expect(t.c.more).toBe(true)
    expect(t.c.scrollToStart()).toBe(true)
    await settle()
    expect(t.feed.history.length).toBe(3)
    t.feed.last().reject(new Error('again'))
    await settle()
    t.env.advance(1999)
    expect(t.c.loading).toBe(true) // the backoff doubled
    t.env.advance(1)
    expect(t.c.loading).toBe(false)
    expect(t.loader.status.state).toBe('ready') // the chart itself is fine
  })

  it('an empty history is the empty state, not an error', async () => {
    const t = setup()
    await loaded(t, 'NEW', H1, [])
    expect(t.loader.status).toEqual({ state: 'empty', loadingMore: false, error: null })
    expect(t.errors).toEqual([])
  })

  it('live bars after an empty history: the state becomes ready, so "No data" does not stay over them', async () => {
    const t = setup()
    await loaded(t, 'NEW', H1, [])
    expect(t.loader.status.state).toBe('empty')
    t.feed.tick(bar(LAST, 100))
    t.feed.tick(bar(LAST + HOUR, 101))
    t.env.frame()
    expect(t.c.list.length).toBe(2)
    expect(t.loader.status).toEqual({ state: 'ready', loadingMore: false, error: null })
  })

  it('states: loading while a request is in flight, then ready', async () => {
    const t = setup()
    await loaded(t)
    expect(t.statuses.map(s => s.state)).toEqual(['loading', 'ready'])
  })
})

describe('SC-006: dispose and stale ticks', () => {
  it('dispose unsubscribes the active pair once', async () => {
    const t = setup()
    await loaded(t)
    t.loader.dispose()
    t.loader.dispose()
    expect(t.feed.log).toEqual(['sub SUPER 1H', 'unsub SUPER 1H'])
    expect(t.env.listenerCount()).toBe(0)
  })

  it('dispose while the history is in flight: no subscribe and no data after it', async () => {
    const t = setup()
    t.loader.request(sym('SUPER'), H1)
    await settle()
    t.loader.dispose()
    t.feed.last().resolve(hours(10, LAST))
    await settle()
    expect(t.feed.log).toEqual([])
    expect(t.c.calls.applyNewData.length).toBe(0)
  })

  it('a tick through a superseded subscription is not applied to the new pair', async () => {
    const t = setup()
    await loaded(t, 'AAA', H1, hours(10, LAST, 100))
    const oldTick = t.feed.listeners[0]
    t.loader.request(sym('BBB'), H1)
    await settle()
    t.feed.last().resolve(hours(10, LAST, 5000))
    await settle()
    oldTick(bar(LAST, 100.5))
    t.env.frame()
    t.env.advance(10)
    expect(t.c.list[t.c.list.length - 1].close).toBeGreaterThan(4000)
    expect(t.c.calls.updateData).toEqual([])
  })

  it('a tick still waiting for its frame is dropped on a switch whose history arrives before that frame', async () => {
    const t = setup()
    await loaded(t, 'AAA', H1, hours(10, LAST, 100))
    t.feed.tick(bar(LAST, 100.5)) // queued for the next frame
    t.loader.request(sym('BBB'), H1)
    await settle()
    t.feed.last().resolve(hours(10, LAST, 5000)) // a cached feed: answered before the frame
    await settle()
    t.env.frame()
    expect(t.c.calls.updateData).toEqual([])
    expect(t.c.list[t.c.list.length - 1].close).toBeGreaterThan(4000)
  })

  it('dispose with a tick pending: no updateData after dispose', async () => {
    const t = setup()
    await loaded(t)
    t.feed.tick(bar(LAST, 101))
    t.loader.dispose()
    t.env.frame()
    t.env.advance(100)
    expect(t.c.calls.updateData).toEqual([])
  })
})

describe('SC-001: ticks are coalesced into one pass per frame', () => {
  it('30 ticks of one bar: nothing until the frame, then one updateData with the last tick', async () => {
    const t = setup()
    await loaded(t)
    for (let i = 0; i < 30; i++) t.feed.tick(bar(LAST, 100 + i))
    expect(t.c.calls.updateData.length).toBe(0)
    t.env.frame()
    expect(t.c.calls.updateData.length).toBe(1)
    expect(t.c.list[t.c.list.length - 1].close).toBe(129)
  })

  it('a bar closing inside the frame: both bars, in order; a late tick for the closed bar is dropped', async () => {
    const t = setup()
    await loaded(t)
    t.feed.tick(bar(LAST, 101))
    t.feed.tick(bar(LAST + HOUR, 102))
    t.feed.tick(bar(LAST, 999)) // late
    t.env.frame()
    expect(t.c.calls.updateData.map(b => [b.timestamp - LAST, b.close])).toEqual([[0, 101], [HOUR, 102]])
  })

  it('a hidden page flushes on a timeout (frames do not run there), also when it hides with a frame pending', async () => {
    const t = setup()
    await loaded(t)
    t.feed.tick(bar(LAST, 101))
    expect(t.env.frames).toBe(1)
    t.env.setHidden(true)
    expect(t.env.frames).toBe(0)
    t.env.advance(0)
    expect(t.c.calls.updateData.length).toBe(1)
    t.feed.tick(bar(LAST, 102))
    expect(t.env.frames).toBe(0)
    t.env.advance(0)
    expect(t.c.calls.updateData.length).toBe(2)
  })

  it('tickThrottleMs: at most one pass per window', async () => {
    const t = setup({ loader: { tickThrottleMs: 250 } })
    await loaded(t)
    t.feed.tick(bar(LAST, 101))
    t.env.advance(0)
    expect(t.c.calls.updateData.length).toBe(1)
    for (let i = 0; i < 10; i++) { t.feed.tick(bar(LAST, 102 + i)); t.env.advance(20) }
    expect(t.c.calls.updateData.length).toBe(1)
    t.env.advance(60)
    expect(t.c.calls.updateData.length).toBe(2)
    expect(t.c.list[t.c.list.length - 1].close).toBe(111)
  })

  it('ticks 250 ms apart: each one is applied in the next frame (nothing is held back across frames)', async () => {
    const t = setup()
    await loaded(t)
    for (let i = 0; i < 4; i++) {
      t.feed.tick(bar(LAST, 101 + i))
      t.env.frame()
      expect(t.c.calls.updateData.length).toBe(i + 1)
      expect(t.c.list[t.c.list.length - 1].close).toBe(101 + i)
      t.env.advance(250)
      expect(t.c.calls.updateData.length).toBe(i + 1)
    }
  })

  it('a live bar older than the newest bar is ignored with one warning', async () => {
    const t = setup()
    await loaded(t)
    t.feed.tick(bar(LAST - HOUR, 1))
    t.feed.tick(bar(LAST - 2 * HOUR, 1))
    t.env.frame()
    expect(t.c.calls.updateData).toEqual([])
    expect(t.env.warnings.filter(w => w.includes('older than the newest bar')).length).toBe(1)
  })
})

describe('SC-029: the subscribe callback takes an array (snapshot semantics)', () => {
  it('[final k, new k+1]: the closed bar gets its final close and one bar is added', async () => {
    const t = setup()
    await loaded(t, 'SUPER', H1, hours(10, LAST, 100))
    t.feed.tick([bar(LAST + HOUR, 103), bar(LAST, 102.5)]) // unsorted on purpose
    t.env.frame()
    expect(t.c.list.length).toBe(11)
    expect(t.c.list[9].close).toBe(102.5)
    expect(t.c.list[10].close).toBe(103)
  })

  it('bars are replaced, never merged: volume is not summed', async () => {
    const t = setup()
    await loaded(t, 'SUPER', H1, hours(10, LAST, 100))
    t.feed.tick([bar(LAST, 101, { volume: 50 }), bar(LAST, 102, { volume: 60 })])
    t.env.frame()
    expect(t.c.list[9].volume).toBe(60)
  })
})

describe('SC-019 / SC-024: request ranges and scroll-back merging', () => {
  it('the first request is 500 bars before now; scroll-back asks up to the first bar, exclusive', async () => {
    const t = setup()
    await loaded(t)
    expect([t.feed.history[0].from, t.feed.history[0].to]).toEqual(requestRange(H1, t.env.now, 500))
    t.c.scrollToStart()
    await settle()
    const first = t.c.list[0].timestamp
    expect(t.feed.history[1].to).toBe(first)
    expect(t.feed.history[1].from).toBe(first - 500 * HOUR)
  })

  it.each(['loadMore', 'callback'] as const)('%s: a feed that ignores the range gets no duplicates, and paging stops', async kind => {
    const t = setup({ kind })
    const latest = hours(300, LAST)
    await loaded(t, 'SUPER', H1, latest)
    t.c.scrollToStart()
    await settle()
    t.feed.last().resolve(latest) // the same window again
    await settle()
    const ts = t.c.timestamps()
    expect(new Set(ts).size).toBe(ts.length)
    expect(ts.length).toBe(300)
    expect(t.c.more).toBe(false)
    expect(t.c.scrollToStart()).toBe(false)
    expect(t.feed.history.length).toBe(2)
  })

  it.each(['loadMore', 'callback'] as const)('%s: a first page shorter than the view asks for older bars from inside applyNewData, and that request is answered', async kind => {
    const t = setup({ kind, viewSize: 100 })
    await loaded(t, 'SUPER', H1, hours(40, LAST))
    const first = t.c.list[0].timestamp
    expect(t.feed.history.length).toBe(2)
    expect(t.feed.history[1].to).toBe(first)
    expect(t.loader.status).toEqual({ state: 'ready', loadingMore: true, error: null })
    t.feed.last().resolve(hours(50, first - HOUR))
    await settle()
    const ts = t.c.timestamps()
    expect(ts.length).toBe(90)
    expect(ts.every((v, i) => i === 0 || v - ts[i - 1] === HOUR)).toBe(true)
    expect(t.loader.status.loadingMore).toBe(false)
  })

  it('an inclusive feed (returns the bar at `to`): no duplicate at the seam', async () => {
    const t = setup()
    await loaded(t, 'SUPER', H1, hours(100, LAST))
    const first = t.c.list[0].timestamp
    t.c.scrollToStart()
    await settle()
    t.feed.last().resolve(hours(50, first))
    await settle()
    const ts = t.c.timestamps()
    expect(ts.length).toBe(149)
    expect(new Set(ts).size).toBe(149)
    expect(ts.every((v, i) => i === 0 || v - ts[i - 1] === HOUR)).toBe(true)
  })

  it('an exclusive feed: no bar missing at the seam', async () => {
    const t = setup()
    await loaded(t, 'SUPER', H1, hours(100, LAST))
    const first = t.c.list[0].timestamp
    t.c.scrollToStart()
    await settle()
    const h = t.feed.last()
    t.feed.last().resolve(hours(50, h.to - HOUR).filter(b => b.timestamp < h.to))
    await settle()
    const ts = t.c.timestamps()
    expect(ts[49]).toBe(first - HOUR)
    expect(ts.every((v, i) => i === 0 || v - ts[i - 1] === HOUR)).toBe(true)
  })
})

describe('SC-025: bars are normalized at every entry point', () => {
  it('descending seconds history is drawn ascending in ms, and later second ticks are scaled too', async () => {
    const t = setup()
    const secs = hours(5, LAST).reverse().map(b => ({ ...b, timestamp: b.timestamp / 1000 }))
    await loaded(t, 'SUPER', H1, secs)
    expect(t.c.timestamps()).toEqual(hours(5, LAST).map(b => b.timestamp))
    t.feed.tick({ ...bar(LAST, 150), timestamp: LAST / 1000 })
    t.env.frame()
    expect(t.c.list.length).toBe(5)
    expect(t.c.list[4].close).toBe(150)
  })

  it('numeric strings are converted, with one warning', async () => {
    const t = setup()
    const strings = hours(3, LAST).map(b => ({ ...b, close: String(b.close) })) as unknown as KLineData[]
    await loaded(t, 'SUPER', H1, strings)
    expect(t.c.list.map(b => typeof b.close)).toEqual(['number', 'number', 'number'])
    t.feed.tick({ ...bar(LAST, 1), open: '1' } as unknown as KLineData)
    t.env.frame()
    expect(t.c.list[2].open).toBe(1)
    expect(t.env.warnings.filter(w => w.includes('numeric strings')).length).toBe(1)
  })

  it('a bar with NaN close never reaches the chart', async () => {
    const t = setup()
    const bars = hours(5, LAST)
    bars[2] = { ...bars[2], close: NaN }
    await loaded(t, 'SUPER', H1, bars)
    expect(t.c.list.length).toBe(4)
    expect(t.c.list.every(b => Number.isFinite(b.close))).toBe(true)
  })
})

describe('SC-035: klinecharts 9.8 setLoadDataCallback', () => {
  it('a "backward" request is answered at once with no data and no more', async () => {
    const t = setup({ kind: 'callback' })
    await loaded(t)
    t.c.reachEnd()
    expect(t.c.calls.backwardAnswers).toEqual([{ data: [], more: false }])
  })

  it('scroll-back answers through the callback, not the deprecated applyMoreData', async () => {
    const t = setup({ kind: 'callback' })
    await loaded(t, 'SUPER', H1, hours(100, LAST))
    t.c.scrollToStart()
    await settle()
    t.feed.last().resolve(hours(50, t.c.list[0].timestamp - HOUR))
    await settle()
    expect(t.c.list.length).toBe(150)
    expect(t.c.calls.applyMoreData.length).toBe(0)
  })
})

describe('SC-018 / SC-012: replay is a data mode', () => {
  it('ticks during replay are buffered, not drawn; exit shows them', async () => {
    const t = setup()
    await loaded(t, 'SUPER', H1, hours(100, LAST))
    expect(t.loader.enterReplay()).toBe(true)
    const shown = t.c.list.length
    t.feed.tick(bar(LAST, 150))
    t.feed.tick(bar(LAST + HOUR, 151))
    t.env.frame()
    expect(t.c.list.length).toBe(shown)
    expect(t.c.calls.updateData).toEqual([])
    t.loader.exitReplay()
    expect(t.c.list.length).toBe(101)
    expect(t.c.list[99].close).toBe(150)
    expect(t.c.list[100].close).toBe(151)
    expect(t.replays).toEqual([true, false])
  })

  it('a forward step appends with updateData (the view keeps its scroll); a step back rebuilds', async () => {
    const t = setup()
    await loaded(t, 'SUPER', H1, hours(100, LAST))
    t.loader.enterReplay()
    const rebuilds = t.c.calls.applyNewData.length
    for (let i = 0; i < 20; i++) t.loader.replayStep(1)
    expect(t.c.calls.applyNewData.length).toBe(rebuilds)
    expect(t.c.calls.updateData.length).toBe(20)
    expect(t.c.list.length).toBe(81)
    t.loader.replayStep(-1)
    expect(t.c.calls.applyNewData.length).toBe(rebuilds + 1)
    expect(t.c.list.length).toBe(80)
  })

  it('a symbol change during replay ends it without restoring the old snapshot', async () => {
    const t = setup()
    await loaded(t, 'AAA', H1, hours(100, LAST, 100))
    t.loader.enterReplay()
    const before = t.c.calls.applyNewData.length
    t.loader.request(sym('BBB'), H1)
    await settle()
    expect(t.loader.replaying).toBe(false)
    expect(t.replays).toEqual([true, false])
    expect(t.c.calls.applyNewData.length).toBe(before) // no AAA snapshot flashed
    t.feed.last().resolve(hours(100, LAST, 5000))
    await settle()
    t.loader.replayStep(1)
    expect(t.c.list.every(b => b.close > 4000)).toBe(true)
  })

  it('scroll-back during replay: the page goes into the series and the head stays on its bar', async () => {
    const t = setup()
    await loaded(t, 'SUPER', H1, hours(100, LAST))
    t.loader.enterReplay()
    const head = t.c.list[t.c.list.length - 1].timestamp
    t.c.scrollToStart()
    await settle()
    t.feed.last().resolve(hours(50, t.c.list[0].timestamp - HOUR))
    await settle()
    expect(t.c.list[t.c.list.length - 1].timestamp).toBe(head)
    t.loader.replayStep(1)
    expect(t.c.list[t.c.list.length - 1].timestamp).toBe(head + HOUR)
    t.loader.exitReplay()
    expect(t.c.list.length).toBe(150)
  })

  it('SC-067: enterReplay(at) starts at that data index instead of the 60% default', async () => {
    const t = setup()
    await loaded(t, 'SUPER', H1, hours(100, LAST))
    expect(t.loader.enterReplay(10)).toBe(true)
    expect(t.c.list.length).toBe(11)
  })

  it('SC-067: replayInfo reports the head index/length/timestamp, and null outside replay', async () => {
    const t = setup()
    await loaded(t, 'SUPER', H1, hours(100, LAST))
    expect(t.loader.replayInfo).toBeNull()
    t.loader.enterReplay(10)
    expect(t.loader.replayInfo).toEqual({ index: 10, length: 100, timestamp: t.c.list[10].timestamp })
    t.loader.replayStep(1)
    expect(t.loader.replayInfo?.index).toBe(11)
    t.loader.exitReplay()
    expect(t.loader.replayInfo).toBeNull()
  })
})

describe('SC-030: gap backfill after sleep or a reconnect', () => {
  it('a tick after a gap is held, one request fills the hole, then the tick is appended', async () => {
    const t = setup()
    await loaded(t, 'SUPER', H1, hours(100, LAST))
    t.env.advance(5 * HOUR)
    t.feed.tick(bar(LAST + 5 * HOUR, 200))
    t.env.frame()
    expect(t.c.list.length).toBe(100) // held
    expect(t.feed.history.length).toBe(2)
    expect(t.feed.last().from).toBe(LAST)
    t.feed.last().resolve(hours(500, LAST + 5 * HOUR)) // a feed that ignores `from`: the latest window
    await settle()
    t.env.frame()
    const ts = t.c.timestamps()
    expect(ts.slice(-7).map(v => (v - LAST) / HOUR)).toEqual([-1, 0, 1, 2, 3, 4, 5])
    expect(t.c.list[t.c.list.length - 1].close).toBe(200)
  })

  it('a hole wider than the window falls back to replacing the data', async () => {
    const t = setup()
    await loaded(t, 'SUPER', H1, hours(100, LAST))
    t.env.advance(1000 * HOUR)
    t.feed.tick(bar(LAST + 1000 * HOUR, 200))
    t.feed.last().resolve(hours(20, LAST + 999 * HOUR))
    await settle()
    t.env.frame()
    const ts = t.c.timestamps()
    expect(ts.length).toBe(21)
    expect(ts[20]).toBe(LAST + 1000 * HOUR)
  })

  it('a tick during replay makes no request', async () => {
    const t = setup()
    await loaded(t, 'SUPER', H1, hours(100, LAST))
    t.loader.enterReplay()
    t.feed.tick(bar(LAST + 10 * HOUR, 200))
    expect(t.feed.history.length).toBe(1)
  })

  it('a symbol switch during the backfill drops its result', async () => {
    const t = setup()
    await loaded(t, 'SUPER', H1, hours(100, LAST))
    t.feed.tick(bar(LAST + 5 * HOUR, 200))
    const backfill = t.feed.last()
    t.loader.request(sym('ETH'), H1)
    await settle()
    t.feed.last().resolve(hours(10, LAST, 3000))
    await settle()
    backfill.resolve(hours(50, LAST + 4 * HOUR, 100))
    await settle()
    t.env.frame()
    expect(t.c.list.length).toBe(10)
    expect(t.c.list.every(b => b.close > 2000)).toBe(true)
  })

  it('rate-limited: a second gap within 30 s is appended without a request', async () => {
    const t = setup()
    await loaded(t, 'SUPER', H1, hours(100, LAST))
    t.feed.tick(bar(LAST + 5 * HOUR, 200))
    t.feed.last().resolve(hours(100, LAST + 4 * HOUR))
    await settle()
    t.env.frame()
    t.env.advance(10_000)
    t.feed.tick(bar(LAST + 10 * HOUR, 300))
    t.env.frame()
    expect(t.feed.history.length).toBe(2)
    expect(t.c.list[t.c.list.length - 1].close).toBe(300)
  })

  it('visible after being hidden longer than one period: one request; a quick switch: none', async () => {
    const t = setup()
    await loaded(t, 'SUPER', H1, hours(100, LAST))
    t.env.setHidden(true)
    t.env.advance(10 * 60_000)
    t.env.setHidden(false)
    expect(t.feed.history.length).toBe(1)
    t.env.setHidden(true)
    t.env.advance(2 * HOUR)
    t.env.setHidden(false)
    expect(t.feed.history.length).toBe(2)
    t.feed.last().resolve(hours(100, LAST + 2 * HOUR))
    await settle()
    t.env.frame()
    expect(t.c.list[t.c.list.length - 1].timestamp).toBe(LAST + 2 * HOUR)
  })

  it('a backfill that never settles gives up after the timeout: the held bars are applied and live bars flow again', async () => {
    const t = setup()
    await loaded(t, 'SUPER', H1, hours(100, LAST))
    t.env.advance(3 * HOUR)
    t.feed.tick(bar(LAST + 3 * HOUR, 200))
    expect(t.feed.history.length).toBe(2) // the backfill; it is never answered
    t.env.advance(9_000)
    t.feed.tick(bar(LAST + 3 * HOUR, 201))
    t.env.frame()
    expect(t.c.list.length).toBe(100) // held while the backfill runs
    t.env.advance(1_000)
    t.env.frame()
    expect(t.c.list.length).toBe(101)
    expect(t.c.list[100].close).toBe(201)
    expect(t.errors.map(e => [e.phase, e.timeout])).toEqual([['sync', true]])
    expect(t.loader.status.state).toBe('ready')
    t.feed.tick(bar(LAST + 4 * HOUR, 300))
    t.env.frame()
    expect(t.c.list[t.c.list.length - 1].close).toBe(300)
    t.feed.history[1].resolve(hours(500, LAST + 3 * HOUR)) // the late answer is dropped
    await settle()
    t.env.frame()
    expect(t.c.list.length).toBe(102)
    expect(t.c.calls.applyNewData.length).toBe(1)
  })

  it('a feed whose history has holes of its own (a market that closes): a live bar after a gap is appended, no backfill', async () => {
    const t = setup()
    const closedOvernight = [...hours(50, LAST - 20 * HOUR), ...hours(10, LAST)]
    await loaded(t, 'SUPER', H1, closedOvernight)
    t.env.advance(5 * HOUR)
    t.feed.tick(bar(LAST + 5 * HOUR, 200))
    t.env.frame()
    expect(t.feed.history.length).toBe(1)
    expect(t.c.list.length).toBe(61)
    expect(t.c.list[60].close).toBe(200)
  })

  it('hasHoles: two or more periods between neighbours', () => {
    expect(hasHoles(hours(10, LAST), H1)).toBe(false)
    expect(hasHoles([bar(LAST - 2 * HOUR), bar(LAST)], H1)).toBe(true)
    expect(hasHoles([bar(LAST - 2 * HOUR), bar(LAST)], { multiplier: 2, timespan: 'hour' })).toBe(false)
    expect(hasHoles([bar(Date.UTC(2026, 0, 1)), bar(Date.UTC(2026, 1, 1))], { multiplier: 1, timespan: 'month' })).toBe(false)
    expect(hasHoles([bar(Date.UTC(2026, 0, 1)), bar(Date.UTC(2026, 2, 1))], { multiplier: 1, timespan: 'month' })).toBe(true)
    expect(hasHoles([], H1)).toBe(false)
  })

  it('a backfill that replaces the data drops the scroll-back page in flight for the old data', async () => {
    const t = setup()
    await loaded(t, 'SUPER', H1, hours(100, LAST))
    t.c.scrollToStart()
    await settle()
    const page = t.feed.history[1]
    expect(t.loader.status.loadingMore).toBe(true)
    t.env.advance(1000 * HOUR)
    t.feed.tick(bar(LAST + 1000 * HOUR, 200))
    expect(t.feed.history.length).toBe(3)
    t.feed.history[2].resolve(hours(20, LAST + 999 * HOUR)) // does not reach back: replaces the data
    await settle()
    t.env.frame()
    expect(t.c.timestamps().length).toBe(21)
    expect(t.loader.status.loadingMore).toBe(false)
    page.resolve(hours(100, LAST - 100 * HOUR)) // the page for the replaced data
    await settle()
    const ts = t.c.timestamps()
    expect(ts.length).toBe(21)
    expect(ts.every((v, i) => i === 0 || v - ts[i - 1] === HOUR)).toBe(true)
    expect(t.c.calls.applyMoreData.length).toBe(0)
  })

  it('a backfill window shorter than the view pages back at once, and that request is answered', async () => {
    const t = setup({ viewSize: 50 })
    await loaded(t, 'SUPER', H1, hours(100, LAST))
    t.env.advance(1000 * HOUR)
    t.feed.tick(bar(LAST + 1000 * HOUR, 200))
    t.feed.last().resolve(hours(20, LAST + 999 * HOUR))
    await settle()
    t.env.frame()
    expect(t.feed.history.length).toBe(3) // 20 bars do not fill the view: older bars asked for at once
    expect(t.feed.history[2].to).toBe(LAST + 980 * HOUR)
    expect(t.loader.status.loadingMore).toBe(true)
    t.feed.last().resolve(hours(30, LAST + 979 * HOUR))
    await settle()
    expect(t.c.timestamps().length).toBe(51)
    expect(t.loader.status.loadingMore).toBe(false)
  })

  it('online after a failed load retries it', async () => {
    const t = setup()
    t.loader.request(sym('SUPER'), H1)
    await settle()
    t.feed.last().reject(new Error('offline'))
    await settle()
    t.env.online()
    await settle()
    expect(t.feed.fetched()).toEqual(['SUPER 1H', 'SUPER 1H'])
  })
})

describe('mount order', () => {
  it('a request made before the chart is attached starts on attach', async () => {
    const env = fakeEnv()
    const feed = deferredFeed()
    const c = fakeChart()
    const loader = new DataLoader({ datafeed: feed.datafeed, env: env.env })
    loader.request(sym('SUPER'), H1)
    await settle()
    expect(feed.history.length).toBe(0)
    loader.attach(c.chart)
    await settle()
    expect(feed.fetched()).toEqual(['SUPER 1H'])
  })

  it('bars a test built are plain KLineData', () => {
    const b: KLineData = bar(T0)
    expect(b.timestamp).toBe(T0)
  })
})

describe('SC-028: the datafeed gets a context (signal, firstDataRequest, countBack, before)', () => {
  it('firstDataRequest is true on the initial load and true again after a symbol/period change', async () => {
    const t = setup()
    await loaded(t)
    expect(t.feed.history[0].ctx?.firstDataRequest).toBe(true)
    await loaded(t, 'OTHER')
    expect(t.feed.history[1].ctx?.firstDataRequest).toBe(true)
  })

  it('firstDataRequest is false for a scroll-back page and for a gap backfill', async () => {
    const t = setup()
    await loaded(t)
    const firstShownTs = t.c.list[0].timestamp
    t.c.scrollToStart()
    await settle()
    expect(t.feed.last().ctx?.firstDataRequest).toBe(false)
    // `before`: the same instant as `to` — the chart's oldest loaded bar,
    // which scrollToStart asked to page back from.
    expect(t.feed.last().ctx?.before).toBe(firstShownTs)
    t.env.online() // an offline->online transition with no error state resyncs
    await settle()
    expect(t.feed.last().ctx?.firstDataRequest).toBe(false)
  })

  it('countBack reflects the configured bar count for both the initial and scroll-back requests', async () => {
    const t = setup({ loader: { count: 120 } })
    await loaded(t, 'SUPER', H1, hours(120, LAST))
    expect(t.feed.last().ctx?.countBack).toBe(120)
    t.c.scrollToStart()
    await settle()
    expect(t.feed.last().ctx?.countBack).toBe(120)
  })

  it('supersede aborts the initial request\'s signal', async () => {
    const t = setup()
    t.loader.request(sym('SUPER'), H1)
    await settle()
    const first = t.feed.last()
    expect(first.ctx?.aborted()).toBe(false)
    t.loader.request(sym('OTHER'), H1)
    await settle()
    expect(first.ctx?.aborted()).toBe(true)
  })

  it('dispose aborts an in-flight request\'s signal', async () => {
    const t = setup()
    t.loader.request(sym('SUPER'), H1)
    await settle()
    const first = t.feed.last()
    t.loader.dispose()
    expect(first.ctx?.aborted()).toBe(true)
  })

  it('supersede during a scroll-back page aborts its signal too', async () => {
    const t = setup()
    await loaded(t)
    t.c.scrollToStart()
    await settle()
    const page = t.feed.last()
    t.loader.request(sym('OTHER'), H1)
    await settle()
    expect(page.ctx?.aborted()).toBe(true)
  })
})

describe('SC-028: { bars, noData: true } means the same as an empty array', () => {
  it('stops scroll-back paging, like `[]` already did', async () => {
    const t = setup()
    await loaded(t)
    t.c.scrollToStart()
    await settle()
    t.feed.last().resolve({ bars: [bar(T0 - 400 * HOUR)], noData: true })
    await settle()
    expect(t.c.more).toBe(false)
  })

  it('an initial load answered this way is drawn and marked with no more history', async () => {
    const t = setup()
    t.loader.request(sym('SMALL'), H1)
    await settle()
    t.feed.last().resolve({ bars: hours(3, LAST), noData: true })
    await settle()
    expect(t.c.list.length).toBe(3)
    expect(t.c.more).toBe(false)
  })

  it('a plain array with items still means "more" (unchanged)', async () => {
    const t = setup()
    await loaded(t)
    expect(t.c.more).toBe(true)
  })
})

describe('SC-027: the history cache paints a revisited pair at once, and still asks the datafeed', () => {
  it('a cached pair paints before the confirming fetch resolves, and the fetch still happens', async () => {
    const t = setup({ loader: { historyCache: { max: 8 } } })
    await loaded(t, 'SUPER', H1, hours(300, LAST))
    // Switch away, then back: the loader's own request() is what a symbol/period
    // signal change drives in production (src/data/chartData.ts).
    t.loader.request(sym('OTHER'), H1)
    await settle()
    t.feed.last().resolve(hours(300, LAST, 200))
    await settle()
    const beforeRevisit = t.feed.fetched().length
    t.loader.request(sym('SUPER'), H1)
    await settle()
    // Painted from cache already, before the confirming fetch answers: SUPER's
    // own bars (close ~100) are shown, not still OTHER's (close ~200-203, the
    // same length, which a length-only check would miss).
    expect(t.c.list.length).toBe(300)
    expect(t.c.list[t.c.list.length - 1].close).toBeLessThan(150)
    expect(t.feed.fetched().length).toBe(beforeRevisit + 1) // it still asked
  })

  it('when the fresh answer\'s tail lines up with the cached bars, it is merged with updateData, not a second applyNewData', async () => {
    const t = setup({ loader: { historyCache: { max: 8 } } })
    const base = hours(300, LAST)
    await loaded(t, 'SUPER', H1, base)
    await loaded(t, 'OTHER', H1, hours(300, LAST, 200))
    const applyCountBefore = t.c.calls.applyNewData.length
    t.loader.request(sym('SUPER'), H1)
    await settle()
    // The revisit's cache paint is one applyNewData; the confirming fetch below
    // must not add a second one when it lines up with what was just painted.
    const afterCachePaint = t.c.calls.applyNewData.length
    expect(afterCachePaint).toBe(applyCountBefore + 1)
    const updatesBefore = t.c.calls.updateData.length
    // Same bars, plus one closed differently and one new bar: a "tail" answer.
    const fresh = base.slice()
    fresh[fresh.length - 1] = { ...fresh[fresh.length - 1], close: 999 }
    fresh.push(bar(LAST + HOUR, 999))
    t.feed.last().resolve(fresh)
    await settle()
    expect(t.c.calls.applyNewData.length).toBe(afterCachePaint) // no second full replace
    expect(t.c.calls.updateData.length).toBeGreaterThan(updatesBefore)
    expect(t.c.list[t.c.list.length - 1].close).toBe(999)
  })

  it('two symbols that share a ticker but differ by priceCurrency never share a cache entry', async () => {
    const t = setup({ loader: { historyCache: { max: 8 } } })
    await loaded(t, 'BTC', H1, hours(300, LAST, 100))
    // A different SymbolInfo (priceCurrency), same ticker: request() takes the
    // full SymbolInfo, unlike the `ticker`-only test helper `loaded`.
    t.loader.request({ ticker: 'BTC', priceCurrency: 'DEMO' }, H1)
    await settle()
    // No cache hit: still 'loading', nothing painted from a BTC/USDT cache entry.
    expect(t.statuses[t.statuses.length - 1].state).toBe('loading')
  })

  it('is off unless a host opts in (no behaviour change to an existing chart)', async () => {
    const t = setup() // historyCache not passed
    await loaded(t, 'SUPER', H1, hours(300, LAST))
    await loaded(t, 'OTHER', H1, hours(300, LAST, 200))
    const applyCountBefore = t.c.calls.applyNewData.length
    t.loader.request(sym('SUPER'), H1)
    await settle()
    // No instant paint from a cache: exactly one applyNewData, after the fetch.
    expect(t.c.calls.applyNewData.length).toBe(applyCountBefore) // none yet: still loading
    expect(t.statuses[t.statuses.length - 1].state).toBe('loading')
  })

  it('primeHistory seeds a pair that has not loaded yet, so its first visit paints at once', async () => {
    const t = setup({ loader: { historyCache: { max: 8 } } })
    t.loader.primeHistory(sym('PRIMED'), H1, hours(50, LAST))
    t.loader.request(sym('PRIMED'), H1)
    await settle()
    expect(t.c.list.length).toBe(50)
    expect(t.statuses[t.statuses.length - 1].state).toBe('loading') // still confirming
  })

  it('invalidateHistory(symbol, period) drops one pair; a later revisit does not paint from it', async () => {
    const t = setup({ loader: { historyCache: { max: 8 } } })
    await loaded(t, 'SUPER', H1, hours(300, LAST))
    await loaded(t, 'OTHER', H1, hours(300, LAST, 200))
    t.loader.invalidateHistory(sym('SUPER'), H1)
    const applyCountBefore = t.c.calls.applyNewData.length
    t.loader.request(sym('SUPER'), H1)
    await settle()
    expect(t.c.calls.applyNewData.length).toBe(applyCountBefore) // no instant cache paint
  })
})

describe('SC-141: loadUntil pages older bars in directly, for setVisibleRange/scrollToTime', () => {
  it('reaches a target within the already-loaded window without any request', async () => {
    const t = setup()
    await loaded(t, 'SUPER', H1, hours(300, LAST))
    const target = t.c.list[10].timestamp
    const fetchedBefore = t.feed.fetched().length
    const result = await t.loader.loadUntil(target)
    expect(result).toEqual({ covered: true })
    expect(t.feed.fetched().length).toBe(fetchedBefore)
  })

  it('pages back until the target is covered, each page applied with applyMoreData', async () => {
    const t = setup()
    await loaded(t, 'SUPER', H1, hours(300, LAST))
    const target = LAST - 305 * HOUR // just before the loaded window
    const p = t.loader.loadUntil(target, 5)
    for (let i = 0; i < 3; i++) {
      await settle()
      const call = t.feed.history[t.feed.history.length - 1]
      call.resolve(hours(100, call.to - HOUR))
    }
    const result = await p
    expect(result.covered).toBe(true)
    expect(t.c.calls.applyMoreData.length).toBeGreaterThan(0)
    expect(t.c.list[0].timestamp).toBeLessThanOrEqual(target)
  })

  it('stops with covered:false on an empty (or noData) page, instead of retrying forever', async () => {
    const t = setup()
    await loaded(t, 'SUPER', H1, hours(300, LAST))
    const p = t.loader.loadUntil(LAST - 10000 * HOUR)
    await settle()
    t.feed.last().resolve({ bars: [], noData: true })
    const result = await p
    expect(result).toEqual({ covered: false })
  })

  it('stops at the page cap rather than looping without bound', async () => {
    const t = setup()
    await loaded(t, 'SUPER', H1, hours(300, LAST))
    const p = t.loader.loadUntil(0, 2)
    for (let i = 0; i < 2; i++) {
      await settle()
      const call = t.feed.history[t.feed.history.length - 1]
      call.resolve(hours(100, call.to - HOUR))
    }
    const result = await p
    expect(result.covered).toBe(false)
    expect(t.c.calls.applyMoreData.length).toBe(2)
  })

  it('a symbol change during the loop stops it with covered:false, and applies no stale page', async () => {
    const t = setup()
    await loaded(t, 'SUPER', H1, hours(300, LAST))
    const p = t.loader.loadUntil(LAST - 1000 * HOUR)
    await settle()
    const call = t.feed.last()
    t.loader.request(sym('OTHER'), H1)
    await settle()
    t.feed.last().resolve(hours(300, LAST, 200)) // the new pair's own initial load
    call.resolve(hours(100, call.to - HOUR)) // the stale page, answered late
    await settle()
    const result = await p
    expect(result).toEqual({ covered: false })
    // Only the new pair's own bars are on the chart: the stale page (close 100s
    // range, from the SUPER pair) never got prepended onto OTHER's data (200s).
    expect(t.c.list.every(b => b.close >= 200)).toBe(true)
  })

  it('a second call while one is running resolves covered:false at once, rather than race it', async () => {
    const t = setup()
    await loaded(t, 'SUPER', H1, hours(300, LAST))
    const first = t.loader.loadUntil(LAST - 1000 * HOUR, 5)
    const second = await t.loader.loadUntil(LAST - 1000 * HOUR, 5)
    expect(second).toEqual({ covered: false })
    // Let the first call's requests settle so it does not leak into later tests.
    for (let i = 0; i < 5; i++) {
      await settle()
      if (t.feed.history.length === 0) break
      const call = t.feed.history[t.feed.history.length - 1]
      if (call === undefined) break
      call.resolve([])
    }
    await first
  })

  it('nothing to load (no scroll-back registered) resolves covered:false, not a hang', async () => {
    const t = setup()
    const result = await t.loader.loadUntil(0)
    expect(result).toEqual({ covered: false })
  })
})

describe('SC-020: a "bars" event fires with the fresh bars just before an initial load is drawn', () => {
  it('fires once per symbol/period change, with the normalized bars, before applyNewData', async () => {
    const t = setup()
    const seen: Array<{ count: number, appliedYet: boolean }> = []
    t.loader.on('bars', e => {
      seen.push({ count: e.bars.length, appliedYet: t.c.calls.applyNewData.length > 0 })
    })
    t.loader.request(sym('SUPER'), H1)
    await settle()
    t.feed.last().resolve(hours(42, LAST))
    await settle()
    expect(seen).toEqual([{ count: 42, appliedYet: false }])
  })

  it('does not fire for a scroll-back page or a live tick', async () => {
    const t = setup()
    let count = 0
    t.loader.on('bars', () => { count++ })
    await loaded(t)
    expect(count).toBe(1)
    t.c.scrollToStart()
    await settle()
    t.feed.last().resolve(hours(5, LAST - 300 * HOUR))
    await settle()
    t.feed.tick(bar(LAST + HOUR))
    t.env.frame()
    expect(count).toBe(1)
  })
})
