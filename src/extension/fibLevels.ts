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

// Fibonacci levels for the three fib line tools (fibonacciLine, segment,
// extension) were hardcoded percents baked into each template, so nobody —
// not a user, not a host, not the drawing editor's toolbar, not an MCP tool —
// could ever draw a 161.8%/261.8% extension target (SC-179). This is the one
// place that reads a level set from an overlay, so every tool (and any future
// "Levels" control) reads and writes the same shape.
//
// Part of SUPer-Chart (Apache-2.0).

export interface FibLevels {
  levels: number[]
}

const MAX_LEVELS = 24

/** True for a finite number (negative levels — below 0% — are allowed). */
const isLevel = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * The level set an overlay draws with: `extendData.levels` when it is a
 * non-empty array of finite numbers (deduped, capped, sorted ascending),
 * otherwise `defaults`. Any other shape of extendData — undefined, the plain
 * string the text tools use, a stray value from bad host input — falls back
 * to `defaults` too, so nothing here can crash a template.
 */
export function readLevels (overlay: { extendData?: unknown }, defaults: readonly number[]): FibLevels {
  const raw = (overlay.extendData as { levels?: unknown } | null | undefined)?.levels
  if (!Array.isArray(raw)) {
    return { levels: [...defaults] }
  }
  const seen = new Set<number>()
  const levels: number[] = []
  for (const v of raw) {
    if (isLevel(v) && !seen.has(v)) {
      seen.add(v)
      levels.push(v)
      if (levels.length >= MAX_LEVELS) {
        break
      }
    }
  }
  if (levels.length === 0) {
    return { levels: [...defaults] }
  }
  levels.sort((a, b) => a - b)
  return { levels }
}

/** klinecharts' own fibonacciLine defaults (retracement), unchanged by this fix. */
export const RETRACEMENT_LEVELS: readonly number[] = [1, 0.786, 0.618, 0.5, 0.382, 0.236, 0]

/**
 * TradingView's trend-based extension defaults — the ones a user actually
 * reaches for (161.8%, 261.8%, ...), which the old fixed set never included.
 */
export const EXTENSION_LEVELS: readonly number[] = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618, 3.618, 4.236]
