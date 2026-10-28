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
import { attachWheelZoom, normalizeWheel, stepToward, wheelZoomFactor, type MotionWheelChart } from './wheelZoomMotion'
import type { TweenClock } from './easing'

describe('normalizeWheel', () => {
  it('line and page mode are notched wheels; three lines are one 100px notch', () => {
    expect(normalizeWheel({ deltaY: -3, deltaMode: 1 })).toEqual({ px: -100, kind: 'notch' })
    expect(normalizeWheel({ deltaY: 1, deltaMode: 2 }).kind).toBe('notch')
  })

  it('pixel mode: 50px or more is a mouse notch, less is a trackpad, ctrl with a small delta is a pinch', () => {
    expect(normalizeWheel({ deltaY: 100, deltaMode: 0 })).toEqual({ px: 100, kind: 'notch' })
    expect(normalizeWheel({ deltaY: -120, deltaMode: 0 }).kind).toBe('notch')
    expect(normalizeWheel({ deltaY: -4, deltaMode: 0 })).toEqual({ px: -4, kind: 'smooth' })
    expect(normalizeWheel({ deltaY: -4, deltaMode: 0, ctrlKey: true })).toEqual({ px: -4, kind: 'pinch' })
    expect(normalizeWheel({ deltaY: -100, deltaMode: 0, ctrlKey: true }).kind).toBe('notch') // Ctrl + a real mouse wheel
  })

  it('a non-finite delta is 0, never NaN', () => {
    expect(normalizeWheel({ deltaY: NaN }).px).toBe(0)
  })
})

describe('wheelZoomFactor', () => {
  it('one 100px notch is the 10% step the chart has always used, in both directions', () => {
    expect(wheelZoomFactor({ px: -100, kind: 'notch' })).toBeCloseTo(1.1, 10)
    expect(wheelZoomFactor({ px: 100, kind: 'notch' })).toBeCloseTo(1 / 1.1, 10)
  })

  it('a trackpad zooms in proportion to the distance: 40 x 4px = 1.6 notches, however it is split', () => {
    let f = 1
    for (let i = 0; i < 40; i++) f *= wheelZoomFactor({ px: -4, kind: 'smooth' })
    expect(f).toBeCloseTo(Math.pow(1.1, 1.6), 10)
    expect(wheelZoomFactor({ px: -160, kind: 'smooth' })).toBeCloseTo(f, 10)
  })

  it('a pinch follows the fingers: deltaY = -100 ln(scale) zooms by exactly scale', () => {
    expect(wheelZoomFactor({ px: -100 * Math.log(1.5), kind: 'pinch' })).toBeCloseTo(1.5, 10)
  })
})

describe('stepToward', () => {
  it('approaches the target monotonically and lands on it exactly', () => {
    let v = 8
    const seen: number[] = []
    for (let i = 0; i < 40 && v !== 12; i++) {
      v = stepToward(v, 12, 16, 60)
      seen.push(v)
    }
    expect(v).toBe(12)
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1])
    expect(seen.length).toBeGreaterThan(3) // eased, not one jump
  })

  it('is time-based: two 8ms steps equal one 16ms step', () => {
    expect(stepToward(stepToward(8, 12, 8, 60), 12, 8, 60)).toBeCloseTo(stepToward(8, 12, 16, 60), 10)
  })

  it('tau 0 or unusable input goes straight to the target', () => {
    expect(stepToward(8, 12, 16, 0)).toBe(12)
    expect(stepToward(NaN, 12, 16, 60)).toBe(12)
  })
})

function fakeClock (): TweenClock & { tick: (ms: number) => void, pending: () => number } {
  let now = 0
  const pending = new Map<number, (t: number) => void>()
  let nextHandle = 1
  return {
    now: () => now,
    raf: cb => { const h = nextHandle++; pending.set(h, cb); return h },
    cancel: h => { pending.delete(h) },
    pending: () => pending.size,
    tick: ms => {
      now += ms
      const due = [...pending.entries()]
      pending.clear()
      for (const [, cb] of due) cb(now)
    }
  }
}

function fakeChart (barSpace = 8): MotionWheelChart & { barSpace: number, zooms: Array<[number, number]>, enabled: boolean } {
  const chart = {
    barSpace,
    zooms: [] as Array<[number, number]>,
    enabled: true,
    getBarSpace: () => chart.barSpace,
    isZoomEnabled: () => chart.enabled,
    zoomTo: (next: number, x: number) => { chart.zooms.push([next, x]); chart.barSpace = next },
    toPaneX: (clientX: number) => clientX - 100
  }
  return chart
}

// vitest runs in plain Node: `root` is a bare EventTarget (see inertialPan.test.ts).
function fakeRoot (): HTMLElement {
  return new EventTarget() as unknown as HTMLElement
}

function wheel (root: HTMLElement, init: { deltaY: number, deltaX?: number, deltaMode?: number, ctrlKey?: boolean, clientX?: number }): { prevented: boolean, stopped: boolean } {
  const evt = new Event('wheel', { cancelable: true })
  for (const [k, v] of Object.entries({ deltaX: 0, deltaMode: 0, ctrlKey: false, clientX: 400, ...init })) {
    Object.defineProperty(evt, k, { value: v })
  }
  let stopped = false
  const stop = evt.stopPropagation.bind(evt)
  Object.defineProperty(evt, 'stopPropagation', { value: () => { stopped = true; stop() } })
  root.dispatchEvent(evt)
  return { prevented: evt.defaultPrevented, stopped }
}

describe('attachWheelZoom', () => {
  it('keeps the SC-097 gate: horizontal wheel passes through untouched; mode "none" releases vertical wheel to the page', () => {
    const root = fakeRoot()
    const chart = fakeChart()
    const clock = fakeClock()
    let mode: 'zoom' | 'none' = 'zoom'
    attachWheelZoom(root, chart, () => mode, { clock })
    expect(wheel(root, { deltaY: 1, deltaX: 40 })).toEqual({ prevented: false, stopped: false })
    mode = 'none'
    expect(wheel(root, { deltaY: -100 })).toEqual({ prevented: false, stopped: true })
    clock.tick(16)
    expect(chart.zooms).toEqual([])
  })

  it('a mouse notch eases over several frames to exactly 1.1x, anchored at the cursor', () => {
    const root = fakeRoot()
    const chart = fakeChart(8)
    const clock = fakeClock()
    attachWheelZoom(root, chart, () => 'zoom', { clock })
    expect(wheel(root, { deltaY: -100, clientX: 460 }).prevented).toBe(true)
    for (let i = 0; i < 60 && clock.pending() > 0; i++) clock.tick(16)
    expect(chart.zooms.length).toBeGreaterThan(3)
    expect(chart.barSpace).toBeCloseTo(8.8, 10)
    expect(chart.zooms.every(([, x]) => x === 360)).toBe(true)
  })

  it('a first frame that reads 0 ms since the wheel (coarsened timers) still zooms, and the ease runs to the end', () => {
    const root = fakeRoot()
    const chart = fakeChart(8)
    const clock = fakeClock()
    attachWheelZoom(root, chart, () => 'zoom', { clock })
    wheel(root, { deltaY: -100 })
    clock.tick(0)
    expect(chart.barSpace).toBeGreaterThan(8)
    for (let i = 0; i < 60 && clock.pending() > 0; i++) clock.tick(16)
    expect(chart.barSpace).toBeCloseTo(8.8, 10)
  })

  it('notches arriving while one is still easing accumulate onto the same target (no restart from a mid-flight value)', () => {
    const root = fakeRoot()
    const chart = fakeChart(8)
    const clock = fakeClock()
    attachWheelZoom(root, chart, () => 'zoom', { clock })
    wheel(root, { deltaY: -100 })
    clock.tick(16)
    wheel(root, { deltaY: -100 })
    clock.tick(16)
    wheel(root, { deltaY: -100 })
    for (let i = 0; i < 60 && clock.pending() > 0; i++) clock.tick(16)
    expect(chart.barSpace).toBeCloseTo(8 * Math.pow(1.1, 3), 10)
  })

  it('a trackpad burst is summed and applied once, in the next frame', () => {
    const root = fakeRoot()
    const chart = fakeChart(8)
    const clock = fakeClock()
    attachWheelZoom(root, chart, () => 'zoom', { clock })
    for (let i = 0; i < 40; i++) wheel(root, { deltaY: -4 })
    expect(chart.zooms).toEqual([]) // nothing inside the input handler
    clock.tick(16)
    expect(chart.zooms.length).toBe(1)
    expect(chart.barSpace).toBeCloseTo(8 * Math.pow(1.1, 1.6), 10)
    expect(clock.pending()).toBe(0)
  })

  it('reduced motion lands a notch in one frame', () => {
    const root = fakeRoot()
    const chart = fakeChart(8)
    const clock = fakeClock()
    attachWheelZoom(root, chart, () => 'zoom', { clock, isReducedMotion: () => true })
    wheel(root, { deltaY: -100 })
    clock.tick(16)
    expect(chart.zooms.length).toBe(1)
    expect(chart.barSpace).toBeCloseTo(8.8, 10)
  })

  it('clamps to [1, 50], and a disabled zoom still keeps the page from scrolling', () => {
    const root = fakeRoot()
    const chart = fakeChart(48)
    const clock = fakeClock()
    attachWheelZoom(root, chart, () => 'zoom', { clock, isReducedMotion: () => true })
    wheel(root, { deltaY: -1000 })
    clock.tick(16)
    expect(chart.barSpace).toBe(50)
    chart.enabled = false
    expect(wheel(root, { deltaY: 100 }).prevented).toBe(true)
    clock.tick(16)
    expect(chart.barSpace).toBe(50)
  })

  it('grabbing the chart (pointerdown) drops a zoom still easing in; onZoom fires per zooming wheel', () => {
    const root = fakeRoot()
    const chart = fakeChart(8)
    const clock = fakeClock()
    let zooms = 0
    const handle = attachWheelZoom(root, chart, () => 'zoom', { clock, onZoom: () => { zooms++ } })
    wheel(root, { deltaY: -100 })
    clock.tick(16)
    const mid = chart.barSpace
    root.dispatchEvent(new Event('pointerdown'))
    clock.tick(16)
    clock.tick(16)
    expect(chart.barSpace).toBe(mid)
    expect(zooms).toBe(1)
    handle.dispose()
    wheel(root, { deltaY: -100 })
    clock.tick(16)
    expect(chart.barSpace).toBe(mid)
  })
})
