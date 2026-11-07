import { describe, expect, it } from 'vitest'

import type { Period } from '../core/feed'

import { parsePeriod, periodAllowed, periodKey, resolveTypedPeriod } from './parsePeriod'

const PERIODS: Period[] = [
  { multiplier: 1, timespan: 'minute', text: '1m' },
  { multiplier: 1, timespan: 'hour', text: '1H' },
  { multiplier: 1, timespan: 'day', text: 'D' }
]

describe('parsePeriod / periodKey re-exports', () => {
  it('are the same functions data/keys.ts already implements', () => {
    expect(parsePeriod('4H')).toEqual({ multiplier: 4, timespan: 'hour' })
    expect(periodKey({ multiplier: 4, timespan: 'hour' })).toBe('4:hour')
  })
})

describe('periodAllowed', () => {
  it('always allows an entry of the configured periods', () => {
    expect(periodAllowed({ multiplier: 1, timespan: 'hour' }, { periods: PERIODS })).toBe(true)
  })

  it('refuses anything else by default (no customPeriods, no datafeed.resolvePeriod)', () => {
    expect(periodAllowed({ multiplier: 3, timespan: 'minute' }, { periods: PERIODS })).toBe(false)
  })

  it('customPeriods: true allows anything', () => {
    expect(periodAllowed({ multiplier: 3, timespan: 'minute' }, { periods: PERIODS, customPeriods: true })).toBe(true)
  })

  it('customPeriods as a predicate decides per period', () => {
    const ctx = { periods: PERIODS, customPeriods: (p: { timespan: string }) => p.timespan === 'minute' }
    expect(periodAllowed({ multiplier: 3, timespan: 'minute' }, ctx)).toBe(true)
    expect(periodAllowed({ multiplier: 3, timespan: 'week' }, ctx)).toBe(false)
  })

  it('a datafeed.resolvePeriod implementation is itself the opt-in', () => {
    const ctx = { periods: PERIODS, datafeed: { resolvePeriod: (p: Period) => p as never } }
    expect(periodAllowed({ multiplier: 3, timespan: 'minute' }, ctx)).toBe(true)
  })
})

describe('resolveTypedPeriod', () => {
  it('unreadable text', () => {
    expect(resolveTypedPeriod('not a period', { periods: PERIODS })).toEqual({ kind: 'unreadable' })
  })

  it('a configured period resolves to the exact configured object (keeps its display text)', () => {
    expect(resolveTypedPeriod('1h', { periods: PERIODS })).toEqual({ kind: 'ok', period: PERIODS[1] })
  })

  it('a valid but non-configured period is unsupported with no capability (never reaches the datafeed)', () => {
    expect(resolveTypedPeriod('3m', { periods: PERIODS })).toEqual({ kind: 'unsupported' })
  })

  it('with customPeriods: true, a non-configured period resolves with its typed label', () => {
    expect(resolveTypedPeriod('3m', { periods: PERIODS, customPeriods: true })).toEqual({
      kind: 'ok', period: { multiplier: 3, timespan: 'minute', text: '3m' }
    })
  })

  it('with datafeed.resolvePeriod, its return value is used verbatim', () => {
    const resolved: Period = { multiplier: 3, timespan: 'minute', text: '3-minute' }
    const ctx = { periods: PERIODS, datafeed: { resolvePeriod: () => resolved } }
    expect(resolveTypedPeriod('3m', ctx)).toEqual({ kind: 'ok', period: resolved })
  })

  it('datafeed.resolvePeriod returning null falls back to the typed label', () => {
    const ctx = { periods: PERIODS, datafeed: { resolvePeriod: () => null } }
    expect(resolveTypedPeriod('3m', ctx)).toEqual({ kind: 'ok', period: { multiplier: 3, timespan: 'minute', text: '3m' } })
  })
})
