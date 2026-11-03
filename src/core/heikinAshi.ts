/**
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at

 * http://www.apache.org/licenses/LICENSE-2.0

 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Heikin Ashi (SC-NEXT #2): the one new chart "type" that genuinely needs a
// data transform rather than a renderer style tweak. Heikin Ashi candles are each
// derived from the ORIGINAL OHLC and the PREVIOUS Heikin Ashi candle, so this
// is a stateful left-to-right scan, not a per-bar map — and it must run over
// the full loaded history from the first bar, not just the visible window, or
// scrolling back would recompute a different (wrong) series every time more
// history loads. `toHeikinAshi` is pure and total: same length in, same
// length out, volume/timestamp untouched so the volume pane and time axis are
// unaffected by switching chart type.
//
// Formula (the standard one TradingView and every other charting product
// uses): haClose = (O+H+L+C)/4; haOpen = (prevHaOpen+prevHaClose)/2 (the
// first bar's haOpen falls back to (O+C)/2, matching TradingView's own
// convention for the series' first candle); haHigh = max(H, haOpen, haClose);
// haLow = min(L, haOpen, haClose).
//
// Part of SUPer-Chart (Apache-2.0).

/** The subset of KLineData a Heikin Ashi transform reads and writes; a plain object works for both klinecharts' KLineData and any host's superset of it. */
export interface OhlcBar {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  volume?: number
  turnover?: number
}

/**
 * Maps `bars` (ascending by timestamp, as klinecharts requires) to their
 * Heikin Ashi series. Non-finite OHLC values pass through unchanged for that
 * bar and reset the previous-HA state, so the next valid bar restarts the
 * recurrence rather than carrying invalid data forward (normalizeBars drops those
 * before they would ever reach here — this is the defensive fallback for a
 * host that calls toHeikinAshi directly on unvalidated data).
 */
export function toHeikinAshi<T extends OhlcBar> (bars: readonly T[]): T[] {
  let prevOpen: number | null = null
  let prevClose: number | null = null
  return bars.map(bar => {
    const { open, high, low, close } = bar
    if (!Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) {
      // Reset rather than carry NaN forward: the next good bar restarts the
      // series (its own first-bar formula) instead of computing from NaN.
      prevOpen = null
      prevClose = null
      return bar
    }
    const haClose = (open + high + low + close) / 4
    const haOpen = prevOpen === null || prevClose === null ? (open + close) / 2 : (prevOpen + prevClose) / 2
    const haHigh = Math.max(high, haOpen, haClose)
    const haLow = Math.min(low, haOpen, haClose)
    prevOpen = haOpen
    prevClose = haClose
    return { ...bar, open: haOpen, high: haHigh, low: haLow, close: haClose }
  })
}

/** True for candle_solid/candle_stroke/etc. bars whose close >= open (used to colour a Heikin Ashi bar the same way an ordinary candle is). */
export function isHeikinAshiUp (bar: Pick<OhlcBar, 'open' | 'close'>): boolean {
  return bar.close >= bar.open
}
