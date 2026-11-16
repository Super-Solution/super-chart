// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import type { EngineFrame } from '@supersolutions/super-chart-core'
import { MAGNET_REACH, snapToBar } from './magnet'

/** One pixel per second on x and one pixel per price unit (inverted) on y: enough to test distances exactly. */
function frameOf (bars: ReadonlyArray<{ timestamp: number, open: number, high: number, low: number, close: number }>): EngineFrame {
  return {
    drawingContext: { bars },
    project: (timestamp: number, price: number) => ({ x: timestamp, y: 200 - price })
  } as unknown as EngineFrame
}
const bars = [
  { timestamp: 0, open: 100, high: 110, low: 90, close: 105 },
  { timestamp: 20, open: 105, high: 120, low: 100, close: 115 },
  { timestamp: 40, open: 115, high: 118, low: 95, close: 96 }
]

describe('snapToBar', () => {
  it('snaps to the nearest open, high, low or close of the bar beside the pointer', () => {
    const frame = frameOf(bars)
    // Pointer at x 19, y 82 is 3 px from bar 1's high (price 120 projects to y 80): the high wins.
    expect(snapToBar(frame, { x: 19, y: 82 }, { timestamp: 19, price: 118 })).toEqual({ timestamp: 20, price: 120 })
    // Pointer near bar 0's low.
    expect(snapToBar(frame, { x: 1, y: 108 }, { timestamp: 1, price: 92 })).toEqual({ timestamp: 0, price: 90 })
  })

  it('leaves the point alone when no corner is within reach', () => {
    const frame = frameOf(bars)
    const anchor = { timestamp: 30, price: 150 } // 70 px above any bar
    expect(snapToBar(frame, { x: 30, y: 50 }, anchor)).toBe(anchor)
    expect(MAGNET_REACH).toBe(24)
  })

  it('never reaches across more than one bar either side, and copes with no data', () => {
    expect(snapToBar(frameOf([]), { x: 5, y: 5 }, { timestamp: 5, price: 1 })).toEqual({ timestamp: 5, price: 1 })
    const frame = frameOf(bars)
    // Beyond the last bar: only the last bar's corners are candidates.
    expect(snapToBar(frame, { x: 60, y: 104 }, { timestamp: 60, price: 96 }, 30)).toEqual({ timestamp: 40, price: 96 })
  })
})
