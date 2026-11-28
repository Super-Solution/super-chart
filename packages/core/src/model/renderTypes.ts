import type { Timespan } from '../feed'
import type { TradingSession } from './tradingSession'

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
  'line', 'line-markers', 'step-line', 'area', 'hlc-area', 'baseline',
  /** Columns of X and O for the point and figure price mode; needs `pointFigureBox`, otherwise it paints candles. */
  'point-figure'
] as const
export type EngineChartType = typeof ENGINE_CHART_TYPES[number]

export interface EngineRenderOptions {
  chartType?: EngineChartType
  /** Explicit dense-candle paint aggregation; raw prices and inspection stay unchanged. */
  candleDensity?: 'raw' | 'pixel-envelope'
  /** Point and figure only: the price height of one box, so a column's boxes can be counted. Set by the price mode. */
  pointFigureBox?: number
  /** Baseline chart reference price; defaults to the first visible close. */
  baseline?: number
  /** Selects the Super Chart light or dark palette; the single colours below override it. Default dark. */
  theme?: EngineRenderTheme
  background?: string
  grid?: string
  /** Which grid lines the price pane draws: price levels only (default), time ticks only, both, or none. */
  gridLines?: 'horizontal' | 'vertical' | 'both' | 'none'
  text?: string
  up?: string
  down?: string
  line?: string
  font?: string
  pricePrecision?: number
  /** Viewer/display IANA timezone, used for intraday bars. Default UTC. */
  timeZone?: string
  /** BCP 47 tag for the month and day names on the time axis (`zh-TW`, `de`). Default `en`. The workspace passes its own locale. */
  locale?: string
  /** Actual feed period; day-and-larger labels represent market sessions. */
  timespan?: Timespan
  /** SymbolInfo.timezone for daily/weekly/monthly/yearly session dates; default UTC. */
  symbolTimezone?: string
  /**
   * A checked trading schedule (`compileSession`): bars in pre-market and after-hours get a wash behind them and each
   * new local date a faint line, on intraday periods only. The workspace sets it from `SymbolInfo.session`.
   */
  session?: TradingSession | null
  /** The always-on legend at the top left of the price pane: title, open/high/low/close, change, indicator values. Default true. */
  legend?: boolean
  /** The legend's first words, usually "name · interval · exchange". The workspace sets it from the symbol; empty shows none. */
  legendTitle?: string
  /** Fold the legend's indicator rows into one line ("3 indicators"), keeping the quote row. Default false. */
  legendCollapsed?: boolean
  /** The folded line's words; `{count}` stands for the number of indicators. Default "{count} indicators". */
  legendCollapsedLabel?: string
  /** A large faint name behind the candles, with an optional smaller line under it; `null` or absent draws none. */
  watermark?: { readonly title: string, readonly subtitle?: string } | null
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
