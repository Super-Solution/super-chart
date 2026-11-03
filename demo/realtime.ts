import { paintChart, chartPng } from './canvasRenderer'
import { attachChartGestures } from './gestures'
import { RealtimeSeries, RealtimeView, createRealtimeChartFrame } from '../src/core/index'
import type { CandleMode, Datafeed, MarketBar, RealtimeChartFrame } from '../src/core/index'
import { DataLoader } from '../src/data/loader'

const element = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T
const plot = element<HTMLDivElement>('plot')
const chart = element<HTMLCanvasElement>('chart')
const cursor = element<HTMLCanvasElement>('cursor')
const status = element<HTMLOutputElement>('status')
const readout = element<HTMLOutputElement>('readout')
const metrics = element<HTMLOutputElement>('metrics')
const time = element<HTMLInputElement>('time')
const mode = element<HTMLSelectElement>('mode')
const spacing = element<HTMLSelectElement>('spacing')
const indicators = element<HTMLInputElement>('indicators')
const live = element<HTMLButtonElement>('live')
const span = 60000
const initialIndex = Math.floor(Date.now() / span)
const oldestIndex = initialIndex - 24999
let latestIndex = initialIndex
let callback: ((bar: MarketBar) => void) | null = null
let timer: ReturnType<typeof setInterval> | undefined
let running = false
let disposed = false
let ticks = 0
let notifications = 0
let draws = 0
let pendingFrame = 0
let frame: RealtimeChartFrame | null = null
let layoutKey = ''
let cursorX: number | null = null
let inspectedFrame: RealtimeChartFrame | null = null
let inspectedIndex: number | null = null
let exporting = false
const abort = new AbortController()
const samples: number[] = []
const price = (i: number): number => 100 + 8 * Math.sin(i / 37) + 2 * Math.sin(i / 7)
function candle (i: number): MarketBar {
  const open = price(i), close = price(i + 1)
  return { timestamp: i * span, open, close, high: Math.max(open, close) + 1, low: Math.min(open, close) - 1, volume: 100 + i % 100 }
}
function tick (advance = false): void {
  if (callback === null || disposed) return
  if (advance) latestIndex++
  const bar = candle(latestIndex)
  bar.close += Math.sin(++ticks / 9) * 0.5
  callback(bar)
}
function updateTimer (): void {
  clearInterval(timer)
  timer = undefined
  if (running && callback !== null && !disposed) timer = setInterval(() => { tick(ticks > 0 && ticks % 20 === 0) }, 250)
  live.textContent = running ? 'Pause live' : 'Start live'
}
const feed: Datafeed = {
  searchSymbols: async () => [],
  getHistoryKLineData: async (_symbol, _period, _from, _to, request) => {
    const end = request?.firstDataRequest !== false ? latestIndex : Math.floor((request.before ?? latestIndex * span) / span) - 1
    const count = request?.firstDataRequest !== false ? 20000 : 500
    const start = Math.max(oldestIndex, end - count + 1)
    const bars = Array.from({ length: Math.max(0, end - start + 1) }, (_, i) => candle(start + i))
    return { bars, noData: start === oldestIndex }
  },
  subscribe: (_symbol, _period, next) => { callback = next; updateTimer() },
  unsubscribe: () => { callback = null; updateTimer() }
}
const series = new RealtimeSeries()
const view = new RealtimeView(series, { count: 160 })
const loader = new DataLoader({ datafeed: feed, count: 20000 })
function context (canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const rect = plot.getBoundingClientRect(), ratio = window.devicePixelRatio || 1
  const width = Math.round(rect.width * ratio), height = Math.round(rect.height * ratio)
  if (canvas.width !== width) canvas.width = width
  if (canvas.height !== height) canvas.height = height
  const ctx = canvas.getContext('2d')
  if (ctx === null) throw new Error('Canvas 2D is unavailable')
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, width, height)
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  return ctx
}
function inspect (): void {
  const hit = frame !== null && cursorX !== null ? frame.inspect(cursorX) : null
  if (frame === inspectedFrame && (hit?.index ?? null) === inspectedIndex) return
  inspectedFrame = frame; inspectedIndex = hit?.index ?? null
  const ctx = context(cursor)
  if (hit === null || frame === null) { readout.textContent = 'Move over a candle to inspect its values.'; return }
  const index = frame.model.xKeys.indexOf(hit.timestamp), x = frame.model.xPositions[index]
  const g = frame.model.geometry
  ctx.strokeStyle = '#9badbf'; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(x, g.top); ctx.lineTo(x, g.bottom); ctx.stroke()
  const b = hit.displayBar
  readout.textContent = `${new Date(hit.timestamp).toLocaleString()} · ${hit.mode === 'raw' ? 'Raw' : 'Synthetic HA'} O ${b.open.toFixed(4)} H ${b.high.toFixed(4)} L ${b.low.toFixed(4)} C ${b.close.toFixed(4)} · Raw MA20 ${hit.ma20?.toFixed(4) ?? '—'} EMA21 ${hit.ema21?.toFixed(4) ?? '—'}`
}
function draw (): void {
  pendingFrame = 0
  if (disposed) return
  const started = performance.now(), rect = plot.getBoundingClientRect()
  const snapshot = view.getSnapshot()
  const key = [rect.width, rect.height, window.devicePixelRatio, spacing.value, indicators.checked].join(':')
  const repaint = frame === null || key !== layoutKey || frame.snapshot.bars !== snapshot.bars ||
    frame.snapshot.ma20 !== snapshot.ma20 || frame.snapshot.ema21 !== snapshot.ema21
  if (repaint) {
    layoutKey = key
    frame = createRealtimeChartFrame(snapshot, rect.width, rect.height, {
      spacing: spacing.value as 'time' | 'category', indicators: indicators.checked ? ['MA20', 'EMA21'] : [],
      colors: { MA20: '#f4ba53', EMA21: '#8bafff' }
    })
    paintChart(context(chart), frame)
    draws++
    samples.push(performance.now() - started); if (samples.length > 200) samples.shift()
  }
  const sorted = [...samples].sort((a, b) => a - b)
  metrics.textContent = `Loaded ${snapshot.length.toLocaleString()} · visible ${snapshot.bars.length} · ${snapshot.following ? 'following' : 'pinned'} · ${snapshot.mode} · notifications ${notifications} · draws ${draws} · model + draw median ${sorted[Math.floor(sorted.length / 2)].toFixed(2)} ms`
  element<HTMLButtonElement>('older').disabled = !snapshot.hasMore
  inspect()
}
function schedule (): void { if (!pendingFrame && !disposed) pendingFrame = requestAnimationFrame(draw) }
const stopData = view.subscribe(() => { notifications++; schedule() })
const stopStatus = loader.on('status', value => { status.textContent = value.state + (value.loadingMore ? ' · loading history' : '') })
function on (target: EventTarget, type: string, action: EventListener, passive = true): void {
  target.addEventListener(type, action, { signal: abort.signal, passive })
}
on(live, 'click', () => { running = !running; updateTimer() })
on(element('burst'), 'click', () => { for (let i = 0; i < 300; i++) tick(i > 0 && i % 10 === 0) })
on(element('older'), 'click', () => { view.requestMore() })
on(element('follow'), 'click', () => { view.followLatest() })
on(element('in'), 'click', () => { view.zoom(1.5) })
on(element('out'), 'click', () => { view.zoom(1 / 1.5) })
on(mode, 'change', () => { view.setMode(mode.value as CandleMode) })
on(spacing, 'change', schedule)
on(indicators, 'change', schedule)
on(element('seek'), 'click', () => { status.textContent = view.seek(new Date(time.value).getTime()) ? 'Jumped to nearest loaded candle' : 'Enter a valid loaded time' })
const stopGestures = attachChartGestures(plot, view, () => frame?.model.geometry ?? null, x => { cursorX = x; inspect() })
const resize = new ResizeObserver(schedule)
resize.observe(plot)
function dispose (): void {
  if (disposed) return
  disposed = true; running = false; updateTimer(); abort.abort(); resize.disconnect()
  if (pendingFrame) cancelAnimationFrame(pendingFrame)
  stopGestures(); stopData(); stopStatus(); view.dispose(); loader.dispose()
  document.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('button,input,select').forEach(control => { control.disabled = true })
  status.textContent = 'Disposed · feed, subscriptions, observers and controls stopped'
}
on(element('export'), 'click', () => { void exportChart() })
async function exportChart (): Promise<void> {
  if (disposed || exporting || frame === null) return
  exporting = true
  const button = element<HTMLButtonElement>('export'); button.disabled = true
  try {
    // Flush any queued viewport/options update before capturing the chart layer.
    if (pendingFrame) { cancelAnimationFrame(pendingFrame); draw() }
    const captured = frame
    const blob = await chartPng(chart)
    if (disposed) return
    const url = URL.createObjectURL(blob), link = document.createElement('a')
    link.href = url; link.download = 'synthetic-chart-' + captured.snapshot.mode + '.png'
    document.body.append(link); link.click(); link.remove()
    setTimeout(() => { URL.revokeObjectURL(url) }, 1000)
    status.textContent = 'Exported synthetic chart · ' + captured.snapshot.mode
  } catch (error) {
    if (!disposed) status.textContent = 'Export failed: ' + (error instanceof Error ? error.message : String(error))
  } finally { exporting = false; if (!disposed) button.disabled = false }
}
on(element('dispose'), 'click', dispose)
on(window, 'pagehide', dispose)
import.meta.hot?.dispose(dispose)
time.value = new Date(initialIndex * span - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)
loader.attach(series)
loader.request({ ticker: 'SYNTHETIC', pricePrecision: 4, volumePrecision: 0 }, { multiplier: 1, timespan: 'minute', text: '1m' })
schedule()
