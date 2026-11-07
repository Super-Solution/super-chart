/** Platform-neutral chart data. Extracted for Web and React Native, 2026-10-29. */
export interface MarketBar {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  volume?: number
  turnover?: number
  /** Preserve the Web feed extension-field contract; OHLCV fields stay numeric. */
  [key: string]: any
}
