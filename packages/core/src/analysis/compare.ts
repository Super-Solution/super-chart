// SPDX-License-Identifier: GPL-3.0-or-later
// Compare overlay: another market's closes laid over the chart's own, rebased so both start at the same price. Pure, no state.

export interface CompareBar { readonly timestamp: number, readonly close: number }

/**
 * One value per bar of `main`: the other market's close at that time (the latest bar at or before it, so a slower period or
 * a gap carries forward), multiplied so it equals the main close at the first bar both have. A bar before the other market's
 * first bar, or one whose close is not a positive number, is null; if nothing overlaps every row is null.
 */
export function rebaseCompare (main: readonly CompareBar[], other: readonly CompareBar[]): Array<number | null> {
  const out: Array<number | null> = new Array(main.length).fill(null)
  if (other.length === 0) return out
  // Both lists are in time order; walk them together.
  let j = -1, base: number | null = null
  for (let i = 0; i < main.length; i++) {
    while (j + 1 < other.length && other[j + 1].timestamp <= main[i].timestamp) j++
    if (j < 0) continue
    const close = other[j].close
    if (!(close > 0) || !Number.isFinite(close)) continue
    if (base === null) {
      if (!(main[i].close > 0) || !Number.isFinite(main[i].close)) continue
      base = main[i].close / close
    }
    out[i] = close * base
  }
  return out
}
