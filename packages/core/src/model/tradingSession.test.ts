import { describe, expect, it } from 'vitest'

import type { SymbolSession } from '../feed'
import { compileSession, compileSymbolSession, sessionBarClose, sessionChangeAfter, sessionKindAt, sessionLayout, SESSION_LIMITS, type TradingSession } from './tradingSession'

const at = (month: number, day: number, hour: number, minute = 0): number => Date.UTC(2026, month - 1, day, hour, minute)
// New York in November 2026 is on standard time (UTC-5) after the 1st, and on daylight time (UTC-4) in July.
const equity: SymbolSession = {
  timezone: 'America/New_York',
  regular: '0930-1600',
  pre: '0400-0930',
  post: '1600-2000',
  closed: ['2026-11-26'],
  exceptions: { '2026-11-27': { regular: '0930-1300', post: '1300-1700' } }
}
const build = (raw: unknown, fallback?: string): TradingSession => {
  const { session, issues } = compileSession(raw, fallback)
  expect(issues).toEqual([])
  return session as TradingSession
}

describe('compileSession', () => {
  it('accepts a full schedule and reads the zone from the symbol when the session has none', () => {
    expect(compileSession(equity).session?.timezone).toBe('America/New_York')
    expect(compileSession({ regular: '0930-1600' }, 'Asia/Tokyo').session?.timezone).toBe('Asia/Tokyo')
    expect(compileSession({ regular: '0930-1600' }).session?.timezone).toBe('UTC')
    expect(compileSymbolSession({ timezone: 'Asia/Tokyo', session: { regular: '0900-1130,1230-1500' } }).session?.timezone).toBe('Asia/Tokyo')
    expect(compileSymbolSession({ ticker: 'X' } as { session?: SymbolSession })).toEqual({ session: null, issues: [] })
  })

  it('refuses a fault with its stable code and lists every fault in one pass', () => {
    const codes = (raw: unknown): string[] => compileSession(raw).issues.map(issue => `${issue.field}:${issue.code}`)
    expect(codes(null)).toEqual(['session:bad_session'])
    expect(codes([])).toEqual(['session:bad_session'])
    expect(codes({})).toEqual(['regular:bad_session'])
    expect(codes({ regular: '0930-1600', timezone: 'Mars/Olympus' })).toEqual(['timezone:bad_timezone'])
    for (const text of ['0930-0930', '0000-0000', '2500-1600', '0960-1600', '2400-0100', '0930-1600:8', '0930-1600:', '930-1600', '', '0930-1600,', 'open', 5]) {
      expect(codes({ regular: text }), String(text)).toEqual(['regular:bad_segments'])
    }
    expect(codes({ regular: '0930-1600', closed: ['2026-02-30'] })).toEqual(['closed[0]:bad_date'])
    expect(codes({ regular: '0930-1600', closed: 'x' })).toEqual(['closed:bad_date'])
    expect(codes({ regular: '0930-1600', exceptions: { '2026-12-24': 'half' } })).toEqual(['exceptions[2026-12-24]:bad_date'])
    expect(codes({ regular: '0930-1600', exceptions: { '2026-12-24': { regular: '0930-1300:12' } } })).toEqual(['exceptions[2026-12-24].regular:bad_segments'])
    expect(codes({ regular: 'x', pre: 'y', timezone: 'Nope/Zone' })).toEqual(['timezone:bad_timezone', 'regular:bad_segments', 'pre:bad_segments'])
    expect(codes({ regular: Array.from({ length: SESSION_LIMITS.segments + 1 }, () => '0100-0200').join(',') })).toEqual(['regular:too_many'])
    expect(codes({ regular: '0930-1600', closed: Array.from({ length: SESSION_LIMITS.dates + 1 }, () => '2026-01-01') })).toEqual(['closed:too_many'])
  })

  it('allows an empty exception field (none that day) and 2400 as an end', () => {
    expect(compileSession({ regular: '0000-2400', exceptions: { '2026-12-25': { regular: '' } } }).issues).toEqual([])
  })
})

describe('sessionKindAt', () => {
  const session = build(equity)
  it('classifies a regular weekday in standard time (09:30 New York is 14:30 UTC)', () => {
    expect(sessionKindAt(session, at(11, 25, 8, 59))).toBe('closed')
    expect(sessionKindAt(session, at(11, 25, 9, 0))).toBe('pre') // 04:00
    expect(sessionKindAt(session, at(11, 25, 14, 29))).toBe('pre')
    expect(sessionKindAt(session, at(11, 25, 14, 30))).toBe('regular')
    expect(sessionKindAt(session, at(11, 25, 20, 59))).toBe('regular')
    expect(sessionKindAt(session, at(11, 25, 21, 0))).toBe('post') // 16:00
    expect(sessionKindAt(session, at(11, 26, 0, 59))).toBe('post') // 19:59
    expect(sessionKindAt(session, at(11, 26, 1, 0))).toBe('closed') // 20:00
  })

  it('follows daylight saving: the same wall time is an hour earlier in UTC in July', () => {
    expect(sessionKindAt(session, at(7, 1, 13, 29))).toBe('pre')
    expect(sessionKindAt(session, at(7, 1, 13, 30))).toBe('regular')
    expect(sessionKindAt(session, at(7, 1, 19, 59))).toBe('regular')
    expect(sessionKindAt(session, at(7, 1, 20, 0))).toBe('post')
  })

  it('weekends, closed dates and exceptions', () => {
    expect(sessionKindAt(session, at(11, 28, 15, 0))).toBe('closed') // Saturday
    expect(sessionKindAt(session, at(11, 26, 15, 0))).toBe('closed') // listed in closed
    expect(sessionKindAt(session, at(11, 27, 17, 59))).toBe('regular') // early close 13:00 New York
    expect(sessionKindAt(session, at(11, 27, 18, 0))).toBe('post')
    expect(sessionKindAt(session, at(11, 27, 21, 59))).toBe('post') // post to 17:00 on the exception day
    expect(sessionKindAt(session, at(11, 27, 22, 0))).toBe('closed')
    expect(sessionKindAt(session, at(11, 27, 9, 0))).toBe('pre') // pre is not mentioned, so it stays
  })

  it('a segment that crosses midnight belongs to the day it starts on', () => {
    const night = build({ regular: '2200-0600:12345' })
    expect(sessionKindAt(night, at(11, 23, 23, 0))).toBe('regular') // Monday 23:00
    expect(sessionKindAt(night, at(11, 24, 5, 59))).toBe('regular')
    expect(sessionKindAt(night, at(11, 24, 6, 0))).toBe('closed')
    expect(sessionKindAt(night, at(11, 28, 3, 0))).toBe('regular') // Friday's span runs into Saturday morning
    expect(sessionKindAt(night, at(11, 28, 23, 0))).toBe('closed') // there is no Saturday start
    expect(sessionKindAt(night, at(11, 22, 23, 0))).toBe('closed') // Sunday start is not listed
  })

  it('days: 1 is Monday and 7 is Sunday; regular wins where schedules overlap', () => {
    const weekend = build({ regular: '1000-1200:67', pre: '0900-1100:67' })
    expect(sessionKindAt(weekend, at(11, 28, 9, 30))).toBe('pre') // Saturday
    expect(sessionKindAt(weekend, at(11, 29, 10, 30))).toBe('regular') // Sunday: overlap, regular wins
    expect(sessionKindAt(weekend, at(11, 29, 11, 30))).toBe('regular')
    expect(sessionKindAt(weekend, at(11, 25, 10, 30))).toBe('closed') // Wednesday
  })

  it('a time that is not finite is closed', () => {
    expect(sessionKindAt(session, Number.NaN)).toBe('closed')
    expect(sessionKindAt(session, Infinity)).toBe('closed')
  })
})

describe('sessionChangeAfter', () => {
  const session = build(equity)
  it('is the next edge where the class changes, and skips an edge between two spans of the same class', () => {
    expect(sessionChangeAfter(session, at(11, 25, 14, 0))).toBe(at(11, 25, 14, 30))
    expect(sessionChangeAfter(session, at(11, 25, 14, 30))).toBe(at(11, 25, 21, 0))
    expect(sessionChangeAfter(session, at(11, 25, 21, 0))).toBe(at(11, 26, 1, 0))
    const lunch = build({ regular: '0900-1130,1130-1500' })
    expect(sessionChangeAfter(lunch, at(11, 25, 9, 30))).toBe(at(11, 25, 15, 0))
  })
})

describe('sessionBarClose', () => {
  const session = build(equity)
  it('an intraday bar ends at the session edge when its period would cross it', () => {
    expect(sessionBarClose(session, at(11, 25, 20, 30), { multiplier: 1, timespan: 'hour' })).toBe(at(11, 25, 21, 0)) // 15:30 hour bar, not 16:30
    expect(sessionBarClose(session, at(11, 25, 14, 30), { multiplier: 5, timespan: 'minute' })).toBe(at(11, 25, 14, 35))
    expect(sessionBarClose(session, at(11, 25, 13, 30), { multiplier: 1, timespan: 'hour' })).toBe(at(11, 25, 14, 30)) // pre-market ends at the open
    expect(sessionBarClose(session, at(11, 27, 17, 0), { multiplier: 2, timespan: 'hour' })).toBe(at(11, 27, 18, 0)) // early close
  })

  it('a bar that opened while the market was closed has no answer (the caller keeps its estimate)', () => {
    expect(sessionBarClose(session, at(11, 28, 15, 0), { multiplier: 1, timespan: 'hour' })).toBeUndefined()
    expect(sessionBarClose(session, at(11, 25, 15, 0), { multiplier: 1, timespan: 'fortnight' })).toBeUndefined()
  })

  it('a bar of a day or more ends at the last regular close before the calendar end', () => {
    expect(sessionBarClose(session, at(11, 25, 14, 30), { multiplier: 1, timespan: 'day' })).toBe(at(11, 25, 21, 0))
    expect(sessionBarClose(session, at(11, 23, 14, 30), { multiplier: 1, timespan: 'week' })).toBe(at(11, 27, 18, 0)) // Thursday is closed, Friday closes early
    expect(sessionBarClose(session, at(11, 25, 14, 30), { multiplier: 1, timespan: 'month' }, 'UTC')).toBe(at(12, 24, 21, 0)) // the period ends Dec 25 09:30 New York, so the last close is Thursday the 24th
  })
})

describe('sessionLayout', () => {
  const session = build(equity)
  it('classes every bar and marks the first bar of a new local date, never the first bar given', () => {
    const times = [at(11, 25, 14, 25), at(11, 25, 14, 30), at(11, 25, 21, 0), at(11, 26, 1, 0), at(11, 26, 14, 30), at(11, 27, 14, 30)]
    const { kinds, breaks } = sessionLayout(session, times)
    expect([...kinds]).toEqual([1, 0, 2, 3, 3, 0]) // pre, regular, post, closed, closed (holiday), regular
    expect([...breaks]).toEqual([0, 0, 0, 0, 1, 1]) // 01:00 UTC is still Nov 25 in New York
  })

  it('does not break a day on a bar with no finite time', () => {
    const { kinds, breaks } = sessionLayout(session, [at(11, 25, 14, 30), Number.NaN, at(11, 25, 15, 0)])
    expect([...kinds]).toEqual([0, 3, 0])
    expect([...breaks]).toEqual([0, 0, 0])
  })
})
