import type { Timespan } from '../feed'

/** Web renderer settings. Geometry, data ownership and native drawing stay in their own layers. */
export const ENGINE_CHART_TYPES = [
  'candles', 'hollow-candles', 'outline-candles', 'hollow-down-candles',
  'ohlc', 'volume-bars', 'columns', 'high-low',
  'line', 'line-markers', 'step-line', 'area', 'hlc-area', 'baseline'
] as const
export type EngineChartType = typeof ENGINE_CHART_TYPES[number]

export interface EngineRenderOptions {
  chartType?: EngineChartType
  /** Baseline chart reference price; defaults to the first visible close. */
  baseline?: number
  background?: string
  grid?: string
  text?: string
  up?: string
  down?: string
  line?: string
  font?: string
  pricePrecision?: number
  /** Viewer/display IANA timezone, used for intraday bars. Default UTC. */
  timeZone?: string
  /** Actual feed period; day-and-larger labels represent market sessions. */
  timespan?: Timespan
  /** SymbolInfo.timezone for daily/weekly/monthly/yearly session dates; default UTC. */
  symbolTimezone?: string
  /** Internal pane composition can omit repeated time labels. */
  showTimeAxis?: boolean
  formatPrice?: (price: number, precision: number) => string
}
