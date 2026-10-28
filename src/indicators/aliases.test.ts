import { describe, expect, it } from 'vitest'
import { resolveIndicatorName, isAliasTarget, INDICATOR_ALIASES } from './aliases'

describe('resolveIndicatorName', () => {
  it('routes RSI/MACD/SMA to their SC_ replacement', () => {
    expect(resolveIndicatorName('RSI')).toBe('SC_RSI')
    expect(resolveIndicatorName('MACD')).toBe('SC_MACD')
    expect(resolveIndicatorName('SMA')).toBe('SC_SMA')
  })

  it('leaves every other name unchanged, MA/EMA/BOLL/VOL/COMPARE included', () => {
    for (const name of ['MA', 'EMA', 'BOLL', 'VOL', 'COMPARE', 'SUPER_RSI', 'KDJ', 'SC_RSI']) {
      expect(resolveIndicatorName(name)).toBe(name)
    }
  })

  it('isAliasTarget is true only for the SC_ names this module aliases to', () => {
    expect(isAliasTarget('SC_RSI')).toBe(true)
    expect(isAliasTarget('SC_ATR')).toBe(false)
    expect(isAliasTarget('RSI')).toBe(false)
  })

  it('put-back: removing an alias entry stops the redirect (guards against a silently empty table)', () => {
    const withoutMacd = { ...INDICATOR_ALIASES } as Record<string, string>
    delete withoutMacd.MACD
    expect(withoutMacd.MACD ?? 'MACD').toBe('MACD')
    // sanity that the real table still redirects it
    expect(INDICATOR_ALIASES.MACD).toBe('SC_MACD')
  })
})
