// SPDX-License-Identifier: GPL-3.0-or-later
// Fair Value Gaps (SC-NEXT #6, Smart Money Concepts): the standard 3-candle
// imbalance definition (ICT and every OHLCV-only FVG indicator agree on this
// one) — for three consecutive candles A, B, C: a bullish FVG is the gap
// between A.high and C.low when C.low > A.high (B's range never overlapped
// it); a bearish FVG is the gap between A.low and C.high when C.high < A.low.
// Pure and unit-tested; SC_FVG (src/indicators/SC_FVG.ts) turns the result
// into figures.
//

export interface Bar { high: number, low: number }

export type FvgDirection = 'bullish' | 'bearish'

export interface FairValueGap {
  /** Index of candle A (the gap spans A/B/C, indices i, i+1, i+2). */
  index: number
  top: number
  bottom: number
  direction: FvgDirection
  /** True once any later bar's range has traded back through the full gap (SC-NEXT: "extending until filled"). */
  filled: boolean
  /** Index of the bar that filled it, or null while still open. */
  filledAtIndex: number | null
}

/**
 * Detects every 3-candle FVG in `bars`. A gap is "filled" the first time a
 * later bar's [low, high] covers the ENTIRE gap (partial fills are common in
 * practice but the common convention — and the simplest, most defensible
 * OHLCV-only rule — treats the gap as open until fully covered).
 */
export function detectFairValueGaps (bars: readonly Bar[]): FairValueGap[] {
  const gaps: FairValueGap[] = []
  for (let i = 0; i + 2 < bars.length; i++) {
    const a = bars[i]
    const c = bars[i + 2]
    if (c.low > a.high) {
      gaps.push({ index: i, top: c.low, bottom: a.high, direction: 'bullish', filled: false, filledAtIndex: null })
    } else if (c.high < a.low) {
      gaps.push({ index: i, top: a.low, bottom: c.high, direction: 'bearish', filled: false, filledAtIndex: null })
    }
  }
  for (const gap of gaps) {
    for (let k = gap.index + 3; k < bars.length; k++) {
      if (bars[k].low <= gap.bottom && bars[k].high >= gap.top) {
        gap.filled = true
        gap.filledAtIndex = k
        break
      }
    }
  }
  return gaps
}
