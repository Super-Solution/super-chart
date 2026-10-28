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

import { describe, expect, it } from 'vitest'
import { clamp01, easeOutCubic, easeOutQuart, linear, prefersReducedMotion, runTween, tweenValue, type TweenClock } from './easing'

describe('clamp01', () => {
  it('clamps below 0, above 1, and NaN', () => {
    expect(clamp01(-1)).toBe(0)
    expect(clamp01(2)).toBe(1)
    expect(clamp01(NaN)).toBe(0)
    expect(clamp01(0.5)).toBe(0.5)
  })
})

describe('easeOutCubic / easeOutQuart / linear', () => {
  it('start at 0, end at 1, and are monotonic non-decreasing', () => {
    for (const fn of [easeOutCubic, easeOutQuart, linear]) {
      expect(fn(0)).toBeCloseTo(0, 5)
      expect(fn(1)).toBeCloseTo(1, 5)
      let prev = -Infinity
      for (let i = 0; i <= 10; i++) {
        const v = fn(i / 10)
        expect(v).toBeGreaterThanOrEqual(prev - 1e-9)
        prev = v
      }
    }
  })

  it('easeOutCubic front-loads motion (past the midpoint before t=0.5)', () => {
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5)
  })
})

describe('tweenValue', () => {
  it('interpolates a to b using the given easing, defaulting to easeOutCubic', () => {
    expect(tweenValue(0, 100, 0)).toBe(0)
    expect(tweenValue(0, 100, 1)).toBe(100)
    expect(tweenValue(10, 20, 0.5, linear)).toBe(15)
    expect(tweenValue(0, 10, 0.5)).toBeCloseTo(easeOutCubic(0.5) * 10, 5)
  })

  it('works with a descending range', () => {
    expect(tweenValue(100, 0, 0.5, linear)).toBe(50)
  })
})

describe('prefersReducedMotion', () => {
  it('is false when there is no matchMedia (Node/SSR)', () => {
    expect(prefersReducedMotion(null)).toBe(false)
  })

  it('reflects matchMedia(prefers-reduced-motion: reduce).matches', () => {
    const win = { matchMedia: (q: string) => ({ matches: q.includes('reduce') }) } as unknown as Window
    expect(prefersReducedMotion(win)).toBe(true)
  })

  it('is false, not throwing, if matchMedia itself throws', () => {
    const win = { matchMedia: () => { throw new Error('nope') } } as unknown as Window
    expect(prefersReducedMotion(win)).toBe(false)
  })
})

/** A deterministic fake clock: `raf` schedules callbacks that `tick(ms)` executes in order once `now()` has advanced past their frame. */
function fakeClock (): TweenClock & { tick: (ms: number) => void, frameCount: () => number } {
  let now = 0
  let frames = 0
  const pending = new Map<number, (t: number) => void>()
  let nextHandle = 1
  return {
    now: () => now,
    raf: cb => {
      const handle = nextHandle++
      pending.set(handle, cb)
      return handle
    },
    cancel: handle => { pending.delete(handle) },
    frameCount: () => frames,
    tick: ms => {
      now += ms
      // Drain whatever is currently pending, one pass per tick (mirrors one browser frame).
      const due = [...pending.entries()]
      pending.clear()
      for (const [, cb] of due) {
        frames++
        cb(now)
      }
    }
  }
}

describe('runTween', () => {
  it('duration 0 resolves synchronously at t=1, one frame, calls onDone', () => {
    const frames: number[] = []
    let done = false
    runTween({ duration: 0, onFrame: t => frames.push(t), onDone: () => { done = true } })
    expect(frames).toEqual([1])
    expect(done).toBe(true)
  })

  it('runs multiple eased frames then finishes exactly at t=1', () => {
    const clock = fakeClock()
    const frames: number[] = []
    let done = false
    runTween({ duration: 100, easing: linear, onFrame: t => frames.push(t), onDone: () => { done = true }, clock })
    expect(done).toBe(false)
    clock.tick(30) // t=0.3
    clock.tick(30) // t=0.6
    clock.tick(30) // t=0.9
    expect(done).toBe(false)
    expect(frames.length).toBe(3)
    expect(frames[0]).toBeCloseTo(0.3, 5)
    clock.tick(20) // elapsed 110 >= 100: finishes
    expect(done).toBe(true)
    expect(frames[frames.length - 1]).toBe(1)
  })

  it('stop() prevents further frames and onDone', () => {
    const clock = fakeClock()
    const frames: number[] = []
    let done = false
    const tween = runTween({ duration: 100, easing: linear, onFrame: t => frames.push(t), onDone: () => { done = true }, clock })
    clock.tick(30)
    tween.stop()
    clock.tick(1000)
    expect(done).toBe(false)
    expect(frames.length).toBe(1)
  })

  it('put-back: without clamping rawT, a slow tick could overshoot past 1 and skip onDone (regression guard)', () => {
    const clock = fakeClock()
    let done = false
    runTween({ duration: 50, easing: linear, onFrame: () => {}, onDone: () => { done = true }, clock })
    clock.tick(10_000) // one huge tick, as if the tab was backgrounded
    expect(done).toBe(true)
  })
})
