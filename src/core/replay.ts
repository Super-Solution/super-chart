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

// Bar replay as data: the full series and the index of the newest bar shown.
// Pure functions over an immutable state; the loader applies the result to the
// chart. Live ticks and scrolled-back history go into `full` while a replay
// runs, so exiting shows everything that arrived meanwhile.

import type { MarketBar } from './types'

export interface ReplayState {
  /** Every bar, oldest first: the snapshot plus what arrived since. */
  readonly full: readonly MarketBar[]
  /** Index in `full` of the newest bar shown. */
  readonly idx: number
}

/** What to do to the chart to go from one replay state to the next. */
export type ReplayApply =
  | { kind: 'none' }
  /** Append one bar (klinecharts updateData): keeps the user's scroll position. */
  | { kind: 'append', bar: MarketBar }
  /** Replace the data (applyNewData) with these bars. */
  | { kind: 'rebuild', bars: MarketBar[] }

/** Fewer bars than this and there is nothing to replay. */
export const MIN_REPLAY_BARS = 3

/**
 * `list` with `bar` merged in as klinecharts would (snapshot semantics): the
 * same timestamp as the last bar replaces it, a newer one is appended, an
 * older one is ignored. Returns a new array, or `list` itself when ignored.
 */
export function mergeBar (list: readonly MarketBar[], bar: MarketBar): readonly MarketBar[] {
  const last = list[list.length - 1]
  if (last === undefined || bar.timestamp > last.timestamp) {
    return [...list, bar]
  }
  if (bar.timestamp === last.timestamp) {
    const next = list.slice()
    next[next.length - 1] = bar
    return next
  }
  return list
}

/** A replay over `bars` starting at `at` (default: 60% of the way in); null if too short. */
export function startReplay (bars: readonly MarketBar[], at?: number): ReplayState | null {
  if (bars.length < MIN_REPLAY_BARS) {
    return null
  }
  const idx = at ?? Math.floor(bars.length * 0.6)
  return { full: bars.slice(), idx: clampIdx(idx, bars.length) }
}

function clampIdx (idx: number, length: number): number {
  return Math.max(0, Math.min(length - 1, Math.trunc(idx)))
}

/** `dir` bars forward (positive) or back (negative), clamped to the series. */
export function stepReplay (state: ReplayState, dir: number): ReplayState {
  const idx = clampIdx(state.idx + dir, state.full.length)
  return idx === state.idx ? state : { full: state.full, idx }
}

/** A live tick during replay: buffered into `full`, never shown until exit. */
export function tickReplay (state: ReplayState, bar: MarketBar): ReplayState {
  const full = mergeBar(state.full, bar)
  return full === state.full ? state : { full, idx: state.idx }
}

/**
 * Older history (a scroll-back page) during replay: prepended to `full`. The
 * index moves with it, so the replay head stays on the same bar.
 */
export function prependReplay (state: ReplayState, older: readonly MarketBar[]): ReplayState {
  if (older.length === 0) {
    return state
  }
  return { full: older.concat(state.full), idx: state.idx + older.length }
}

/** The bars shown at this state: the series up to and including the head. */
export function replayBars (state: ReplayState): MarketBar[] {
  return state.full.slice(0, state.idx + 1)
}

/** True when the head is on the newest bar. */
export function replayAtEnd (state: ReplayState): boolean {
  return state.idx >= state.full.length - 1
}

/**
 * How to show `next` on a chart whose newest bar has timestamp `chartLastTs`,
 * coming from `prev`. One step forward from a chart that shows exactly `prev`
 * is an append (the view keeps its scroll position); anything else (a step
 * back, a jump, a chart in an unexpected state) rebuilds.
 */
export function replayApply (prev: ReplayState, next: ReplayState, chartLastTs: number | undefined): ReplayApply {
  if (next === prev) {
    return { kind: 'none' }
  }
  const prevHead = prev.full[prev.idx]
  if (
    next.full === prev.full && next.idx === prev.idx + 1 &&
    prevHead !== undefined && chartLastTs === prevHead.timestamp
  ) {
    return { kind: 'append', bar: next.full[next.idx] }
  }
  return { kind: 'rebuild', bars: replayBars(next) }
}
