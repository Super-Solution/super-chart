import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Period } from '../core/feed'

import { parsePeriod, periodKey, resolvePeriod, samePeriod, sameSymbol, symbolKey } from './keys'

const PERIODS: Period[] = [
  { multiplier: 1, timespan: 'minute', text: '1m' },
  { multiplier: 5, timespan: 'minute', text: '5m' },
  { multiplier: 1, timespan: 'hour', text: '1H' },
  { multiplier: 4, timespan: 'hour', text: '4H' },
  { multiplier: 1, timespan: 'day', text: 'D' },
  { multiplier: 1, timespan: 'week', text: 'W' },
  { multiplier: 1, timespan: 'month', text: 'M' },
  { multiplier: 1, timespan: 'year', text: 'Y' }
]

afterEach(() => { vi.restoreAllMocks() })

describe('symbol identity', () => {
  it('sameSymbol: every field equal, whatever the object', () => {
    expect(sameSymbol({ ticker: 'BTC', pricePrecision: 2 }, { pricePrecision: 2, ticker: 'BTC' })).toBe(true)
    expect(sameSymbol({ ticker: 'BTC' }, { ticker: 'BTC', priceCurrency: 'USD' })).toBe(false)
    expect(sameSymbol({ ticker: 'BTC', priceCurrency: 'USDT' }, { ticker: 'BTC', priceCurrency: 'USD' })).toBe(false)
  })

  it('symbolKey: a new priceCurrency or market refetches (SupWallet switches markets that way)', () => {
    expect(symbolKey({ ticker: 'BTC', priceCurrency: 'USDT' })).not.toBe(symbolKey({ ticker: 'BTC', priceCurrency: 'USD' }))
    expect(symbolKey({ ticker: 'BTC', market: 'crypto' })).not.toBe(symbolKey({ ticker: 'BTC', market: 'tradfi' }))
    expect(symbolKey({ ticker: 'BTC', exchange: 'A' })).not.toBe(symbolKey({ ticker: 'BTC', exchange: 'B' }))
  })

  it('symbolKey: display-only fields and key order do not', () => {
    const a = symbolKey({ ticker: 'BTC', exchange: 'X', name: 'Bitcoin', pricePrecision: 2, volumePrecision: 0, logo: 'a.png', shortName: 'BTC' })
    const b = symbolKey({ exchange: 'X', ticker: 'BTC', name: 'BTC/USD', pricePrecision: 5 })
    expect(a).toBe(b)
  })

  it('symbolKey: SC-021/SC-027 timezone is display-only (it only changes how a day+ bar\'s date is read, not what is fetched)', () => {
    expect(symbolKey({ ticker: 'BTC', timezone: 'Asia/Shanghai' })).toBe(symbolKey({ ticker: 'BTC', timezone: 'America/Los_Angeles' }))
    expect(symbolKey({ ticker: 'BTC', timezone: 'Asia/Shanghai' })).toBe(symbolKey({ ticker: 'BTC' }))
  })
})

describe('period identity and shorthand', () => {
  it('periodKey and samePeriod ignore the display text', () => {
    expect(periodKey({ multiplier: 4, timespan: 'hour' })).toBe('4:hour')
    const lower: Period = { multiplier: 4, timespan: 'hour', text: '4h' }
    expect(samePeriod(lower, PERIODS[3])).toBe(true)
    expect(samePeriod(PERIODS[0], PERIODS[6])).toBe(false)
  })

  it.each([
    ['1m', 1, 'minute'], ['15m', 15, 'minute'], ['1M', 1, 'month'], ['M', 1, 'month'], ['3M', 3, 'month'],
    ['4h', 4, 'hour'], ['4H', 4, 'hour'], ['D', 1, 'day'], ['1d', 1, 'day'], ['W', 1, 'week'], ['2w', 2, 'week'],
    ['Y', 1, 'year'], ['1y', 1, 'year'], ['30s', 30, 'second'], ['1S', 1, 'second'],
    ['1', 1, 'minute'], ['60', 1, 'hour'], ['240', 4, 'hour'], ['90', 90, 'minute'], [' 4H ', 4, 'hour']
  ])('parsePeriod(%j) is %d %s', (input, multiplier, timespan) => {
    expect(parsePeriod(input)).toEqual({ multiplier, timespan })
  })

  it.each(['', 'x', '0', '0m', '4 hours', 'h4', '1.5h', '-1m'])('parsePeriod(%j) is null', input => {
    expect(parsePeriod(input)).toBeNull()
  })

  it('resolvePeriod maps shorthand onto the configured period, so the top bar highlights it', () => {
    expect(resolvePeriod('4h', PERIODS)).toBe(PERIODS[3])
    expect(resolvePeriod('240', PERIODS)).toBe(PERIODS[3])
    expect(resolvePeriod('1M', PERIODS)).toBe(PERIODS[6])
    expect(resolvePeriod('1m', PERIODS)).toBe(PERIODS[0])
  })

  it('resolvePeriod: 60 minutes configured as minutes still matches "1H"', () => {
    const custom: Period[] = [{ multiplier: 60, timespan: 'minute', text: '60' }]
    expect(resolvePeriod('1H', custom)).toBe(custom[0])
  })

  it('resolvePeriod: a readable string that is not configured gets its own period', () => {
    expect(resolvePeriod('2D', PERIODS)).toEqual({ multiplier: 2, timespan: 'day', text: '2D' })
  })

  it('resolvePeriod: an object is stored as given; an unreadable string is refused with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const p = { multiplier: 4, timespan: 'hour', text: 'four' }
    expect(resolvePeriod(p, PERIODS)).toBe(p)
    expect(resolvePeriod('4 hours', PERIODS)).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
  })
})
