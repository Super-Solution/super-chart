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

// Order blocks (SC-NEXT #6, Smart Money Concepts): from OHLCV alone, no
// trade/order-book data. An order block is the last opposite-direction
// candle before a displacement move strong enough to break the recent swing
// high/low — the common, purely price-action definition used across SMC
// literature and every OHLCV-only SMC indicator (there is no official
// standard body defining this precisely; this is the same shape TradingView
// community SMC scripts converge on). Pure and unit-tested; SC_ORDER_BLOCKS
// (src/indicators/SC_ORDER_BLOCKS.ts) turns the result into figures.
//
// Part of SUPer-Chart (Apache-2.0).

export interface Bar { high: number, low: number, open: number, close: number }

export type OrderBlockDirection = 'bullish' | 'bearish'

export interface OrderBlock {
  /** Index of the order-block candle itself (the last opposite candle before the move). */
  index: number
  high: number
  low: number
  direction: OrderBlockDirection
  /** Index of the candle whose close broke structure (confirming this block). */
  breakIndex: number
  /** True once a later close has re-entered [low, high] (SMC "mitigation"). */
  mitigated: boolean
}

export interface OrderBlockOptions {
  /** How many bars ahead of the candidate candle count as "the move" that must break structure. @default 3 */
  lookahead?: number
  /** The move's total range must be at least this multiple of the candidate candle's own range to count as a displacement, not noise. @default 1.5 */
  displacementFactor?: number
  /** How many bars back to look for the swing high/low the move must break. @default 10 */
  swingLookback?: number
}

const DEFAULTS: Required<OrderBlockOptions> = { lookahead: 3, displacementFactor: 1.5, swingLookback: 10 }

function range (bar: Bar): number {
  return Math.max(0, bar.high - bar.low)
}

/**
 * Detects order blocks over the whole `bars` array (callers pass whatever
 * window — e.g. the visible range plus lookback — they want scanned).
 * Bullish: a down candle (close < open) immediately before an up-move whose
 * close breaks above the prior `swingLookback` bars' high, moving at least
 * `displacementFactor`x the candidate's own range within `lookahead` bars.
 * Bearish is the mirror image. A candidate already superseded by a fresher
 * one of the same direction before its own break is skipped (SMC keeps the
 * most recent unmitigated block, not every historical one).
 */
export function detectOrderBlocks (bars: readonly Bar[], options: OrderBlockOptions = {}): OrderBlock[] {
  const { lookahead, displacementFactor, swingLookback } = { ...DEFAULTS, ...options }
  const blocks: OrderBlock[] = []
  for (let i = swingLookback; i < bars.length - 1; i++) {
    const candidate = bars[i]
    const swingHigh = Math.max(...bars.slice(Math.max(0, i - swingLookback), i).map(b => b.high))
    const swingLow = Math.min(...bars.slice(Math.max(0, i - swingLookback), i).map(b => b.low))
    const candidateRange = Math.max(range(candidate), 1e-9)

    // Bullish: candidate is a down candle, followed by an up displacement breaking swingHigh.
    if (candidate.close < candidate.open) {
      for (let j = i + 1; j <= Math.min(bars.length - 1, i + lookahead); j++) {
        const move = bars[j]
        const moveRange = Math.abs(move.close - candidate.close)
        if (move.close > swingHigh && moveRange >= candidateRange * displacementFactor) {
          blocks.push({ index: i, high: candidate.high, low: candidate.low, direction: 'bullish', breakIndex: j, mitigated: false })
          break
        }
      }
    }
    // Bearish: candidate is an up candle, followed by a down displacement breaking swingLow.
    if (candidate.close > candidate.open) {
      for (let j = i + 1; j <= Math.min(bars.length - 1, i + lookahead); j++) {
        const move = bars[j]
        const moveRange = Math.abs(candidate.close - move.close)
        if (move.close < swingLow && moveRange >= candidateRange * displacementFactor) {
          blocks.push({ index: i, high: candidate.high, low: candidate.low, direction: 'bearish', breakIndex: j, mitigated: false })
          break
        }
      }
    }
  }
  // Mitigation: any later close back inside [low, high].
  for (const block of blocks) {
    for (let k = block.breakIndex + 1; k < bars.length; k++) {
      if (bars[k].close <= block.high && bars[k].close >= block.low) {
        block.mitigated = true
        break
      }
    }
  }
  return blocks
}
