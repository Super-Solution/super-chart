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

// Shared motion primitives (SC-NEXT #1): easing curves, a small rAF-driven
// tween runner, and the prefers-reduced-motion switch every animated feature
// in src/motion and src/canvas/highLowTags checks before it moves a pixel.
// Pure and DOM-free (fake `raf`/`now` in tests, a real one at runtime), so
// every curve and the tween runner's frame count are unit-testable with a
// fake clock instead of a real animation loop.
//
// Part of SUPer-Chart (Apache-2.0).

/** Clamp to [0, 1]; NaN and out-of-range progress values never escape a tween. */
export function clamp01 (t: number): number {
  if (!Number.isFinite(t)) return 0
  return Math.min(1, Math.max(0, t))
}

/** Standard "ease out" cubic: fast start, gentle settle. The default for zoom/pan/axis tweens. */
export function easeOutCubic (t: number): number {
  const x = clamp01(t)
  const inv = 1 - x
  return 1 - inv * inv * inv
}

/** Snappier settle, used for the short fade-in transitions. */
export function easeOutQuart (t: number): number {
  const x = clamp01(t)
  const inv = 1 - x
  return 1 - inv * inv * inv * inv
}

/** Linear, mostly for tests and as an explicit "no easing" choice. */
export function linear (t: number): number {
  return clamp01(t)
}

export type Easing = (t: number) => number

/** `a + (b - a) * easing(t)`. */
export function tweenValue (a: number, b: number, t: number, easing: Easing = easeOutCubic): number {
  return a + (b - a) * easing(t)
}

/**
 * True when the platform asks for no non-essential motion. SSR/no-`matchMedia`
 * environments (Node, old browsers) resolve to `false` (motion allowed) rather
 * than throwing — reduced motion is an explicit opt-in signal, not a default.
 */
export function prefersReducedMotion (win: Pick<Window, 'matchMedia'> | undefined | null = typeof window === 'undefined' ? null : window): boolean {
  try {
    return win?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  } catch {
    return false
  }
}

export interface TweenClock {
  now: () => number
  /** requestAnimationFrame-shaped: invoked with a timestamp, returns a cancellable handle. */
  raf: (cb: (t: number) => void) => number
  cancel: (handle: number) => void
}

const realClock: TweenClock = {
  now: () => Date.now(),
  raf: cb => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(cb) : (setTimeout(() => { cb(Date.now()) }, 16) as unknown as number)),
  cancel: handle => { if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle); else clearTimeout(handle) }
}

export interface RunTweenOptions {
  /** ms. */
  duration: number
  easing?: Easing
  /** Called every frame with progress in [0, 1] (already eased). */
  onFrame: (easedT: number, rawT: number) => void
  /** Called once after the last frame (t === 1), even if `stop()` is never called by the caller. */
  onDone?: () => void
  clock?: TweenClock
}

export interface RunningTween {
  stop: () => void
}

/**
 * Runs one rAF-driven tween from t=0 to t=1 over `duration` ms, calling
 * `onFrame` every frame with the eased progress. `duration <= 0` (including
 * reduced-motion callers, which should pass 0) resolves in one synchronous
 * frame at t=1 — every caller behaves correctly with motion off without a
 * separate code path.
 */
export function runTween (options: RunTweenOptions): RunningTween {
  const clock = options.clock ?? realClock
  const easing = options.easing ?? easeOutCubic
  const duration = Math.max(0, options.duration)
  const start = clock.now()
  let handle: number | null = null
  let done = false

  const finish = (): void => {
    if (done) return
    done = true
    options.onFrame(easing(1), 1)
    options.onDone?.()
  }

  if (duration === 0) {
    finish()
    return { stop: () => {} }
  }

  const step = (): void => {
    if (done) return
    const elapsed = clock.now() - start
    const rawT = clamp01(elapsed / duration)
    if (rawT >= 1) {
      finish()
      return
    }
    options.onFrame(easing(rawT), rawT)
    handle = clock.raf(step)
  }
  handle = clock.raf(step)

  return {
    stop: () => {
      done = true
      if (handle !== null) clock.cancel(handle)
    }
  }
}
