// Load the built owned package, with no upstream runtime or import map.
const build = new URLSearchParams(location.search).get('build') ?? 'esm'
let SC
if (build === 'umd') {
  await new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = '/dist/super-chart.umd.js'
    script.onload = resolve
    script.onerror = () => reject(new Error('Failed to load owned UMD bundle'))
    document.head.appendChild(script)
  })
  SC = window.SuperChart
} else SC = await import('/dist/super-chart.js')

const SPAN = { minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000, month: 2_592_000_000, year: 31_536_000_000 }
// Use the loader's wall clock; candle values remain deterministic for each timestamp.
const NOW = Date.now()
function priceAt (i) { return 100 + 25 * Math.sin(i / 40) + 10 * Math.sin(i / 11) + 4 * Math.sin(i / 3.3) }
function candle (i, span) {
  const o = priceAt(i), c = priceAt(i + 1), wig = 0.6 + 1.8 * Math.abs(Math.sin(i / 3))
  return { timestamp: i * span, open: o, high: Math.max(o, c) + wig, low: Math.min(o, c) - wig, close: c, volume: 500 + 400 * Math.abs(Math.sin(i / 5)) }
}

/** A deterministic datafeed that records every call and lets a spec push ticks. */
function makeDatafeed (opts = {}) {
  const calls = { history: [], subscribe: [], unsubscribe: [], search: [] }
  let listener = null
  const datafeed = {
    async searchSymbols (search) { calls.search.push(search ?? ''); return opts.search ?? [] },
    async getHistoryKLineData (symbol, period, from, to, request) {
      calls.history.push({ ticker: symbol.ticker, period: { ...period }, from, to, firstDataRequest: request?.firstDataRequest, before: request?.before })
      const span = (SPAN[period.timespan] ?? 60_000) * period.multiplier
      const out = []
      const end = Math.min(Math.floor(to / span), Math.floor(NOW / span))
      for (let i = Math.max(Math.floor(from / span), end - 400); i < end; i++) out.push(candle(i, span))
      return out
    },
    subscribe (symbol, period, callback) { calls.subscribe.push({ ticker: symbol.ticker, period: { ...period } }); listener = callback },
    unsubscribe (symbol, period) { calls.unsubscribe.push({ ticker: symbol.ticker, period: { ...period } }) }
  }
  return { datafeed, calls, tick: bar => { listener?.(bar) } }
}

let seq = 0
/** Mount a chart in a fresh container (or options.chart.container); returns { pro, container, feed }. */
function mount (options = {}) {
  let container = options.chart?.container
  if (container === undefined) {
    container = document.createElement('div')
    container.className = 'chart'
    container.id = options.id ?? `chart-${++seq}`
    document.getElementById('charts').appendChild(container)
  }
  const feed = makeDatafeed(options.feed)
  const { container: ignored, ...workspace } = options.chart ?? {}
  const pro = new SC.ChartWorkspace(container, {
    symbol: { ticker: 'SUPER-USDT', pricePrecision: 2, volumePrecision: 0 },
    period: { multiplier: 1, timespan: 'hour', text: '1H' },
    periods: [{ multiplier: 1, timespan: 'hour', text: '1H' }, { multiplier: 1, timespan: 'day', text: 'D' }],
    datafeed: feed.datafeed,
    chart: { indicators: [{ name: 'VOL' }] },
    ...workspace
  })
  return { pro, container, feed }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/** Resolves once the chart has data. */
async function ready (pro, min = 50) {
  for (let i = 0; i < 100; i++) {
    const chart = pro.chart
    if (chart !== null && chart.dataPort.getDataList().length >= min) return chart
    await sleep(50)
  }
  throw new Error('chart never got data')
}

window.H = { SC, build, makeDatafeed, mount, ready, sleep }
window.__ready = true
