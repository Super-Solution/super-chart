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

/**
 * Tail-update detection for indicator `calc` functions (SC-174): a live tick
 * either appends one bar or replaces the last one, and klinecharts hands
 * `calc` the SAME dataList array reference both times (it mutates/pushes onto
 * its own array, per `updateData` in klinecharts 9.1.1 and 9.8.12). When that
 * holds, and calcParams did not change, a template only needs to produce the
 * new/changed row(s), not recompute the whole history.
 *
 * This module only detects the mode; each SC_ template keeps its own small
 * cache (rows plus whatever recurrence state it needs — e.g. RSI's running
 * average gain/loss) and decides how to use 'append'/'replace'. A template
 * that has no cheap tail step can ignore this and always recompute; 'full' is
 * always correct.
 *
 * Recursive indicators (EMA/RMA-based: RSI, MACD) cannot reconstruct their
 * running state from the output rows alone, so their tail step carries that
 * state explicitly. Purely windowed indicators (SMA) recompute just the last
 * row from a direct window sum, which costs O(len), not O(n).
 *
 * Maintained by ZzyzxLabs. Part of SUPer-Chart (Apache-2.0).
 */

export type TailUpdateMode = 'full' | 'append' | 'replace'

export interface TailCache<S> {
  /** The dataList array klinecharts passed in last time (identity, not a copy). */
  ref: unknown
  length: number
  paramsKey: string
  state: S
}

/** A stable key for calcParams (or anything else that must match for a tail step to be valid). */
export function paramsKey (calcParams: unknown): string {
  return JSON.stringify(calcParams)
}

/**
 * 'full' unless `cache` is for the same array reference and the same params:
 * then 'append' when the list grew by exactly one bar, 'replace' when it kept
 * the same length (the last bar's OHLCV changed in place), and 'full' for
 * anything else (a reload, a scroll-back prepend, a parameter change).
 */
export function tailMode<S> (cache: TailCache<S> | null, dataList: { length: number }, key: string): TailUpdateMode {
  if (cache === null || cache.ref !== dataList || cache.paramsKey !== key) return 'full'
  if (dataList.length === cache.length + 1) return 'append'
  if (dataList.length === cache.length) return 'replace'
  return 'full'
}
