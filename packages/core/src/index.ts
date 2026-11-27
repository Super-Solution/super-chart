/** Renderer-free chart core: no DOM or platform renderer runtime. */
import {
  isLength, sum, sma, wma, hma, vwma, ema, rma, rsi, macd, stdev, dev,
  bollinger, highest, lowest, linreg, correlation, change, mom, roc,
  crossover, crossunder, cross, cum, barssince, valuewhen, pivot, trueRange,
  atr, obv, vwap, cci, mfi, stochK, sar, stoch, stochRsi, bbPercent,
  keltner, donchian, atrBands, supertrend, ichimoku, anchoredVwap,
  aroon, adl, cmf, forceIndex, vortex, tsi, ultimate, zigzag, pivotPoints, chandelier, periodBucket
} from './ta'
export type { MarketBar } from './types'
/** Explicit named functions keep generated declarations independent of module namespaces. */
export const ta = Object.freeze({
  isLength,
  sum,
  sma,
  wma,
  hma,
  vwma,
  ema,
  rma,
  rsi,
  macd,
  stdev,
  dev,
  bollinger,
  highest,
  lowest,
  linreg,
  correlation,
  change,
  mom,
  roc,
  crossover,
  crossunder,
  cross,
  cum,
  barssince,
  valuewhen,
  pivot,
  trueRange,
  atr,
  obv,
  vwap,
  cci,
  mfi,
  stochK,
  sar,
  stoch,
  stochRsi,
  bbPercent,
  keltner,
  donchian,
  atrBands,
  supertrend,
  ichimoku,
  anchoredVwap,
  aroon,
  adl,
  cmf,
  forceIndex,
  vortex,
  tsi,
  ultimate,
  zigzag,
  pivotPoints,
  chandelier,
  periodBucket
})
export type { Series } from './ta'
export * from './series'
export * from './normalizeBars'
export * from './precision'
export * from './coalesce'
export * from './financialModel'
export * from './viewport'
export { indicatorSeries as nativeIndicatorSeries } from './nativeIndicators'
export type { NativeCandle } from './nativeIndicators'
export type { ChartDataPort, HistoryLoadRequest } from './chartPort'
export * from './feed'
export * from './marks'
export * from './dataLoader'
export * from './historyCache'
export * from './requestRange'
export * from './marketKeys'
export * from './replay'
export * from './loaderEnvironment'
export * from './heikinAshi'
export * from './derivedSeries'
export * from './derivedPort'
export * from './realtimeSeries'
export * from './realtimeView'
export * from './realtimeModel'
export * from './model'
export * from './formatBarDate'
export * from './timeAxis'
export * from './timeZones'
export { detectFairValueGaps } from './analysis/fairValueGaps'
export { detectOrderBlocks } from './analysis/orderBlocks'
export { previousRangeHighLow } from './analysis/previousRangeHighLow'
export { volumeProfile } from './analysis/volumeProfile'
export { supportResistance } from './analysis/supportResistance'
export type { SupportResistance, SupportResistanceLevel, SupportResistanceOptions, LevelBar } from './analysis/supportResistance'
export * from './continuousViewport'
