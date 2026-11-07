// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import {
  baselineSegments, columnExtents, highLowExtents, hlcAreaPoints, interpolatedClose,
  stepLinePoints, typicalPrice, volumeIntensities, type Bar
} from './geometry'

function bar (open: number, high: number, low: number, close: number, volume = 0): Bar {
  return { open, high, low, close, volume }
}

describe('columnExtents', () => {
  it('the first column runs from its own open to its close', () => {
    const [c0] = columnExtents([bar(10, 12, 9, 11)])
    expect(c0.from).toBe(10)
    expect(c0.to).toBe(11)
    expect(c0.up).toBe(true)
  })

  it('every later column runs from the PREVIOUS bar\'s close, not its own open', () => {
    const bars = [bar(10, 12, 9, 11), bar(50, 52, 49, 9)] // bar 1's own open (50) is far from bar 0's close (11)
    const [, c1] = columnExtents(bars)
    expect(c1.from).toBe(11)
    expect(c1.to).toBe(9)
    expect(c1.up).toBe(false)
  })

  it('one extent per bar', () => {
    const bars = [bar(1, 2, 0.5, 1.5), bar(1.5, 2, 1, 1.8), bar(1.8, 2.1, 1.7, 1.9)]
    expect(columnExtents(bars).map(c => c.index)).toEqual([0, 1, 2])
  })
})

describe('highLowExtents', () => {
  it('reports each bar\'s own high/low and its up/down direction', () => {
    const bars = [bar(10, 15, 8, 12), bar(12, 13, 9, 9)]
    const [e0, e1] = highLowExtents(bars)
    expect(e0).toEqual({ index: 0, high: 15, low: 8, up: true })
    expect(e1).toEqual({ index: 1, high: 13, low: 9, up: false })
  })
})

describe('stepLinePoints', () => {
  it('produces 2n-1 points for n bars', () => {
    const bars = [bar(1, 2, 1, 1.5), bar(1.5, 2, 1, 1.8), bar(1.8, 2, 1, 1.6)]
    expect(stepLinePoints(bars).length).toBe(2 * bars.length - 1)
  })

  it('is a flat-then-jump staircase: the point right before a bar boundary holds the PREVIOUS close, at the NEW bar\'s index', () => {
    const bars = [bar(1, 2, 1, 1.5), bar(1.5, 2.2, 1, 1.9)]
    const points = stepLinePoints(bars)
    // [ {0,1.5}, {1,1.5} (flat carry-over of bar 0's close, at bar 1's x), {1,1.9} (the jump to bar 1's own close) ]
    expect(points).toEqual([
      { index: 0, value: 1.5 },
      { index: 1, value: 1.5 },
      { index: 1, value: 1.9 }
    ])
  })

  it('a single bar is just its own close', () => {
    expect(stepLinePoints([bar(1, 2, 1, 1.5)])).toEqual([{ index: 0, value: 1.5 }])
  })

  it('empty input -> empty output', () => {
    expect(stepLinePoints([])).toEqual([])
  })
})

describe('typicalPrice / hlcAreaPoints', () => {
  it('typicalPrice is (H+L+C)/3', () => {
    expect(typicalPrice(bar(10, 12, 9, 11))).toBeCloseTo((12 + 9 + 11) / 3, 10)
  })

  it('hlcAreaPoints maps every bar to {index, typicalPrice}', () => {
    const bars = [bar(10, 12, 9, 11), bar(11, 14, 10, 13)]
    expect(hlcAreaPoints(bars)).toEqual([
      { index: 0, value: typicalPrice(bars[0]) },
      { index: 1, value: typicalPrice(bars[1]) }
    ])
  })
})

describe('baselineSegments', () => {
  it('empty input -> empty output', () => {
    expect(baselineSegments([], 10)).toEqual([])
  })

  it('all bars on one side is a single segment', () => {
    const bars = [bar(1, 2, 1, 11), bar(11, 12, 10, 12), bar(12, 13, 11, 13)]
    expect(baselineSegments(bars, 10)).toEqual([{ from: 0, to: 2, above: true }])
  })

  it('splits into runs at every above/below flip, adjacent segments sharing the flip index so their fills touch', () => {
    // closes: 11 (above 10), 9 (below), 8 (below), 12 (above)
    const bars = [bar(0, 0, 0, 11), bar(0, 0, 0, 9), bar(0, 0, 0, 8), bar(0, 0, 0, 12)]
    const segs = baselineSegments(bars, 10)
    expect(segs).toEqual([
      { from: 0, to: 0, above: true },
      { from: 0, to: 2, above: false },
      { from: 2, to: 3, above: true }
    ])
  })

  it('a close exactly on the baseline counts as above (>=), matching the up/down convention used elsewhere (candleChange, isHeikinAshiUp)', () => {
    const bars = [bar(0, 0, 0, 10)]
    expect(baselineSegments(bars, 10)).toEqual([{ from: 0, to: 0, above: true }])
  })
})

describe('interpolatedClose', () => {
  it('t=0 is bars[i].close, t=1 is bars[i+1].close', () => {
    const bars = [bar(0, 0, 0, 10), bar(0, 0, 0, 20)]
    expect(interpolatedClose(bars, 0, 0)).toBe(10)
    expect(interpolatedClose(bars, 0, 1)).toBe(20)
    expect(interpolatedClose(bars, 0, 0.5)).toBe(15)
  })

  it('clamps t outside [0, 1]', () => {
    const bars = [bar(0, 0, 0, 10), bar(0, 0, 0, 20)]
    expect(interpolatedClose(bars, 0, -1)).toBe(10)
    expect(interpolatedClose(bars, 0, 2)).toBe(20)
  })

  it('at the last bar (no next), returns that bar\'s own close', () => {
    const bars = [bar(0, 0, 0, 10)]
    expect(interpolatedClose(bars, 0, 0.5)).toBe(10)
  })
})

describe('volumeIntensities', () => {
  it('scales linearly against the max, 1 at the heaviest bar', () => {
    const bars = [bar(0, 0, 0, 0, 10), bar(0, 0, 0, 0, 40), bar(0, 0, 0, 0, 20)]
    expect(volumeIntensities(bars)).toEqual([0.25, 1, 0.5])
  })

  it('all zero volume (no data) -> all 0, not NaN/Infinity', () => {
    const bars = [bar(0, 0, 0, 0, 0), bar(0, 0, 0, 0, 0)]
    expect(volumeIntensities(bars)).toEqual([0, 0])
  })

  it('missing volume is treated as 0', () => {
    expect(volumeIntensities([{ open: 0, high: 0, low: 0, close: 0 }, bar(0, 0, 0, 0, 5)])).toEqual([0, 1])
  })
})
