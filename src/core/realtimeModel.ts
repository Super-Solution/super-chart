import { buildFinancialChartModel, nearestChartIndex } from './financialModel'
import type { FinancialChartModel, FinancialSeries } from './financialModel'
import type { RealtimeViewSnapshot } from './realtimeView'
import type { CandleMode } from './realtimeSeries'
import type { MarketBar } from './types'
import { nearestBarIndex } from './series'

export type RealtimeIndicator = 'MA20' | 'EMA21'
export interface RealtimeChartOptions {
  /** Time spacing preserves market gaps; category spacing gives equal candle widths. */
  spacing?: 'time' | 'category'
  indicators?: readonly RealtimeIndicator[]
  colors?: Partial<Record<RealtimeIndicator, string>>
  axisGutter?: number
}
export interface RealtimeInspection {
  /** Index in the complete loaded series, not in the viewport. */
  index: number
  timestamp: number
  mode: CandleMode
  /** Synthetic OHLC in HA mode; never interpret it as an executable quote. */
  displayBar: Readonly<MarketBar>
  indicatorBasis: 'raw'
  ma20: number | null
  ema21: number | null
}
export interface RealtimeChartFrame {
  readonly snapshot: RealtimeViewSnapshot
  /** Geometry indexes are local to this viewport. Use inspect for a global index. */
  readonly model: FinancialChartModel
  inspect: (chartX: number) => RealtimeInspection | null
}

/** Apply an opt-in fractional view to an existing visible-only model. */
export function applyRealtimeViewport (model: FinancialChartModel, snapshot: RealtimeViewSnapshot, spacing: 'time' | 'category'): void {
  if (snapshot.dataStart === undefined || snapshot.viewport.i1 <= snapshot.viewport.i0 || snapshot.bars.length < 2) return
  const dataStart = snapshot.dataStart, g = model.geometry
  const timeAt = (index: number): number => {
    const local = index - dataStart, first = Math.max(0, Math.min(snapshot.bars.length - 2, Math.floor(local)))
    const a = snapshot.bars[first].timestamp, b = snapshot.bars[first + 1].timestamp
    return a + (b - a) * (local - first)
  }
  const firstTime = timeAt(snapshot.viewport.i0), lastTime = timeAt(snapshot.viewport.i1)
  model.x = (key, index) => g.left + (spacing === 'category'
    ? (dataStart + index - snapshot.viewport.i0) / (snapshot.viewport.i1 - snapshot.viewport.i0)
    : (Number(key) - firstTime) / (lastTime - firstTime)) * g.plotWidth
  model.xPositions = model.xKeys.map((key, index) => model.x(key, index))
  for (const candle of model.plottedCandles) candle.x = model.x(candle.t, candle.index)
  for (const item of model.plottedSeries) for (const point of item.points) point.x = model.x(point.key, point.index)
  const start = Math.max(0, Math.ceil(snapshot.viewport.i0) - dataStart)
  const end = Math.min(model.xKeys.length - 1, Math.floor(snapshot.viewport.i1) - dataStart)
  model.xTickIndices = end < start ? [] : [...new Set([start, Math.floor((start + end) / 2), end])]
}

/**
 * Build only the visible candles/indicator points. Hosts render this shared geometry
 * with their own Canvas/SVG/native view. Inspection uses chart-local x, including
 * the left axis gutter (the same coordinates as model.xPositions).
 * Create once per snapshot or layout/options change, not on every pointer movement.
 */
export function createRealtimeChartFrame (
  snapshot: RealtimeViewSnapshot,
  width: number,
  height: number,
  options: RealtimeChartOptions = {}
): RealtimeChartFrame {
  const indicators = options.indicators ?? ['MA20', 'EMA21']
  const series: FinancialSeries[] = []
  for (const name of ['MA20', 'EMA21'] as const) {
    if (!indicators.includes(name)) continue
    const values = name === 'MA20' ? snapshot.ma20 : snapshot.ema21
    const points: Array<readonly [number, number]> = []
    for (let i = 0; i < snapshot.bars.length; i++) {
      const value = values[i]
      if (value != null && Number.isFinite(value)) points.push([snapshot.bars[i].timestamp, value])
    }
    series.push({ id: name, name, type: 'line', color: options.colors?.[name], points })
  }
  const model = buildFinancialChartModel({
    xType: options.spacing ?? 'time',
    candles: snapshot.bars.map(bar => ({ t: bar.timestamp, o: bar.open, h: bar.high, l: bar.low, c: bar.close, v: bar.volume })),
    series
  }, width, height, options.axisGutter)
  applyRealtimeViewport(model, snapshot, options.spacing ?? 'time')
  return {
    snapshot,
    model,
    inspect: chartX => {
      if (!Number.isFinite(chartX)) return null
      const index = nearestChartIndex(model, chartX)
      if (index === null) return null
      const timestamp = model.xKeys[index]
      if (typeof timestamp !== 'number') return null
      const row = nearestBarIndex(snapshot.bars, timestamp)
      if (row === null || snapshot.bars[row].timestamp !== timestamp) return null
      const finite = (value: number | null): number | null => value !== null && Number.isFinite(value) ? value : null
      return {
        index: (snapshot.dataStart ?? snapshot.viewport.i0) + row,
        timestamp,
        mode: snapshot.mode,
        displayBar: snapshot.bars[row],
        indicatorBasis: 'raw',
        ma20: finite(snapshot.ma20[row]),
        ema21: finite(snapshot.ema21[row])
      }
    }
  }
}
