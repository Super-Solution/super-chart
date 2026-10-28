import { describe, it, expect } from 'vitest'

import { barIndexAt, barInterval, fallbackValueShift, shiftPoints, CloneShift } from './clone'
import { klinechartsTimestampToDataIndex } from './fakeChart'

const MIN = 60_000
/** 300 one-minute bars. */
const TIMELINE = Array.from({ length: 300 }, (_, i) => i * MIN)
const LAST = TIMELINE.length - 1

const shift = (over: Partial<CloneShift> = {}): CloneShift => ({ bars: 3, timeline: TIMELINE, value: 0, ...over })

/** Where klinecharts draws a point: its timestamp (nearest-bar search) wins over its dataIndex. */
const drawnAt = (p: { dataIndex?: number, timestamp?: number }, timeline: readonly number[] = TIMELINE): number | undefined =>
  p.timestamp !== undefined ? klinechartsTimestampToDataIndex(timeline, p.timestamp) : p.dataIndex

describe('barInterval', () => {
  it('returns the median spacing of recent bars', () => {
    const ts = [0, 1, 2, 3, 4, 10, 11, 12].map(i => i * MIN) // one gap
    expect(barInterval(ts)).toBe(MIN)
  })

  it('returns null with fewer than two usable bars', () => {
    expect(barInterval([])).toBeNull()
    expect(barInterval([5])).toBeNull()
    expect(barInterval([5, 5])).toBeNull()
  })
})

describe('barIndexAt', () => {
  it('finds the bar with that timestamp, or the last bar before it', () => {
    expect(barIndexAt(TIMELINE, 0, MIN)).toBe(0)
    expect(barIndexAt(TIMELINE, 120 * MIN, MIN)).toBe(120)
    expect(barIndexAt(TIMELINE, LAST * MIN, MIN)).toBe(LAST)
    expect(barIndexAt(TIMELINE, 120 * MIN + 30_000, MIN)).toBe(120)
  })

  it('extrapolates outside the loaded bars with the interval, or gives up without one', () => {
    expect(barIndexAt(TIMELINE, (LAST + 2) * MIN, MIN)).toBe(LAST + 2)
    expect(barIndexAt(TIMELINE, -2 * MIN, MIN)).toBe(-2)
    expect(barIndexAt(TIMELINE, (LAST + 2) * MIN, null)).toBeNull()
    expect(barIndexAt([], 0, MIN)).toBeNull()
  })
})

describe('fallbackValueShift', () => {
  it('is a 1% step down, or 0 without a usable value', () => {
    expect(fallbackValueShift(200)).toBe(-2)
    expect(fallbackValueShift(-300)).toBe(-3)
    expect(fallbackValueShift(0)).toBe(0)
    expect(fallbackValueShift(undefined)).toBe(0)
  })
})

describe('shiftPoints: time', () => {
  it('moves a point to the bar `bars` later, taking that bar\'s own timestamp', () => {
    const out = shiftPoints([{ dataIndex: 100, timestamp: 100 * MIN, value: 5 }], shift())
    expect(out).toEqual([{ dataIndex: 103, timestamp: 103 * MIN, value: 5 }])
  })

  it('counts bars, not milliseconds, across a gap in the data (weekend)', () => {
    const timeline = [0, 1, 2, 3, 10, 11, 12].map(i => i * MIN)
    const out = shiftPoints([{ dataIndex: 2, timestamp: 2 * MIN }], shift({ timeline }))
    expect(out).toEqual([{ dataIndex: 5, timestamp: 11 * MIN }])
  })

  it('gives a point that lands past the last bar a bare dataIndex, so klinecharts does not pull it back', () => {
    // A segment from bar L-50 to the latest candle (L-1).
    const original = [
      { dataIndex: LAST - 49, timestamp: (LAST - 49) * MIN, value: 1 },
      { dataIndex: LAST, timestamp: LAST * MIN, value: 2 }
    ]
    const copy = shiftPoints(original, shift())
    expect(copy[1]).toEqual({ dataIndex: LAST + 3, value: 2 })
    // Drawn exactly 3 bars right of the original, point for point: same slope.
    // (Pushing the timestamp 3 bars on would be drawn at L-2, LEFT of the original.)
    copy.forEach((p, i) => { expect(drawnAt(p)).toBe((drawnAt(original[i]) as number) + 3) })
  })

  it('keeps a rect on the last bars as wide as the original', () => {
    const original = [{ dataIndex: LAST - 2, timestamp: (LAST - 2) * MIN }, { dataIndex: LAST, timestamp: LAST * MIN }]
    const copy = shiftPoints(original, shift())
    expect((drawnAt(copy[1]) as number) - (drawnAt(copy[0]) as number)).toBe(2)
  })

  it('reads the bar from the timestamp when the stored dataIndex is stale (older bars were prepended)', () => {
    // Drawn at bar 20 before 100 older bars were loaded; klinecharts still draws it from its timestamp.
    const out = shiftPoints([{ dataIndex: 20, timestamp: 120 * MIN }], shift())
    expect(out).toEqual([{ dataIndex: 123, timestamp: 123 * MIN }])
  })

  it('shifts a future point (dataIndex only) further into the future', () => {
    expect(shiftPoints([{ dataIndex: LAST + 5 }], shift())).toEqual([{ dataIndex: LAST + 8 }])
  })

  it('uses the dataIndex when there is no data, and keeps a timestamp-only point where it is', () => {
    expect(shiftPoints([{ dataIndex: 10, timestamp: 1000, value: 50 }], shift({ timeline: [] }))).toEqual([{ dataIndex: 13, value: 50 }])
    expect(shiftPoints([{ timestamp: 1000, value: 1 }], shift({ timeline: [] }))).toEqual([{ timestamp: 1000, value: 1 }])
  })
})

describe('shiftPoints: value', () => {
  it('takes each point\'s converted value (measured at that point)', () => {
    const out = shiftPoints([{ dataIndex: 1, value: 4000 }, { dataIndex: 2, value: 90_000 }], shift({ values: [3900, 85_000], value: -10_600 }))
    expect(out.map(p => p.value)).toEqual([3900, 85_000])
  })

  it('lets a converted value cross zero (a linear oscillator pane)', () => {
    expect(shiftPoints([{ dataIndex: 1, value: 0.2 }], shift({ values: [-0.3] }))[0].value).toBe(-0.3)
  })

  it('falls back to the delta for points that could not be converted', () => {
    const out = shiftPoints([{ dataIndex: 1, value: 100 }, { dataIndex: 2, value: 50 }], shift({ values: [95, undefined], value: -5 }))
    expect(out.map(p => p.value)).toEqual([95, 45])
  })

  it('never lets the fallback delta flip a value\'s sign', () => {
    const out = shiftPoints([{ dataIndex: 1, value: 4000 }, { dataIndex: 2, value: 30 }], shift({ value: -40 }))
    expect(out[0].value).toBe(3960)
    expect(out[1].value).toBeGreaterThan(0)
    expect(out[1].value).toBeLessThan(30)
  })

  it('does not mutate the input', () => {
    const points = [{ dataIndex: 1, value: 1 }]
    shiftPoints(points, shift({ value: 1 }))
    expect(points).toEqual([{ dataIndex: 1, value: 1 }])
  })
})
