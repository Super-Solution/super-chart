/** Existing feed contracts extracted without browser/renderer types, 2026-10-29. */
import type { MarketBar } from './types'

// Keep the existing open string union for custom feed periods.
// eslint-disable-next-line @typescript-eslint/ban-types
export type Timespan = 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year' | (string & {})

export interface SymbolInfo {
  ticker: string
  name?: string
  shortName?: string
  exchange?: string
  market?: string
  /**
   * Decimals of prices on the axis, legend and marks. A number is used as
   * given. 'auto', or leaving it out, derives it from the loaded prices
   * (about four significant digits: 64000 gets 2, 0.64 gets 4, 0.00002 gets
   * 8), once per symbol. `getPricePrecision()` returns the value in use.
   */
  pricePrecision?: number | 'auto'
  volumePrecision?: number
  priceCurrency?: string
  type?: string
  logo?: string
  /**
   * The IANA zone in which this symbol's bars of a day or longer open: their
   * dates are read in it (a daily bar at 00:00 UTC is that UTC date wherever
   * the viewer is, as on TradingView). Default 'UTC', which matches feeds
   * whose daily bars open at 00:00 UTC (Binance, most crypto) and US equities
   * at 13:30 UTC. A feed whose daily bars open at midnight elsewhere (OKX's
   * UTC+8 bars) sets it, e.g. 'Asia/Shanghai'. Intraday bars follow the
   * chart's timezone.
   */
  timezone?: string
}

export interface Period {
  multiplier: number
  timespan: Timespan
  text: string
}

/**
 * What subscribe() hands the datafeed. Call it with the latest bar, or with an
 * array of bars (oldest first), for example the previous bar's final values
 * and the new bar when one closes. Bars are snapshots: each replaces the bar
 * with the same timestamp, and nothing is merged. A bar older than the chart's
 * newest bar is ignored (klinecharts cannot change an older bar in place).
 */
export type DatafeedSubscribeCallback = (data: MarketBar | MarketBar[]) => void

/**
 * The fifth argument of getHistoryKLineData: what the chart is asking for, so
 * a datafeed does not have to guess it from `from`/`to`.
 */
export interface HistoryRequest {
  /**
   * Aborted when the answer is no longer wanted (the symbol or period changed,
   * or the chart was disposed). Pass it to fetch(). The chart ignores what a
   * superseded request resolves or rejects with, AbortError included, so a
   * datafeed that reports its own errors should check `signal.aborted` first.
   */
  signal: AbortSignal
  /**
   * True for the first request of a series: the initial load, every symbol
   * or period change and reload(). False for scroll-back pages and for the
   * catch-up request after a gap (sleep, reconnect).
   */
  firstDataRequest: boolean
  /** How many bars the chart wants (a size hint; more or fewer is fine). */
  countBack: number
  /**
   * Scroll-back only: the timestamp of the chart's oldest bar. Answer with
   * bars strictly older than it (the same instant as `to`). Undefined for
   * the first request and the catch-up request, which want the newest bars.
   */
  before?: number
}

/** What getHistoryKLineData may resolve with instead of a plain array. */
export interface HistoryResult {
  bars: MarketBar[]
  /**
   * True: there is no history before these bars, so the chart stops asking
   * further back (saves the one empty request a short series costs). With a
   * plain array, an empty page means the same.
   */
  noData?: boolean
}

/** The second argument of searchSymbols. */
export interface SearchRequest {
  /** Aborted when the user searches again or closes the search. */
  signal: AbortSignal
}

export interface Datafeed {
  /** A rejection (or throw) shows "Search failed" with Retry in the search dialog. */
  searchSymbols (search?: string, request?: SearchRequest): Promise<SymbolInfo[]>
  /**
   * Resolve a custom interval (one not in the chart's configured `periods`)
   * that a user typed or picked, e.g. from the type-to-change interval box.
   * Implementing this — or the chart's `customPeriods` option — opts into
   * custom intervals; without either, an interval outside the configured
   * list is refused before it ever reaches this datafeed (SC-112). Return
   * null to refuse it anyway (e.g. a resolution the backend cannot serve).
   */
  resolvePeriod? (period: Pick<Period, 'multiplier' | 'timespan'>): Period | null
  /**
   * Bars with `from <= timestamp < to` (ms), oldest first. The first request
   * has `to` = now; scroll-back requests have `to` = the chart's first bar.
   * Reject (or throw) on a transport error: the chart shows an error state
   * with Retry, and scroll-back retries with a backoff. `[]` means "no
   * (older) history": after `[]`, the chart stops asking further back for
   * this symbol and period. Duplicates, overlap, unsorted bars, second
   * timestamps and numeric strings are tolerated.
   *
   * `request` (optional to read) says which kind of request this is and
   * carries an AbortSignal; see HistoryRequest. Resolve with
   * `{ bars, noData: true }` to say there is nothing older.
   */
  getHistoryKLineData (symbol: SymbolInfo, period: Period, from: number, to: number, request?: HistoryRequest): Promise<MarketBar[] | HistoryResult>
  /** Start live updates for this pair. The chart calls it once per load, after the history. */
  subscribe: (symbol: SymbolInfo, period: Period, callback: DatafeedSubscribeCallback) => void
  /**
   * Stop the updates started by the last subscribe(). Calls are strictly
   * paired with subscribe(), and the chart calls it on dispose too.
   */
  unsubscribe: (symbol: SymbolInfo, period: Period) => void
}
