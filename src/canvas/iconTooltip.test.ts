import { describe, expect, it } from 'vitest'

import { activeIconId, iconLabelKey, tooltipStoreOf } from './iconTooltip'

describe('activeIconId', () => {
  it('reads getActiveIcon (klinecharts 9.8.x)', () => {
    expect(activeIconId({ getActiveIcon: () => ({ id: 'setting' }) })).toBe('setting')
  })

  it('falls back to getActiveIconInfo (klinecharts 9.1.x)', () => {
    expect(activeIconId({ getActiveIconInfo: () => ({ id: 'close' }) })).toBe('close')
  })

  it('prefers getActiveIcon when both exist', () => {
    expect(activeIconId({ getActiveIcon: () => ({ id: 'visible' }), getActiveIconInfo: () => ({ id: 'invisible' }) })).toBe('visible')
  })

  it('is null when nothing is active, the store is missing, or a lookup throws', () => {
    expect(activeIconId({ getActiveIcon: () => null })).toBeNull()
    expect(activeIconId(null)).toBeNull()
    expect(activeIconId(undefined)).toBeNull()
    expect(activeIconId({})).toBeNull()
    expect(activeIconId({ getActiveIcon: () => { throw new Error('nope') } })).toBeNull()
  })

  it('is null for a non-string or empty id', () => {
    expect(activeIconId({ getActiveIcon: () => ({ id: 42 }) })).toBeNull()
    expect(activeIconId({ getActiveIcon: () => ({ id: '' }) })).toBeNull()
    expect(activeIconId({ getActiveIcon: () => ({}) })).toBeNull()
  })
})

describe('tooltipStoreOf', () => {
  it('walks chart.getChartStore().getTooltipStore()', () => {
    const ts = { getActiveIcon: () => ({ id: 'close' }) }
    const chart = { getChartStore: () => ({ getTooltipStore: () => ts }) }
    expect(tooltipStoreOf(chart)).toBe(ts)
  })

  it('is null when any step of the walk is missing, not a function, or throws', () => {
    expect(tooltipStoreOf(null)).toBeNull()
    expect(tooltipStoreOf({})).toBeNull()
    expect(tooltipStoreOf({ getChartStore: () => null })).toBeNull()
    expect(tooltipStoreOf({ getChartStore: () => ({}) })).toBeNull()
    expect(tooltipStoreOf({ getChartStore: () => ({ getTooltipStore: () => null }) })).toBeNull()
    expect(tooltipStoreOf({ getChartStore: () => { throw new Error('nope') } })).toBeNull()
  })
})

describe('iconLabelKey', () => {
  it('maps every LEGEND_ICONS id (chart-theme.ts) to its i18n key', () => {
    expect(iconLabelKey('visible')).toBe('legend_icon_show')
    expect(iconLabelKey('invisible')).toBe('legend_icon_hide')
    expect(iconLabelKey('setting')).toBe('legend_icon_settings')
    expect(iconLabelKey('close')).toBe('legend_icon_remove')
  })

  it('is null for null or an id with no label', () => {
    expect(iconLabelKey(null)).toBeNull()
    expect(iconLabelKey('drag')).toBeNull()
  })
})
