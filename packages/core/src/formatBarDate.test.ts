import { describe, expect, it } from 'vitest'

import { formatBarDate } from './formatBarDate'

const DTF_OPTIONS: Intl.DateTimeFormatOptions = {
  hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
}

function displayDtf (tz: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en', { ...DTF_OPTIONS, timeZone: tz })
}

// 2026-09-25T00:00:00Z
const DAY_UTC_MIDNIGHT = Date.UTC(2026, 8, 25, 0, 0, 0)
// Monday 2026-09-21T00:00:00Z
const WEEK_MONDAY_UTC = Date.UTC(2026, 8, 21, 0, 0, 0)
// 2026-08-01T00:00:00Z
const MONTH_START_UTC = Date.UTC(2026, 7, 1, 0, 0, 0)

describe('SC-021: day-and-larger bars format in the symbol timezone, not the display zone', () => {
  it.each(['America/Los_Angeles', 'Asia/Tokyo', 'Etc/UTC'])('a daily bar at 00:00Z reads 2026-09-25 in %s (the display zone)', displayTz => {
    const out = formatBarDate({
      displayDtf: displayDtf(displayTz),
      symbolTimezone: undefined,
      timespan: 'day',
      timestamp: DAY_UTC_MIDNIGHT,
      format: 'YYYY-MM-DD',
      type: 'crosshair'
    })
    expect(out).toBe('2026-09-25')
  })

  it('the display zone alone (no symbolTimezone) would show 2026-09-24 in LA: this is the bug being fixed', () => {
    // Sanity check that the test fixture actually exercises the bug: reading
    // the same instant directly in the *display* zone (what the old code
    // did for day+ bars) gives the wrong, one-day-early date.
    const wrong = new Intl.DateTimeFormat('en', { ...DTF_OPTIONS, timeZone: 'America/Los_Angeles' }).formatToParts(new Date(DAY_UTC_MIDNIGHT))
    const day = wrong.find(p => p.type === 'day')?.value
    expect(day).toBe('24')
  })

  it('a weekly bar opening Monday 2026-09-21T00:00Z stays 2026-09-21 in Chicago', () => {
    const out = formatBarDate({
      displayDtf: displayDtf('America/Chicago'),
      symbolTimezone: undefined,
      timespan: 'week',
      timestamp: WEEK_MONDAY_UTC,
      format: 'YYYY-MM-DD',
      type: 'tooltip'
    })
    expect(out).toBe('2026-09-21')
  })

  it('a monthly bar at 2026-08-01T00:00Z gives 2026-08 on the x-axis in LA', () => {
    const out = formatBarDate({
      displayDtf: displayDtf('America/Los_Angeles'),
      symbolTimezone: undefined,
      timespan: 'month',
      timestamp: MONTH_START_UTC,
      format: 'YYYY-MM',
      type: 'xAxis'
    })
    expect(out).toBe('2026-08')
  })

  it('a yearly bar crosshair label reads the full date in the symbol timezone', () => {
    const out = formatBarDate({
      displayDtf: displayDtf('America/Los_Angeles'),
      symbolTimezone: 'Etc/UTC',
      timespan: 'year',
      timestamp: Date.UTC(2026, 0, 1),
      format: 'YYYY-MM-DD',
      type: 'tooltip'
    })
    expect(out).toBe('2026-01-01')
  })

  it('an OKX-style feed (SymbolInfo.timezone Asia/Shanghai) rolls a 16:00Z bar to the next calendar day', () => {
    // 2026-09-25T16:00Z is 2026-09-26T00:00 in Shanghai (UTC+8): the next day.
    const out = formatBarDate({
      displayDtf: displayDtf('Etc/UTC'),
      symbolTimezone: 'Asia/Shanghai',
      timespan: 'day',
      timestamp: Date.UTC(2026, 8, 25, 16, 0, 0),
      format: 'YYYY-MM-DD',
      type: 'xAxis'
    })
    expect(out).toBe('2026-09-26')
  })

  it('an invalid symbolTimezone falls back to UTC instead of throwing', () => {
    expect(() => formatBarDate({
      displayDtf: displayDtf('Etc/UTC'),
      symbolTimezone: 'Mars/Olympus',
      timespan: 'day',
      timestamp: DAY_UTC_MIDNIGHT,
      format: 'YYYY-MM-DD',
      type: 'xAxis'
    })).not.toThrow()
    const out = formatBarDate({
      displayDtf: displayDtf('Etc/UTC'),
      symbolTimezone: 'Mars/Olympus',
      timespan: 'day',
      timestamp: DAY_UTC_MIDNIGHT,
      format: 'YYYY-MM-DD',
      type: 'xAxis'
    })
    expect(out).toBe('2026-09-25')
  })
})

describe('SC-022: intraday bars keep the display zone; boundary formats are answered', () => {
  it('a 1H bar still follows the display zone, not the symbol timezone', () => {
    const out = formatBarDate({
      displayDtf: displayDtf('America/Los_Angeles'),
      symbolTimezone: 'Asia/Shanghai',
      timespan: 'hour',
      timestamp: Date.UTC(2026, 8, 25, 20, 0, 0),
      format: 'MM-DD HH:mm',
      type: 'xAxis'
    })
    // 20:00Z is 13:00 in LA (UTC-7 in September).
    expect(out).toBe('09-25 13:00')
  })

  it('a minute chart answers a day-boundary x-axis request instead of forcing HH:mm', () => {
    const out = formatBarDate({
      displayDtf: displayDtf('Etc/UTC'),
      symbolTimezone: undefined,
      timespan: 'minute',
      timestamp: DAY_UTC_MIDNIGHT,
      format: 'MM-DD',
      type: 'xAxis'
    })
    expect(out).toBe('09-25')
  })

  it('a minute chart still answers a plain time request with HH:mm', () => {
    const out = formatBarDate({
      displayDtf: displayDtf('Etc/UTC'),
      symbolTimezone: undefined,
      timespan: 'minute',
      timestamp: Date.UTC(2026, 8, 25, 14, 30, 0),
      format: 'HH:mm',
      type: 'xAxis'
    })
    expect(out).toBe('14:30')
  })

  it('a minute chart tooltip keeps the full date and time', () => {
    const out = formatBarDate({
      displayDtf: displayDtf('Etc/UTC'),
      symbolTimezone: undefined,
      timespan: 'minute',
      timestamp: Date.UTC(2026, 8, 25, 14, 30, 0),
      format: 'HH:mm',
      type: 'tooltip'
    })
    expect(out).toBe('2026-09-25 14:30')
  })
})
