import { nearestChartIndex } from '../core/financialModel'
import type { FinancialChartModel } from '../core/financialModel'
import type { EngineRenderFrame } from './frame'
import type { EngineRenderOptions } from './renderTypes'
import { paintPriceSeries } from './seriesRenderer'
import { derivePrecision } from '../core/precision'
import { typicalPrice } from '../charttypes/geometry'
import { formatBarDate } from '../time/formatBarDate'
import type { BarDateRequestType } from '../time/formatBarDate'

export type { EngineRenderOptions } from './renderTypes'

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
function timeLabel (displayDtf: Intl.DateTimeFormat, timestamp: number, options: EngineRenderOptions, type: BarDateRequestType, format = 'HH:mm'): string {
  return Number.isFinite(timestamp) && Math.abs(timestamp) <= 8.64e15
    ? formatBarDate({ displayDtf, timestamp, timespan: options.timespan ?? '', symbolTimezone: options.symbolTimezone, type, format })
    : String(timestamp)
}
function calendarDate (format: Intl.DateTimeFormat, timestamp: number): Record<string, string> {
  return Object.fromEntries(format.formatToParts(timestamp).filter(part => ['year', 'month', 'day'].includes(part.type)).map(part => [part.type, part.value]))
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
function halfBarWidth (m: FinancialChartModel): number {
  let spacing = m.geometry.plotWidth
  const xs = m.xPositions
  for (let i = 1; i < xs.length; i++) {
    const gap = xs[i] - xs[i - 1]
    if (gap > 0) spacing = Math.min(spacing, gap)
  }
  return Math.max(0.25, Math.min(6, spacing * 0.34))
}
function closePath (ctx: CanvasRenderingContext2D, m: FinancialChartModel, area: boolean): void {
  let previous = -2, firstX = 0, lastX = 0, open = false
  for (const candle of m.plottedCandles) {
    const y = m.y(candle.c)
    if (!Number.isFinite(candle.x) || !Number.isFinite(y)) continue
    if (candle.index !== previous + 1) {
      if (area && open) {
        ctx.lineTo(lastX, m.geometry.bottom); ctx.lineTo(firstX, m.geometry.bottom); ctx.closePath()
      }
      ctx.moveTo(candle.x, y); firstX = candle.x; open = true
    } else ctx.lineTo(candle.x, y)
    previous = candle.index; lastX = candle.x
  }
  if (area && open) {
    ctx.lineTo(lastX, m.geometry.bottom); ctx.lineTo(firstX, m.geometry.bottom); ctx.closePath()
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
  const digits = precision(options.pricePrecision ?? derivePrecision(frame.snapshot.bars))
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
      if (paintPriceSeries(ctx, frame, options)) {
        // Extended series share this clip and the exact same price transform.
      } else if (type === 'line' || type === 'area') {
        const color = options.line ?? DEFAULTS.line
        if (type === 'area') {
          ctx.fillStyle = color; ctx.globalAlpha = 0.14
          ctx.beginPath(); closePath(ctx, m, true); ctx.fill(); ctx.globalAlpha = 1
        }
        ctx.strokeStyle = color; ctx.lineWidth = 1.5
        ctx.beginPath(); closePath(ctx, m, false); ctx.stroke()
      } else {
        const half = halfBarWidth(m)
        // Four paths at most for the complete visible candle set, rather than a stroke per bar.
        for (let group = 0; group < 2; group++) {
          const up = group === 0
          const color = up ? options.up ?? DEFAULTS.up : options.down ?? DEFAULTS.down
          ctx.fillStyle = ctx.strokeStyle = color
          ctx.beginPath()
          for (const candle of m.plottedCandles) {
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
            for (const candle of m.plottedCandles) {
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
          const half = halfBarWidth(m), zero = Math.max(g.top, Math.min(g.bottom, m.y(base)))
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
      const date = (options.timespan === 'minute' || options.timespan === 'second') && typeof key === 'number' && Number.isFinite(key) && Math.abs(key) <= 8.64e15 ? calendarDate(formatter, key) : null
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
  const index = nearestChartIndex(m, x), hit = frame.inspect(x)
  if (index === null || hit === null) return
  const bar = hit.displayBar
  const typical = typicalPrice(bar)
  const displayed = options.chartType === 'hlc-area' ? Number.isFinite(typical) ? typical : bar.high / 3 + bar.low / 3 + bar.close / 3 : bar.close
  const px = m.xPositions[index], py = m.y(displayed)
  const indicator = frame.indicatorPane === true
  if (!Number.isFinite(px) || (!indicator && !Number.isFinite(py))) return
  const digits = precision(options.pricePrecision ?? derivePrecision(frame.snapshot.bars))
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
      const point = series.points.find(point => point.index === index)
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
