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

// Clone offset for the drawing editor: the copy is moved a few bars to the right
// and a few pixels lower, so it does not sit exactly on top of the original.
// Pure — no DOM, no klinecharts runtime. Part of SUPer-Chart (Apache-2.0).
//
// Two klinecharts 9.x facts shape the time shift:
//  1. A point with a timestamp is drawn at timestampToDataIndex(timestamp), a
//     nearest-bar search over the loaded data. For a timestamp past the last bar
//     that search answers "the second-to-last bar", so a copy whose timestamp was
//     pushed past the latest candle would be drawn to the LEFT of the original.
//     klinecharts itself stores a future point as a dataIndex with no timestamp
//     (dataIndexToTimestamp has nothing to return there); the copy does the same.
//  2. A point's stored dataIndex goes stale when older bars are prepended
//     (loadMore): klinecharts keeps drawing it from its timestamp. So the bar a
//     point sits on is read from its timestamp when it has one.

export interface DataPoint {
  dataIndex?: number
  timestamp?: number
  value?: number
}

export interface CloneShift {
  /** Bars to move right. */
  bars: number
  /** Timestamps of the chart's bars, oldest first (chart.getDataList()); empty when unknown. */
  timeline: readonly number[]
  /**
   * Per point: the value CLONE_OFFSET_PX lower on the point's own pane, measured
   * at that point (the pane converts it, so a log axis is handled). Missing or
   * non-finite entries fall back to `value`.
   */
  values?: ReadonlyArray<number | null | undefined>
  /** Fallback price delta for points whose value could not be converted. */
  value: number
}

export const CLONE_OFFSET_BARS = 3
export const CLONE_OFFSET_PX = 16
/** Fallback price step: this fraction of the first point's value. */
export const CLONE_FALLBACK_RATIO = 0.01

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * Median spacing of the last few timestamps (robust to a single gap such as a
 * weekend), or null with fewer than two bars.
 */
export function barInterval (timestamps: readonly number[]): number | null {
  const recent = timestamps.filter(isNum).slice(-11)
  const diffs: number[] = []
  for (let i = 1; i < recent.length; i++) {
    const d = recent[i] - recent[i - 1]
    if (d > 0) {
      diffs.push(d)
    }
  }
  if (diffs.length === 0) {
    return null
  }
  diffs.sort((a, b) => a - b)
  return diffs[Math.floor((diffs.length - 1) / 2)]
}

/**
 * The bar index a timestamp sits on in an ascending `timeline`: the bar with
 * that timestamp, else the last bar before it. Outside the loaded bars the index
 * is extrapolated with `interval` (negative before the first bar, past the last
 * one after it); null when that is not possible.
 */
export function barIndexAt (timeline: readonly number[], timestamp: number, interval: number | null): number | null {
  const last = timeline.length - 1
  if (last < 0 || !isNum(timestamp)) {
    return null
  }
  if (timestamp > timeline[last]) {
    return interval !== null && interval > 0 ? last + Math.round((timestamp - timeline[last]) / interval) : null
  }
  if (timestamp < timeline[0]) {
    return interval !== null && interval > 0 ? Math.round((timestamp - timeline[0]) / interval) : null
  }
  let lo = 0
  let hi = last
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (timeline[mid] <= timestamp) {
      lo = mid
    } else {
      hi = mid - 1
    }
  }
  return lo
}

/** Fallback price delta: a small step down, proportional to the first point's value. */
export function fallbackValueShift (base: unknown): number {
  return isNum(base) && base !== 0 ? -Math.abs(base) * CLONE_FALLBACK_RATIO : 0
}

const sameSign = (a: number, b: number): boolean => a === 0 || (a > 0 && b > 0) || (a < 0 && b < 0)

function shiftTime (p: Readonly<DataPoint>, bars: number, timeline: readonly number[], interval: number | null): DataPoint {
  let base: number | null = null
  if (isNum(p.timestamp)) {
    base = barIndexAt(timeline, p.timestamp, interval)
  }
  if (base === null && isNum(p.dataIndex)) {
    base = p.dataIndex
  }
  if (base === null) {
    // Nowhere to measure from: keep the point where it is in time.
    const out: DataPoint = {}
    if (isNum(p.timestamp)) {
      out.timestamp = p.timestamp
    }
    return out
  }
  const target = base + bars
  if (Number.isInteger(target) && target >= 0 && target < timeline.length) {
    return { dataIndex: target, timestamp: timeline[target] }
  }
  // Past the last bar (or with no data): a bare dataIndex, as klinecharts stores it.
  return { dataIndex: target }
}

/**
 * Shift every point `shift.bars` bars to the right and CLONE_OFFSET_PX lower.
 * A converted value (shift.values) is used as is: on a log axis it stays
 * positive by construction, and on a linear axis crossing zero is legitimate.
 * The fallback delta is only a guess, so it never flips a value's sign.
 */
export function shiftPoints (points: ReadonlyArray<Readonly<DataPoint>>, shift: CloneShift): DataPoint[] {
  const interval = barInterval(shift.timeline)
  return points.map((p, i) => {
    const out = shiftTime(p, shift.bars, shift.timeline, interval)
    if (isNum(p.value)) {
      const converted = shift.values?.[i]
      if (isNum(converted)) {
        out.value = converted
      } else {
        const next = p.value + shift.value
        out.value = sameSign(p.value, next) ? next : p.value - Math.abs(p.value) * CLONE_FALLBACK_RATIO
      }
    }
    return out
  })
}
