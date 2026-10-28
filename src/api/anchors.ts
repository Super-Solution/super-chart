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

// Future-time point mapping (SC-135) and the replay index wrapper (SC-178).
//
// klinecharts places any point that carries a `timestamp` with
// `timestampToDataIndex`, a nearest-bar search over the CURRENTLY LOADED data
// (9.1.1 and 9.8.12, `_drawOverlay`/`convertToPixel`). A timestamp later than
// the last loaded bar comes back clamped to the second-to-last bar, so a
// drawing anchored in the future collapses to zero width. The fix used
// throughout this module (and by src/api/drawings.ts, src/api/annotations.ts)
// is the same one src/drawing-editor/clone.ts already uses for a cloned
// drawing's future point: give klinecharts a bare `dataIndex` (no timestamp)
// for anything past the last bar, extrapolated from the period, and keep the
// requested time in Super Chart's own record — never on the klinecharts point.
//
// Part of SUPer-Chart (Apache-2.0).

import { barInterval } from '../drawing-editor/clone'
import type { Period } from '../types'

export interface TimelineBar {
  timestamp: number
}

/** A klinecharts point field: exactly one of these two, matching what klinecharts itself stores (see clone.ts). */
export type DrawPointAnchor = { timestamp: number } | { dataIndex: number }

const TIMESPAN_MS: Readonly<Record<string, number>> = {
  second: 1_000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
  // Approximate: calendar months/years are not fixed-length. Good enough for
  // extrapolating a future anchor; session gaps (equities) make any of this
  // approximate anyway (documented on timeToPoint/pointToTime below).
  month: 2_592_000_000,
  year: 31_536_000_000
}

/** Milliseconds per bar for a Period, or null for an unrecognised timespan/multiplier. */
export function periodMs (period: Pick<Period, 'multiplier' | 'timespan'> | null | undefined): number | null {
  if (period === null || period === undefined) {
    return null
  }
  const unit = TIMESPAN_MS[period.timespan]
  if (unit === undefined || !Number.isFinite(period.multiplier) || period.multiplier <= 0) {
    return null
  }
  return unit * period.multiplier
}

function timestampsOf (dataList: readonly TimelineBar[]): number[] {
  return dataList.map(d => d.timestamp)
}

/**
 * Map a public API time (ms) to what a klinecharts point should carry:
 * `{ timestamp }` at or before the newest loaded bar — klinecharts' own
 * nearest-bar search places that correctly — or a bare `{ dataIndex }` (no
 * timestamp) for a time after it, extrapolated using `period` (falling back
 * to the recent bar spacing when no period is given), so it is never clamped
 * back to the last bar. With no loaded bars, the raw timestamp is kept: there
 * is nothing to anchor a dataIndex against yet.
 */
export function timeToPoint (
  time: number,
  dataList: readonly TimelineBar[],
  period?: Pick<Period, 'multiplier' | 'timespan'> | null
): DrawPointAnchor {
  const last = dataList.length - 1
  if (last < 0 || !Number.isFinite(time)) {
    return { timestamp: time }
  }
  if (time <= dataList[last].timestamp) {
    return { timestamp: time }
  }
  const timestamps = timestampsOf(dataList)
  const interval = periodMs(period) ?? barInterval(timestamps)
  if (interval === null || interval <= 0) {
    return { timestamp: time }
  }
  return { dataIndex: last + Math.round((time - dataList[last].timestamp) / interval) }
}

/**
 * Inverse of timeToPoint: recover a public time (ms) from a stored point.
 * Null when neither field is usable (no timestamp/dataIndex, or dataIndex
 * with nothing loaded to anchor it against).
 */
export function pointToTime (
  point: { timestamp?: number, dataIndex?: number },
  dataList: readonly TimelineBar[],
  period?: Pick<Period, 'multiplier' | 'timespan'> | null
): number | null {
  if (typeof point.timestamp === 'number' && Number.isFinite(point.timestamp)) {
    return point.timestamp
  }
  if (typeof point.dataIndex === 'number' && Number.isFinite(point.dataIndex)) {
    const last = dataList.length - 1
    if (last < 0) {
      return null
    }
    if (point.dataIndex >= 0 && point.dataIndex <= last) {
      return dataList[point.dataIndex]?.timestamp ?? null
    }
    const interval = periodMs(period) ?? barInterval(timestampsOf(dataList))
    if (interval === null) {
      return null
    }
    return dataList[last].timestamp + (point.dataIndex - last) * interval
  }
  return null
}

// ---------------------------------------------------------------------------
// SC-178: replay collapses the same way, for a much larger fraction of what
// is on screen — every overlay point anchored beyond the replay cursor loses
// its timestamp lookup the moment replay slices the data down to a prefix of
// the full series. The fix here leaves overlay points untouched (host
// overlays included) and instead makes timestampToDataIndex, WHILE REPLAY IS
// ACTIVE, extrapolate a timestamp past the currently-shown (sliced) data the
// SAME way timeToPoint already does for a future point — from the period's
// bar spacing off the last SHOWN bar — instead of clamping it.
//
// This deliberately never reaches into data/loader.ts's private replay state
// (the full, unsliced series) — that module is owned by an earlier batch, and
// the current, sliced `chart.getDataList()` is enough: because the replay
// slice is always the FULL series' own prefix (older bars are never
// re-numbered by entering replay), the sliced last bar's timestamp plus N
// periods lands on exactly the same instant the full series would have at
// that index, as long as the series has no gap between the cursor and the
// point (the same approximation timeToPoint already documents for session
// gaps).
// ---------------------------------------------------------------------------

interface TimeScaleStoreLike {
  timestampToDataIndex: (timestamp: number) => number
}

interface ChartStoreLike {
  getTimeScaleStore?: () => TimeScaleStoreLike | null | undefined
}

interface ReplayWidgetLike {
  getChartStore?: () => ChartStoreLike | null | undefined
  getDataList?: () => readonly TimelineBar[]
}

/**
 * Installs the lookup wrapper described above. Feature-detected: klinecharts
 * has never published `getChartStore()` as part of its typed API, so a
 * version or a fake test chart that lacks it gets a no-op restorer instead of
 * throwing. Call the returned restore function in exitReplay() and on
 * cleanup, so a stale wrapper never survives a symbol/period change.
 */
export function installReplayFutureAnchor (
  widget: unknown,
  getPeriod: () => Pick<Period, 'multiplier' | 'timespan'> | null,
  isReplaying: () => boolean
): () => void {
  const w = widget as ReplayWidgetLike | null | undefined
  const store = w?.getChartStore?.()?.getTimeScaleStore?.()
  if (store === null || store === undefined || typeof store.timestampToDataIndex !== 'function' || typeof w?.getDataList !== 'function') {
    return () => {}
  }
  const original = store.timestampToDataIndex.bind(store)
  let active = true
  const wrapped = (timestamp: number): number => {
    if (active && isReplaying()) {
      const dataList = w.getDataList?.() ?? []
      const last = dataList.length - 1
      if (last >= 0 && timestamp > dataList[last].timestamp) {
        const anchor = timeToPoint(timestamp, dataList, getPeriod())
        if ('dataIndex' in anchor) {
          return anchor.dataIndex
        }
      }
    }
    return original(timestamp)
  }
  store.timestampToDataIndex = wrapped
  return () => {
    active = false
    if (store.timestampToDataIndex === wrapped) {
      store.timestampToDataIndex = original
    }
  }
}
