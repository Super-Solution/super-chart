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

// The motion modules (wheelZoomMotion.ts, inertialPan.ts) talk to a small,
// testable chart interface; these adapters implement it on a live
// klinecharts 9.7/9.8 chart. They reach the time-scale store (private in
// both versions, feature-detected) because the public calls do not say the
// same thing across hosted versions: `zoomAtCoordinate(scale)` is a factor
// on 9.8.12 but klinecharts' raw zoom step on 9.7.2, and
// `getOffsetRightDistance()` is clamped at 0 once the newest bar is off
// screen, so it cannot say where a chart scrolled into history is.
//
// Part of SUPer-Chart (Apache-2.0).

import type { InertiaChart } from './inertialPan'
import type { MotionWheelChart } from './wheelZoomMotion'

interface TimeScaleStoreLike {
  zoom?: (scale: number, coordinate: { x: number, y: number }) => void
  getLastBarRightSideDiffBarCount?: () => number
  getBarSpace?: () => { bar: number }
}

export interface KlineMotionChartLike {
  getBarSpace: () => number
  setBarSpace: (space: number) => void
  isZoomEnabled: () => boolean
  scrollByDistance: (distance: number) => void
  getDom: (paneId?: string, position?: never) => HTMLElement | null | undefined
  convertToPixel: (points: unknown, finder: unknown) => unknown
  getChartStore?: () => { getTimeScaleStore?: () => TimeScaleStoreLike | null | undefined } | null | undefined
  getAllDrawPanes?: () => Array<{ getId?: () => string }>
}

/** klinecharts' zoom step is `barSpace * (1 + scale / 10)` in 9.7 and 9.8 alike. */
const ZOOM_STEP_DIVISOR = 10

function timeScale (chart: KlineMotionChartLike): TimeScaleStoreLike | null {
  try {
    return chart.getChartStore?.()?.getTimeScaleStore?.() ?? null
  } catch {
    return null
  }
}

function mainDom (chart: KlineMotionChartLike, paneId = 'candle_pane'): HTMLElement | null {
  return chart.getDom(paneId, 'main' as never) ?? null
}

export function klineWheelChart (chart: KlineMotionChartLike): MotionWheelChart {
  const store = timeScale(chart)
  // One coordinate object for every step (klinecharts reads it, never keeps it).
  const at = { x: 0, y: 0 }
  return {
    getBarSpace: () => chart.getBarSpace(),
    isZoomEnabled: () => chart.isZoomEnabled(),
    zoomTo: (next, anchorX) => {
      const cur = chart.getBarSpace()
      if (!(next > 0) || !Number.isFinite(next) || next === cur) return
      if (typeof store?.zoom !== 'function') {
        chart.setBarSpace(next)
        return
      }
      at.x = anchorX
      store.zoom((next / cur - 1) * ZOOM_STEP_DIVISOR, at)
      if (chart.getBarSpace() === cur) {
        // klinecharts ignores a bar space outside [1, 50] rather than clamping
        // it; a rounding error at the limit lands a hair outside: step back in.
        const inside = next * (next > cur ? 1 - 1e-9 : 1 + 1e-9)
        store.zoom((inside / cur - 1) * ZOOM_STEP_DIVISOR, at)
      }
    },
    toPaneX: clientX => {
      const r = mainDom(chart)?.getBoundingClientRect()
      if (r === undefined) return 0
      return Math.min(r.width, Math.max(0, clientX - r.left))
    }
  }
}

export function klineInertiaChart (chart: KlineMotionChartLike): InertiaChart {
  const store = timeScale(chart)
  const canRead = typeof store?.getLastBarRightSideDiffBarCount === 'function' && typeof store?.getBarSpace === 'function'
  return {
    scrollByDistance: distance => { chart.scrollByDistance(distance) },
    getBarSpace: () => chart.getBarSpace(),
    getScrollPosition: () => {
      if (canRead) {
        return -(store?.getLastBarRightSideDiffBarCount?.() ?? 0) * (store?.getBarSpace?.().bar ?? 0)
      }
      // Public fallback: where the first loaded bar is (moves 1:1 with a pan).
      const p = chart.convertToPixel({ dataIndex: 0 }, { paneId: 'candle_pane' }) as { x?: number } | Array<{ x?: number }>
      const x = Array.isArray(p) ? p[0]?.x : p?.x
      return typeof x === 'number' ? x : 0
    }
  }
}

/** Whether a pointerdown target is inside a pane's plot area (not an axis, not the chrome). */
export function klinePlotTarget (chart: KlineMotionChartLike): (target: EventTarget | null) => boolean {
  return target => {
    if (typeof Node === 'undefined' || !(target instanceof Node)) return true
    let panes: Array<{ getId?: () => string }> = []
    try { panes = chart.getAllDrawPanes?.() ?? [] } catch { return true }
    if (panes.length === 0) return true
    for (const pane of panes) {
      const id = pane.getId?.()
      if (id === undefined || id === 'x_axis_pane') continue
      if (mainDom(chart, id)?.contains(target) === true) return true
    }
    return false
  }
}
