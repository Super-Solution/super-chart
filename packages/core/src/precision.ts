// SPDX-License-Identifier: GPL-3.0-or-later
// A fixed 2-decimal price precision reads BONK-sized prices as a flat "0.00"
// and gives the y-axis a padded, mostly-negative range (klinecharts pads the
// axis by ±4·10^-precision when the data's own range is narrower than that).
// derivePrecision picks a precision from the size of the prices themselves,
// not from how many decimals the feed happens to send (a float feed would
// otherwise give BTC nine decimals): about four significant digits on the
// smallest positive price, raised further if the visible range would still
// be narrower than one tick at that precision.

/** Anything with the four OHLC fields (KLineData satisfies this). */
export interface OhlcLike {
  open: number
  high: number
  low: number
  close: number
}

function clamp (value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value))
}

/**
 * A precision from `bars`' own OHLC range: `ceil(-log10(minPositive)) + 3`
 * (BONK's ~0.00002 gives 8, 0.64 gives 4, 64000 gives 2), clamped to [2, 10],
 * then raised while the full high/low range is still narrower than one tick
 * at that precision. 2 for no bars, or none with a finite positive OHLC value
 * (an empty or all-zero series).
 */
export function derivePrecision (bars: readonly OhlcLike[]): number {
  let minPositive = Infinity
  let min = Infinity
  let max = -Infinity
  for (const bar of bars) {
    for (const value of [bar.open, bar.high, bar.low, bar.close]) {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        continue
      }
      if (value > 0 && value < minPositive) {
        minPositive = value
      }
      if (value < min) {
        min = value
      }
      if (value > max) {
        max = value
      }
    }
  }
  if (!Number.isFinite(minPositive)) {
    return 2
  }
  let precision = clamp(Math.ceil(-Math.log10(minPositive)) + 3, 2, 10)
  const range = max - min
  if (Number.isFinite(range) && range > 0) {
    while (precision < 10 && range < 10 ** -precision) {
      precision++
    }
  }
  return precision
}

/**
 * What to pass klinecharts' setPriceVolumePrecision: `symbolPrecision` as
 * given when it is a number (an explicit value always wins over the data);
 * `derivePrecision(bars)` when it is 'auto' or omitted.
 */
export function resolvePricePrecision (symbolPrecision: number | 'auto' | undefined, bars: readonly OhlcLike[]): number {
  return typeof symbolPrecision === 'number' ? symbolPrecision : derivePrecision(bars)
}
