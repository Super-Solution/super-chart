import { describe, expect, it } from 'vitest'

import { CHART_TYPE_ORDER, chartTypeItems, chartTypeLabel, chartTypeOrderIsComplete } from './chartTypes'
import { centredScrollTop, matchesTyped, placeMenu } from './popover'
import { isOutside } from './outsideDismiss'
import { readMode } from './fullscreen'
import { CHART_TYPES } from '../types'
import { editorKeyAction, KeyContext } from '../drawing-editor/keyboard'
import { StyleStack } from '../theme/styleStack'

describe('one chart-type list (SC-124)', () => {
  it('lists every chart type once, with a name in every built-in locale', () => {
    expect(chartTypeOrderIsComplete()).toBe(true)
    expect([...CHART_TYPE_ORDER].sort()).toEqual([...CHART_TYPES].sort())
    for (const locale of ['en-US', 'zh-CN']) {
      const items = chartTypeItems(locale)
      expect(items.map(i => i.key)).toEqual([...CHART_TYPE_ORDER])
      for (const item of items) {
        expect(item.text.startsWith('chart_type_'), `${locale} ${item.key}`).toBe(false)
      }
      expect(new Set(items.map(i => i.text)).size).toBe(items.length)
    }
    expect(chartTypeLabel('ohlc', 'en-US')).toBe('Bars')
    expect(chartTypeLabel('line', 'en-US')).toBe('Line')
    expect(chartTypeLabel('area', 'en-US')).toBe('Area')
  })
})

describe('popover helpers', () => {
  it('keeps a menu inside the chart and under its trigger', () => {
    expect(placeMenu({ left: 40, top: 0, bottom: 38 }, 150, 800)).toEqual({ left: 40, top: 38 })
    expect(placeMenu({ left: 700, top: 0, bottom: 38 }, 150, 800)).toEqual({ left: 650, top: 38 })
    expect(placeMenu({ left: 10, top: 0, bottom: 38 }, 900, 800)).toEqual({ left: 0, top: 38 })
  })

  it('centres the current option within the list range', () => {
    // Row 15 of 40px rows in a 200px list of 24 rows.
    expect(centredScrollTop(600, 40, 200, 960)).toBe(520)
    expect(centredScrollTop(0, 40, 200, 960)).toBe(0)
    expect(centredScrollTop(920, 40, 200, 960)).toBe(760)
  })

  it('type-ahead matches the start of the text or of the name after an offset', () => {
    expect(matchesTyped('Log', 'l')).toBe(true)
    expect(matchesTyped('(UTC+9) Tokyo', 'to')).toBe(true)
    expect(matchesTyped('(UTC+9) Tokyo', '(utc')).toBe(true)
    expect(matchesTyped('(UTC+9) Tokyo', 'ky')).toBe(false)
  })
})

describe('outside dismissal', () => {
  it('counts the popover and its anchor as inside', () => {
    const node = (parent?: any): any => ({ nodeType: 1, parent, contains (o: any) { for (let n = o; n; n = n.parent) if (n === this) return true; return false } })
    const menu = node()
    const item = node(menu)
    const anchor = node()
    const canvas = node()
    expect(isOutside(item, [menu, anchor])).toBe(false)
    expect(isOutside(anchor, [menu, anchor])).toBe(false)
    expect(isOutside(canvas, [menu, anchor])).toBe(true)
    expect(isOutside(null, [menu])).toBe(true)
    expect(isOutside(canvas, [undefined, null])).toBe(true)
  })
})

describe('full screen state (SC-081)', () => {
  it('is read from the page, never toggled: another element in full screen is not this chart', () => {
    const root = {} as Element
    const other = {} as Element
    expect(readMode(root, root, false)).toBe('native')
    expect(readMode(other, root, false)).toBeNull()
    expect(readMode(null, root, false)).toBeNull()
    expect(readMode(null, root, true)).toBe('pseudo')
  })
})

describe('the drawing editor leaves a dialog\'s keys alone (SC-145)', () => {
  const ctx = (patch: Partial<KeyContext>): KeyContext => ({
    key: 'Backspace',
    modifier: false,
    composing: false,
    targetTag: 'button',
    targetInputType: null,
    targetEditable: false,
    targetIsDocument: false,
    targetInsideChart: true,
    lastPressInChart: true,
    ...patch
  })
  it('does not delete or deselect from a control in a dialog', () => {
    expect(editorKeyAction(ctx({}))).toBe('delete')
    expect(editorKeyAction(ctx({ targetInDialog: true }))).toBeNull()
    expect(editorKeyAction(ctx({ key: 'Escape', targetInDialog: true }))).toBeNull()
  })
})

describe('Settings > Restore defaults forgets the Settings values (SC-124)', () => {
  it('clears user paths and the objects they leave empty, and keeps the rest', () => {
    const stack = new StyleStack({ grid: { show: false } })
    stack.addUser({ grid: { show: true }, candle: { priceMark: { last: { show: false }, high: { show: false } } } })
    stack.clearUser(['grid.show', 'candle.priceMark.last.show'])
    const out = stack.compose('dark', [{}]) as any
    // The host's value applies again; the other Settings value stays.
    expect(out.grid.show).toBe(false)
    expect(out.candle.priceMark.last).toBeUndefined()
    expect(out.candle.priceMark.high.show).toBe(false)
  })
})
