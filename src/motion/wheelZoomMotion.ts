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

// Cursor-anchored wheel/trackpad/pinch zoom (SC-NEXT #1, reworked
// 2026-09-28). The same gate as SC-097 (decideWheelAction: which wheel zooms
// at all, and what is released to the page); what changed is how a wheel
// event becomes a bar space:
//
// - Deltas are measured, not counted. A mouse notch (100px in Chrome, three
//   lines in Firefox) is one 10% step, exactly as before; a trackpad's stream
//   of small pixel deltas zooms in proportion to how far the fingers moved,
//   instead of 10% per event (which made trackpad zoom run away at whatever
//   rate the device sent events); a pinch (ctrl+wheel) follows the fingers
//   1:1 (browsers report it as deltaY = -100·ln(scale)).
// - Deltas accumulate into one target, applied once per frame. A notch eases
//   toward the target (exponential approach in log space, so consecutive
//   notches just move the target instead of restarting a tween from a
//   mid-flight value); trackpad and pinch are direct manipulation and land
//   in the frame they arrive in. Reduced motion (or `motion: false`) lands
//   every notch in one frame too.
// - The anchor is the bar under the cursor, kept there by the chart's own
//   zoom (`zoomTo`, which in Super Chart is klinecharts' internal cursor-
//   anchored zoom). The previous version corrected `offsetRightDistance`
//   after each step, but klinecharts reports that distance clamped at 0 once
//   the newest bar is off screen, so every zoom while scrolled back into
//   history snapped the chart to the newest bar, and overwrote the chart's
//   default right gap as a side effect.
//
// The math (normalizeWheel, wheelZoomFactor, stepToward) is pure and
// unit-tested; attachWheelZoom is the thin wiring, verified in the browser
// (e2e/tests/motion*.spec.ts).
//
// Part of SUPer-Chart (Apache-2.0).

import { decideWheelAction, type WheelMode } from '../canvas/navigation'
import type { TweenClock } from './easing'

export type WheelKind = 'notch' | 'smooth' | 'pinch'

export interface NormalizedWheel {
  /** Vertical delta in px (negative = zoom in). */
  px: number
  kind: WheelKind
}

/** px per line in line mode (Firefox): three lines, one notch, = 100px, Chrome's notch. */
export const LINE_PX = 100 / 3
/** px per page in page mode (rare: some accessibility settings). */
export const PAGE_PX = 400
/** One 100px notch zooms 10%, the step this chart has always used. */
export const WHEEL_ZOOM_PER_PX = Math.log(1.1) / 100
/** A pinch arrives as ctrl+wheel with deltaY = -100·ln(scale): exp(-deltaY/100) is the fingers' own scale. */
export const PINCH_ZOOM_PER_PX = 1 / 100

/**
 * The wheel event's vertical delta in px and what kind of device it most
 * likely came from. Line/page mode is always a notched wheel. In pixel mode,
 * ctrl with a small delta is a trackpad pinch (a real Ctrl+mouse-wheel
 * notch is 100px), a delta of 50px or more is a mouse notch, anything
 * smaller is a trackpad (or a high-resolution wheel) scrolling smoothly.
 */
export function normalizeWheel (e: { deltaY: number, deltaMode?: number, ctrlKey?: boolean }): NormalizedWheel {
  const dy = Number.isFinite(e.deltaY) ? e.deltaY : 0
  if (e.deltaMode === 1) return { px: dy * LINE_PX, kind: 'notch' }
  if (e.deltaMode === 2) return { px: dy * PAGE_PX, kind: 'notch' }
  const abs = Math.abs(dy)
  if (e.ctrlKey === true && abs < 50) return { px: dy, kind: 'pinch' }
  return { px: dy, kind: abs >= 50 ? 'notch' : 'smooth' }
}

/** Multiplier on the bar space for one normalized wheel delta (> 1 zooms in). */
export function wheelZoomFactor (w: NormalizedWheel): number {
  const k = w.kind === 'pinch' ? PINCH_ZOOM_PER_PX : WHEEL_ZOOM_PER_PX
  const f = Math.exp(-w.px * k)
  return Number.isFinite(f) && f > 0 ? f : 1
}

/**
 * One frame of an exponential approach from `current` to `target` in log
 * space (a zoom feels even at every scale), with time constant `tauMs`.
 * Returns exactly `target` once within 0.2%, and immediately when `tauMs`
 * is 0 or the inputs are unusable.
 */
export function stepToward (current: number, target: number, dtMs: number, tauMs: number): number {
  if (!(tauMs > 0) || !(current > 0) || !(target > 0) || !Number.isFinite(current) || !Number.isFinite(target)) return target
  const k = 1 - Math.exp(-Math.max(0, dtMs) / tauMs)
  const next = current * Math.pow(target / current, k)
  return Math.abs(Math.log(target / next)) < 0.002 ? target : next
}

export interface MotionWheelChart {
  getBarSpace: () => number
  isZoomEnabled: () => boolean
  /** Sets the bar space, keeping the bar at pane-relative `anchorX` where it is. */
  zoomTo: (barSpace: number, anchorX: number) => void
  /** Pane-relative x for a client x (read once per wheel event, in the input handler; never per frame). */
  toPaneX: (clientX: number) => number
}

export interface WheelZoomOptions {
  isReducedMotion?: () => boolean
  /** Frames for the eased approach; Super Chart passes its frame loop's clock (runs before the layers repaint). */
  clock: TweenClock
  /** Time constant of a notch's eased approach. @default 60 */
  tauMs?: number
  /** @default 1 */
  minBarSpace?: number
  /** @default 50 */
  maxBarSpace?: number
  /** Called on every wheel that zooms (Super Chart stops a running fling). */
  onZoom?: () => void
}

export interface WheelZoomHandle {
  dispose: () => void
  /** Drops any zoom still easing in (a drag grabbed the chart). */
  stop: () => void
}

/**
 * One capture-phase, non-passive wheel listener on the chart root (the
 * contract of attachWheelNavigation, SC-097: same gate, same
 * stopPropagation/preventDefault rules), zooming as described above.
 */
export function attachWheelZoom (root: HTMLElement, chart: MotionWheelChart, getMode: () => WheelMode, options: WheelZoomOptions): WheelZoomHandle {
  const { clock } = options
  const tauMs = options.tauMs ?? 60
  const min = options.minBarSpace ?? 1
  const max = options.maxBarSpace ?? 50
  let target: number | null = null
  let anchorX = 0
  let eased = false
  let handle: number | null = null
  let lastT = 0

  const stop = (): void => {
    if (handle !== null) clock.cancel(handle)
    handle = null
    target = null
  }

  const step = (now: number): void => {
    handle = null
    if (target === null) return
    const cur = chart.getBarSpace()
    // At least a few ms per step: input is dispatched right before the frame
    // that handles it, and performance.now() is coarsened (100 µs in
    // Chrome), so the first step can read 0 ms elapsed — which would make no
    // progress at all.
    const dt = Math.min(64, Math.max(4, now - lastT))
    lastT = now
    const next = eased ? stepToward(cur, target, dt, tauMs) : target
    if (next !== cur) {
      chart.zoomTo(next, anchorX)
      // The chart would not move (zoom disabled mid-way): give up.
      if (chart.getBarSpace() === cur) {
        target = null
        return
      }
    }
    if (next === target) {
      target = null
      return
    }
    handle = clock.raf(step)
  }

  const handler = (e: WheelEvent): void => {
    const action = decideWheelAction({ deltaX: e.deltaX, deltaY: e.deltaY, mode: getMode(), ctrlKey: e.ctrlKey })
    if (action === 'passthrough') return
    e.stopPropagation()
    if (action === 'page-scroll') return
    e.preventDefault()
    if (!chart.isZoomEnabled()) return
    const w = normalizeWheel(e)
    if (w.px === 0) return
    options.onZoom?.()
    const base = target ?? chart.getBarSpace()
    target = Math.min(max, Math.max(min, base * wheelZoomFactor(w)))
    anchorX = chart.toPaneX(e.clientX)
    eased = w.kind === 'notch' && !(options.isReducedMotion?.() ?? false)
    if (handle === null) {
      lastT = clock.now()
      handle = clock.raf(step)
    }
  }

  const onPointerDown = (): void => { stop() }
  root.addEventListener('wheel', handler, { capture: true, passive: false })
  root.addEventListener('pointerdown', onPointerDown, true)
  return {
    stop,
    dispose: () => {
      root.removeEventListener('wheel', handler, { capture: true })
      root.removeEventListener('pointerdown', onPointerDown, true)
      stop()
    }
  }
}
