import { afterEach, describe, expect, it, vi } from 'vitest'

import { addPeriods, requestRange } from './requestRange'

const H = 3_600_000
const D = 24 * H
const utc = (y: number, m: number, d = 1, h = 0): number => Date.UTC(y, m - 1, d, h)
const iso = (ts: number): string => new Date(ts).toISOString()

afterEach(() => { vi.restoreAllMocks() })

describe('requestRange', () => {
  const to = utc(2026, 9, 26, 7) + 1234 // unaligned "now": to is passed through

  it.each([
    ['second', 1, 500, to - 500 * 1000],
    ['minute', 1, 500, to - 500 * 60_000],
    ['minute', 15, 500, to - 500 * 15 * 60_000],
    ['hour', 4, 500, to - 500 * 4 * H],
    ['day', 1, 500, to - 500 * D],
    ['week', 1, 500, to - 500 * 7 * D],
    ['week', 2, 10, to - 20 * 7 * D]
  ])('%s x%d: count bars of fixed length before to', (timespan, multiplier, count, from) => {
    expect(requestRange({ timespan, multiplier }, to, count)).toEqual([from, to])
  })

  it('month: calendar months in UTC, from the first of the month', () => {
    expect(requestRange({ timespan: 'month', multiplier: 1 }, to, 500).map(iso)).toEqual(['1985-01-01T00:00:00.000Z', iso(to)])
    expect(requestRange({ timespan: 'month', multiplier: 3 }, to, 4).map(iso)).toEqual(['2025-09-01T00:00:00.000Z', iso(to)])
  })

  it('month: January minus N rolls back across years', () => {
    const jan = utc(2026, 1, 15)
    expect(iso(requestRange({ timespan: 'month', multiplier: 1 }, jan, 1)[0])).toBe('2025-12-01T00:00:00.000Z')
    expect(iso(requestRange({ timespan: 'month', multiplier: 1 }, jan, 13)[0])).toBe('2024-12-01T00:00:00.000Z')
  })

  it('year: calendar years in UTC; the default Y range is no longer inverted (was from 2469)', () => {
    const [from, t] = requestRange({ timespan: 'year', multiplier: 1 }, to, 500)
    expect(from).toBe(0) // 1526 is before the epoch: clamped
    expect(t).toBe(to)
    expect(iso(requestRange({ timespan: 'year', multiplier: 1 }, to, 10)[0])).toBe('2016-01-01T00:00:00.000Z')
  })

  it('an anchor on Feb 29 of a leap year', () => {
    const feb29 = utc(2024, 2, 29, 12)
    expect(iso(requestRange({ timespan: 'month', multiplier: 1 }, feb29, 1)[0])).toBe('2024-01-01T00:00:00.000Z')
    expect(iso(requestRange({ timespan: 'year', multiplier: 1 }, feb29, 1)[0])).toBe('2023-01-01T00:00:00.000Z')
    expect(requestRange({ timespan: 'day', multiplier: 1 }, feb29, 1)[0]).toBe(feb29 - D)
  })

  it('from <= to for every timespan and count, and from is never negative', () => {
    for (const timespan of ['second', 'minute', 'hour', 'day', 'week', 'month', 'year']) {
      for (const count of [0, 1, 500, 100_000]) {
        for (const anchor of [to, utc(1970, 1, 8), 0]) {
          const [from, t] = requestRange({ timespan, multiplier: 1 }, anchor, count)
          expect(from, `${timespan} ${count} ${anchor}`).toBeLessThanOrEqual(t)
          expect(from).toBeGreaterThanOrEqual(0)
        }
      }
    }
  })

  it('an unknown timespan does not throw: one warning, and the empty range [to, to] (not all history since 1970)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(requestRange({ timespan: 'fortnight', multiplier: 1 }, to, 500)).toEqual([to, to])
    expect(requestRange({ timespan: 'fortnight', multiplier: 1 }, to, 5)).toEqual([to, to])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('fortnight')
  })
})

describe('addPeriods', () => {
  it('fixed timespans add multiplier x unit', () => {
    expect(addPeriods({ timespan: 'hour', multiplier: 4 }, 0, 2)).toBe(8 * H)
    expect(addPeriods({ timespan: 'week', multiplier: 1 }, 0, -1)).toBe(-7 * D)
  })

  it('month and year are calendar steps that keep the time of day', () => {
    expect(iso(addPeriods({ timespan: 'month', multiplier: 1 }, utc(2026, 8, 1, 16), 1))).toBe('2026-09-01T16:00:00.000Z')
    // A day past the end of the month rolls over (Jul 31 + 2 months is Oct 1).
    expect(iso(addPeriods({ timespan: 'month', multiplier: 1 }, utc(2026, 7, 31, 16), 2))).toBe('2026-10-01T16:00:00.000Z')
    expect(iso(addPeriods({ timespan: 'year', multiplier: 1 }, utc(2024, 2, 29), 1))).toBe('2025-03-01T00:00:00.000Z')
  })

  it('NaN for an unknown timespan', () => {
    expect(addPeriods({ timespan: 'tick', multiplier: 1 }, 0, 1)).toBeNaN()
  })
})
