import { describe, expect, it } from 'vitest'

import { CHART_TYPES, THEMES, isChartType, isTheme } from './types'

describe('runtime guards for JSON callers', () => {
  it('accepts exactly the listed themes', () => {
    expect(THEMES.filter(isTheme)).toEqual(['light', 'dark'])
    expect(['drak', 'Dark', '', null, undefined, 1].some(isTheme)).toBe(false)
  })

  it('accepts exactly the listed chart types', () => {
    expect(CHART_TYPES.every(isChartType)).toBe(true)
    expect(['lin', 'candle', 'CANDLE_SOLID', {}].some(isChartType)).toBe(false)
  })
})
