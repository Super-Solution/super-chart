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

// The engine's own magnet, replacing klinecharts' weak-magnet snap for user
// drawings (SC-103). klinecharts' OverlayView._coordinateToPoint has an
// asymmetric weak-magnet branch: for a cursor below the low it computes the
// buffer value on the WRONG side of the low, so `value < buffValue` can never
// be true and the below-low snap is dead code (confirmed on klinecharts 9.7.2
// and 9.8.12). That code is internal (OverlayView is not exported) and is a
// peer dependency shared with host-created overlays and raw-klinecharts
// charts (SupWallet's LiveChart/TAChart), so it is never patched; instead
// user drawings are always created/overridden with klinecharts `mode:
// 'normal'`, and this module's magnetSnapPixel recomputes the snap in PIXEL
// space, which the caller (drawing-editor/controller.ts's onDrawing hook)
// applies. Pixel space also means this is correct on a reversed or log y-axis
// without knowing which: the caller already converted OHLC to pixels.
// Part of SUPer-Chart (Apache-2.0).

export type MagnetMode = 'normal' | 'weak_magnet' | 'strong_magnet'

/** One bar's OHLC, already converted to this pane's pixel y (any two may be equal; a flat bar snaps to one point). */
export interface OhlcPixel {
  open: number
  high: number
  low: number
  close: number
}

/** Default klinecharts modeSensitivity. */
export const DEFAULT_MAGNET_SENSITIVITY_PX = 8

interface Nearest { key: keyof OhlcPixel, y: number, dist: number }

function nearestOhlc (yPx: number, ohlc: OhlcPixel): Nearest {
  const entries = Object.entries(ohlc) as Array<[keyof OhlcPixel, number]>
  let best: Nearest = { key: entries[0][0], y: entries[0][1], dist: Math.abs(yPx - entries[0][1]) }
  for (const [key, y] of entries.slice(1)) {
    const dist = Math.abs(yPx - y)
    if (dist < best.dist) {
      best = { key, y, dist }
    }
  }
  return best
}

/**
 * The magnet-snapped pixel y for a raw pointer y, or null when nothing snaps
 * (weak mode, cursor outside the candle's high/low band and further than
 * `sensitivityPx` from the nearer edge). `mode: 'normal'` always returns null
 * (no snap) so the caller does not have to branch on it separately.
 *
 * Weak mode: inside the [high, low] pixel band (candle body or wick, however
 * the axis is oriented) it snaps to the nearest OHLC, same as strong mode;
 * outside that band it snaps only within `sensitivityPx` of the boundary it
 * is approaching — symmetric above the high AND below the low, unlike the
 * engine's own bug.
 */
export function magnetSnapPixel (yPx: number, ohlc: OhlcPixel, mode: MagnetMode, sensitivityPx = DEFAULT_MAGNET_SENSITIVITY_PX): number | null {
  if (mode === 'normal') {
    return null
  }
  const near = nearestOhlc(yPx, ohlc)
  if (mode === 'strong_magnet') {
    return near.y
  }
  const top = Math.min(ohlc.high, ohlc.low)
  const bottom = Math.max(ohlc.high, ohlc.low)
  if (yPx >= top && yPx <= bottom) {
    return near.y
  }
  const edge = yPx < top ? top : bottom
  return Math.abs(yPx - edge) <= sensitivityPx ? near.y : null
}

// ---------------------------------------------------------------------------
// The glue that reads a bar's OHLC and applies the snap while a user drawing
// is being placed or dragged (drawing-editor/controller.ts's prepare()).
// Kept here, not in controller.ts, so the wiring is one small chained
// callback there. Never throws: any failure leaves the point where the
// cursor put it (the same as magnet mode being off).

/** The subset of the klinecharts Chart this needs (a fake implements it in tests). */
export interface MagnetChart {
  getDataList: () => ReadonlyArray<{ open: number, high: number, low: number, close: number }>
  convertToPixel: (points: unknown, options: { paneId: string }) => unknown
  convertFromPixel: (points: unknown, options: { paneId: string }) => unknown
}

interface DrawingPoint { value?: number, [k: string]: unknown }

/** The subset of an in-progress klinecharts Overlay this needs. */
export interface MagnetOverlayEvent {
  x?: number
  y?: number
  overlay: {
    points: DrawingPoint[]
    currentStep: number
    mode?: string
    modeSensitivity?: number
    performEventMoveForDrawing?: (params: { currentStep: number, mode?: string, points: DrawingPoint[], performPointIndex: number, performPoint: DrawingPoint }) => void
  }
}

function firstOf<T> (v: T | T[] | null | undefined): T | undefined {
  return Array.isArray(v) ? v[0] : (v ?? undefined)
}

/**
 * Snap the point currently being placed or dragged to the OHLC of the bar
 * under the cursor's x, in pixel space, when the overlay's mode is
 * 'weak_magnet' or 'strong_magnet'. Mutates `event.overlay.points` in place —
 * the same thing klinecharts' own (buggy) magnet does — and re-runs the
 * tool's own performEventMoveForDrawing so a constrained tool (a horizontal
 * line, say) stays consistent with the snapped value.
 */
export function applyMagnetSnap (chart: MagnetChart, event: MagnetOverlayEvent, paneId: string): void {
  try {
    const mode = event.overlay.mode
    if (mode !== 'weak_magnet' && mode !== 'strong_magnet') {
      return
    }
    if (typeof event.x !== 'number' || typeof event.y !== 'number') {
      return
    }
    const step = event.overlay.currentStep
    const idx = step === -1 ? event.overlay.points.length - 1 : step - 1
    const point = event.overlay.points[idx]
    if (idx < 0 || point === undefined) {
      return
    }
    const from = firstOf(chart.convertFromPixel([{ x: event.x }], { paneId })) as { dataIndex?: number } | undefined
    const dataIndex = from?.dataIndex
    if (typeof dataIndex !== 'number') {
      return
    }
    const bar = chart.getDataList()[dataIndex]
    if (bar === undefined) {
      return
    }
    const pixels = chart.convertToPixel(
      [{ value: bar.open }, { value: bar.high }, { value: bar.low }, { value: bar.close }],
      { paneId }
    ) as Array<{ y?: number }> | undefined
    if (!Array.isArray(pixels) || pixels.length !== 4) {
      return
    }
    const ohlc: OhlcPixel = { open: pixels[0]?.y ?? NaN, high: pixels[1]?.y ?? NaN, low: pixels[2]?.y ?? NaN, close: pixels[3]?.y ?? NaN }
    if (![ohlc.open, ohlc.high, ohlc.low, ohlc.close].every(Number.isFinite)) {
      return
    }
    const sensitivity = typeof event.overlay.modeSensitivity === 'number' ? event.overlay.modeSensitivity : DEFAULT_MAGNET_SENSITIVITY_PX
    const snappedY = magnetSnapPixel(event.y, ohlc, mode, sensitivity)
    if (snappedY === null) {
      return
    }
    const back = firstOf(chart.convertFromPixel([{ y: snappedY }], { paneId })) as { value?: number } | undefined
    if (typeof back?.value !== 'number' || !Number.isFinite(back.value)) {
      return
    }
    point.value = back.value
    event.overlay.performEventMoveForDrawing?.({ currentStep: step, mode, points: event.overlay.points, performPointIndex: idx, performPoint: point })
  } catch { /* magnet is best-effort: leave the point where the cursor put it */ }
}
