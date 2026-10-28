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

// A price axis that does not change width while the chart moves.
//
// klinecharts sizes the y-axis from the widest label currently on it (every
// pane's axis; the widest wins) and re-measures on every pan and zoom. The
// plot is anchored to the axis' left edge, so each time the labels get wider
// or narrower — a pan across 100,000, a volume pane going from "8.2K" to
// "12.5K" — every candle and drawing jumps sideways by the difference, back
// and forth, for as long as the pan keeps crossing it: a visible shake. Each
// of those width changes was also the trigger for a canvas layer freezing
// (src/canvas/frameLoop.ts).
//
// So, as long as the host leaves `yAxis.size` on 'auto', the width only
// grows: every pane's axis reports the widest width seen so far. `reset()`
// (a new symbol or period) lets it fit the new labels once. A host that sets
// a fixed `yAxis.size` is never overridden.
//
// Part of SUPer-Chart (Apache-2.0).

interface AxisLike { getAutoSize: () => number }
interface PaneLike { getId?: () => string, getAxisComponent?: () => unknown }
interface ChartLike {
  getAllDrawPanes?: () => PaneLike[]
  getStyles?: () => { yAxis?: { size?: unknown } } | null | undefined
}

export interface StickyAxisWidth {
  /** Wraps the y-axes of panes not seen yet (call after a pane is added). */
  adopt: () => void
  /** Forget the widest width: the next layout fits the current labels. */
  reset: () => void
  /** The width every y-axis currently reports (0 before the first layout). */
  readonly width: number
  dispose: () => void
}

function isAxis (value: unknown): value is AxisLike {
  return value !== null && typeof value === 'object' && typeof (value as AxisLike).getAutoSize === 'function'
}

export function attachStickyAxisWidth (chart: unknown): StickyAxisWidth {
  const c = chart as ChartLike | null
  let widest = 0
  let disposed = false
  // Each wrapped axis and its own `getAutoSize` property, if it had one
  // (klinecharts keeps it on the prototype; dispose puts back what was there).
  const wrapped = new Map<AxisLike, PropertyDescriptor | undefined>()

  const isAuto = (): boolean => {
    try {
      const size = c?.getStyles?.()?.yAxis?.size
      return size === undefined || size === 'auto'
    } catch {
      return false
    }
  }

  const adopt = (): void => {
    if (disposed) return
    let panes: PaneLike[] = []
    try { panes = c?.getAllDrawPanes?.() ?? [] } catch { return }
    for (const pane of panes) {
      if (pane.getId?.() === 'x_axis_pane') continue // its axis' "size" is a height
      const axis = pane.getAxisComponent?.()
      if (!isAxis(axis) || wrapped.has(axis)) continue
      const own = axis.getAutoSize
      wrapped.set(axis, Object.getOwnPropertyDescriptor(axis, 'getAutoSize'))
      Object.defineProperty(axis, 'getAutoSize', {
        configurable: true,
        writable: true,
        value: function (this: AxisLike): number {
          const natural = own.call(axis)
          if (!isAuto() || !Number.isFinite(natural)) return natural
          if (natural > widest) widest = natural
          return widest
        }
      })
    }
  }

  adopt()
  return {
    adopt,
    reset: () => { widest = 0 },
    get width () { return widest },
    dispose: () => {
      if (disposed) return
      disposed = true
      for (const [axis, previous] of wrapped) {
        delete (axis as unknown as Record<string, unknown>).getAutoSize
        if (previous !== undefined) Object.defineProperty(axis, 'getAutoSize', previous)
      }
      wrapped.clear()
    }
  }
}
