import { buildFinancialChartModel, nearestChartIndex } from '../core/financialModel'
import type { FinancialChartModel, FinancialSeries } from '../core/financialModel'
import type { RealtimeViewSnapshot } from '../core/realtimeView'
import type { MarketBar } from '../core/types'
import { nearestBarIndex } from '../core/series'
import { createPriceScale } from './priceScale'
import type { PriceScale, PriceScaleOptions } from './priceScale'
import type { IndicatorFigure } from './indicators'
import { applyRealtimeViewport } from '../core/realtimeModel'
import type { DrawingContext } from './drawings'

export interface FrameIndicator {
  id: string
  name: string
  pane: string
  figures: readonly IndicatorFigure[]
  rows: ReadonlyArray<Readonly<Record<string, number | null>>>
}
export interface EngineLayout {
  axisGutter?: number
  priceScale?: PriceScaleOptions
  /** Portion of chart height used by price when indicator panes exist. */
  priceRatio?: number
  /** Positive relative heights, keyed by the pane ids in EngineFrame. */
  paneWeights?: Readonly<Record<string, number>>
}

export function validateEngineLayout (layout: EngineLayout): void {
  if (layout.axisGutter !== undefined && (!Number.isFinite(layout.axisGutter) || layout.axisGutter < 0)) throw new RangeError('Axis gutter must be finite and nonnegative')
  if (layout.priceRatio !== undefined && (!Number.isFinite(layout.priceRatio) || layout.priceRatio < 0.3 || layout.priceRatio > 0.85)) throw new RangeError('Price ratio must be from 0.3 to 0.85')
  if (layout.paneWeights !== undefined && (layout.paneWeights === null || typeof layout.paneWeights !== 'object' || Array.isArray(layout.paneWeights) ||
    Object.values(layout.paneWeights).some(value => !Number.isFinite(value) || value <= 0))) throw new RangeError('Pane weights must be positive finite numbers')
}
export interface EnginePane {
  id: string
  top: number
  height: number
  frame: EngineRenderFrame
  scale: PriceScale
}
export interface EngineInspection {
  index: number
  timestamp: number
  mode: RealtimeViewSnapshot['mode']
  displayBar: Readonly<MarketBar>
  indicatorBasis: 'raw'
  /** Actual values used by rendered figures, keyed by indicator instance id. */
  indicators: Readonly<Record<string, Readonly<Record<string, number | null>>>>
}
export interface EngineRenderFrame {
  snapshot: RealtimeViewSnapshot
  model: FinancialChartModel
  inspect: (chartX: number) => EngineInspection | null
  previousClose?: number
  /** Indicator-only panes share time coordinates but never label an OHLC price. */
  indicatorPane?: boolean
  title?: string
  figureStyles?: ReadonlyMap<string, IndicatorFigure>
}
export interface EngineFrame extends EngineRenderFrame {
  /** Borrowed revealed raw bars and data revision for data-derived drawings. */
  drawingContext: DrawingContext
  panes: readonly EnginePane[]
  project: (timestamp: number, price: number) => { x: number, y: number } | null
  unproject: (x: number, y: number) => { timestamp: number, price: number } | null
}

function rescale (model: FinancialChartModel, values: readonly number[], options: PriceScaleOptions, base: number): PriceScale {
  const scale = createPriceScale(values, model.geometry.top, model.geometry.bottom, options, base)
  model.min = scale.min; model.max = scale.max; model.yTicks = scale.ticks
  model.y = scale.y
  for (const candle of model.plottedCandles) {
    const open = scale.y(candle.o), close = scale.y(candle.c), high = scale.y(candle.h), low = scale.y(candle.l)
    candle.bodyTop = Math.min(open, close); candle.bodyBottom = Math.max(open, close)
    candle.wickTop = Math.min(high, low); candle.wickBottom = Math.max(high, low)
  }
  model.plottedCandles = model.plottedCandles.filter(c => Number.isFinite(c.wickTop) && Number.isFinite(c.wickBottom))
  for (const series of model.plottedSeries) {
    series.points = series.points.map(point => ({ ...point, y: scale.y(point.value) })).filter(point => Number.isFinite(point.y))
  }
  return scale
}

/** Visible-only geometry. Indicator computation and market history stay outside the renderer. */
export function buildEngineFrame (
  snapshot: RealtimeViewSnapshot,
  rawBars: readonly MarketBar[],
  indicators: readonly FrameIndicator[],
  width: number,
  height: number,
  layout: EngineLayout = {},
  previousClose?: number,
  dataRevision?: unknown
): EngineFrame {
  validateEngineLayout(layout)
  const paneIds = [...new Set(indicators.filter(item => item.pane !== 'price').map(item => item.pane))]
  const ratio = Math.max(0.3, Math.min(0.85, layout.priceRatio ?? 0.62))
  const ids = ['price', ...paneIds]
  const weights = ids.map(id => layout.paneWeights?.[id] ?? (id === 'price' ? ratio : (1 - ratio) / paneIds.length))
  // Normalize before summing so even very large finite input weights cannot overflow.
  const largestWeight = Math.max(...weights), normalized = weights.map(value => value / largestWeight)
  let totalWeight = normalized.reduce((sum, value) => sum + value, 0), available = height
  const minimum = Math.min(48, height / ids.length), heights: number[] = new Array(ids.length)
  const pending = new Set(ids.map((_, index) => index))
  // Reserve a usable minimum only for panes that need it; larger panes retain
  // their requested relative heights. This also makes drag sizes round-trip.
  while (pending.size > 0) {
    const small = [...pending].filter(index => available * normalized[index] / totalWeight < minimum)
    if (small.length === 0) {
      for (const index of pending) heights[index] = available * normalized[index] / totalWeight
      break
    }
    for (const index of small) { heights[index] = minimum; available -= minimum; totalWeight -= normalized[index]; pending.delete(index) }
  }
  const panes: EnginePane[] = []
  const dataStart = snapshot.dataStart ?? snapshot.viewport.i0
  const inspect = (model: FinancialChartModel, chartX: number): EngineInspection | null => {
    if (!Number.isFinite(chartX)) return null
    const slot = nearestChartIndex(model, chartX), timestamp = slot === null ? undefined : model.xKeys[slot]
    const index = typeof timestamp === 'number' ? nearestBarIndex(snapshot.bars, timestamp) : null
    const bar = index === null ? undefined : snapshot.bars[index]
    if (index === null || bar === undefined || bar.timestamp !== timestamp) return null
    const globalIndex = dataStart + index
    const values: Record<string, Readonly<Record<string, number | null>>> = Object.create(null)
    for (const indicator of indicators) values[indicator.id] = { ...indicator.rows[globalIndex] }
    return { index: globalIndex, timestamp: bar.timestamp, mode: snapshot.mode, displayBar: bar, indicatorBasis: 'raw', indicators: values }
  }
  let paneTop = 0
  for (const [position, id] of ids.entries()) {
    const primary = position === 0
    const paneHeight = heights[position], top = paneTop
    paneTop += paneHeight
    const series: FinancialSeries[] = []
    const figureStyles = new Map<string, IndicatorFigure>()
    for (const indicator of indicators) {
      if (indicator.pane !== id) continue
      for (const figure of indicator.figures) {
        const points: Array<readonly [number, number]> = []
        for (let i = 0; i < snapshot.bars.length; i++) {
          const value = indicator.rows[dataStart + i]?.[figure.key]
          if (value != null && Number.isFinite(value)) points.push([snapshot.bars[i].timestamp, value])
        }
        const seriesId = JSON.stringify([indicator.id, figure.key])
        figureStyles.set(seriesId, figure)
        series.push({ id: seriesId, name: figure.title, type: figure.type === 'circle' ? 'scatter' : figure.type, color: figure.color, points })
      }
    }
    // Candles establish the same category slots across every pane, including indicator warmup gaps.
    const model = buildFinancialChartModel({ xType: 'category', series, candles: snapshot.bars.map(bar => ({ t: bar.timestamp, o: bar.open, h: bar.high, l: bar.low, c: bar.close, v: bar.volume })) }, width, paneHeight, layout.axisGutter)
    // Include the bordering candles for continuous lines, but project the exact
    // fractional window. Drawing anchors and cursor hit testing use these pixels.
    applyRealtimeViewport(model, snapshot, 'category')
    const values: number[] = primary ? snapshot.bars.flatMap(bar => [bar.high, bar.low]) : []
    for (const item of series) { for (const point of item.points) values.push(point[1]); if (item.type === 'bar') values.push(figureStyles.get(item.id)?.base ?? 0) }
    if (!primary) model.plottedCandles = []
    const scale = rescale(model, values, primary ? layout.priceScale ?? {} : {}, rawBars[0]?.close ?? 1)
    panes.push({
      id,
      top,
      height: paneHeight,
      frame: {
        snapshot,
        model,
        figureStyles,
        previousClose: primary ? previousClose : undefined,
        indicatorPane: !primary,
        title: primary ? undefined : indicators.filter(item => item.pane === id).map(item => item.name).join(' · '),
        inspect: x => inspect(model, x)
      },
      scale
    })
  }
  const price = panes[0], model = price.frame.model
  const indexForTime = (timestamp: number): number | null => {
    if (!Number.isFinite(timestamp) || rawBars.length === 0) return null
    let lo = 0, hi = rawBars.length
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (rawBars[mid].timestamp < timestamp) lo = mid + 1; else hi = mid }
    if (rawBars.length === 1) return 0
    if (lo === 0) return (timestamp - rawBars[0].timestamp) / (rawBars[1].timestamp - rawBars[0].timestamp)
    if (lo === rawBars.length) return rawBars.length - 1 + (timestamp - rawBars[lo - 1].timestamp) / (rawBars[lo - 1].timestamp - rawBars[lo - 2].timestamp)
    const a = rawBars[lo - 1].timestamp, b = rawBars[lo].timestamp
    return lo - 1 + (timestamp - a) / (b - a)
  }
  return {
    ...price.frame,
    drawingContext: { bars: rawBars, revision: dataRevision, visibleRange: [snapshot.viewport.i0, snapshot.viewport.i1] },
    panes,
    project: (timestamp, value) => {
      const index = indexForTime(timestamp)
      if (index === null || !Number.isFinite(value)) return null
      const span = snapshot.viewport.i1 - snapshot.viewport.i0, g = model.geometry
      const x = span <= 0 ? g.left + g.plotWidth / 2 : g.left + (index - snapshot.viewport.i0) / span * g.plotWidth
      const y = price.scale.y(value)
      return Number.isFinite(y) ? { x, y } : null
    },
    unproject: (x, y) => {
      if (!Number.isFinite(x) || !Number.isFinite(y) || snapshot.bars.length === 0) return null
      const g = model.geometry, fraction = (x - g.left) / g.plotWidth * Math.max(0, snapshot.viewport.i1 - snapshot.viewport.i0)
      const index = snapshot.viewport.i0 + fraction
      const left = Math.max(0, Math.min(rawBars.length - 2, Math.floor(index)))
      const a = rawBars[left], b = rawBars[Math.min(rawBars.length - 1, left + 1)]
      const timestamp = a.timestamp + (b.timestamp - a.timestamp) * (index - left)
      const value = price.scale.value(y)
      return Number.isFinite(value) ? { timestamp, price: value } : null
    }
  }
}
