import type { MarketBar } from '../types'
import { indicatorField as priceSeries, ownedKernel, ownedWindow } from './indicatorInputs'
import {
  atr, atrBands, keltner, donchian, anchoredVwap, sma, rsi, macd, stochK,
  stochRsi, mfi, bbPercent, supertrend, ichimoku, wma, hma, vwma, dema, tema, kama, type Series
} from '../ta'
import { previousRangeHighLow } from '../analysis/previousRangeHighLow'
import type { EngineIndicators, IndicatorDefinition, IndicatorFigure, IndicatorRow } from './indicators'

/** Optional owned-TA pack; importing this module does not register or activate anything. */
export const TECHNICAL_INDICATOR_NAMES = Object.freeze([
  'SC_RSI', 'SC_MACD', 'SC_SMA',
  'SC_ATR', 'SC_ATR_BANDS', 'SC_KELTNER', 'SC_DONCHIAN', 'SC_VWAP',
  'SC_STOCH', 'SC_STOCHRSI', 'SC_MFI', 'SC_BBP', 'SC_SUPERTREND', 'SC_ICHIMOKU', 'SC_PDHL',
  'SC_WMA', 'SC_HMA', 'SC_DEMA', 'SC_TEMA', 'SC_VWMA', 'SC_KAMA',
  'SC_CVD', 'SC_CVD_EST'
] as const)

export type TechnicalIndicatorName = typeof TECHNICAL_INDICATOR_NAMES[number]

function rows (keys: readonly string[], values: readonly Series[]): IndicatorRow[] {
  const result: IndicatorRow[] = new Array(values[0]?.length ?? 0)
  for (let i = 0; i < result.length; i++) {
    const row: Record<string, number | null> = Object.create(null)
    for (let j = 0; j < keys.length; j++) {
      const value = values[j][i]
      row[keys[j]] = value !== null && Number.isFinite(value) ? value : null
    }
    result[i] = row
  }
  return result
}

function prices (bars: readonly MarketBar[]): { high: Series, low: Series, close: Series } {
  return { high: priceSeries(bars, 'high'), low: priceSeries(bars, 'low'), close: priceSeries(bars, 'close') }
}

function lines (...entries: Array<readonly [string, string]>): readonly IndicatorFigure[] {
  return Object.freeze(entries.map(([key, title]) => Object.freeze({ key, title, type: 'line' as const })))
}

type ParameterKind = 'period' | 'positive' | 'anchor' | 'offset' | 'range' | 'reset'

/** Missing values use the existing SC defaults; invalid explicit values fail instead of silently changing the requested calculation. */
function parameters (name: string, supplied: readonly number[], defaults: readonly number[], kinds: readonly ParameterKind[]): readonly number[] {
  if (supplied.length > defaults.length) throw new RangeError(`${name} accepts at most ${defaults.length} parameters`)
  return defaults.map((fallback, index) => {
    const value = supplied[index] ?? fallback
    if (!Number.isFinite(value)) throw new RangeError(`${name} parameters must be finite`)
    switch (kinds[index]) {
      case 'period':
        if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} periods must be positive safe integers`)
        break
      case 'positive':
        if (value <= 0) throw new RangeError(`${name} multiplier must be positive`)
        break
      case 'anchor':
        if (!Number.isInteger(value) || value < 0 || value > 4) throw new RangeError('SC_VWAP anchor must be 0, 1, 2, 3 or 4')
        break
      case 'offset': break // A fixed offset in minutes, matching the existing SC_VWAP calculation.
      case 'range':
        if (value !== 0 && value !== 1) throw new RangeError('SC_PDHL period must be 0 (day) or 1 (week)')
        break
      case 'reset':
        if (value !== 0 && value !== 1) throw new RangeError(`${name} reset must be 0 (never) or 1 (every UTC day)`)
        break
    }
    return value
  })
}

function define (
  name: TechnicalIndicatorName,
  defaults: readonly number[],
  kinds: readonly ParameterKind[],
  pane: IndicatorDefinition['pane'],
  figures: readonly IndicatorFigure[],
  calculate: IndicatorDefinition['calculate']
): IndicatorDefinition {
  const normalized = (supplied: readonly number[]): readonly number[] => parameters(name, supplied, defaults, kinds)
  const compute = (bars: readonly MarketBar[], supplied: readonly number[]): readonly IndicatorRow[] => calculate(bars, normalized(supplied))
  if (name === 'SC_SMA' || name === 'SC_RSI' || name === 'SC_MACD') { ownedKernel(compute, {
    name: name === 'SC_SMA' ? 'MA' : name === 'SC_RSI' ? 'RSI' : 'MACD',
    parameters: normalized,
    ...(name === 'SC_SMA' ? { maKey: 'sma' } : {})
  }) }
  if (name === 'SC_DONCHIAN') { ownedWindow(compute, {
    inputStart: (supplied, from) => Math.max(0, from - normalized(supplied)[0] + 1), outputStart: (_p, from) => from
  }) }
  if (name === 'SC_ICHIMOKU') { ownedWindow(compute, {
    inputStart: (supplied, from, length) => {
      const p = normalized(supplied), shift = Math.min(p[3] - 1, length)
      return Math.max(0, from - 2 * shift - Math.max(p[0], p[1], p[2]) + 1)
    },
    outputStart: (supplied, from, length) => Math.max(0, from - Math.min(normalized(supplied)[3] - 1, length))
  }) }
  return Object.freeze({
    name,
    params: Object.freeze([...defaults]),
    pane,
    figures,
    calculate: compute
  })
}

/**
 * Running total of per-bar volume delta. A bar whose delta is unknown (null) is left out of the total and drawn as a gap, so
 * missing data is visible instead of silently counted as zero. With `daily`, the total restarts at each UTC midnight.
 */
function cumulate (bars: readonly MarketBar[], delta: Series, daily: boolean): Series {
  const out: Series = new Array(bars.length)
  let total = 0, day = NaN
  for (let i = 0; i < bars.length; i++) {
    if (daily) {
      const today = Math.floor(bars[i].timestamp / DAY_MS)
      if (today !== day) { day = today; total = 0 }
    }
    const value = delta[i]
    if (value === null) { out[i] = null; continue }
    total += value
    out[i] = total
  }
  return out
}

const bands = lines(['basis', 'Basis'], ['upper', 'Upper'], ['lower', 'Lower'])
const oscillator = lines(['k', '%K'], ['d', '%D'])
const DAY_MS = 86400000

/**
 * Exact fixed-offset bucket convention of existing SC_VWAP. The weekly epoch
 * offset is retained; this does not introduce exchange sessions or DST rules.
 */
function vwapPeriod (timestamp: number, anchor: number, offset: number): number | null {
  const shifted = timestamp + offset * 60000
  if (!Number.isFinite(shifted)) return null
  if (anchor === 0) return Math.floor(shifted / DAY_MS)
  if (anchor === 1) return Math.floor((Math.floor(shifted / DAY_MS) - 3) / 7)
  const date = new Date(shifted)
  const year = date.getUTCFullYear(), month = date.getUTCMonth()
  if (!Number.isFinite(year)) return null
  if (anchor === 2) return year * 100 + month
  if (anchor === 3) return year * 10 + Math.floor(month / 3)
  return year
}

/**
 * Existing SC formulas, independent of their old template/drawing layer.
 * These definitions deliberately use the same owned core functions and seeds.
 * All calculations return full-series rows with explicit null gaps. The generic
 * registry reuses results for viewport-only changes, but these optional kernels
 * share owned OHLC input arrays within one compute call. Stateful SC_SMA,
 * SC_RSI and SC_MACD reuse the matching incremental owned kernels. Donchian
 * and Ichimoku tail edits recompute their finite dependency windows, including
 * Ichimoku's lagging rows before the edited bar. Corrections/prepends rebuild.
 *
 * VWAP preserves the fixed-offset session buckets and skips the first loaded
 * bucket because it may be partial. Missing volume follows the existing core's
 * zero-contribution semantics; no synthetic volume is inserted into the bars.
 * BBP remains unbounded outside [0, 1]. Supertrend starts down when ATR becomes
 * available; separate up/down lines preserve gaps at every direction change.
 *
 * Ichimoku values are shifted by displacement - 1 exactly as in SC_ICHIMOKU.
 * Like that implementation, this row-based pack cannot draw futureA/futureB
 * beyond the last real bar, or a filled cloud. It exposes the five existing-bar
 * lines only; no future candles or projection coordinates are invented.
 *
 * SC_RSI/SC_MACD/SC_SMA preserve their owned formulas and defaults. SC_SMA
 * uses the compensated core sum; the former template's naive tail-only sum
 * can differ in final floating-point bits. These optional names now share the
 * incremental MA/RSI/MACD kernels by calculation identity, with their original
 * defaults and row keys. History corrections/prepends still rebuild.
 * Oscillator reference levels and MACD's four-color histogram require renderer
 * metadata, and are not represented by these line/bar figures.
 *
 * SC_PDHL retains the existing full-dataset, latest-loaded-period UTC lookup,
 * including the most recent available earlier day/week when history has gaps.
 * Its constant rows are current reference levels, NOT rolling historical
 * values suitable for backtesting. The line renderer includes them in price
 * autoscaling; the old draw-only template did not. Dashed axis-spanning labels
 * also require renderer metadata. A dataset within one period has null levels.
 *
 * SC_VRVP, SC_ORDER_BLOCKS and SC_FVG are intentionally not registered here:
 * they need visible-range volume-profile or rectangle rendering, rather than
 * scalar rows. Their existing pure geometry/detection helpers remain available.
 * Registering an empty or unrelated line would falsely advertise support.
 *
 * Default/missing parameters retain the SC defaults. Explicit invalid periods,
 * multipliers and anchor selections are rejected at calculation time rather
 * than using the old UI template's silent fallbacks.
 */
export const TECHNICAL_INDICATOR_DEFINITIONS: readonly IndicatorDefinition[] = Object.freeze([
  define('SC_RSI', [14], ['period'], 'separate', lines(['rsi', 'RSI']), (bars, p) => {
    return rows(['rsi'], [rsi(priceSeries(bars, 'close'), p[0])])
  }),
  define('SC_MACD', [12, 26, 9], ['period', 'period', 'period'], 'separate', Object.freeze([
    Object.freeze({ key: 'hist', title: 'Histogram', type: 'bar' as const }),
    Object.freeze({ key: 'dif', title: 'MACD', type: 'line' as const }),
    Object.freeze({ key: 'dea', title: 'Signal', type: 'line' as const })
  ]), (bars, p) => {
    const result = macd(priceSeries(bars, 'close'), p[0], p[1], p[2])
    return rows(['hist', 'dif', 'dea'], [result.hist, result.dif, result.dea])
  }),
  define('SC_SMA', [9], ['period'], 'price', lines(['sma', 'SMA']), (bars, p) => {
    return rows(['sma'], [sma(priceSeries(bars, 'close'), p[0])])
  }),
  define('SC_ATR', [14], ['period'], 'separate', lines(['atr', 'ATR']), (bars, p) => {
    const { high, low, close } = prices(bars)
    return rows(['atr'], [atr(high, low, close, p[0])])
  }),
  define('SC_ATR_BANDS', [14, 2], ['period', 'positive'], 'price', bands, (bars, p) => {
    const { high, low, close } = prices(bars)
    const result = atrBands(high, low, close, p[0], p[1])
    return rows(['basis', 'upper', 'lower'], [result.basis, result.upper, result.lower])
  }),
  define('SC_KELTNER', [20, 2, 10], ['period', 'positive', 'period'], 'price', bands, (bars, p) => {
    const { high, low, close } = prices(bars)
    const result = keltner(high, low, close, p[0], p[1], p[2])
    return rows(['basis', 'upper', 'lower'], [result.basis, result.upper, result.lower])
  }),
  define('SC_DONCHIAN', [20], ['period'], 'price', bands, (bars, p) => {
    const result = donchian(priceSeries(bars, 'high'), priceSeries(bars, 'low'), p[0])
    return rows(['basis', 'upper', 'lower'], [result.basis, result.upper, result.lower])
  }),
  define('SC_VWAP', [0, 0, 2], ['anchor', 'offset', 'positive'], 'price', lines(['vwap', 'VWAP'], ['upper', 'Upper'], ['lower', 'Lower']), (bars, p) => {
    const { high, low, close } = prices(bars)
    const volume = priceSeries(bars, 'volume')
    const periods = bars.map(bar => vwapPeriod(bar.timestamp, p[0], p[1]))
    const result = anchoredVwap(high, low, close, volume, periods, true)
    const upper: Series = new Array(bars.length), lower: Series = new Array(bars.length)
    for (let i = 0; i < bars.length; i++) {
      const value = result.vwap[i], deviation = result.stdev[i]
      upper[i] = value === null || deviation === null ? null : value + p[2] * deviation
      lower[i] = value === null || deviation === null ? null : value - p[2] * deviation
    }
    return rows(['vwap', 'upper', 'lower'], [result.vwap, upper, lower])
  }),
  define('SC_STOCH', [14, 1, 3], ['period', 'period', 'period'], 'separate', oscillator, (bars, p) => {
    const { high, low, close } = prices(bars)
    const k = sma(stochK(high, low, close, p[0]), p[1])
    return rows(['k', 'd'], [k, sma(k, p[2])])
  }),
  define('SC_STOCHRSI', [14, 14, 3, 3], ['period', 'period', 'period', 'period'], 'separate', oscillator, (bars, p) => {
    const result = stochRsi(priceSeries(bars, 'close'), p[0], p[1], p[2], p[3])
    return rows(['k', 'd'], [result.k, result.d])
  }),
  define('SC_MFI', [14], ['period'], 'separate', lines(['mfi', 'MFI']), (bars, p) => {
    const { high, low, close } = prices(bars)
    return rows(['mfi'], [mfi(high, low, close, priceSeries(bars, 'volume'), p[0])])
  }),
  define('SC_BBP', [20, 2], ['period', 'positive'], 'separate', lines(['b', '%B']), (bars, p) => {
    return rows(['b'], [bbPercent(priceSeries(bars, 'close'), p[0], p[1])])
  }),
  define('SC_SUPERTREND', [10, 3], ['period', 'positive'], 'price', Object.freeze([
    Object.freeze({ key: 'up', title: 'Supertrend Up', type: 'line' as const, color: '#26A69A' }),
    Object.freeze({ key: 'down', title: 'Supertrend Down', type: 'line' as const, color: '#EF5350' })
  ]), (bars, p) => {
    const { high, low, close } = prices(bars)
    const result = supertrend(high, low, close, p[0], p[1])
    const up: Series = new Array(bars.length), down: Series = new Array(bars.length)
    for (let i = 0; i < bars.length; i++) {
      up[i] = result.trend[i] === 1 ? result.line[i] : null
      down[i] = result.trend[i] === -1 ? result.line[i] : null
    }
    return rows(['up', 'down'], [up, down])
  }),
  define('SC_ICHIMOKU', [9, 26, 52, 26], ['period', 'period', 'period', 'period'], 'price', lines(
    ['conversion', 'Conversion'], ['base', 'Base'], ['spanA', 'Span A'], ['spanB', 'Span B'], ['lagging', 'Lagging']
  ), (bars, p) => {
    const { high, low, close } = prices(bars)
    // A shift >= input length makes every shifted in-dataset value null. Limit
    // only the discarded future buffers; retained values remain identical even
    // for a displacement much larger than the loaded history.
    const displacement = Math.min(p[3], bars.length + 1)
    const result = ichimoku(high, low, close, p[0], p[1], p[2], displacement)
    return rows(['conversion', 'base', 'spanA', 'spanB', 'lagging'], [result.conversion, result.base, result.spanA, result.spanB, result.lagging])
  }),
  define('SC_WMA', [9], ['period'], 'price', lines(['wma', 'WMA']), (bars, p) => {
    return rows(['wma'], [wma(priceSeries(bars, 'close'), p[0])])
  }),
  define('SC_HMA', [9], ['period'], 'price', lines(['hma', 'HMA']), (bars, p) => {
    return rows(['hma'], [hma(priceSeries(bars, 'close'), p[0])])
  }),
  define('SC_DEMA', [20], ['period'], 'price', lines(['dema', 'DEMA']), (bars, p) => {
    return rows(['dema'], [dema(priceSeries(bars, 'close'), p[0])])
  }),
  define('SC_TEMA', [20], ['period'], 'price', lines(['tema', 'TEMA']), (bars, p) => {
    return rows(['tema'], [tema(priceSeries(bars, 'close'), p[0])])
  }),
  define('SC_VWMA', [20], ['period'], 'price', lines(['vwma', 'VWMA']), (bars, p) => {
    return rows(['vwma'], [vwma(priceSeries(bars, 'close'), priceSeries(bars, 'volume'), p[0])])
  }),
  define('SC_KAMA', [10, 2, 30], ['period', 'period', 'period'], 'price', lines(['kama', 'KAMA']), (bars, p) => {
    if (p[1] >= p[2]) throw new RangeError('SC_KAMA fast period must be shorter than the slow period')
    return rows(['kama'], [kama(priceSeries(bars, 'close'), p[0], p[1], p[2])])
  }),
  define('SC_CVD', [0], ['reset'], 'separate', lines(['cvd', 'CVD']), (bars, p) => {
    // Exact: the feed reports how much of each bar's volume was bought by market orders (`buyVolume`).
    const delta: Series = new Array(bars.length)
    for (let i = 0; i < bars.length; i++) {
      const volume = bars[i].volume, buy = bars[i].buyVolume
      const known = typeof volume === 'number' && typeof buy === 'number' && Number.isFinite(volume) && Number.isFinite(buy) && volume >= 0 && buy >= 0 && buy <= volume
      delta[i] = known ? 2 * (buy as number) - (volume as number) : null
    }
    return rows(['cvd'], [cumulate(bars, delta, p[0] === 1)])
  }),
  define('SC_CVD_EST', [0], ['reset'], 'separate', lines(['cvd', 'CVD (estimate)']), (bars, p) => {
    // Estimate for feeds without trade direction: each bar's volume is split by where the close sits in the bar's range.
    // It is a bar-level approximation, not the real buy/sell split; use SC_CVD when the feed reports `buyVolume`.
    const delta: Series = new Array(bars.length)
    for (let i = 0; i < bars.length; i++) {
      const { high, low, close, volume } = bars[i]
      const known = typeof volume === 'number' && Number.isFinite(volume) && volume >= 0 && Number.isFinite(high) && Number.isFinite(low) && Number.isFinite(close)
      delta[i] = !known ? null : high > low ? (volume as number) * (2 * close - high - low) / (high - low) : 0
    }
    return rows(['cvd'], [cumulate(bars, delta, p[0] === 1)])
  }),
  define('SC_PDHL', [0], ['range'], 'price', lines(['high', 'Previous High'], ['low', 'Previous Low']), (bars, p) => {
    const range = previousRangeHighLow(bars, p[0] === 1 ? 'week' : 'day', 'UTC')
    const high = range !== null && Number.isFinite(range.high) ? range.high : null
    const low = range !== null && Number.isFinite(range.low) ? range.low : null
    const row = Object.freeze({ high, low })
    return new Array<IndicatorRow>(bars.length).fill(row)
  })
])

/** Register once per registry, then explicitly add the desired SC_* instances. */
export function registerTechnicalIndicators (registry: EngineIndicators): void {
  for (const definition of TECHNICAL_INDICATOR_DEFINITIONS) registry.register(definition)
}
