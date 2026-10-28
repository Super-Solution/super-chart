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
import {
  attachInertialPan, clampVelocity, flingDistance, flingDuration, runInertialScroll, shouldFling, VelocityTracker,
  type InertiaChart
} from './inertialPan'
import type { TweenClock } from './easing'

describe('VelocityTracker', () => {
  const track = (samples: Array<[number, number]>, capacity?: number): VelocityTracker => {
    const t = new VelocityTracker(capacity)
    for (const [time, x] of samples) t.add(time, x)
    return t
  }

  it('is 0 with fewer than 2 samples', () => {
    expect(track([]).velocity(0)).toBe(0)
    expect(track([[0, 0]]).velocity(0)).toBe(0)
  })

  it('a steady drag reads its exact speed (least squares over the horizon)', () => {
    const samples: Array<[number, number]> = []
    for (let t = 0; t <= 96; t += 8) samples.push([t, 1000 + 2 * t]) // 2 px/ms from an arbitrary origin
    expect(track(samples).velocity(96)).toBeCloseTo(2, 6)
  })

  it('only the last horizonMs count: a fast start followed by a slow finish reads slow', () => {
    const samples: Array<[number, number]> = []
    for (let t = 0; t <= 200; t += 10) samples.push([t, t < 100 ? 5 * t : 500 + 0.5 * (t - 100)])
    expect(track(samples).velocity(200, 80)).toBeCloseTo(0.5, 6)
  })

  it('released after holding still longer than stoppedMs: 0 (no fling from stale speed)', () => {
    const samples: Array<[number, number]> = [[0, 0], [8, 16], [16, 32], [24, 48], [32, 64]]
    const t = track(samples)
    t.add(90, 64) // the release, 58ms after the last movement
    expect(t.velocity(90, 80, 40)).toBe(0)
    const quick = track(samples)
    quick.add(40, 64) // released 8ms after the last movement: still a flick
    expect(quick.velocity(40, 80, 40)).toBeGreaterThan(1)
  })

  it('a position that never changed (the drag moved a drawing, not the chart) is 0', () => {
    expect(track([[0, 50], [8, 50], [16, 50], [24, 50]]).velocity(24)).toBe(0)
  })

  it('keeps a fixed-size ring: many samples never grow it and the newest still decide', () => {
    const t = new VelocityTracker(8)
    for (let i = 0; i < 1000; i++) t.add(i * 8, i * 8 * 3)
    expect(t.size).toBe(8)
    expect(t.velocity(999 * 8)).toBeCloseTo(3, 6)
  })

  it('ignores non-finite samples', () => {
    const t = track([[0, 0], [8, 16]])
    t.add(NaN, 5)
    t.add(16, Infinity)
    expect(t.size).toBe(2)
    expect(t.velocity(8)).toBeCloseTo(2, 6)
  })
})

describe('clampVelocity / shouldFling', () => {
  it('clamps to the configured max, preserving sign', () => {
    expect(clampVelocity(10, { maxVelocity: 3.5 })).toBe(3.5)
    expect(clampVelocity(-10, { maxVelocity: 3.5 })).toBe(-3.5)
    expect(clampVelocity(1, { maxVelocity: 3.5 })).toBe(1)
  })

  it('rejects a slow release (an intentional drag-and-stop) below minVelocity', () => {
    expect(shouldFling(0.01, { minVelocity: 0.08 })).toBe(false)
    expect(shouldFling(0.1, { minVelocity: 0.08 })).toBe(true)
    expect(shouldFling(-0.1, { minVelocity: 0.08 })).toBe(true)
  })
})

describe('flingDuration / flingDistance', () => {
  it('is 0 for a velocity of 0', () => {
    expect(flingDuration(0)).toBe(0)
    expect(flingDistance(0)).toBe(0)
  })

  it('a faster release runs longer and travels further, same direction as v0', () => {
    const slow = { duration: flingDuration(0.2), distance: flingDistance(0.2) }
    const fast = { duration: flingDuration(1.5), distance: flingDistance(1.5) }
    expect(fast.duration).toBeGreaterThan(slow.duration)
    expect(fast.distance).toBeGreaterThan(slow.distance)
    expect(flingDistance(-1.5)).toBeLessThan(0)
  })

  it('never exceeds maxDurationMs', () => {
    expect(flingDuration(100, { maxDurationMs: 1600 })).toBeLessThanOrEqual(1600)
  })
})

/** Same fake clock shape as easing.test.ts, local so this file has no cross-file test coupling. */
function fakeClock (): TweenClock & { tick: (ms: number) => void } {
  let now = 0
  const pending = new Map<number, (t: number) => void>()
  let nextHandle = 1
  return {
    now: () => now,
    raf: cb => { const h = nextHandle++; pending.set(h, cb); return h },
    cancel: h => { pending.delete(h) },
    tick: ms => {
      now += ms
      const due = [...pending.entries()]
      pending.clear()
      for (const [, cb] of due) cb(now)
    }
  }
}

describe('runInertialScroll', () => {
  it('does not scroll at all for a sub-threshold velocity', () => {
    const calls: number[] = []
    const chart: InertiaChart = { scrollByDistance: d => calls.push(d) }
    const clock = fakeClock()
    runInertialScroll(chart, 0.01, { minVelocity: 0.08 }, clock)
    clock.tick(1000)
    expect(calls.length).toBe(0)
  })

  it('scrolls the chart in decaying increments, same direction as the release velocity, then stops', () => {
    const calls: number[] = []
    const chart: InertiaChart = { scrollByDistance: d => calls.push(d) }
    const clock = fakeClock()
    const opts = { decayPerMs: 0.99, stopAtFraction: 0.05, maxDurationMs: 1000 }
    runInertialScroll(chart, 1.0, opts, clock)
    for (let i = 0; i < 40; i++) clock.tick(10)
    expect(calls.length).toBeGreaterThan(3)
    expect(calls.every(d => d > 0)).toBe(true) // positive v0 -> every increment scrolls the same way
    // Decelerating: the first increment is bigger than the last non-zero one.
    const nonZero = calls.filter(d => d !== 0)
    expect(nonZero[0]).toBeGreaterThan(nonZero[nonZero.length - 1])
  })

  it('a negative release velocity scrolls the other way', () => {
    const calls: number[] = []
    const chart: InertiaChart = { scrollByDistance: d => calls.push(d) }
    const clock = fakeClock()
    runInertialScroll(chart, -1.0, { decayPerMs: 0.99 }, clock)
    clock.tick(10); clock.tick(10)
    expect(calls.every(d => d <= 0)).toBe(true)
  })

  it('stop() halts further scrollByDistance calls', () => {
    const calls: number[] = []
    const chart: InertiaChart = { scrollByDistance: d => calls.push(d) }
    const clock = fakeClock()
    const stop = runInertialScroll(chart, 1.0, { decayPerMs: 0.99 }, clock)
    clock.tick(10)
    const countAfterOneFrame = calls.length
    stop()
    clock.tick(1000)
    expect(calls.length).toBe(countAfterOneFrame)
  })

  it('stops as soon as the chart stops moving (it reached the oldest or newest bar)', () => {
    const calls: number[] = []
    let pos = 0
    const limit = 30
    const chart: InertiaChart = {
      scrollByDistance: d => { calls.push(d); pos = Math.min(limit, pos + d) },
      getScrollPosition: () => pos
    }
    const clock = fakeClock()
    runInertialScroll(chart, 2, { decayPerMs: 0.998 }, clock)
    for (let i = 0; i < 200; i++) clock.tick(8)
    expect(pos).toBe(limit)
    // Two blocked frames after reaching the limit, then nothing more.
    const firstBlocked = calls.findIndex((_, i) => calls.slice(0, i + 1).reduce((a, b) => a + b, 0) >= limit)
    expect(calls.length).toBeLessThanOrEqual(firstBlocked + 3)
  })

  it('put-back: total distance approximates the closed-form flingDistance (regression guard on the decay formula)', () => {
    const calls: number[] = []
    const chart: InertiaChart = { scrollByDistance: d => calls.push(d) }
    const clock = fakeClock()
    const opts = { decayPerMs: 0.995, stopAtFraction: 0.02, maxDurationMs: 2000 }
    runInertialScroll(chart, 1.2, opts, clock)
    for (let i = 0; i < 200; i++) clock.tick(5)
    const total = calls.reduce((a, b) => a + b, 0)
    expect(total).toBeGreaterThan(0)
    expect(total).toBeCloseTo(flingDistance(1.2, opts), 0)
  })
})

describe('attachInertialPan', () => {
  // vitest here runs in a plain Node environment (no jsdom, see vitest.config.ts),
  // so `root` is a bare EventTarget (Node's built-in Web-standard class) with
  // the same addEventListener/removeEventListener/dispatchEvent contract
  // attachInertialPan actually uses, cast to HTMLElement for the call. With
  // no ownerDocument, moves and the release are heard on `root` too.
  function fakeRoot (): HTMLElement {
    return new EventTarget() as unknown as HTMLElement
  }

  function fire (root: HTMLElement, type: string, x: number, t: number, extra: Record<string, unknown> = {}): void {
    const evt = new Event(type, { bubbles: true, cancelable: true })
    for (const [k, v] of Object.entries({ clientX: x, button: 0, pointerType: 'mouse', timeStamp: t, target: null, ...extra })) {
      Object.defineProperty(evt, k, { value: v })
    }
    root.dispatchEvent(evt)
  }

  /** A chart that pans 1:1 with the pointer unless `consumed` (a drawing took the drag). */
  function fakeChart (): InertiaChart & { calls: number[], pos: number, consumed: boolean, barSpace: number } {
    const chart = {
      calls: [] as number[],
      pos: 0,
      consumed: false,
      barSpace: 8,
      scrollByDistance: (d: number) => { chart.calls.push(d); chart.pos += d },
      getScrollPosition: () => chart.pos,
      getBarSpace: () => chart.barSpace
    }
    return chart
  }

  /** A fast drag: the chart follows each move before the move is sampled (as klinecharts does). */
  function flick (root: HTMLElement, chart: ReturnType<typeof fakeChart>, opts: { stillFor?: number, type?: string } = {}): void {
    fire(root, 'pointerdown', 0, 0, { pointerType: opts.type ?? 'mouse' })
    let x = 0
    for (let t = 8; t <= 48; t += 8) {
      const next = t * 2
      if (!chart.consumed) chart.pos += next - x
      x = next
      fire(root, 'mousemove', x, t)
    }
    fire(root, 'pointerup', x, 48 + (opts.stillFor ?? 0), { pointerType: opts.type ?? 'mouse' })
  }

  it('flings in the direction the chart moved, and a fresh pointerdown or wheel mid-fling stops it', () => {
    const root = fakeRoot()
    const chart = fakeChart()
    const clock = fakeClock()
    const off = attachInertialPan(root, chart, { clock })
    flick(root, chart)
    clock.tick(10)
    expect(chart.calls.length).toBeGreaterThan(0)
    expect(chart.calls.every(d => d > 0)).toBe(true)
    const count = chart.calls.length
    fire(root, 'pointerdown', 0, 60) // grabs the chart mid-fling
    clock.tick(1000)
    expect(chart.calls.length).toBe(count)

    flick(root, chart)
    clock.tick(10)
    const count2 = chart.calls.length
    root.dispatchEvent(new Event('wheel'))
    clock.tick(1000)
    expect(chart.calls.length).toBe(count2)
    off()
  })

  it('no fling when the drag moved a drawing instead of the chart (pointer fast, chart still)', () => {
    const root = fakeRoot()
    const chart = fakeChart()
    chart.consumed = true
    const clock = fakeClock()
    attachInertialPan(root, chart, { clock })
    flick(root, chart)
    clock.tick(1000)
    expect(chart.calls).toEqual([])
  })

  it('no fling when released after holding still, when the bar space changed (an axis zoom-drag), for touch, or off the plot area', () => {
    const clock = fakeClock()
    const held = fakeChart()
    const r1 = fakeRoot()
    attachInertialPan(r1, held, { clock })
    flick(r1, held, { stillFor: 60 })

    const zoomed = fakeChart()
    const r2 = fakeRoot()
    attachInertialPan(r2, zoomed, { clock })
    fire(r2, 'pointerdown', 0, 0)
    zoomed.barSpace = 9
    zoomed.pos += 100
    fire(r2, 'mousemove', 100, 8)
    fire(r2, 'pointerup', 100, 10)

    const touch = fakeChart()
    const r3 = fakeRoot()
    attachInertialPan(r3, touch, { clock })
    flick(r3, touch, { type: 'touch' })

    const axis = fakeChart()
    const r4 = fakeRoot()
    attachInertialPan(r4, axis, { clock, isPanTarget: () => false })
    flick(r4, axis)

    clock.tick(1000)
    expect([held.calls, zoomed.calls, touch.calls, axis.calls]).toEqual([[], [], [], []])
  })

  it('respects isReducedMotion and isSuspended', () => {
    const clock = fakeClock()
    const a = fakeChart()
    const ra = fakeRoot()
    attachInertialPan(ra, a, { isReducedMotion: () => true, clock })
    flick(ra, a)
    const b = fakeChart()
    const rb = fakeRoot()
    attachInertialPan(rb, b, { isSuspended: () => true, clock })
    flick(rb, b)
    clock.tick(1000)
    expect(a.calls).toEqual([])
    expect(b.calls).toEqual([])
  })

  it('without getScrollPosition it falls back to the pointer (legacy), and never flings on a slow drag-and-release', () => {
    const root = fakeRoot()
    const calls: number[] = []
    const chart: InertiaChart = { scrollByDistance: d => calls.push(d) }
    const clock = fakeClock()
    attachInertialPan(root, chart, { inertia: { minVelocity: 0.5 }, clock })
    fire(root, 'pointerdown', 0, 0)
    fire(root, 'pointermove', 5, 30)
    fire(root, 'pointerup', 6, 60)
    clock.tick(1000)
    expect(calls.length).toBe(0)
    fire(root, 'pointerdown', 0, 100)
    fire(root, 'pointermove', 40, 110)
    fire(root, 'pointermove', 80, 120)
    fire(root, 'pointerup', 100, 125)
    clock.tick(16)
    expect(calls.length).toBeGreaterThan(0)
  })
})
