import { nearestChartIndex, derivePrecision, formatBarDate, type FinancialChartModel, type ChartCandlePoint, type EngineRenderFrame, type EngineRenderOptions, type BarDateRequestType } from '@supersolutions/super-chart-core'
import { paintPriceSeries } from './seriesRenderer'
import { typicalPrice, halfBarWidth } from './geometry'
import { colors, withAlpha, CANVAS_FONT, CANVAS_LABEL_FONT } from './tokens'

export type { EngineRenderOptions } from '@supersolutions/super-chart-core'

/** The theme's palette with the host's single-colour overrides applied. */
interface Palette {
  background: string
  grid: string
  text: string
  ink: string
  inkMuted: string
  up: string
  down: string
  flat: string
  line: string
  font: string
  upBar: string
  downBar: string
  crosshair: string
  tagFill: string
  tagText: string
  onMarket: string
  indicator: readonly [string, string, string]
}
function palette (options: EngineRenderOptions): Palette {
  const c = colors(options.theme)
  const up = options.up ?? c.up, down = options.down ?? c.down, background = options.background ?? c.surface
  return {
    background,
    grid: options.grid ?? c.line,
    text: options.text ?? c.inkMuted,
    ink: c.ink,
    inkMuted: c.inkMuted,
    up,
    down,
    flat: c.flat,
    line: options.line ?? c.ink,
    font: options.font ?? CANVAS_FONT,
    upBar: options.up === undefined ? c.upBar : withAlpha(up, 0.42),
    downBar: options.down === undefined ? c.downBar : withAlpha(down, 0.42),
    crosshair: c.lineStrong,
    tagFill: c.ink,
    tagText: background,
    onMarket: c.onMarket,
    indicator: c.indicator
  }
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
/** +1 up, -1 down, 0 flat: the close against the open. */
function direction (open: number, close: number): number {
  return close > open ? 1 : close < open ? -1 : 0
}

/**
 * Hollow when the close is above the open, solid when below, one line when flat,
 * so up and down read by shape before colour. Bodies under 3px are filled, or
 * a hollow body would vanish. A path per group, not a stroke per bar.
 */
function paintCandles (ctx: CanvasRenderingContext2D, m: FinancialChartModel, candles: readonly ChartCandlePoint[], half: number, type: 'candles' | 'ohlc', p: Palette): void {
  const bodies = type === 'candles', hollowUp = bodies && half >= 1.5
  ctx.lineWidth = 1
  for (const group of [1, -1, 0]) {
    const color = group > 0 ? p.up : group < 0 ? p.down : p.flat
    ctx.fillStyle = ctx.strokeStyle = color
    const hollow = (candle: ChartCandlePoint): boolean => hollowUp && group > 0 && candle.bodyBottom - candle.bodyTop >= 2
    ctx.beginPath()
    for (const candle of candles) {
      if (direction(candle.o, candle.c) !== group) continue
      if (hollow(candle)) {
        ctx.moveTo(candle.x, candle.wickTop); ctx.lineTo(candle.x, candle.bodyTop)
        ctx.moveTo(candle.x, candle.bodyBottom); ctx.lineTo(candle.x, candle.wickBottom)
        ctx.rect(candle.x - half + 0.5, candle.bodyTop + 0.5, Math.max(1, 2 * half - 1), candle.bodyBottom - candle.bodyTop - 1)
      } else {
        ctx.moveTo(candle.x, candle.wickTop); ctx.lineTo(candle.x, candle.wickBottom)
      }
      if (type === 'ohlc') {
        const openY = m.y(candle.o), closeY = m.y(candle.c)
        ctx.moveTo(candle.x - half, openY); ctx.lineTo(candle.x, openY)
        ctx.moveTo(candle.x, closeY); ctx.lineTo(candle.x + half, closeY)
      } else if (group === 0) {
        ctx.moveTo(candle.x - half, candle.bodyTop); ctx.lineTo(candle.x + half, candle.bodyTop)
      }
    }
    ctx.stroke()
    if (!bodies || group === 0) continue
    ctx.beginPath()
    for (const candle of candles) {
      if (direction(candle.o, candle.c) !== group || hollow(candle)) continue
      ctx.rect(candle.x - half, candle.bodyTop, 2 * half, Math.max(1, candle.bodyBottom - candle.bodyTop))
    }
    ctx.fill()
  }
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
  const p = palette(options)
  const digits = precision(options.pricePrecision ?? frame.pricePrecision ?? derivePrecision(frame.snapshot.bars))
  const formatter = timeFormat(options.timeZone ?? 'UTC')
  const bars = frame.snapshot.bars
  const last = frame.indicatorPane === true ? undefined : bars[bars.length - 1]
  const lastY = last === undefined ? NaN : m.y(last.close)
  const showLast = last !== undefined && Number.isFinite(lastY) && lastY >= g.top && lastY <= g.bottom
  const lastColor = last === undefined ? p.flat : [p.down, p.flat, p.up][direction(last.open, last.close) + 1]
  ctx.save()
  try {
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'
    ctx.setLineDash([]); ctx.lineWidth = 1
    ctx.fillStyle = p.background
    ctx.fillRect(0, 0, g.width, g.height)
    ctx.font = p.font
    ctx.textBaseline = 'middle'

    ctx.save()
    try {
      clipPlot(ctx, m)
      // Horizontal grid only: price levels matter, time is read from the axis.
      ctx.strokeStyle = p.grid
      ctx.beginPath()
      for (const tick of m.yTicks) {
        const y = Math.round(m.y(tick)) + 0.5
        ctx.moveTo(g.left, y); ctx.lineTo(g.right, y)
      }
      ctx.stroke()

      const type = options.chartType ?? 'candles'
      const span = frame.snapshot.viewport.i1 - frame.snapshot.viewport.i0
      const half = (type !== 'line' && type !== 'area') || m.plottedSeries.some(series => series.source.type === 'bar') ? halfBarWidth(m, frame.snapshot.dataStart !== undefined && span > 0 ? g.plotWidth / span : undefined) : 0
      if (paintPriceSeries(ctx, frame, { ...options, up: p.up, down: p.down, line: p.line, text: p.text, background: p.background }, half)) {
        // Extended series share this clip and the exact same price transform.
      } else if (type === 'line' || type === 'area') {
        if (type === 'area') {
          ctx.fillStyle = options.line === undefined ? colors(options.theme).inkWash : p.line
          ctx.globalAlpha = options.line === undefined ? 1 : 0.14
          paintClose(ctx, m, true); ctx.globalAlpha = 1
        }
        ctx.strokeStyle = p.line; ctx.lineWidth = 2; ctx.lineJoin = 'round'
        paintClose(ctx, m, false)
      } else {
        // Density changes only the paint list; raw data, inspection and indicator rows remain exact.
        const candles = options.candleDensity === 'pixel-envelope' ? candleEnvelope(m) : m.plottedCandles
        paintCandles(ctx, m, candles, half, type === 'ohlc' ? 'ohlc' : 'candles', p)
      }

      // Lines without their own colour take the pane's slots in order; a fourth
      // and later line is ink-muted and dashed. Bars follow the candle (volume)
      // or their sign around the base (histograms).
      let slot = 0
      let directions: Map<unknown, number> | null = null
      for (const series of m.plottedSeries) {
        const style = frame.figureStyles?.get(series.source.id)
        const own = series.source.color
        if (series.source.type === 'bar') {
          const base = Math.max(m.min, Math.min(m.max, style?.base ?? 0))
          const zero = Math.max(g.top, Math.min(g.bottom, m.y(base)))
          const signed = series.points.some(point => point.value < base)
          if (own === undefined && !signed && directions === null) directions = new Map(bars.map(bar => [bar.timestamp, direction(bar.open, bar.close)]))
          for (const rising of [true, false]) {
            ctx.fillStyle = own ?? (rising ? p.upBar : p.downBar)
            ctx.beginPath()
            for (const point of series.points) {
              const up = own !== undefined || (signed ? point.value >= base : directions?.get(point.key) !== -1)
              if (up !== rising) continue
              ctx.rect(point.x - half, Math.min(zero, point.y), half * 2, Math.max(1, Math.abs(point.y - zero)))
            }
            ctx.fill()
            if (own !== undefined) break
          }
          continue
        }
        let color = own, dash = style?.dash
        if (color === undefined) {
          color = slot < p.indicator.length ? p.indicator[slot] : p.inkMuted
          if (slot >= p.indicator.length && dash === undefined) dash = [4, 3]
          slot++
        }
        ctx.lineWidth = style?.lineWidth ?? 1.5
        ctx.setLineDash(dash === undefined ? [] : [...dash])
        ctx.strokeStyle = ctx.fillStyle = color
        if (series.source.type === 'scatter') {
          ctx.beginPath()
          for (const point of series.points) { ctx.moveTo(point.x + ctx.lineWidth, point.y); ctx.arc(point.x, point.y, ctx.lineWidth, 0, 2 * Math.PI) }
          ctx.fill(); continue
        }
        ctx.lineJoin = 'round'
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
      ctx.setLineDash([])

      if (showLast) {
        const y = Math.round(lastY) + 0.5
        ctx.strokeStyle = lastColor; ctx.lineWidth = 1; ctx.setLineDash([2, 3])
        ctx.beginPath(); ctx.moveTo(g.left, y); ctx.lineTo(g.right, y); ctx.stroke(); ctx.setLineDash([])
      }
    } finally { ctx.restore() }

    if (frame.indicatorPane === true && frame.title !== undefined) {
      ctx.font = CANVAS_LABEL_FONT; ctx.fillStyle = p.text; ctx.textAlign = 'left'
      ctx.fillText(frame.title, g.left + 4, Math.max(8, g.top - 7), Math.max(1, g.plotWidth - 8))
      ctx.font = p.font
    }
    // Price labels never collide with each other or with the last-price tag.
    ctx.fillStyle = p.text; ctx.textAlign = 'right'
    let previousY = -Infinity
    for (const tick of [...m.yTicks].sort((a, b) => m.y(a) - m.y(b))) {
      const y = m.y(tick)
      if (y - previousY < 12 || (showLast && Math.abs(y - lastY) < 14)) continue
      ctx.fillText(options.formatPrice?.(tick, digits) ?? tick.toFixed(digits), g.left - 6, y, Math.max(1, g.left - 10))
      previousY = y
    }
    if (m.hasRightAxis) {
      ctx.textAlign = 'left'
      for (const tick of m.rightTicks) ctx.fillText(tick.toFixed(digits), g.right + 6, m.y(tick, 'right'), Math.max(1, g.width - g.right - 10))
    }
    if (showLast && last !== undefined) {
      ctx.fillStyle = lastColor
      ctx.fillRect(2, Math.round(lastY) - 9, Math.max(1, g.left - 4), 18)
      ctx.fillStyle = p.onMarket; ctx.textAlign = 'right'
      ctx.fillText(options.formatPrice?.(last.close, digits) ?? last.close.toFixed(digits), g.left - 6, Math.round(lastY), Math.max(1, g.left - 10))
    }
    let labelRight = -Infinity
    let previousDate: Record<string, string> | null = null
    ctx.fillStyle = p.text; ctx.textAlign = 'center'
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
  const p = palette(options)
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
    ctx.strokeStyle = p.crosshair
    ctx.lineWidth = 1; ctx.setLineDash([3, 3])
    ctx.save()
    try {
      clipPlot(ctx, m)
      const cx = Math.round(px) + 0.5, cy = Math.round(py) + 0.5
      ctx.beginPath(); ctx.moveTo(cx, g.top); ctx.lineTo(cx, g.bottom)
      if (!indicator) { ctx.moveTo(g.left, cy); ctx.lineTo(g.right, cy) }
      ctx.stroke()
    } finally { ctx.restore() }
    ctx.setLineDash([]); ctx.font = p.font
    ctx.textAlign = 'left'; ctx.textBaseline = 'top'

    // Readout: names muted, values in ink, on the canvas colour.
    const parts: Array<[string, string]> = indicator
      ? m.plottedSeries.map(series => {
        // Visible points stay ordered even when warmup/null gaps were filtered.
        let lo = 0, hi = series.points.length
        while (lo < hi) { const mid = (lo + hi) >>> 1; if (series.points[mid].index < index) lo = mid + 1; else hi = mid }
        const point = series.points[lo]?.index === index ? series.points[lo] : undefined
        return [`${series.source.name ?? series.source.id} `, point === undefined ? '—' : String(Number(point.value.toPrecision(6)))]
      })
      : [[hit.mode === 'heikin-ashi' ? 'HA O ' : 'O ', bar.open.toFixed(digits)], ['H ', bar.high.toFixed(digits)], ['L ', bar.low.toFixed(digits)], ['C ', bar.close.toFixed(digits)]]
    const gap = 10
    const width = Math.min(g.plotWidth, parts.reduce((sum, [name, value]) => sum + ctx.measureText(name).width + ctx.measureText(value).width + gap, 8))
    ctx.fillStyle = p.background; ctx.globalAlpha = 0.92
    ctx.fillRect(g.left, g.top, width, 20); ctx.globalAlpha = 1
    let cursor = g.left + 4
    for (const [name, value] of parts) {
      if (cursor > g.left + width) break
      ctx.fillStyle = p.text; ctx.fillText(name, cursor, g.top + 4); cursor += ctx.measureText(name).width
      ctx.fillStyle = p.ink; ctx.fillText(value, cursor, g.top + 4); cursor += ctx.measureText(value).width + gap
    }

    // Tags are ink fills, so they never read as a market colour.
    ctx.textBaseline = 'middle'
    if (!indicator) {
      const y = Math.round(py)
      ctx.fillStyle = p.tagFill; ctx.fillRect(2, y - 9, Math.max(1, g.left - 4), 18)
      ctx.fillStyle = p.tagText; ctx.textAlign = 'right'
      ctx.fillText(options.formatPrice?.(displayed, digits) ?? displayed.toFixed(digits), g.left - 6, y, Math.max(1, g.left - 10))
    }
    if (options.showTimeAxis !== false) {
      const time = timeLabel(timeFormat(options.timeZone ?? 'UTC'), hit.timestamp, options, 'crosshair')
      const timeWidth = Math.min(g.width - 8, ctx.measureText(time).width + 12)
      const timeX = Math.max(2 + timeWidth / 2, Math.min(g.width - 2 - timeWidth / 2, px))
      const timeY = Math.min(g.height - 8, g.bottom + 18)
      ctx.fillStyle = p.tagFill; ctx.fillRect(Math.round(timeX - timeWidth / 2), Math.round(timeY) - 9, Math.round(timeWidth), 18)
      ctx.fillStyle = p.tagText; ctx.textAlign = 'center'
      ctx.fillText(time, timeX, Math.round(timeY), timeWidth - 8)
    }
  } finally { ctx.restore() }
}
