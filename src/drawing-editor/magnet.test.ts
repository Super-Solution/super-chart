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

import { describe, expect, it, vi } from 'vitest'

import { magnetSnapPixel, applyMagnetSnap } from './magnet'
import type { OhlcPixel, MagnetChart, MagnetOverlayEvent } from './magnet'

// A normal (non-reversed) axis: price grows upward, so pixel y grows downward
// (smaller y = higher price = the high). high=100px, low=140px.
const NORMAL: OhlcPixel = { open: 120, high: 100, low: 140, close: 110 }

describe('magnetSnapPixel', () => {
  it('normal mode never snaps', () => {
    expect(magnetSnapPixel(100, NORMAL, 'normal')).toBeNull()
    expect(magnetSnapPixel(60, NORMAL, 'normal')).toBeNull()
  })

  it('weak mode: within sensitivity ABOVE the high snaps to the high (the bug this fixes had this direction working)', () => {
    expect(magnetSnapPixel(100 - 4, NORMAL, 'weak_magnet', 8)).toBe(100)
    expect(magnetSnapPixel(100 - 8, NORMAL, 'weak_magnet', 8)).toBe(100)
  })

  it('weak mode: within sensitivity BELOW the low also snaps to the low (this is the sign-bug fix)', () => {
    expect(magnetSnapPixel(140 + 4, NORMAL, 'weak_magnet', 8)).toBe(140)
    expect(magnetSnapPixel(140 + 8, NORMAL, 'weak_magnet', 8)).toBe(140)
  })

  it('weak mode: outside the sensitivity band on either side does not snap', () => {
    expect(magnetSnapPixel(100 - 9, NORMAL, 'weak_magnet', 8)).toBeNull()
    expect(magnetSnapPixel(140 + 9, NORMAL, 'weak_magnet', 8)).toBeNull()
  })

  it('weak mode: inside the candle (between high and low pixels) snaps to the nearest OHLC', () => {
    // open=120 is 20px from high(100) and 20px from low(140); close=110 is
    // nearer: 10px from high, 30px from low. A cursor at 112 is nearest close(110).
    expect(magnetSnapPixel(112, NORMAL, 'weak_magnet')).toBe(110)
    // A cursor at 130 is nearest open(120).
    expect(magnetSnapPixel(130, NORMAL, 'weak_magnet')).toBe(120)
  })

  it('strong mode always snaps to the nearest OHLC, any distance', () => {
    expect(magnetSnapPixel(0, NORMAL, 'strong_magnet')).toBe(100)
    expect(magnetSnapPixel(1000, NORMAL, 'strong_magnet')).toBe(140)
    expect(magnetSnapPixel(112, NORMAL, 'strong_magnet')).toBe(110)
  })

  it('a reversed axis (low pixel value = the high) is symmetric: min/max of the two pixels define the band, not which key is "high"', () => {
    const reversed: OhlcPixel = { open: 120, high: 140, low: 100, close: 130 }
    // "below the low" in price terms is now the LARGER pixel value (140+): still snaps within sensitivity.
    expect(magnetSnapPixel(140 + 5, reversed, 'weak_magnet', 8)).toBe(140)
    expect(magnetSnapPixel(100 - 5, reversed, 'weak_magnet', 8)).toBe(100)
    expect(magnetSnapPixel(140 + 20, reversed, 'weak_magnet', 8)).toBeNull()
  })

  it('a flat bar (all four OHLC at the same pixel) snaps to that one point in both modes', () => {
    const flat: OhlcPixel = { open: 50, high: 50, low: 50, close: 50 }
    expect(magnetSnapPixel(50, flat, 'weak_magnet')).toBe(50)
    expect(magnetSnapPixel(55, flat, 'weak_magnet', 8)).toBe(50)
    expect(magnetSnapPixel(1000, flat, 'strong_magnet')).toBe(50)
  })
})

describe('applyMagnetSnap', () => {
  // Value space: low=90, high=110. Pixel space (inverted, as a real y-axis
  // is): value 110 (high) -> y 0; value 90 (low) -> y 100.
  const VALUE_TO_Y = (v: number): number => 100 - (v - 90) * 5
  const Y_TO_VALUE = (y: number): number => 90 + (100 - y) / 5
  const bar = { open: 100, high: 110, low: 90, close: 105 }

  function makeChart (): MagnetChart {
    return {
      getDataList: () => [bar],
      convertToPixel: (points) => (points as Array<{ value: number }>).map(p => ({ y: VALUE_TO_Y(p.value) })),
      convertFromPixel: (points) => (points as Array<{ x?: number, y?: number }>).map(p => {
        if (typeof p.y === 'number') return { value: Y_TO_VALUE(p.y) }
        // Any x maps to dataIndex 0 (the fixture has one bar).
        return { dataIndex: 0 }
      })
    }
  }

  it('mode normal: never mutates the point', () => {
    const points = [{ value: 999 }]
    const event: MagnetOverlayEvent = { x: 5, y: VALUE_TO_Y(102), overlay: { points, currentStep: 1, mode: 'normal' } }
    applyMagnetSnap(makeChart(), event, 'candle_pane')
    expect(points[0].value).toBe(999)
  })

  it('weak magnet: near the high snaps the in-progress point to the high value', () => {
    const points = [{ value: 999 }]
    const highY = VALUE_TO_Y(110)
    const event: MagnetOverlayEvent = { x: 5, y: highY - 3, overlay: { points, currentStep: 1, mode: 'weak_magnet' } }
    applyMagnetSnap(makeChart(), event, 'candle_pane')
    expect(points[0].value).toBeCloseTo(110, 5)
  })

  it('weak magnet: far from the whole bar does not snap (leaves the cursor value)', () => {
    const points = [{ value: 999 }]
    const event: MagnetOverlayEvent = { x: 5, y: VALUE_TO_Y(110) - 40, overlay: { points, currentStep: 1, mode: 'weak_magnet' } }
    applyMagnetSnap(makeChart(), event, 'candle_pane')
    expect(points[0].value).toBe(999)
  })

  it('a finished overlay (currentStep -1) snaps its LAST point (dragging a placed handle)', () => {
    const points = [{ value: 1 }, { value: 999 }]
    const event: MagnetOverlayEvent = { x: 5, y: VALUE_TO_Y(105) + 1, overlay: { points, currentStep: -1, mode: 'strong_magnet' } }
    applyMagnetSnap(makeChart(), event, 'candle_pane')
    expect(points[0].value).toBe(1)
    expect(points[1].value).toBeCloseTo(105, 5)
  })

  it('re-runs performEventMoveForDrawing with the snapped point so constrained tools stay consistent', () => {
    const points = [{ value: 999 }]
    const performEventMoveForDrawing = vi.fn()
    const event: MagnetOverlayEvent = { x: 5, y: VALUE_TO_Y(110), overlay: { points, currentStep: 1, mode: 'strong_magnet', performEventMoveForDrawing } }
    applyMagnetSnap(makeChart(), event, 'candle_pane')
    expect(performEventMoveForDrawing).toHaveBeenCalledTimes(1)
    const arg = performEventMoveForDrawing.mock.calls[0][0]
    expect(arg.performPointIndex).toBe(0)
    expect(arg.performPoint.value).toBeCloseTo(110, 5)
  })

  it('never throws when x/y are missing or the chart errors', () => {
    const points = [{ value: 1 }]
    const broken: MagnetChart = { getDataList: () => { throw new Error('boom') }, convertToPixel: () => [], convertFromPixel: () => [] }
    expect(() => { applyMagnetSnap(broken, { overlay: { points, currentStep: 1, mode: 'strong_magnet' } }, 'candle_pane') }).not.toThrow()
    expect(points[0].value).toBe(1)
  })
})
