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

// What a datafeed returns goes straight onto the canvas, and klinecharts
// validates none of it: a descending list runs the time axis backwards, seconds
// put every bar in January 1970, and one NaN high blanks the whole price pane.
// normalizeBars makes any list safe to draw. Well-formed input (ascending,
// milliseconds, finite numbers) comes back as the same array, not a copy, so
// feeds that are already correct pay one pass and nothing else.

import type { KLineData } from 'klinecharts'

/** 1: timestamps are milliseconds. 1000: they are seconds (multiply by 1000). */
export type TimeUnit = 1 | 1000

/** What normalizeBars had to fix, so the caller can warn once per kind. */
export interface BarIssues {
  /** The input was not an array (it is treated as []). */
  notArray: boolean
  /** Bars dropped for a missing or non-finite timestamp, open, high, low or close. */
  dropped: number
  /** Bars dropped because a later bar had the same timestamp (the last one wins). */
  duplicates: number
  /** The input was not in ascending order. */
  unsorted: boolean
  /** Timestamps were seconds and were converted to milliseconds. */
  seconds: boolean
  /** A value was a numeric string (or other non-number) and was converted. */
  coerced: boolean
}

export interface NormalizedBars {
  bars: KLineData[]
  unit: TimeUnit
  issues: BarIssues
}

/** Below this, a timestamp is taken to be in seconds (1e11 ms is March 1973). */
const SECONDS_BELOW = 1e11

function noIssues (): BarIssues {
  return { notArray: false, dropped: 0, duplicates: 0, unsorted: false, seconds: false, coerced: false }
}

/** True when normalizeBars changed anything. */
export function hasIssues (issues: BarIssues): boolean {
  return issues.notArray || issues.dropped > 0 || issues.duplicates > 0 || issues.unsorted || issues.seconds || issues.coerced
}

/** A number from a number or a numeric string; NaN for anything else (null, '', objects). */
function toNumber (value: unknown): number {
  if (typeof value === 'number') {
    return value
  }
  if (typeof value === 'string' && value.trim() !== '') {
    return Number(value)
  }
  return NaN
}

function isBarObject (value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * The unit a batch's timestamps are in, from its largest finite timestamp.
 * Undefined for a batch with no usable timestamp.
 */
export function decideUnit (list: unknown): TimeUnit | undefined {
  if (!Array.isArray(list)) {
    return undefined
  }
  let max = -Infinity
  for (const bar of list) {
    if (isBarObject(bar)) {
      const ts = toNumber(bar.timestamp)
      if (Number.isFinite(ts) && ts > max) {
        max = ts
      }
    }
  }
  if (max === -Infinity) {
    return undefined
  }
  return max < SECONDS_BELOW ? 1000 : 1
}

function isCleanOptional (value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'number' && Number.isFinite(value))
}

/** One pass: ascending, milliseconds, finite numbers. Such input is returned as is. */
function isClean (list: readonly unknown[], unit: TimeUnit): boolean {
  if (unit !== 1) {
    return false
  }
  let prev = -Infinity
  for (const bar of list) {
    if (!isBarObject(bar)) {
      return false
    }
    const { timestamp, open, high, low, close } = bar
    if (
      typeof timestamp !== 'number' || typeof open !== 'number' || typeof high !== 'number' ||
      typeof low !== 'number' || typeof close !== 'number' ||
      !Number.isFinite(timestamp) || !Number.isFinite(open) || !Number.isFinite(high) ||
      !Number.isFinite(low) || !Number.isFinite(close) ||
      timestamp <= prev ||
      !isCleanOptional(bar.volume) || !isCleanOptional(bar.turnover)
    ) {
      return false
    }
    prev = timestamp
  }
  return true
}

/**
 * One bar made safe to draw, or null when it cannot be (a required field is
 * missing or not a finite number). Extra fields are kept. volume and turnover
 * are optional: undefined and null stay as they are, other non-finite values
 * become undefined; a bar is never dropped for its volume.
 */
export function normalizeBar (bar: unknown, unit: TimeUnit, issues: BarIssues = noIssues()): KLineData | null {
  if (!isBarObject(bar)) {
    issues.dropped++
    return null
  }
  const timestamp = toNumber(bar.timestamp) * unit
  const open = toNumber(bar.open)
  const high = toNumber(bar.high)
  const low = toNumber(bar.low)
  const close = toNumber(bar.close)
  if (!Number.isFinite(timestamp) || !Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) {
    issues.dropped++
    return null
  }
  if (typeof bar.timestamp !== 'number' || typeof bar.open !== 'number' || typeof bar.high !== 'number' || typeof bar.low !== 'number' || typeof bar.close !== 'number') {
    issues.coerced = true
  }
  const out: Record<string, unknown> = { ...bar, timestamp, open, high, low, close }
  for (const key of ['volume', 'turnover']) {
    const value = bar[key]
    if (value === undefined || value === null) {
      continue
    }
    const n = toNumber(value)
    if (typeof value !== 'number') {
      issues.coerced = true
    }
    out[key] = Number.isFinite(n) ? n : undefined
  }
  return out as unknown as KLineData
}

/**
 * Bars safe to hand to klinecharts: strictly ascending millisecond timestamps
 * (a later duplicate replaces an earlier one), finite OHLC (numeric strings
 * are converted), optional volume/turnover.
 *
 * `unit` is the time unit decided earlier for this chart (the first history
 * batch decides it, and later pages and ticks reuse it, so a seconds feed
 * whose ticks are also seconds keeps working). Without it, the unit is decided
 * from this batch.
 *
 * Input that needs no change is returned as the same array.
 */
export function normalizeBars (list: unknown, unit?: TimeUnit): NormalizedBars {
  const issues = noIssues()
  if (!Array.isArray(list)) {
    issues.notArray = true
    return { bars: [], unit: unit ?? 1, issues }
  }
  const u: TimeUnit = unit ?? decideUnit(list) ?? 1
  if (isClean(list, u)) {
    return { bars: list as KLineData[], unit: u, issues }
  }
  issues.seconds = u === 1000
  const bars: KLineData[] = []
  let sorted = true
  for (const raw of list) {
    const bar = normalizeBar(raw, u, issues)
    if (bar === null) {
      continue
    }
    if (bars.length > 0 && bar.timestamp < bars[bars.length - 1].timestamp) {
      sorted = false
    }
    bars.push(bar)
  }
  if (!sorted) {
    issues.unsorted = true
    // Array.prototype.sort is stable, so among equal timestamps the input
    // order survives and "last one wins" below still means the feed's last.
    bars.sort((a, b) => a.timestamp - b.timestamp)
  }
  const unique: KLineData[] = []
  for (const bar of bars) {
    const last = unique[unique.length - 1]
    if (last !== undefined && last.timestamp === bar.timestamp) {
      unique[unique.length - 1] = bar
      issues.duplicates++
    } else {
      unique.push(bar)
    }
  }
  return { bars: unique, unit: u, issues }
}

/**
 * A scroll-back page reduced to what fits before the loaded data: bars
 * strictly older than `firstTs` (the chart's first bar). Feeds that ignore the
 * requested range, or treat `to` as inclusive, would otherwise prepend copies.
 * Expects normalized (ascending, unique) bars.
 */
export function olderThan (bars: readonly KLineData[], firstTs: number | undefined): KLineData[] {
  if (firstTs === undefined) {
    return bars.slice()
  }
  let end = 0
  while (end < bars.length && bars[end].timestamp < firstTs) {
    end++
  }
  return bars.slice(0, end)
}
