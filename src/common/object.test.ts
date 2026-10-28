import { describe, expect, it } from 'vitest'

import { deepClone, mergeDeep, setPath } from './object'

describe('deepClone', () => {
  it('shares no nested object or array with the source', () => {
    const live = { candle: { priceMark: { last: { show: true } }, bar: { upColor: '#0f0' } }, grid: { horizontal: { dashedValue: [2, 2] } } }
    const copy = deepClone(live)
    expect(copy).toEqual(live)
    expect(copy).not.toBe(live)
    expect(copy.candle).not.toBe(live.candle)
    expect(copy.candle.priceMark.last).not.toBe(live.candle.priceMark.last)
    expect(copy.grid.horizontal.dashedValue).not.toBe(live.grid.horizontal.dashedValue)
    // The point of the copy: changing the live object later does not change it.
    live.candle.priceMark.last.show = false
    live.grid.horizontal.dashedValue.push(9)
    expect(copy.candle.priceMark.last.show).toBe(true)
    expect(copy.grid.horizontal.dashedValue).toEqual([2, 2])
  })

  it('keeps functions and class instances by reference', () => {
    const fn = (): string => 'x'
    const date = new Date(0)
    const copy = deepClone({ tooltip: { custom: fn }, at: date })
    expect(copy.tooltip.custom).toBe(fn)
    expect(copy.at).toBe(date)
  })

  it('returns primitives unchanged', () => {
    expect(deepClone(3)).toBe(3)
    expect(deepClone(null)).toBe(null)
    expect(deepClone('a')).toBe('a')
  })
})

describe('setPath', () => {
  it('creates missing levels', () => {
    const style = {}
    setPath(style, 'candle.priceMark.last.show', false)
    expect(style).toEqual({ candle: { priceMark: { last: { show: false } } } })
  })

  it('keeps siblings and replaces non-object levels', () => {
    const style: Record<string, unknown> = { candle: { type: 'area', priceMark: 1 } }
    setPath(style, 'candle.priceMark.high.show', true)
    expect(style).toEqual({ candle: { type: 'area', priceMark: { high: { show: true } } } })
  })

  it('sets a top-level key', () => {
    expect(setPath({ a: 1 }, 'b', 2)).toEqual({ a: 1, b: 2 })
  })
})

describe('mergeDeep', () => {
  it('merges plain objects key by key, later layers winning, without touching the inputs', () => {
    const a = { grid: { horizontal: { color: '#111', style: 'solid' } }, candle: { type: 'area' } }
    const b = { grid: { horizontal: { color: '#222' } }, xAxis: { tickText: { size: 11 } } }
    const out = mergeDeep<Record<string, any>>(a, b, undefined, null)
    expect(out).toEqual({ grid: { horizontal: { color: '#222', style: 'solid' } }, candle: { type: 'area' }, xAxis: { tickText: { size: 11 } } })
    expect(a.grid.horizontal.color).toBe('#111')
    expect(out.grid).not.toBe(a.grid)
    expect(out.xAxis).not.toBe(b.xAxis)
  })

  it('replaces arrays whole and skips undefined values', () => {
    const out = mergeDeep<Record<string, any>>({ bars: [{ a: 1, b: 2 }], x: 1 }, { bars: [{ a: 3 }], x: undefined })
    expect(out).toEqual({ bars: [{ a: 3 }], x: 1 })
  })
})
