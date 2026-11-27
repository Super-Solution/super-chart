import { describe, expect, it } from 'vitest'
import { INDICATOR_INFO, indicatorInfo, indicatorShortName, searchIndicators } from './indicatorInfo'
import { TECHNICAL_INDICATOR_NAMES } from './indicatorPack'
import { CLASSIC_INDICATOR_NAMES } from './classicIndicators'

const BUILTINS = ['MA', 'EMA', 'BOLL', 'VOL', 'MACD', 'RSI', 'KDJ']
const all = [...BUILTINS, ...CLASSIC_INDICATOR_NAMES, ...TECHNICAL_INDICATOR_NAMES]

describe('indicator info', () => {
  it('describes every indicator the package ships', () => {
    for (const name of all) expect(INDICATOR_INFO[name], name).toBeDefined()
  })

  it('finds by name, long name, keyword and Chinese keyword, best match first', () => {
    expect(searchIndicators(all, 'rsi')[0]).toBe('RSI')
    expect(searchIndicators(all, 'bollinger')).toContain('BOLL')
    expect(searchIndicators(all, '一目')).toEqual(['SC_ICHIMOKU'])
    expect(searchIndicators(all, 'moving average').slice(0, 2)).toEqual(['MA', 'EMA'])
    expect(searchIndicators(all, 'no such thing')).toEqual([])
  })

  it('leaves out an indicator that only repeats a registered one, and lists the rest by family', () => {
    const listed = searchIndicators(all, '')
    expect(listed).not.toContain('SC_RSI')
    expect(listed).toContain('SC_ATR')
    expect(searchIndicators(['SC_RSI'], '')).toEqual(['SC_RSI'])
    const families = listed.map(name => indicatorInfo(name).group)
    expect(families).toEqual([...families].sort((a, b) => ['trend', 'momentum', 'volatility', 'volume', 'levels'].indexOf(a) - ['trend', 'momentum', 'volatility', 'volume', 'levels'].indexOf(b)))
  })

  it('names an unknown indicator readably', () => {
    expect(indicatorInfo('SC_FANCY_BANDS').label).toBe('FANCY BANDS')
    expect(indicatorShortName('SC_ATR')).toBe('ATR')
    expect(indicatorShortName('MYSCRIPT')).toBe('MYSCRIPT')
  })
})
