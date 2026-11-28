import { describe, expect, it } from 'vitest'
import { rebaseCompare } from './compare'

const bars = (closes: number[], start = 0): Array<{ timestamp: number, close: number }> => closes.map((close, i) => ({ timestamp: (start + i) * 60_000, close }))

describe('rebaseCompare', () => {
  it('scales the other market so it starts on the main close, keeping its own percentage moves', () => {
    const out = rebaseCompare(bars([100, 110, 121]), bars([2000, 2200, 2420]))
    expect(out.map(v => Math.round(v ?? 0))).toEqual([100, 110, 121])
    const flat = rebaseCompare(bars([100, 100, 100]), bars([10, 20, 5]))
    expect(flat).toEqual([100, 200, 50])
  })
  it('is null before the other market starts and carries a gap forward', () => {
    const out = rebaseCompare(bars([100, 100, 100, 100]), bars([10, 20], 1))
    expect(out).toEqual([null, 100, 200, 200])
  })
  it('is all null with no overlap, no data or a non-positive close', () => {
    expect(rebaseCompare(bars([1, 2]), [])).toEqual([null, null])
    expect(rebaseCompare(bars([1, 2]), bars([5, 6], 10))).toEqual([null, null])
    expect(rebaseCompare(bars([1, 2]), bars([0, -1]))).toEqual([null, null])
  })
})
