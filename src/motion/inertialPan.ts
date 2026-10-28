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

// Inertial (kinetic) pan (SC-NEXT #1): a drag/flick keeps scrolling and
// decelerates after release, instead of stopping dead the instant the
// pointer lifts. klinecharts' own drag-to-pan stays the ONLY thing that moves
// the chart while the button is down (1:1, no easing); this module only
// watches the gesture and, on release, continues it with a decaying series
// of `scrollByDistance` calls. Off under prefers-reduced-motion and while a
// drawing tool is armed (`isSuspended`).
//
// What it continues is what the CHART did, not what the pointer did
// (2026-09-28): the release velocity comes from the chart's own scroll
// position, sampled after klinecharts has handled each move, so a drag that
// a drawing consumed (grabbing a line) or an axis drag that zoomed instead of
// panning never flings. The velocity is a least-squares slope over the last
// ~80 ms before release, and a pointer held still for longer than ~40 ms
// before letting go does not fling at all (the same two rules as Android's
// VelocityTracker). Touch is left to klinecharts' own touch fling, so exactly
// one inertia ever runs.
//
// The physics (VelocityTracker, the decay schedule) is pure and unit-tested
// with a fake clock; `attachInertialPan` is the thin DOM wiring, exercised
// by the e2e suite (e2e/tests/motion*.spec.ts).
//
// Part of SUPer-Chart (Apache-2.0).

import { runTween, type TweenClock } from './easing'

/**
 * Recent (time, position) samples in a fixed ring (no allocation per move),
 * and the release velocity they imply.
 */
export class VelocityTracker {
  private readonly ts: Float64Array
  private readonly xs: Float64Array
  private count = 0
  private head = 0

  constructor (readonly capacity = 32) {
    this.ts = new Float64Array(capacity)
    this.xs = new Float64Array(capacity)
  }

  reset (): void {
    this.count = 0
    this.head = 0
  }

  get size (): number {
    return this.count
  }

  add (t: number, x: number): void {
    if (!Number.isFinite(t) || !Number.isFinite(x)) return
    this.ts[this.head] = t
    this.xs[this.head] = x
    this.head = (this.head + 1) % this.capacity
    if (this.count < this.capacity) this.count++
  }

  /** Ring index of the i-th newest sample (0 = newest). */
  private idx (i: number): number {
    return (this.head - 1 - i + this.capacity * 2) % this.capacity
  }

  /**
   * px/ms at time `at` (the release): the least-squares slope of the samples
   * no older than `horizonMs`, or 0 when fewer than two samples fall in that
   * window or the position has not changed for longer than `stoppedMs`.
   */
  velocity (at: number, horizonMs = 80, stoppedMs = 40): number {
    if (this.count < 2) return 0
    const x0 = this.xs[this.idx(0)]
    // When did the position last change?
    let lastMove = -Infinity
    for (let i = 0; i < this.count - 1; i++) {
      const a = this.idx(i)
      const b = this.idx(i + 1)
      if (Math.abs(this.xs[a] - this.xs[b]) > 0.5) {
        lastMove = this.ts[a]
        break
      }
    }
    if (at - lastMove > stoppedMs) return 0
    let n = 0
    let st = 0
    let sx = 0
    let stt = 0
    let stx = 0
    for (let i = 0; i < this.count; i++) {
      const k = this.idx(i)
      const dt = this.ts[k] - at
      if (-dt > horizonMs) break
      const dx = this.xs[k] - x0
      n++
      st += dt
      sx += dx
      stt += dt * dt
      stx += dt * dx
    }
    if (n < 2) return 0
    const den = n * stt - st * st
    if (den <= 1e-9) return 0
    const v = (n * stx - st * sx) / den
    return Number.isFinite(v) ? v : 0
  }
}

export interface InertiaOptions {
  /** px/ms below which the fling does not start (an intentional drag-and-stop, not a flick). @default 0.08 */
  minVelocity?: number
  /** px/ms clamp, so a jumpy/synthetic pointer event cannot launch an unbounded scroll. @default 3.5 */
  maxVelocity?: number
  /** Exponential decay per ms: v(t) = v0 * decay^t. Smaller = stops sooner. @default 0.998 */
  decayPerMs?: number
  /**
   * Absolute px/ms floor the decaying velocity must fall under before the fling
   * stops (NOT a fraction of v0 — a fixed floor, like real touch/trackpad
   * momentum scrolling, so a harder flick both travels further AND runs
   * longer before crossing the same floor; a fraction-of-v0 floor would make
   * every fling take the same duration regardless of how hard it was thrown).
   * @default 0.02
   */
  stopVelocity?: number
  /** Hard cap on how long the fling can run, regardless of decay math. @default 1600 */
  maxDurationMs?: number
}

const DEFAULTS: Required<InertiaOptions> = {
  minVelocity: 0.08,
  maxVelocity: 3.5,
  decayPerMs: 0.998,
  stopVelocity: 0.02,
  maxDurationMs: 1600
}

/** How long (ms) exponential decay from `v0` takes to fall under the absolute `stopVelocity` floor, given `decayPerMs` per ms. Pure math, no tween. */
export function flingDuration (v0: number, options: InertiaOptions = {}): number {
  const { decayPerMs, stopVelocity, maxDurationMs } = { ...DEFAULTS, ...options }
  const abs = Math.abs(v0)
  if (abs === 0 || decayPerMs <= 0 || decayPerMs >= 1 || abs <= stopVelocity) return 0
  // decay^t = stopVelocity / abs(v0)  =>  t = ln(stopVelocity / abs(v0)) / ln(decay)
  const t = Math.log(stopVelocity / abs) / Math.log(decayPerMs)
  return Math.min(maxDurationMs, Math.max(0, t))
}

/** Total px the fling will travel (the exponential's integral), same sign as v0. */
export function flingDistance (v0: number, options: InertiaOptions = {}): number {
  const { decayPerMs } = { ...DEFAULTS, ...options }
  const duration = flingDuration(v0, options)
  if (duration === 0 || decayPerMs <= 0 || decayPerMs >= 1) return 0
  const lnDecay = Math.log(decayPerMs)
  // integral of v0 * decay^t dt from 0 to duration = v0 * (decay^duration - 1) / ln(decay)
  return v0 * (Math.pow(decayPerMs, duration) - 1) / lnDecay
}

/** Whether a release velocity should start a fling at all (clamped to [minVelocity, maxVelocity] in magnitude first). */
export function shouldFling (v0: number, options: InertiaOptions = {}): boolean {
  const { minVelocity } = { ...DEFAULTS, ...options }
  return Math.abs(v0) >= minVelocity
}

export function clampVelocity (v0: number, options: InertiaOptions = {}): number {
  const { maxVelocity } = { ...DEFAULTS, ...options }
  return Math.max(-maxVelocity, Math.min(maxVelocity, v0))
}

export interface InertiaChart {
  scrollByDistance: (distance: number) => void
  /**
   * The chart's scroll position in px, growing as the content moves right
   * (the direction a rightward drag moves it). When present, the release
   * velocity is measured from it, and a fling stops as soon as the chart
   * stops moving (it reached the oldest or the newest bar).
   */
  getScrollPosition?: () => number
  /** When present, a gesture that changed the bar space (an axis zoom-drag) never flings. */
  getBarSpace?: () => number
}

/**
 * Starts a decaying scroll from release velocity `v0` (px/ms, positive =
 * pointer moved right = chart should keep panning the same direction it was
 * being dragged). Each frame calls `chart.scrollByDistance` with just that
 * frame's slice of the exponential (time-based, so the distance does not
 * depend on the frame rate). Returns a stop function.
 */
export function runInertialScroll (chart: InertiaChart, v0Raw: number, options: InertiaOptions = {}, clock?: TweenClock): () => void {
  const opts = { ...DEFAULTS, ...options }
  const v0 = clampVelocity(v0Raw, opts)
  if (!shouldFling(v0, opts)) {
    return () => {}
  }
  const duration = flingDuration(v0, opts)
  if (duration <= 0) {
    return () => {}
  }
  const lnDecay = Math.log(opts.decayPerMs)
  const posAt = (t: number): number => v0 * (Math.pow(opts.decayPerMs, t) - 1) / lnDecay
  let lastPos = 0
  let blocked = 0
  let stopped = false
  const tween = runTween({
    duration,
    easing: t => t, // the exponential decay IS the easing curve here; runTween just drives the frames.
    clock,
    onFrame: (_eased, rawT) => {
      if (stopped) return
      const pos = posAt(rawT * duration)
      const delta = pos - lastPos
      lastPos = pos
      if (delta === 0) return
      const before = chart.getScrollPosition?.()
      chart.scrollByDistance(delta)
      if (before === undefined || Math.abs(delta) < 0.5) return
      // At the oldest/newest bar klinecharts clamps the scroll: stop instead
      // of spinning on for the rest of the decay.
      const moved = Math.abs((chart.getScrollPosition?.() ?? before) - before)
      blocked = moved < 0.01 ? blocked + 1 : 0
      if (blocked >= 2) {
        stopped = true
        tween.stop()
      }
    }
  })
  return () => {
    stopped = true
    tween.stop()
  }
}

export interface AttachInertialPanOptions {
  isReducedMotion?: () => boolean
  /** While true, no fling starts (e.g. a drawing tool is armed, or a drag started inside a drawing/editor). @default () => false */
  isSuspended?: () => boolean
  inertia?: InertiaOptions
  clock?: TweenClock
  /** Whether a gesture that starts on this target pans the chart (a pane's plot area, never an axis or the chrome). @default () => true */
  isPanTarget?: (target: EventTarget | null) => boolean
  /** How far back the release velocity looks. @default 80 */
  horizonMs?: number
  /** Held still for longer than this before release: no fling. @default 40 */
  stoppedMs?: number
  /** Where moves and the release are heard (a drag can leave the chart). @default root's window, else root */
  moveTarget?: EventTarget
}

export type InertialPanHandle = (() => void) & { stop: () => void }

/**
 * Watches primary-button mouse/pen drags on `root` and, on release, starts
 * `runInertialScroll` with the chart's own release velocity. Any new
 * pointerdown, wheel or key on the chart stops a fling in progress (grabbing
 * the chart mid-fling, exactly like grabbing a spun wheel). Returns a
 * dispose function that also carries `stop()`.
 */
export function attachInertialPan (root: HTMLElement, chart: InertiaChart, options: AttachInertialPanOptions = {}): InertialPanHandle {
  const tracker = new VelocityTracker()
  const horizonMs = options.horizonMs ?? 80
  const stoppedMs = options.stoppedMs ?? 40
  const byChart = typeof chart.getScrollPosition === 'function'
  const moveTarget: EventTarget = options.moveTarget ?? (root.ownerDocument?.defaultView as EventTarget | null | undefined) ?? root
  let dragging = false
  let barSpaceAtDown = 0
  let stopFling: (() => void) | null = null

  const stop = (): void => {
    stopFling?.()
    stopFling = null
  }
  const sample = (t: number, clientX: number): void => {
    tracker.add(t, byChart ? (chart.getScrollPosition?.() ?? 0) : clientX)
  }

  const onDown = (e: PointerEvent): void => {
    stop()
    dragging = false
    if (e.button !== 0 || e.pointerType === 'touch') return
    if (options.isPanTarget !== undefined && !options.isPanTarget(e.target)) return
    dragging = true
    barSpaceAtDown = chart.getBarSpace?.() ?? 0
    tracker.reset()
    sample(e.timeStamp, e.clientX)
  }
  // Sampled AFTER klinecharts has handled the move (its drag listens for
  // mousemove on the document element; this one is on the window, later in
  // the bubble path), so the position read is the one this move produced.
  const onMove = (e: MouseEvent): void => {
    if (dragging) sample(e.timeStamp, e.clientX)
  }
  const onUp = (e: PointerEvent): void => {
    if (!dragging) return
    dragging = false
    sample(e.timeStamp, e.clientX)
    if (e.type === 'pointercancel') return
    if ((options.isReducedMotion?.() ?? false) || (options.isSuspended?.() ?? false)) return
    if (chart.getBarSpace !== undefined && chart.getBarSpace() !== barSpaceAtDown) return
    const v0 = tracker.velocity(e.timeStamp, horizonMs, stoppedMs)
    if (!shouldFling(v0, options.inertia)) return
    stopFling = runInertialScroll(chart, v0, options.inertia, options.clock)
  }
  const onInterrupt = (): void => { stop() }

  const moveType = byChart ? 'mousemove' : 'pointermove'
  const moveCapture = !byChart
  root.addEventListener('pointerdown', onDown as EventListener, true)
  moveTarget.addEventListener(moveType, onMove as EventListener, moveCapture)
  moveTarget.addEventListener('pointerup', onUp as EventListener, true)
  moveTarget.addEventListener('pointercancel', onUp as EventListener, true)
  root.addEventListener('wheel', onInterrupt, { capture: true, passive: true })
  root.addEventListener('keydown', onInterrupt, true)
  const dispose = (): void => {
    root.removeEventListener('pointerdown', onDown as EventListener, true)
    moveTarget.removeEventListener(moveType, onMove as EventListener, moveCapture)
    moveTarget.removeEventListener('pointerup', onUp as EventListener, true)
    moveTarget.removeEventListener('pointercancel', onUp as EventListener, true)
    root.removeEventListener('wheel', onInterrupt, { capture: true })
    root.removeEventListener('keydown', onInterrupt, true)
    stop()
  }
  return Object.assign(dispose, { stop })
}
