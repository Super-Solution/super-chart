import { describe, expect, it } from 'vitest'
import { firstBarFrom, isWorkspaceRange, rangeStart } from './ranges'

const day = 86_400_000
const at = (iso: string): number => Date.parse(iso)

describe('workspace ranges', () => {
  it('counts months in calendar terms, clamping to the shorter month', () => {
    expect(rangeStart('1M', at('2026-03-31T00:00:00Z'))).toBe(at('2026-02-28T00:00:00Z'))
    expect(rangeStart('1M', at('2026-03-15T09:30:00Z'))).toBe(at('2026-02-15T09:30:00Z'))
    expect(rangeStart('3M', at('2026-11-27T00:00:00Z'))).toBe(at('2026-08-27T00:00:00Z'))
    expect(rangeStart('1Y', at('2024-02-29T00:00:00Z'))).toBe(at('2023-02-28T00:00:00Z'))
    expect(rangeStart('5Y', at('2026-11-27T00:00:00Z'))).toBe(at('2021-11-27T00:00:00Z'))
  })

  it('crosses a year boundary for months and anchors YTD on 1 January', () => {
    expect(rangeStart('6M', at('2026-02-10T00:00:00Z'))).toBe(at('2025-08-10T00:00:00Z'))
    expect(rangeStart('YTD', at('2026-11-27T12:00:00Z'))).toBe(at('2026-01-01T00:00:00Z'))
  })

  it('uses plain days for 1D and 5D, and no start for all', () => {
    const last = at('2026-11-27T00:00:00Z')
    expect(rangeStart('1D', last)).toBe(last - day)
    expect(rangeStart('5D', last)).toBe(last - 5 * day)
    expect(rangeStart('all', last)).toBeNull()
    expect(rangeStart('1M', Number.NaN)).toBeNull()
  })

  it('finds the first bar at or after a start', () => {
    const bars = [10, 20, 30, 40].map(timestamp => ({ timestamp }))
    expect(firstBarFrom(bars, 5)).toBe(0)
    expect(firstBarFrom(bars, 20)).toBe(1)
    expect(firstBarFrom(bars, 21)).toBe(2)
    expect(firstBarFrom(bars, 41)).toBe(4)
  })

  it('recognises range names', () => {
    expect(isWorkspaceRange('YTD')).toBe(true)
    expect(isWorkspaceRange('2Y')).toBe(false)
    expect(isWorkspaceRange(5)).toBe(false)
  })
})
