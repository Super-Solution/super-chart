import { nearestChartIndex, axisStrip, derivePrecision, formatBarDate, timeAxisTicks, sessionLayout, type FinancialChartModel, type ChartCandlePoint, type EngineRenderFrame, type EngineRenderOptions, type BarDateRequestType } from '@supersolutions/super-chart-core'
import { paintPriceSeries } from './seriesRenderer'
import { typicalPrice, halfBarWidth } from './geometry'
import { timeLabelCentre } from './badge'
import { paintLegend, legendRowBoxes, seriesColors, type LegendPalette, type LegendRowBox } from './legend'
import { colors, withAlpha, CANVAS_FONT, CANVAS_LABEL_FONT, FONT_SANS } from './tokens'

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
 * Solid bodies, up and down, one line when flat; the hollow looks are chart types of their own
 * (`hollow-candles`, `hollow-down-candles`, `outline-candles`). A path per group, not a stroke per bar.
 */
function paintCandles (ctx: CanvasRenderingContext2D, m: FinancialChartModel, candles: readonly ChartCandlePoint[], half: number, type: 'candles' | 'ohlc', p: Palette): void {
  const bodies = type === 'candles'
  ctx.lineWidth = 1
  for (const group of [1, -1, 0]) {
    const color = group > 0 ? p.up : group < 0 ? p.down : p.flat
    ctx.fillStyle = ctx.strokeStyle = color
    ctx.beginPath()
    for (const candle of candles) {
      if (direction(candle.o, candle.c) !== group) continue
      ctx.moveTo(candle.x, candle.wickTop); ctx.lineTo(candle.x, candle.wickBottom)
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
      if (direction(candle.o, candle.c) !== group) continue
      ctx.rect(candle.x - half, candle.bodyTop, 2 * half, Math.max(1, candle.bodyBottom - candle.bodyTop))
    }
    ctx.fill()
  }
}

/** Where the time axis puts its ticks (x in pane pixels), the same choice `paintTimeAxis` makes, for a vertical grid to sit on them. */
function timeTickXs (ctx: CanvasRenderingContext2D, m: FinancialChartModel, options: EngineRenderOptions): number[] {
  const g = m.geometry, timestamps = m.xKeys as number[]
  if (!(timestamps.length > 0 && timestamps.every(key => typeof key === 'number'))) return m.xTickIndices.map(index => m.xPositions[index]).filter(Number.isFinite)
  const sample = ctx.measureText(options.timespan === 'second' ? '00:00:00' : '00:00').width
  return timeAxisTicks(timestamps, m.xPositions, { timeZone: options.timeZone, symbolTimezone: options.symbolTimezone, timespan: options.timespan, locale: options.locale, minSpacing: sample + 40, left: g.left, right: g.right })
    .map(tick => m.xPositions[tick.index]).filter(Number.isFinite)
}

const BOLD_FONT = /^(\d+)\s/
/** Emphasised (years, months, days) ticks are drawn heavier than times of day. */
function boldFont (font: string): string { return font.replace(BOLD_FONT, '700 ') }
/**
 * The time-axis row: round-time ticks chosen for the width (`timeAxisTicks`), each with a short stroke at its bar and
 * its label clear of the badge and the chart edge. Keys that are not timestamps (category axes) keep the three-point layout.
 */
function paintTimeAxis (ctx: CanvasRenderingContext2D, m: FinancialChartModel, p: Palette, options: EngineRenderOptions): void {
  const g = m.geometry
  const timestamps = m.xKeys as number[]
  const timed = timestamps.length > 0 && timestamps.every(key => typeof key === 'number')
  let labels: Array<{ index: number, label: string, emphasised: boolean }>
  if (timed) {
    const seconds = options.timespan === 'second'
    const sample = ctx.measureText(seconds ? '00:00:00' : '00:00').width
    labels = timeAxisTicks(timestamps, m.xPositions, {
      timeZone: options.timeZone,
      symbolTimezone: options.symbolTimezone,
      timespan: options.timespan,
      locale: options.locale,
      minSpacing: sample + 40,
      left: g.left,
      right: g.right
    }).map(tick => ({ index: tick.index, label: tick.label, emphasised: tick.level === 'year' || tick.level === 'month' || tick.level === 'day' }))
  } else {
    labels = m.xTickIndices.map(index => ({ index, label: String(m.xKeys[index]), emphasised: false }))
  }
  let labelRight = -Infinity
  ctx.fillStyle = p.text; ctx.textAlign = 'center'
  const font = ctx.font, heavy = boldFont(font)
  ctx.strokeStyle = p.grid
  for (const { index, label, emphasised } of labels) {
    ctx.font = emphasised ? heavy : font
    const width = Math.min(ctx.measureText(label).width, Math.max(1, g.width - 8))
    const x = timeLabelCentre(m.xPositions[index], width, g.width, 4)
    if (x - width / 2 < labelRight + 8) continue
    ctx.beginPath(); ctx.moveTo(Math.round(m.xPositions[index]) + 0.5, g.bottom); ctx.lineTo(Math.round(m.xPositions[index]) + 0.5, g.bottom + 4); ctx.stroke()
    ctx.fillStyle = emphasised ? options.text ?? p.ink : p.text
    ctx.fillText(label, x, Math.min(g.height - 8, g.bottom + 18), width)
    labelRight = x + width / 2
  }
  ctx.font = font
}

const DATE_ONLY: ReadonlySet<string> = new Set(['day', 'week', 'month', 'year'])
/**
 * Pre-market and after-hours as a wash behind the bars, and a faint dashed line where a new local date begins, from
 * `options.session`. Intraday periods only (a bar of a day or more has no time of day); bars outside every session are
 * left bare. The wash spans from the middle of the gap before the first extended bar to the middle of the gap after
 * the last, so it meets the next bar's region without a seam.
 */
function paintSession (ctx: CanvasRenderingContext2D, m: FinancialChartModel, p: Palette, options: EngineRenderOptions): void {
  const session = options.session
  if (session === undefined || session === null || DATE_ONLY.has(options.timespan ?? '')) return
  const xs = m.xPositions, count = xs.length, g = m.geometry
  if (count < 2 || !m.xKeys.every(key => typeof key === 'number')) return
  const { kinds, breaks } = sessionLayout(session, m.xKeys as number[])
  const edge = (i: number, side: -1 | 1): number => {
    const j = i + side
    return j < 0 || j >= count ? xs[i] + side * Math.abs(xs[i] - xs[i - side]) / 2 : (xs[i] + xs[j]) / 2
  }
  ctx.fillStyle = colors(options.theme).inkWash
  for (let i = 0; i < count; i++) {
    if (kinds[i] !== 1 && kinds[i] !== 2) continue
    let end = i
    while (end + 1 < count && (kinds[end + 1] === 1 || kinds[end + 1] === 2)) end++
    const left = edge(i, -1), right = edge(end, 1)
    if (Number.isFinite(left) && Number.isFinite(right) && right > left) ctx.fillRect(left, g.top, right - left, g.plotHeight)
    i = end
  }
  ctx.strokeStyle = p.grid; ctx.setLineDash([2, 4]); ctx.beginPath()
  for (let i = 1; i < count; i++) {
    if (breaks[i] === 0) continue
    const x = Math.round(edge(i, -1)) + 0.5
    if (Number.isFinite(x)) { ctx.moveTo(x, g.top); ctx.lineTo(x, g.bottom) }
  }
  ctx.stroke(); ctx.setLineDash([])
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
      paintSession(ctx, m, p, options)
      // Price levels by default (time is read from the axis); `gridLines` adds the time ticks or removes either.
      const grid = options.gridLines ?? 'horizontal'
      ctx.strokeStyle = p.grid
      ctx.beginPath()
      if (grid === 'horizontal' || grid === 'both') {
        for (const tick of m.yTicks) {
          const y = Math.round(m.y(tick)) + 0.5
          ctx.moveTo(g.left, y); ctx.lineTo(g.right, y)
        }
      }
      if ((grid === 'vertical' || grid === 'both') && frame.indicatorPane !== true) {
        for (const tickX of timeTickXs(ctx, m, options)) { const x = Math.round(tickX) + 0.5; ctx.moveTo(x, g.top); ctx.lineTo(x, g.bottom) }
      }
      ctx.stroke()

      if (frame.indicatorPane !== true && options.watermark !== undefined && options.watermark !== null && options.watermark.title !== '') {
        // Behind everything: the symbol and what it is, faint enough that no candle or line loses to it.
        const mark = options.watermark, size = Math.max(14, Math.min(g.plotHeight * 0.22, g.plotWidth * 0.1, 96))
        ctx.save()
        try {
          ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = p.ink; ctx.globalAlpha = 0.04
          const cx = (g.left + g.right) / 2, cy = (g.top + g.bottom) / 2 + (mark.subtitle === undefined ? size * 0.35 : -size * 0.05)
          ctx.font = `700 ${size}px ${FONT_SANS}`; ctx.fillText(mark.title, cx, cy, g.plotWidth - 24)
          if (mark.subtitle !== undefined && mark.subtitle !== '') { ctx.font = `500 ${Math.max(11, size * 0.3)}px ${FONT_SANS}`; ctx.fillText(mark.subtitle, cx, cy + size * 0.5, g.plotWidth - 24) }
        } finally { ctx.restore() }
      }

      const type = options.chartType ?? 'candles'
      const span = frame.snapshot.viewport.i1 - frame.snapshot.viewport.i0
      const half = (type !== 'line' && type !== 'area') || m.plottedSeries.some(series => series.source.type === 'bar') ? halfBarWidth(m, frame.snapshot.dataStart !== undefined && span > 0 ? g.plotWidth / span : undefined) : 0
      const colorMemo = new Map<string, string>()
      seriesColors.set(m, colorMemo)
      const paintSeries = (list: readonly FinancialChartModel['plottedSeries'][number][]): void => {
        // Lines without their own colour take the pane's slots in order; a fourth
        // and later line is ink-muted and dashed. Bars follow the candle (volume)
        // or their sign around the base (histograms).
        let slot = 0
        let directions: Map<unknown, number> | null = null
        for (const series of list) {
          const style = frame.figureStyles?.get(series.source.id)
          const own = series.source.color
          if (series.source.type === 'bar') {
            const base = Math.max(m.min, Math.min(m.max, style?.base ?? 0))
            const zero = series.zeroY !== undefined ? series.zeroY : Math.max(g.top, Math.min(g.bottom, m.y(base)))
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
          colorMemo.set(series.source.id, color)
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
      }
      // Overlay bands (volume) sit behind the price series, on a scale of their own.
      paintSeries(m.plottedSeries.filter(series => series.zeroY !== undefined))
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

      paintSeries(m.plottedSeries.filter(series => series.zeroY === undefined))
      ctx.setLineDash([])

      if (showLast) {
        const y = Math.round(lastY) + 0.5
        ctx.strokeStyle = lastColor; ctx.lineWidth = 1; ctx.setLineDash([2, 3])
        ctx.beginPath(); ctx.moveTo(g.left, y); ctx.lineTo(g.right, y); ctx.stroke(); ctx.setLineDash([])
      }
    } finally { ctx.restore() }

    if (frame.indicatorPane === true && frame.title !== undefined && options.legend === false) {
      ctx.font = CANVAS_LABEL_FONT; ctx.fillStyle = p.text; ctx.textAlign = 'left'
      ctx.fillText(frame.title, g.left + 4, Math.max(8, g.top - 7), Math.max(1, g.plotWidth - 8))
      ctx.font = p.font
    }
    // Price labels never collide with each other or with the last-price tag.
    const strip = axisStrip(g)
    ctx.fillStyle = p.text; ctx.textAlign = strip.align
    let previousY = -Infinity
    for (const tick of [...m.yTicks].sort((a, b) => m.y(a) - m.y(b))) {
      const y = m.y(tick)
      if (y - previousY < 12 || (showLast && Math.abs(y - lastY) < 14)) continue
      ctx.fillText(options.formatPrice?.(tick, digits) ?? tick.toFixed(digits), strip.textX, y, Math.max(1, strip.width - 10))
      previousY = y
    }
    if (m.hasRightAxis) {
      ctx.textAlign = 'left'
      for (const tick of m.rightTicks) ctx.fillText(tick.toFixed(digits), g.right + 6, m.y(tick, 'right'), Math.max(1, g.width - g.right - 10))
    }
    if (showLast && last !== undefined) {
      ctx.fillStyle = lastColor
      ctx.fillRect(strip.from + 2, Math.round(lastY) - 9, Math.max(1, strip.width - 4), 18)
      ctx.fillStyle = p.onMarket; ctx.textAlign = strip.align
      ctx.fillText(options.formatPrice?.(last.close, digits) ?? last.close.toFixed(digits), strip.textX, Math.round(lastY), Math.max(1, strip.width - 10))
    }
    if (options.showTimeAxis !== false) paintTimeAxis(ctx, m, p, options)
  } finally { ctx.restore() }
}

/** The always-on legend, drawn on the cursor layer so a pointer move repaints only it. `x` is the pointer's, or null for the latest bar. */
export function paintEngineLegend (ctx: CanvasRenderingContext2D, frame: EngineRenderFrame, x: number | null, options: EngineRenderOptions = {}): void {
  if (!ready(frame.model)) return
  const p = palette(options)
  const legend: LegendPalette = { background: p.background, ink: p.ink, muted: p.inkMuted, up: p.up, down: p.down, flat: p.flat, font: p.font }
  paintLegend(ctx, frame, x, options, legend, precision(options.pricePrecision ?? frame.pricePrecision ?? derivePrecision(frame.snapshot.bars)))
}

/** The boxes of the legend's indicator rows at rest, in pane pixels, so the workspace can put actions beside them. */
export function engineLegendRowBoxes (ctx: CanvasRenderingContext2D, frame: EngineRenderFrame, options: EngineRenderOptions = {}): LegendRowBox[] {
  if (!ready(frame.model)) return []
  const p = palette(options)
  const legend: LegendPalette = { background: p.background, ink: p.ink, muted: p.inkMuted, up: p.up, down: p.down, flat: p.flat, font: p.font }
  return legendRowBoxes(ctx, frame, options, legend, precision(options.pricePrecision ?? frame.pricePrecision ?? derivePrecision(frame.snapshot.bars)))
}

/** A small second tag under the last-price tag (the bar-close countdown), on the cursor layer so it can change every second at no cost to the plot. */
export function paintEngineLastCaption (ctx: CanvasRenderingContext2D, frame: EngineRenderFrame, text: string, options: EngineRenderOptions = {}): void {
  const m = frame.model, g = m.geometry
  if (!ready(m) || frame.indicatorPane === true || text === '') return
  const last = frame.snapshot.bars[frame.snapshot.bars.length - 1]
  if (last === undefined) return
  const y = m.y(last.close)
  if (!Number.isFinite(y) || y < g.top || y > g.bottom) return
  const p = palette(options), strip = axisStrip(g)
  const color = [p.down, p.flat, p.up][direction(last.open, last.close) + 1]
  const top = Math.min(g.bottom - 16, Math.round(y) + 10)
  ctx.save()
  try {
    ctx.font = CANVAS_LABEL_FONT; ctx.textBaseline = 'middle'; ctx.textAlign = strip.align
    ctx.fillStyle = color; ctx.fillRect(strip.from + 2, top, Math.max(1, strip.width - 4), 16)
    ctx.fillStyle = p.onMarket; ctx.fillText(text, strip.textX, top + 8.5, Math.max(1, strip.width - 10))
  } finally { ctx.restore() }
}

/**
 * Draw on a separate cleared cursor layer so pointer moves do not redraw candles.
 *
 * With `options.cursorY` set the crosshair follows the pointer freely on both axes (the readout and the time tag still
 * name the bar beside it). Without it the lines sit on the bar's centre and close, as in earlier versions.
 */
export function paintEngineCursor (
  ctx: CanvasRenderingContext2D,
  frame: EngineRenderFrame,
  x: number,
  options: EngineRenderOptions = {}
): void {
  const m = frame.model, g = m.geometry
  if (!ready(m) || !Number.isFinite(x) || x < g.left || x > g.right) return
  const free = options.cursorY !== undefined
  const index = nearestChartIndex(m, x), hit = frame.inspectBar !== undefined ? frame.inspectBar(x) : frame.inspect(x)
  // Free, the lines still follow the pointer over empty time past the last bar; only the bar-bound parts need a bar.
  if (index === null || (hit === null && !free)) return
  const p = palette(options)
  const indicator = frame.indicatorPane === true
  const bar = hit?.displayBar
  let px: number, py: number, displayed = NaN
  if (free) {
    px = x
    const y = options.cursorY, price = options.cursorPrice
    py = y !== null && y !== undefined && price !== null && price !== undefined && Number.isFinite(y) && Number.isFinite(price) && y >= g.top && y <= g.bottom ? y : NaN
    displayed = Number.isFinite(py) ? options.cursorPrice as number : NaN
  } else {
    if (bar === undefined) return
    const typical = typicalPrice(bar)
    displayed = options.chartType === 'hlc-area' ? Number.isFinite(typical) ? typical : bar.high / 3 + bar.low / 3 + bar.close / 3 : bar.close
    px = m.xPositions[index]; py = m.y(displayed)
    if (!Number.isFinite(px) || (!indicator && !Number.isFinite(py))) return
  }
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
      if (free ? Number.isFinite(py) : !indicator) { ctx.moveTo(g.left, cy); ctx.lineTo(g.right, cy) }
      ctx.stroke()
    } finally { ctx.restore() }
    ctx.setLineDash([]); ctx.font = p.font
    ctx.textAlign = 'left'; ctx.textBaseline = 'top'

    // Readout: names muted, values in ink, on the canvas colour.
    if (hit !== null && bar !== undefined && options.legend === false) {
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
    }

    // Tags are ink fills, so they never read as a market colour.
    ctx.textBaseline = 'middle'
    if (Number.isFinite(py) && (free || !indicator)) {
      const y = Math.round(py)
      const text = indicator ? String(Number(displayed.toPrecision(6))) : options.formatPrice?.(displayed, digits) ?? displayed.toFixed(digits)
      const strip = axisStrip(g)
      ctx.fillStyle = p.tagFill; ctx.fillRect(strip.from + 2, y - 9, Math.max(1, strip.width - 4), 18)
      ctx.fillStyle = p.tagText; ctx.textAlign = strip.align
      ctx.fillText(text, strip.textX, y, Math.max(1, strip.width - 10))
    }
    if (options.showTimeAxis !== false && hit !== null) {
      const time = timeLabel(timeFormat(options.timeZone ?? 'UTC'), hit.timestamp, options, 'crosshair')
      const timeWidth = Math.min(g.width - 8, ctx.measureText(time).width + 12)
      const timeX = timeLabelCentre(px, timeWidth, g.width, 2)
      const timeY = Math.min(g.height - 8, g.bottom + 18)
      ctx.fillStyle = p.tagFill; ctx.fillRect(Math.round(timeX - timeWidth / 2), Math.round(timeY) - 9, Math.round(timeWidth), 18)
      ctx.fillStyle = p.tagText; ctx.textAlign = 'center'
      ctx.fillText(time, timeX, Math.round(timeY), timeWidth - 8)
    }
  } finally { ctx.restore() }
}
