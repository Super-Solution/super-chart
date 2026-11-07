// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { dateKeyInTz, previousRangeHighLow, weekKeyInTz, type Bar } from './previousRangeHighLow'

describe('dateKeyInTz', () => {
  it('formats the UTC calendar date', () => {
    expect(dateKeyInTz(Date.UTC(2026, 8, 28, 12, 0), 'UTC')).toBe('2026-09-28')
  })

  it('a zone can shift the calendar date relative to UTC', () => {
    // 2026-09-28 23:30 UTC is already 2026-09-29 in UTC+14 (Pacific/Kiritimati).
    const ts = Date.UTC(2026, 8, 28, 23, 30)
    expect(dateKeyInTz(ts, 'Pacific/Kiritimati')).toBe('2026-09-29')
    expect(dateKeyInTz(ts, 'UTC')).toBe('2026-09-28')
  })

  it('falls back to UTC for an unrecognised zone rather than throwing', () => {
    expect(() => dateKeyInTz(Date.now(), 'Not/AZone')).not.toThrow()
  })
})

describe('weekKeyInTz', () => {
  it('every day in the same Mon-Sun week maps to that week\'s Monday', () => {
    // 2026-09-28 is a Monday.
    const monday = Date.UTC(2026, 8, 28, 12)
    const sunday = Date.UTC(2026, 9, 4, 12) // the following Sunday, same week
    expect(weekKeyInTz(monday, 'UTC')).toBe('2026-09-28')
    expect(weekKeyInTz(sunday, 'UTC')).toBe('2026-09-28')
  })

  it('the next Monday starts a new week key', () => {
    const nextMonday = Date.UTC(2026, 9, 5, 12)
    expect(weekKeyInTz(nextMonday, 'UTC')).toBe('2026-10-05')
  })
})

function bar (ts: number, high: number, low: number): Bar {
  return { timestamp: ts, high, low }
}

const HOUR = 3_600_000
const DAY = 24 * HOUR

describe('previousRangeHighLow', () => {
  it('day: the high/low of the calendar day before the last bar\'s day', () => {
    const day0 = Date.UTC(2026, 8, 27) // Sep 27
    const day1 = Date.UTC(2026, 8, 28) // Sep 28 (the "current" day, excluded)
    const bars: Bar[] = [
      bar(day0, 100, 90), bar(day0 + 6 * HOUR, 110, 95), bar(day0 + 12 * HOUR, 105, 88), // day0: high 110, low 88
      bar(day1, 120, 115), bar(day1 + 6 * HOUR, 125, 118) // day1 ("today"): excluded
    ]
    const result = previousRangeHighLow(bars, 'day', 'UTC')
    expect(result).toMatchObject({ high: 110, low: 88, key: '2026-09-27', fromIndex: 0, toIndex: 2 })
  })

  it('week: the high/low of the Mon-Sun week before the last bar\'s week', () => {
    const week0Mon = Date.UTC(2026, 8, 21) // a Monday
    const week1Mon = Date.UTC(2026, 8, 28) // the following Monday
    const bars: Bar[] = [
      bar(week0Mon, 100, 90), bar(week0Mon + 3 * DAY, 130, 85), // week0: high 130, low 85
      bar(week1Mon, 120, 115) // week1 ("this week"): excluded
    ]
    const result = previousRangeHighLow(bars, 'week', 'UTC')
    expect(result).toMatchObject({ high: 130, low: 85, key: '2026-09-21' })
  })

  it('null when every bar is in the same (current) period — there is no previous one yet', () => {
    const day = Date.UTC(2026, 8, 28)
    const bars: Bar[] = [bar(day, 100, 90), bar(day + HOUR, 105, 95)]
    expect(previousRangeHighLow(bars, 'day', 'UTC')).toBeNull()
  })

  it('null for empty input', () => {
    expect(previousRangeHighLow([], 'day', 'UTC')).toBeNull()
  })

  it('skips a gap: the "previous" period is whichever period is immediately before the current one, even if some days have no bars at all', () => {
    const day0 = Date.UTC(2026, 8, 20)
    const day3 = Date.UTC(2026, 8, 23) // 3 days later, no bars in between
    const bars: Bar[] = [bar(day0, 100, 90), bar(day3, 200, 190)]
    const result = previousRangeHighLow(bars, 'day', 'UTC')
    expect(result).toMatchObject({ high: 100, low: 90, key: '2026-09-20' })
  })

  it('a timezone shift can move a bar into a different day/week than plain UTC would', () => {
    // 23:30 UTC on Sep 27 is already Sep 28 in UTC+14.
    const bars: Bar[] = [
      bar(Date.UTC(2026, 8, 26, 23, 0), 50, 40),
      bar(Date.UTC(2026, 8, 27, 23, 30), 200, 190) // this is "Sep 28" in Kiritimati
    ]
    const utc = previousRangeHighLow(bars, 'day', 'UTC')
    const shifted = previousRangeHighLow(bars, 'day', 'Pacific/Kiritimati')
    // In UTC, both bars are Sep 26/27 respectively -> previous day is Sep 26.
    expect(utc?.key).toBe('2026-09-26')
    // In UTC+14, the last bar is already "Sep 28", so the previous day (Sep 27) is the first bar's own day.
    expect(shifted?.key).toBe('2026-09-27')
  })

  it('put-back: without excluding the LAST (current) period first, the previous-period window would include the wrong bars', () => {
    const day0 = Date.UTC(2026, 8, 27)
    const day1 = Date.UTC(2026, 8, 28)
    const bars: Bar[] = [bar(day0, 100, 90), bar(day1, 999, 1)]
    const result = previousRangeHighLow(bars, 'day', 'UTC')
    // A bug that failed to skip the current day first would report day1's
    // extreme values (999/1) instead of day0's (100/90).
    expect(result?.high).toBe(100)
    expect(result?.low).toBe(90)
  })
})
