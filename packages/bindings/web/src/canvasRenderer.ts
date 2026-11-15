import { nearestChartIndex, derivePrecision, formatBarDate, type FinancialChartModel, type ChartCandlePoint, type EngineRenderFrame, type EngineRenderOptions, type BarDateRequestType } from '@supersolutions/super-chart-core'
import { paintPriceSeries } from './seriesRenderer'
import { typicalPrice, halfBarWidth } from './geometry'

export type { EngineRenderOptions } from '@supersolutions/super-chart-core'

const DEFAULTS = {
  background: '#10151d',
  grid: '#283444',
  text: '#aebcca',
  up: '#58c9ac',
  down: '#f28b82',
  line: '#8bafff',
  font: '12px system-ui'
}
// Axis labels are painted a few times per frame. Reuse Intl setup without retaining chart history.
const timeFormats = new Map<string, Intl.DateTimeFormat>()
function timeFormat (timeZone: string): Intl.DateTimeFormat {
  let format = timeFormats.get(timeZone)
  if (format !== undefined) return format
  format = new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
  if (timeFormats.size === 8) timeFormats.delete(timeFormats.keys().next().value as string)
  timeFormats.set(timeZone, format)
  return format
}
function precision (value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? Math.max(0, Math.min(20, Math.trunc(value))) : 2
}
const dateLabels = new Map<string, string>()
const calendarDates = new Map<string, Record<string, string>>()
function boundedSet<T> (cache: Map<string, T>, key: string, value: T): T {
  if (cache.size >= 512) cache.delete(cache.keys().next().value as string)
  cache.set(key, value)
  return value
}
function timeLabel (displayDtf: Intl.DateTimeFormat, timestamp: number, options: EngineRenderOptions, type: BarDateRequestType, format = 'HH:mm'): string {
  if (!Number.isFinite(timestamp) || Math.abs(timestamp) > 8.64e15) return String(timestamp)
  const key = JSON.stringify([options.timeZone ?? 'UTC', timestamp, options.timespan ?? '', options.symbolTimezone, type, format])
  const cached = dateLabels.get(key)
  return cached ?? boundedSet(dateLabels, key, formatBarDate({ displayDtf, timestamp, timespan: options.timespan ?? '', symbolTimezone: options.symbolTimezone, type, format }))
}
function calendarDate (format: Intl.DateTimeFormat, timestamp: number, timezone: string): Record<string, string> {
  const key = JSON.stringify([timezone, timestamp]), cached = calendarDates.get(key)
  if (cached !== undefined) return cached
  const date: Record<string, string> = {}
  for (const part of format.formatToParts(timestamp)) if (part.type === 'year' || part.type === 'month' || part.type === 'day') date[part.type] = part.value
  return boundedSet(calendarDates, key, date)
}
function boundaryFormat (date: Record<string, string>, previous: Record<string, string> | null): string {
  if (previous === null) return 'MM-DD'
  if (date.year !== previous.year) return 'YYYY'
  if (date.month !== previous.month) return 'YYYY-MM'
  return date.day !== previous.day ? 'MM-DD' : 'HH:mm'
}
function ready (m: FinancialChartModel): boolean {
  const g = m.geometry
  return Number.isFinite(g.width) && Number.isFinite(g.height) && g.width > 0 && g.height > 0 &&
    Number.isFinite(g.left) && Number.isFinite(g.top) && Number.isFinite(g.plotWidth) && Number.isFinite(g.plotHeight) &&
    g.plotWidth > 0 && g.plotHeight > 0
}
function clipPlot (ctx: CanvasRenderingContext2D, m: FinancialChartModel): void {
  const g = m.geometry
  ctx.beginPath(); ctx.rect(g.left, g.top, g.plotWidth, g.plotHeight); ctx.clip()
}
interface CloseGeometry { points: Array<{ x: number, y: number, index: number }>, stroke?: Path2D, area?: Path2D }
const closeGeometry = new WeakMap<FinancialChartModel, CloseGeometry>()
function closePoints (m: FinancialChartModel): CloseGeometry {
  let geometry = closeGeometry.get(m)
  if (geometry !== undefined) return geometry
  geometry = { points: [] }
  for (const candle of m.plottedCandles) {
    const y = m.y(candle.c)
    if (Number.isFinite(candle.x) && Number.isFinite(y)) geometry.points.push({ x: candle.x, y, index: candle.index })
  }
  closeGeometry.set(m, geometry)
  return geometry
}
function closePath (target: Pick<CanvasRenderingContext2D, 'moveTo' | 'lineTo' | 'closePath'>, m: FinancialChartModel, area: boolean): void {
  let previous = -2, firstX = 0, lastX = 0, open = false
  for (const point of closePoints(m).points) {
    if (point.index !== previous + 1) {
      if (area && open) { target.lineTo(lastX, m.geometry.bottom); target.lineTo(firstX, m.geometry.bottom); target.closePath() }
      target.moveTo(point.x, point.y); firstX = point.x; open = true
    } else target.lineTo(point.x, point.y)
    previous = point.index; lastX = point.x
  }
  if (area && open) { target.lineTo(lastX, m.geometry.bottom); target.lineTo(firstX, m.geometry.bottom); target.closePath() }
}
function paintClose (ctx: CanvasRenderingContext2D, m: FinancialChartModel, area: boolean): void {
  if (typeof Path2D !== 'undefined') {
    const geometry = closePoints(m), key = area ? 'area' : 'stroke'
    let path = geometry[key]
    if (path === undefined) { path = new Path2D(); closePath(path, m, area); geometry[key] = path }
    if (area) ctx.fill(path); else ctx.stroke(path)
  } else {
    ctx.beginPath(); closePath(ctx, m, area)
    if (area) ctx.fill(); else ctx.stroke()
  }
}
const envelopes = new WeakMap<FinancialChartModel, readonly ChartCandlePoint[]>()
/** Explicit pixel-envelope paint mode: first open, last close, all highs/lows. Never changes the public model. */
function candleEnvelope (m: FinancialChartModel): readonly ChartCandlePoint[] {
  if (m.plottedCandles.length <= m.geometry.plotWidth) return m.plottedCandles
  const cached = envelopes.get(m)
  if (cached !== undefined) return cached
  const result: ChartCandlePoint[] = []
  let bucket = NaN
  for (const candle of m.plottedCandles) {
    const pixel = Math.floor(candle.x)
    if (!Number.isFinite(pixel)) continue
    const previous = result[result.length - 1]
    if (pixel !== bucket || previous === undefined) { result.push({ ...candle }); bucket = pixel; continue }
    previous.c = candle.c; previous.h = Math.max(previous.h, candle.h); previous.l = Math.min(previous.l, candle.l)
    previous.wickTop = Math.min(previous.wickTop, candle.wickTop); previous.wickBottom = Math.max(previous.wickBottom, candle.wickBottom)
    const open = m.y(previous.o), close = m.y(previous.c)
    previous.bodyTop = Math.min(open, close); previous.bodyBottom = Math.max(open, close)
  }
  envelopes.set(m, result)
  return result
}

/**
 * Draw in the frame's logical-pixel coordinate system. The host sets the DPR transform.
 * No data or geometry is recalculated here; inspection and rendering use the same model.
 * Separate indicator panes use the same model and painter without candle geometry.
 */
export function paintEngineFrame (
  ctx: CanvasRenderingContext2D,
  frame: EngineRenderFrame,
  options: EngineRenderOptions = {}
): void {
  const m = frame.model, g = m.geometry
  if (!ready(m)) return
  const digits = precision(options.pricePrecision ?? frame.pricePrecision ?? derivePrecision(frame.snapshot.bars))
  const formatter = timeFormat(options.timeZone ?? 'UTC')
  ctx.save()
  try {
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'
    ctx.setLineDash([]); ctx.lineWidth = 1
    ctx.fillStyle = options.background ?? DEFAULTS.background
    ctx.fillRect(0, 0, g.width, g.height)
    ctx.font = options.font ?? DEFAULTS.font
    ctx.textBaseline = 'middle'

    ctx.save()
    try {
      clipPlot(ctx, m)
      ctx.strokeStyle = options.grid ?? DEFAULTS.grid
      ctx.beginPath()
      for (const tick of m.yTicks) {
        const y = m.y(tick)
        ctx.moveTo(g.left, y); ctx.lineTo(g.right, y)
      }
      for (const index of m.xTickIndices) {
        const x = m.xPositions[index]
        ctx.moveTo(x, g.top); ctx.lineTo(x, g.bottom)
      }
      ctx.stroke()

      const type = options.chartType ?? 'candles'
      const span = frame.snapshot.viewport.i1 - frame.snapshot.viewport.i0
      const half = (type !== 'line' && type !== 'area') || m.plottedSeries.some(series => series.source.type === 'bar') ? halfBarWidth(m, frame.snapshot.dataStart !== undefined && span > 0 ? g.plotWidth / span : undefined) : 0
      if (paintPriceSeries(ctx, frame, options, half)) {
        // Extended series share this clip and the exact same price transform.
      } else if (type === 'line' || type === 'area') {
        const color = options.line ?? DEFAULTS.line
        if (type === 'area') {
          ctx.fillStyle = color; ctx.globalAlpha = 0.14
          paintClose(ctx, m, true); ctx.globalAlpha = 1
        }
        ctx.strokeStyle = color; ctx.lineWidth = 1.5
        paintClose(ctx, m, false)
      } else {
        // Density changes only the paint list; raw data, inspection and indicator rows remain exact.
        const candles = options.candleDensity === 'pixel-envelope' ? candleEnvelope(m) : m.plottedCandles
        // Four paths at most for the complete visible candle set, rather than a stroke per bar.
        for (let group = 0; group < 2; group++) {
          const up = group === 0
          const color = up ? options.up ?? DEFAULTS.up : options.down ?? DEFAULTS.down
          ctx.fillStyle = ctx.strokeStyle = color
          ctx.beginPath()
          for (const candle of candles) {
            if ((candle.c >= candle.o) !== up) continue
            ctx.moveTo(candle.x, candle.wickTop); ctx.lineTo(candle.x, candle.wickBottom)
            if (type === 'ohlc') {
              const openY = m.y(candle.o), closeY = m.y(candle.c)
              ctx.moveTo(candle.x - half, openY); ctx.lineTo(candle.x, openY)
              ctx.moveTo(candle.x, closeY); ctx.lineTo(candle.x + half, closeY)
            }
          }
          ctx.stroke()
          if (type === 'candles') {
            ctx.beginPath()
            for (const candle of candles) {
              if ((candle.c >= candle.o) !== up) continue
              const bodyHeight = Math.max(1, candle.bodyBottom - candle.bodyTop)
              ctx.rect(candle.x - half, candle.bodyTop, 2 * half, bodyHeight)
            }
            ctx.fill()
          }
        }
      }

      ctx.lineWidth = 1.5
      for (const series of m.plottedSeries) {
        const style = frame.figureStyles?.get(series.source.id)
        ctx.lineWidth = style?.lineWidth ?? 1.5
        ctx.setLineDash(style?.dash === undefined ? [] : [...style.dash])
        ctx.strokeStyle = series.source.color ?? options.line ?? DEFAULTS.line
        if (series.source.type === 'bar') {
          ctx.fillStyle = ctx.strokeStyle
          const base = Math.max(m.min, Math.min(m.max, style?.base ?? 0))
          const zero = Math.max(g.top, Math.min(g.bottom, m.y(base)))
          ctx.beginPath()
          for (const point of series.points) ctx.rect(point.x - half, Math.min(zero, point.y), half * 2, Math.max(1, Math.abs(point.y - zero)))
          ctx.fill(); continue
        }
        if (series.source.type === 'scatter') {
          ctx.fillStyle = ctx.strokeStyle; ctx.beginPath()
          for (const point of series.points) { ctx.moveTo(point.x + ctx.lineWidth, point.y); ctx.arc(point.x, point.y, ctx.lineWidth, 0, 2 * Math.PI) }
          ctx.fill(); continue
        }
        ctx.beginPath()
        let previous = -2
        for (const point of series.points) {
          // The model filters null/non-finite values. Index discontinuities still identify those gaps.
          if (point.index !== previous + 1) ctx.moveTo(point.x, point.y)
          else ctx.lineTo(point.x, point.y)
          previous = point.index
        }
        ctx.stroke()
      }
    } finally { ctx.restore() }

    ctx.fillStyle = options.text ?? DEFAULTS.text
    if (frame.indicatorPane === true && frame.title !== undefined) {
      ctx.textAlign = 'left'
      ctx.fillText(frame.title, g.left + 4, Math.max(8, g.top - 7), Math.max(1, g.plotWidth - 8))
    }
    ctx.textAlign = 'right'
    for (const tick of m.yTicks) ctx.fillText(options.formatPrice?.(tick, digits) ?? tick.toFixed(digits), g.left - 6, m.y(tick), Math.max(1, g.left - 10))
    if (m.hasRightAxis) {
      ctx.textAlign = 'left'
      for (const tick of m.rightTicks) ctx.fillText(tick.toFixed(digits), g.right + 6, m.y(tick, 'right'), Math.max(1, g.width - g.right - 10))
    }
    let labelRight = -Infinity
    let previousDate: Record<string, string> | null = null
    ctx.textAlign = 'center'
    for (const index of options.showTimeAxis === false ? [] : m.xTickIndices) {
      const key = m.xKeys[index]
      const date = (options.timespan === 'minute' || options.timespan === 'second') && typeof key === 'number' && Number.isFinite(key) && Math.abs(key) <= 8.64e15 ? calendarDate(formatter, key, options.timeZone ?? 'UTC') : null
      const label = typeof key === 'number' ? timeLabel(formatter, key, options, 'xAxis', date === null ? 'HH:mm' : boundaryFormat(date, previousDate)) : String(key)
      const width = Math.min(ctx.measureText(label).width, Math.max(1, g.width - 8))
      const x = Math.max(4 + width / 2, Math.min(g.width - 4 - width / 2, m.xPositions[index]))
      if (x - width / 2 < labelRight + 8) continue
      ctx.fillText(label, x, Math.min(g.height - 8, g.bottom + 18), width)
      labelRight = x + width / 2
      previousDate = date
    }
  } finally { ctx.restore() }
}

/** Draw on a separate cleared cursor layer so pointer moves do not redraw candles. */
export function paintEngineCursor (
  ctx: CanvasRenderingContext2D,
  frame: EngineRenderFrame,
  x: number,
  options: EngineRenderOptions = {}
): void {
  const m = frame.model, g = m.geometry
  if (!ready(m) || !Number.isFinite(x) || x < g.left || x > g.right) return
  const index = nearestChartIndex(m, x), hit = frame.inspectBar !== undefined ? frame.inspectBar(x) : frame.inspect(x)
  if (index === null || hit === null) return
  const bar = hit.displayBar
  const typical = typicalPrice(bar)
  const displayed = options.chartType === 'hlc-area' ? Number.isFinite(typical) ? typical : bar.high / 3 + bar.low / 3 + bar.close / 3 : bar.close
  const px = m.xPositions[index], py = m.y(displayed)
  const indicator = frame.indicatorPane === true
  if (!Number.isFinite(px) || (!indicator && !Number.isFinite(py))) return
  const digits = precision(options.pricePrecision ?? frame.pricePrecision ?? derivePrecision(frame.snapshot.bars))
  ctx.save()
  try {
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'
    ctx.strokeStyle = ctx.fillStyle = options.text ?? DEFAULTS.text
    ctx.lineWidth = 1; ctx.setLineDash([3, 3])
    ctx.save()
    try {
      clipPlot(ctx, m)
      ctx.beginPath(); ctx.moveTo(px, g.top); ctx.lineTo(px, g.bottom)
      if (!indicator) { ctx.moveTo(g.left, py); ctx.lineTo(g.right, py) }
      ctx.stroke()
    } finally { ctx.restore() }
    ctx.setLineDash([]); ctx.font = options.font ?? DEFAULTS.font
    ctx.textAlign = 'left'; ctx.textBaseline = 'top'
    const label = indicator ? m.plottedSeries.map(series => {
      // Visible points stay ordered even when warmup/null gaps were filtered.
      let lo = 0, hi = series.points.length
      while (lo < hi) { const mid = (lo + hi) >>> 1; if (series.points[mid].index < index) lo = mid + 1; else hi = mid }
      const point = series.points[lo]?.index === index ? series.points[lo] : undefined
      return `${series.source.name ?? series.source.id} ${point === undefined ? '—' : Number(point.value.toPrecision(6))}`
    }).join('  ') : `${hit.mode === 'heikin-ashi' ? 'HA ' : ''}O ${bar.open.toFixed(digits)}  H ${bar.high.toFixed(digits)}  L ${bar.low.toFixed(digits)}  C ${bar.close.toFixed(digits)}`
    const width = Math.min(g.plotWidth, ctx.measureText(label).width + 8)
    ctx.fillStyle = options.background ?? DEFAULTS.background
    ctx.fillRect(g.left, g.top, width, 20)
    ctx.fillStyle = options.text ?? DEFAULTS.text
    ctx.fillText(label, g.left + 4, g.top + 3, Math.max(1, width - 8))
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle'
    if (!indicator) ctx.fillText(options.formatPrice?.(displayed, digits) ?? displayed.toFixed(digits), g.left - 6, py, Math.max(1, g.left - 10))
    const time = timeLabel(timeFormat(options.timeZone ?? 'UTC'), hit.timestamp, options, 'crosshair')
    const timeWidth = Math.min(g.width - 8, ctx.measureText(time).width)
    const timeX = Math.max(4 + timeWidth / 2, Math.min(g.width - 4 - timeWidth / 2, px))
    ctx.textAlign = 'center'
    if (options.showTimeAxis !== false) ctx.fillText(time, timeX, Math.min(g.height - 8, g.bottom + 18), timeWidth)
  } finally { ctx.restore() }
}
