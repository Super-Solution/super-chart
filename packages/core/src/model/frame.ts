import { buildFinancialChartModel, financialGeometry, nearestChartIndex, type FinancialChartModel, type FinancialSeries } from '../financialModel'
import type { RealtimeViewSnapshot } from '../realtimeView'
import type { MarketBar } from '../types'
import { nearestBarIndex } from '../series'
import { createPriceScale, type PriceScale, type PriceScaleOptions } from './priceScale'
import type { IndicatorFigure } from './indicators'
import { applyRealtimeViewport } from '../realtimeModel'
import type { DrawingContext } from './drawings'
import { derivePrecision } from '../precision'

export interface FrameIndicator {
  id: string
  name: string
  pane: string
  /** Drawn in the bottom band of the price pane on a scale of its own (see `EngineLayout.overlayRatio`). */
  overlay?: boolean
  /** The legend's name for it, such as "MA 20"; the indicator's name when unset. */
  label?: string
  figures: readonly IndicatorFigure[]
  rows: ReadonlyArray<Readonly<Record<string, number | null>>>
}
export interface EngineLayout {
  /** The edge the price labels sit on. Default `right`, where trading charts put them; `left` keeps the older layout. */
  axisSide?: 'left' | 'right'
  axisGutter?: number
  priceScale?: PriceScaleOptions
  /** Portion of chart height used by price when indicator panes exist. */
  priceRatio?: number
  /** Height of the band overlay indicators (volume by default) use along the bottom of the price pane, from 0.05 to 0.5 of the plot. Default 0.2. */
  overlayRatio?: number
  /** Positive relative heights, keyed by the pane ids in EngineFrame. */
  paneWeights?: Readonly<Record<string, number>>
}

export function validateEngineLayout (layout: EngineLayout): void {
  if (layout.axisSide !== undefined && layout.axisSide !== 'left' && layout.axisSide !== 'right') throw new RangeError('Axis side must be left or right')
  if (layout.axisGutter !== undefined && (!Number.isFinite(layout.axisGutter) || layout.axisGutter < 0)) throw new RangeError('Axis gutter must be finite and nonnegative')
  if (layout.priceRatio !== undefined && (!Number.isFinite(layout.priceRatio) || layout.priceRatio < 0.3 || layout.priceRatio > 0.85)) throw new RangeError('Price ratio must be from 0.3 to 0.85')
  if (layout.overlayRatio !== undefined && (!Number.isFinite(layout.overlayRatio) || layout.overlayRatio < 0.05 || layout.overlayRatio > 0.5)) throw new RangeError('Overlay ratio must be from 0.05 to 0.5')
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
  /** Lightweight renderer lookup; does not materialize all indicator rows. */
  inspectBar?: (chartX: number) => Omit<EngineInspection, 'indicators' | 'indicatorBasis'> | null
  previousClose?: number
  /** Indicator-only panes share time coordinates but never label an OHLC price. */
  indicatorPane?: boolean
  title?: string
  figureStyles?: ReadonlyMap<string, IndicatorFigure>
  /** Price-pane indicators, for the legend: each one's label and the ids of the series it draws. */
  legend?: ReadonlyArray<{ readonly id: string, readonly label: string, readonly seriesIds: readonly string[], readonly overlay: boolean }>
  /** Derived once from this immutable snapshot, shared by panes and cursor paints. */
  pricePrecision?: number
}
export interface EngineFrame extends EngineRenderFrame {
  /** Borrowed revealed raw bars and data revision for data-derived drawings. */
  drawingContext: DrawingContext
  panes: readonly EnginePane[]
  project: (timestamp: number, price: number) => { x: number, y: number } | null
  unproject: (x: number, y: number) => { timestamp: number, price: number } | null
}

/** Where an overlay series draws: a band along the bottom of the pane on a scale of its own, bars growing up from `base`. */
interface OverlayMap { y: (value: number) => number, zeroY: number }
function overlayMap (source: FinancialSeries, base: number, bottom: number, plotHeight: number, ratio: number): OverlayMap {
  const bar = source.type === 'bar'
  let lo = bar ? Math.min(0, base) : Infinity, hi = bar ? Math.max(0, base) : -Infinity
  for (const point of source.points) { if (point[1] < lo) lo = point[1]; if (point[1] > hi) hi = point[1] }
  const band = Math.max(16, plotHeight * ratio), span = hi - lo
  const y = (value: number): number => !(span > 0) ? bottom : bottom - (value - lo) / span * band
  return { y, zeroY: y(bar ? base : lo) }
}

function rescale (model: FinancialChartModel, values: readonly number[], options: PriceScaleOptions, base: number, overlays: ReadonlyMap<string, OverlayMap> = new Map()): PriceScale {
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
    const overlay = overlays.get(series.source.id)
    if (overlay !== undefined) series.zeroY = overlay.zeroY
    series.points = series.points.map(point => ({ ...point, y: (overlay?.y ?? scale.y)(point.value) })).filter(point => Number.isFinite(point.y))
  }
  return scale
}

/** Owned snapshots have one ordered category slot per normalized candle. Avoid
 * generic series key discovery and intermediate projections for this common path. */
function alignedModel (
  snapshot: RealtimeViewSnapshot, series: FinancialSeries[], indexByTime: ReadonlyMap<number, number>,
  width: number, height: number, gutter: number | undefined, scaleOptions: PriceScaleOptions,
  values: readonly number[], base: number, primary: boolean, axisSide: 'left' | 'right', overlays: ReadonlyMap<string, OverlayMap>
): { model: FinancialChartModel, scale: PriceScale } {
  const geometry = financialGeometry(width, height, gutter, 12, axisSide), count = snapshot.bars.length
  const scale = createPriceScale(values, geometry.top, geometry.bottom, scaleOptions, base)
  const span = snapshot.viewport.i1 - snapshot.viewport.i0
  const fractional = snapshot.dataStart !== undefined && span > 0 && count > 0
  const x = (_key: string | number, index: number): number => geometry.left + (fractional
    ? ((snapshot.dataStart as number) + index - snapshot.viewport.i0) / span * geometry.plotWidth
    : count < 2 ? geometry.plotWidth / 2 : index / (count - 1) * geometry.plotWidth)
  const xKeys = snapshot.bars.map(bar => bar.timestamp), xPositions = xKeys.map(x)
  let xTickIndices = count < 3 ? xKeys.map((_, i) => i) : [0, Math.floor((count - 1) / 2), count - 1]
  if (fractional) {
    const start = Math.max(0, Math.ceil(snapshot.viewport.i0) - (snapshot.dataStart as number))
    const end = Math.min(count - 1, Math.floor(snapshot.viewport.i1) - (snapshot.dataStart as number))
    xTickIndices = end < start ? [] : [...new Set([start, Math.floor((start + end) / 2), end])]
  }
  const model: FinancialChartModel = {
    geometry,
    min: scale.min,
    max: scale.max,
    yTicks: scale.ticks,
    rightMin: 0,
    rightMax: 1,
    rightTicks: [],
    hasRightAxis: false,
    xKeys,
    allKeys: [...xKeys],
    start: 0,
    end: Math.max(1, count),
    xPositions,
    xTickIndices,
    plottedCandles: [],
    plottedSeries: [],
    x,
    y: scale.y
  }
  if (primary) {
    for (let index = 0; index < count; index++) {
      const bar = snapshot.bars[index]
      const open = scale.y(bar.open), close = scale.y(bar.close), high = scale.y(bar.high), low = scale.y(bar.low)
      if (!Number.isFinite(high) || !Number.isFinite(low)) continue
      model.plottedCandles.push({
        t: bar.timestamp,
        o: bar.open,
        h: bar.high,
        l: bar.low,
        c: bar.close,
        v: bar.volume,
        x: xPositions[index],
        index,
        bodyTop: Math.min(open, close),
        bodyBottom: Math.max(open, close),
        wickTop: Math.min(high, low),
        wickBottom: Math.max(high, low)
      })
    }
  }
  for (const source of series) {
    const points: FinancialChartModel['plottedSeries'][number]['points'] = []
    const overlay = overlays.get(source.id), project = overlay?.y ?? scale.y
    for (const [key, value] of source.points) {
      const index = indexByTime.get(key as number), y = project(value)
      if (index === undefined || !Number.isFinite(xPositions[index]) || !Number.isFinite(y)) continue
      points.push({ x: xPositions[index], y, value, key, index })
    }
    model.plottedSeries.push(overlay === undefined ? { source, points } : { source, points, zeroY: overlay.zeroY })
  }
  return { model, scale }
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
  const axisSide = layout.axisSide ?? 'right'
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
  // A malformed external snapshot keeps the generic model's filtering semantics.
  const aligned = snapshot.bars.every((bar, index, bars) => Number.isFinite(bar.timestamp) &&
    (index === 0 || bar.timestamp > bars[index - 1].timestamp) &&
    Number.isFinite(bar.open) && Number.isFinite(bar.high) && Number.isFinite(bar.low) && Number.isFinite(bar.close) &&
    bar.high >= Math.max(bar.open, bar.close) && bar.low <= Math.min(bar.open, bar.close))
  const indexByTime = new Map<number, number>()
  if (aligned) for (let i = 0; i < snapshot.bars.length; i++) indexByTime.set(snapshot.bars[i].timestamp, i)
  const candles = aligned ? [] : snapshot.bars.map(bar => ({ t: bar.timestamp, o: bar.open, h: bar.high, l: bar.low, c: bar.close, v: bar.volume }))
  const pricePrecision = derivePrecision(snapshot.bars)
  const dataStart = snapshot.dataStart ?? snapshot.viewport.i0
  const inspectBar = (model: FinancialChartModel, chartX: number): Omit<EngineInspection, 'indicators' | 'indicatorBasis'> | null => {
    if (!Number.isFinite(chartX)) return null
    const span = snapshot.viewport.i1 - snapshot.viewport.i0
    // Padding is empty time, not a repeated copy of the final real candle.
    if (snapshot.dataStart !== undefined && span > 0 && model.xPositions.length > 0) {
      const halfSlot = model.geometry.plotWidth / span / 2
      if (chartX > model.xPositions[model.xPositions.length - 1] + halfSlot || chartX < model.xPositions[0] - halfSlot) return null
    }
    const slot = nearestChartIndex(model, chartX), timestamp = slot === null ? undefined : model.xKeys[slot]
    const index = aligned ? slot : typeof timestamp === 'number' ? nearestBarIndex(snapshot.bars, timestamp) : null
    const bar = index === null ? undefined : snapshot.bars[index]
    if (index === null || bar === undefined || bar.timestamp !== timestamp) return null
    return { index: dataStart + index, timestamp: bar.timestamp, mode: snapshot.mode, displayBar: bar }
  }
  const inspect = (model: FinancialChartModel, chartX: number): EngineInspection | null => {
    const hit = inspectBar(model, chartX)
    if (hit === null) return null
    const values: Record<string, Readonly<Record<string, number | null>>> = Object.create(null)
    for (const indicator of indicators) values[indicator.id] = { ...indicator.rows[hit.index] }
    return { ...hit, indicatorBasis: 'raw', indicators: values }
  }
  let paneTop = 0
  for (const [position, id] of ids.entries()) {
    const primary = position === 0
    const paneHeight = heights[position], top = paneTop
    paneTop += paneHeight
    const series: FinancialSeries[] = []
    const figureStyles = new Map<string, IndicatorFigure>()
    const legend: Array<{ id: string, label: string, seriesIds: string[], overlay: boolean }> = []
    for (const indicator of indicators) {
      if (indicator.pane !== id) continue
      const entry = { id: indicator.id, label: indicator.label ?? indicator.name, seriesIds: [] as string[], overlay: indicator.overlay === true }
      if (primary) legend.push(entry)
      for (const figure of indicator.figures) {
        const points: Array<readonly [number, number]> = []
        for (let i = 0; i < snapshot.bars.length; i++) {
          const value = indicator.rows[dataStart + i]?.[figure.key]
          if (value != null && Number.isFinite(value)) points.push([snapshot.bars[i].timestamp, value])
        }
        const seriesId = JSON.stringify([indicator.id, figure.key])
        figureStyles.set(seriesId, figure)
        entry.seriesIds.push(seriesId)
        series.push({ id: seriesId, name: figure.title, type: figure.type === 'circle' ? 'scatter' : figure.type, color: figure.color, points, ...(indicator.overlay === true ? { overlay: true } : {}) })
      }
    }
    const values: number[] = []
    if (primary) for (const bar of snapshot.bars) values.push(bar.high, bar.low)
    const overlays = new Map<string, OverlayMap>()
    const overlayRatio = layout.overlayRatio ?? 0.2
    for (const item of series) {
      if (item.overlay === true) {
        const g = financialGeometry(width, paneHeight, layout.axisGutter, 12, axisSide)
        overlays.set(item.id, overlayMap(item, figureStyles.get(item.id)?.base ?? 0, g.bottom, g.plotHeight, overlayRatio))
        continue
      }
      for (const point of item.points) values.push(point[1]); if (item.type === 'bar') values.push(figureStyles.get(item.id)?.base ?? 0)
    }
    const scaleOptions = primary ? layout.priceScale ?? {} : {}, base = rawBars[0]?.close ?? 1
    let model: FinancialChartModel, scale: PriceScale
    if (aligned) {
      ({ model, scale } = alignedModel(snapshot, series, indexByTime, width, paneHeight, layout.axisGutter, scaleOptions, values, base, primary, axisSide, overlays))
    } else {
      // Preserve generic handling of malformed/duplicate external categories.
      model = buildFinancialChartModel({ xType: 'category', series, candles }, width, paneHeight, layout.axisGutter, undefined, 52, axisSide)
      applyRealtimeViewport(model, snapshot, 'category')
      if (!primary) model.plottedCandles = []
      scale = rescale(model, values, scaleOptions, base, overlays)
    }
    panes.push({
      id,
      top,
      height: paneHeight,
      frame: {
        snapshot,
        model,
        figureStyles,
        ...(primary && legend.length > 0 ? { legend } : {}),
        pricePrecision,
        previousClose: primary ? previousClose : undefined,
        indicatorPane: !primary,
        title: primary ? undefined : indicators.filter(item => item.pane === id).map(item => item.label ?? item.name).join(' · '),
        inspectBar: x => inspectBar(model, x),
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
