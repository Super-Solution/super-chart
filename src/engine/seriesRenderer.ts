import { baselineSegments, columnExtents, highLowExtents, hlcAreaPoints, stepLinePoints, volumeIntensities } from '../charttypes/geometry'
import type { Bar } from '../charttypes/geometry'
import type { ChartCandlePoint, FinancialChartModel } from '../core/financialModel'
import { nearestBarIndex } from '../core/series'
import type { EngineRenderFrame } from './frame'
import type { EngineRenderOptions } from './renderTypes'

export { ENGINE_CHART_TYPES } from './renderTypes'

interface Point { x: number, y: number }

function halfWidth (model: FinancialChartModel): number {
  let spacing = model.geometry.plotWidth
  for (let i = 1; i < model.xPositions.length; i++) {
    const gap = model.xPositions[i] - model.xPositions[i - 1]
    if (gap > 0) spacing = Math.min(spacing, gap)
  }
  return Math.max(0.25, Math.min(6, spacing * 0.34))
}
function barsOf (candles: readonly ChartCandlePoint[]): Bar[] {
  return candles.map(bar => ({ open: bar.o, high: bar.h, low: bar.l, close: bar.c, volume: bar.v }))
}
function path (ctx: CanvasRenderingContext2D, points: readonly Point[]): void {
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y)
  }
}
/** Gaps in filtered data remain gaps in a line or area, including on logarithmic scales. */
function runs (candles: readonly ChartCandlePoint[], y: (value: number) => number, value: (bar: ChartCandlePoint) => number): ChartCandlePoint[][] {
  const result: ChartCandlePoint[][] = []
  let previous = -2, run: ChartCandlePoint[] = []
  for (const candle of candles) {
    if (!Number.isFinite(candle.x) || !Number.isFinite(y(value(candle)))) { previous = -2; continue }
    if (candle.index !== previous + 1) { run = []; result.push(run) }
    run.push(candle); previous = candle.index
  }
  return result
}
function drawBaseline (
  ctx: CanvasRenderingContext2D, model: FinancialChartModel, baseline: number, up: string, down: string, neutral: string
): void {
  const baseY = model.y(baseline)
  if (!Number.isFinite(baseY)) return
  const cross = (a: ChartCandlePoint, b: ChartCandlePoint): Point => {
    const ay = model.y(a.c), by = model.y(b.c)
    // Interpolate the rendered line, so the split meets the baseline under log/reversed scales too.
    const fraction = by === ay ? 0 : Math.max(0, Math.min(1, (baseY - ay) / (by - ay)))
    return { x: a.x + (b.x - a.x) * fraction, y: baseY }
  }
  for (const candles of runs(model.plottedCandles, model.y, candle => candle.c)) {
    const bars = barsOf(candles)
    for (const segment of baselineSegments(bars, baseline)) {
      const points: Point[] = []
      for (let i = segment.from; i <= segment.to; i++) {
        const candle = candles[i]
        if (i === segment.from && (candle.c >= baseline) !== segment.above && i + 1 < candles.length) points.push(cross(candle, candles[i + 1]))
        else points.push({ x: candle.x, y: model.y(candle.c) })
      }
      if (segment.to + 1 < candles.length && (candles[segment.to + 1].c >= baseline) !== segment.above) {
        points.push(cross(candles[segment.to], candles[segment.to + 1]))
      }
      const first = points[0], last = points[points.length - 1]
      if (first === undefined) continue
      const color = segment.above ? up : down
      ctx.fillStyle = ctx.strokeStyle = color
      ctx.beginPath(); ctx.moveTo(first.x, baseY)
      for (const p of points) ctx.lineTo(p.x, p.y)
      ctx.lineTo(last.x, baseY); ctx.closePath()
      ctx.globalAlpha = 0.22; ctx.fill(); ctx.globalAlpha = 1
      ctx.beginPath(); path(ctx, points); ctx.stroke()
    }
  }
  ctx.strokeStyle = neutral; ctx.lineWidth = 1; ctx.setLineDash([4, 4])
  ctx.beginPath(); ctx.moveTo(model.geometry.left, baseY); ctx.lineTo(model.geometry.right, baseY); ctx.stroke()
}

/** Extended price-series types only. The caller owns plot clipping and paints indicators separately. */
export function paintPriceSeries (
  ctx: CanvasRenderingContext2D,
  frame: EngineRenderFrame,
  options: EngineRenderOptions = {}
): boolean {
  const type = options.chartType ?? 'candles'
  if (type === 'candles' || type === 'ohlc' || type === 'line' || type === 'area') return false
  const model = frame.model, candles = model.plottedCandles, half = halfWidth(model)
  const up = options.up ?? '#58c9ac', down = options.down ?? '#f28b82', line = options.line ?? '#8bafff'
  const color = (rising: boolean): string => rising ? up : down
  ctx.save()
  try {
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.setLineDash([])
    ctx.lineWidth = 1.5; ctx.strokeStyle = ctx.fillStyle = line
    switch (type) {
      case 'hollow-candles': case 'outline-candles': case 'hollow-down-candles': {
        for (let group = 0; group < 2; group++) {
          const rising = group === 0
          const hollow = type === 'outline-candles' || (type === 'hollow-candles' ? rising : !rising)
          ctx.strokeStyle = ctx.fillStyle = color(rising); ctx.lineWidth = 1
          ctx.beginPath()
          for (const candle of candles) {
            if ((candle.c >= candle.o) !== rising) continue
            const open = model.y(candle.o), close = model.y(candle.c)
            if (![open, close, candle.wickTop, candle.wickBottom].every(Number.isFinite)) continue
            const height = Math.max(1, Math.abs(close - open)), top = (open + close - height) / 2
            ctx.moveTo(candle.x, candle.wickTop); ctx.lineTo(candle.x, top)
            ctx.moveTo(candle.x, top + height); ctx.lineTo(candle.x, candle.wickBottom)
          }
          ctx.stroke(); ctx.beginPath()
          for (const candle of candles) {
            if ((candle.c >= candle.o) !== rising) continue
            const open = model.y(candle.o), close = model.y(candle.c)
            if (!Number.isFinite(open) || !Number.isFinite(close)) continue
            const height = Math.max(1, Math.abs(close - open))
            ctx.rect(candle.x - half, (open + close - height) / 2, half * 2, height)
          }
          if (hollow) ctx.stroke(); else ctx.fill()
        }
        break
      }
      case 'columns': {
        const extents = columnExtents(frame.snapshot.bars), preceding = frame.previousClose
        if (extents.length > 0 && preceding !== undefined && Number.isFinite(preceding)) {
          extents[0] = { ...extents[0], from: preceding, up: extents[0].to >= preceding }
        }
        for (let group = 0; group < 2; group++) {
          const rising = group === 0
          ctx.fillStyle = color(rising); ctx.beginPath()
          for (const candle of candles) {
            const index = typeof candle.t === 'number' ? nearestBarIndex(frame.snapshot.bars, candle.t) : null
            if (index === null || frame.snapshot.bars[index].timestamp !== candle.t) continue
            const extent = extents[index]
            if (extent.up !== rising) continue
            const a = model.y(extent.from), b = model.y(extent.to)
            if (!Number.isFinite(a) || !Number.isFinite(b)) continue
            ctx.rect(candle.x - half, Math.min(a, b), half * 2, Math.max(1, Math.abs(b - a)))
          }
          ctx.fill()
        }
        break
      }
      case 'high-low': {
        const extents = highLowExtents(barsOf(candles))
        ctx.lineWidth = 2
        for (let group = 0; group < 2; group++) {
          const rising = group === 0
          ctx.strokeStyle = color(rising); ctx.beginPath()
          for (const extent of extents) {
            if (extent.up !== rising) continue
            const x = candles[extent.index].x, a = model.y(extent.high), b = model.y(extent.low)
            if (!Number.isFinite(a) || !Number.isFinite(b)) continue
            ctx.moveTo(x, a); ctx.lineTo(x, b)
          }
          ctx.stroke()
        }
        break
      }
      case 'volume-bars': {
        const intensities = volumeIntensities(barsOf(candles))
        ctx.lineWidth = 2
        for (let i = 0; i < candles.length; i++) {
          const candle = candles[i], open = model.y(candle.o), close = model.y(candle.c)
          if (!Number.isFinite(open) || !Number.isFinite(close)) continue
          ctx.strokeStyle = color(candle.c >= candle.o); ctx.globalAlpha = 0.25 + 0.65 * intensities[i]
          ctx.beginPath(); ctx.moveTo(candle.x, candle.wickTop); ctx.lineTo(candle.x, candle.wickBottom)
          ctx.moveTo(candle.x - half, open); ctx.lineTo(candle.x, open)
          ctx.moveTo(candle.x, close); ctx.lineTo(candle.x + half, close); ctx.stroke()
        }
        break
      }
      case 'step-line': case 'hlc-area': case 'line-markers': {
        const hlc = type === 'hlc-area'
        for (const run of runs(candles, model.y, candle => hlc ? candle.h / 3 + candle.l / 3 + candle.c / 3 : candle.c)) {
          const bars = barsOf(run)
          const values = type === 'step-line' ? stepLinePoints(bars) : hlc ? hlcAreaPoints(bars) : bars.map((bar, index) => ({ index, value: bar.close }))
          if (hlc) { for (const value of values) {
            // Avoid overflowing the intermediate H + L + C sum for finite large prices.
            if (!Number.isFinite(value.value)) { const bar = bars[value.index]; value.value = bar.high / 3 + bar.low / 3 + bar.close / 3 }
          } }
          const points = values.map(value => ({ x: run[value.index].x, y: model.y(value.value) })).filter(p => Number.isFinite(p.y))
          if (points.length === 0) continue
          if (hlc) {
            ctx.beginPath(); ctx.moveTo(points[0].x, model.geometry.bottom)
            for (const p of points) ctx.lineTo(p.x, p.y)
            ctx.lineTo(points[points.length - 1].x, model.geometry.bottom); ctx.closePath()
            ctx.globalAlpha = 0.18; ctx.fill(); ctx.globalAlpha = 1
          }
          ctx.lineWidth = 1.75; ctx.beginPath(); path(ctx, points); ctx.stroke()
          if (type === 'line-markers') {
            ctx.beginPath()
            for (const p of points) { ctx.moveTo(p.x + 2.5, p.y); ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2) }
            ctx.fill()
          }
        }
        break
      }
      case 'baseline': {
        const baseline = options.baseline ?? frame.snapshot.bars[0]?.close
        if (baseline !== undefined && Number.isFinite(baseline)) drawBaseline(ctx, model, baseline, up, down, options.text ?? '#aebcca')
        break
      }
      default: return false
    }
    return true
  } finally { ctx.restore() }
}
