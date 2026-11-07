// Helpers for tests/loader.spec.ts: a datafeed whose history requests stay
// pending until the test settles them (so a test decides the order in which
// answers arrive), bars at a distinct price level per ticker (so the bars on
// screen tell which symbol they belong to), and call counters.

export const HOUR = 3_600_000
const SPAN = { second: 1_000, minute: 60_000, hour: HOUR, day: 86_400_000, week: 604_800_000 }
export const LEVEL = { SUPER: 100, AAA: 200, ETH: 3000, BBB: 5000, BTC: 60000 }

export const spanOf = period => (SPAN[period.timespan] ?? HOUR) * period.multiplier
export const align = (ts, span) => ts - (ts % span)

/** `n` bars of `period` ending with the bar that opens at `lastTs`, around the ticker's level. */
export function bars (ticker, period, lastTs, n) {
  const span = spanOf(period)
  const base = LEVEL[ticker] ?? 100
  const out = []
  for (let i = 0; i < n; i++) {
    const ts = lastTs - (n - 1 - i) * span
    const c = base * (1 + 0.01 * Math.sin(ts / span / 7))
    out.push({ timestamp: ts, open: c, high: c * 1.002, low: c * 0.998, close: c, volume: 10 })
  }
  return out
}

/** The ticker whose level the chart's newest bar is at. */
export function tickerShown (chart) {
  const last = chart.dataPort.getDataList().at(-1)
  if (last === undefined) return null
  for (const [t, level] of Object.entries(LEVEL)) {
    if (Math.abs(last.close / level - 1) < 0.05) return t
  }
  return null
}

export function deferredFeed () {
  const history = []
  const log = []
  const listeners = []
  const datafeed = {
    async searchSymbols () { return [] },
    getHistoryKLineData (symbol, period, from, to) {
      return new Promise((resolve, reject) => {
        history.push({ ticker: symbol.ticker, period: period.text, timespan: period.timespan, multiplier: period.multiplier, from, to, resolve, reject, settled: false })
      })
    },
    subscribe (symbol, period, callback) { log.push(`sub ${symbol.ticker} ${period.text}`); listeners.push(callback) },
    unsubscribe (symbol, period) { log.push(`unsub ${symbol.ticker} ${period.text}`) }
  }
  const feed = {
    datafeed,
    history,
    log,
    listeners,
    tick: data => { listeners.at(-1)?.(data) },
    fetched: () => history.map(h => `${h.ticker} ${h.period}`),
    /** Answer request `i` with the latest window of its pair (n bars ending at the bar before `to`). */
    answer (i, n = 300) {
      const h = history[i]
      const period = { multiplier: h.multiplier, timespan: h.timespan }
      const span = spanOf(period)
      h.settled = true
      h.resolve(bars(h.ticker, period, align(h.to - 1, span), n))
    }
  }
  return feed
}

export const sleep = ms => new Promise(resolve => { setTimeout(resolve, ms) })

/**
 * Poll until fn() is truthy and return its value. Throws when the time is up,
 * so a step that never happens fails the test where it stalled (not at some
 * later, unrelated assertion).
 */
export async function until (fn, ms = 3000, what = String(fn)) {
  for (let waited = 0; waited <= ms; waited += 25) {
    const value = fn()
    if (value) return value
    await sleep(25)
  }
  throw new Error(`until: still false after ${ms} ms: ${what}`)
}

/** Mount a chart on a deferred feed; `chart` options are spread over the harness defaults. */
export function mountDeferred (chart = {}) {
  const feed = deferredFeed()
  const { pro, container } = window.H.mount({ chart: { datafeed: feed.datafeed, ...chart } })
  return { pro, container, feed }
}

/** Count calls to the owned data port used by the loader. */
export function countCalls (chart, method) {
  const counter = { n: 0, args: [] }
  const name = ({ applyNewData: 'setData', updateData: 'update', updateDataBatch: 'updateBatch' })[method] ?? method
  const original = chart[name].bind(chart)
  chart[name] = (...args) => { counter.n++; counter.args.push(args); return original(...args) }
  return counter
}

export const frame = () => new Promise(resolve => { requestAnimationFrame(() => { resolve() }) })

/** Show the first bar and request the preceding page through the owned view. */
export function scrollToStart (chart) {
  const { viewport } = chart.view.getSnapshot()
  chart.view.setViewport({ i0: 0, i1: viewport.i1 - viewport.i0 })
  chart.view.requestMore()
}
