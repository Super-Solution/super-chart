import { describe, expect, it } from 'vitest'

import { barIndexOf, timestampToBarIndex } from './barIndexOf'
import { klinechartsTimestampToDataIndex } from '../drawing-editor/fakeChart'

const BAR_MS = 60_000
const data = Array.from({ length: 20 }, (_, i) => ({ timestamp: i * BAR_MS }))

describe('timestampToBarIndex', () => {
  it('agrees with klinecharts\' own port (fakeChart.ts) for every bar, exactly', () => {
    for (let i = 0; i < data.length; i++) {
      expect(timestampToBarIndex(data, data[i].timestamp)).toBe(klinechartsTimestampToDataIndex(data.map(d => d.timestamp), data[i].timestamp))
    }
  })

  it('finds an exact match at the first, middle and last bar', () => {
    expect(timestampToBarIndex(data, 0)).toBe(0)
    expect(timestampToBarIndex(data, 10 * BAR_MS)).toBe(10)
    expect(timestampToBarIndex(data, 19 * BAR_MS)).toBe(19)
  })

  it('finds the nearest bar for an off-grid timestamp inside the range', () => {
    expect(timestampToBarIndex(data, 5 * BAR_MS + 100)).toBe(5)
  })

  it('degrades the way klinecharts itself does outside the loaded range', () => {
    // klinecharts' own algorithm answers length-2 for anything past the last bar.
    expect(timestampToBarIndex(data, 100 * BAR_MS)).toBe(klinechartsTimestampToDataIndex(data.map(d => d.timestamp), 100 * BAR_MS))
    expect(timestampToBarIndex(data, -100 * BAR_MS)).toBe(klinechartsTimestampToDataIndex(data.map(d => d.timestamp), -100 * BAR_MS))
  })

  it('returns 0 for an empty list', () => {
    expect(timestampToBarIndex([], 123)).toBe(0)
  })
})

describe('barIndexOf', () => {
  it('prefers the timestamp (this is what stays correct after loadMore prepends bars)', () => {
    // A point created when bar 5 was dataIndex 5; after 10 older bars were
    // prepended, dataIndex 5 is now a different bar, but the timestamp still
    // finds the bar it was actually drawn on.
    const shifted = Array.from({ length: 30 }, (_, i) => ({ timestamp: (i - 10) * BAR_MS }))
    expect(barIndexOf({ dataIndex: 5, timestamp: 5 * BAR_MS }, shifted)).toBe(15)
  })

  it('falls back to dataIndex when there is no timestamp (a future point)', () => {
    expect(barIndexOf({ dataIndex: 25 }, data)).toBe(25)
  })

  it('rounds a fractional dataIndex', () => {
    expect(barIndexOf({ dataIndex: 4.9 }, data)).toBe(5)
  })

  it('returns null with neither a timestamp nor a dataIndex, or non-finite values', () => {
    expect(barIndexOf({}, data)).toBeNull()
    expect(barIndexOf({ timestamp: NaN }, data)).toBeNull()
    expect(barIndexOf({ dataIndex: Infinity }, data)).toBeNull()
  })

  it('uses dataIndex when the data list is empty (nothing to search)', () => {
    expect(barIndexOf({ timestamp: 5, dataIndex: 3 }, [])).toBe(3)
    expect(barIndexOf({ timestamp: 5 }, [])).toBeNull()
  })
})
