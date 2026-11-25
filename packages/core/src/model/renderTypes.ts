import type { Timespan } from '../feed'

/**
 * The canvas colour sets. The two `-colorblind` sets keep the light or dark surface and replace the
 * green/red candles with the Okabe-Ito blue/orange pair, which stays distinguishable in the common
 * forms of colour-vision deficiency (and the indicator lines move off blue/orange too).
 */
export type EngineRenderTheme = 'light' | 'dark' | 'light-colorblind' | 'dark-colorblind'
export const ENGINE_RENDER_THEMES: readonly EngineRenderTheme[] = Object.freeze(['light', 'dark', 'light-colorblind', 'dark-colorblind'] as const)

/** Web renderer settings. Geometry, data ownership and native drawing stay in their own layers. */
export const ENGINE_CHART_TYPES = [
  'candles', 'hollow-candles', 'outline-candles', 'hollow-down-candles',
  'ohlc', 'volume-bars', 'columns', 'high-low',
  'line', 'line-markers', 'step-line', 'area', 'hlc-area', 'baseline'
] as const
export type EngineChartType = typeof ENGINE_CHART_TYPES[number]

export interface EngineRenderOptions {
  chartType?: EngineChartType
  /** Explicit dense-candle paint aggregation; raw prices and inspection stay unchanged. */
  candleDensity?: 'raw' | 'pixel-envelope'
  /** Baseline chart reference price; defaults to the first visible close. */
  baseline?: number
  /** Selects the Super Chart light or dark palette; the single colours below override it. Default dark. */
  theme?: EngineRenderTheme
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
  /**
   * Makes the crosshair follow the pointer on both axes instead of snapping to the bar under it. `cursorY` is the
   * pointer's height in this pane's own pixels and `cursorPrice` the value there; `null` (or a height outside the plot)
   * means the pointer is in another pane, so only the vertical line is drawn. Left unset, the crosshair keeps the older
   * behaviour and sits on the bar's close.
   */
  cursorY?: number | null
  cursorPrice?: number | null
}
