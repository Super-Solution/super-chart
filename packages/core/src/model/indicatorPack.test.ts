// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { TECHNICAL_INDICATOR_DEFINITIONS, TECHNICAL_INDICATOR_NAMES } from './indicatorPack'
import * as ta from '../ta'
import type { MarketBar } from '../types'

const HOUR = 3_600_000, T0 = Date.UTC(2026, 0, 5)
const definition = (name: string): (typeof TECHNICAL_INDICATOR_DEFINITIONS)[number] => TECHNICAL_INDICATOR_DEFINITIONS.find(item => item.name === name)!
const bars: MarketBar[] = Array.from({ length: 150 }, (_, i) => {
  const close = 100 + 10 * Math.sin(i / 6) + (i % 5)
  return { timestamp: T0 + i * 4 * HOUR, open: close - 0.5, high: close + 1 + (i % 3), low: close - 1 - (i % 2), close, volume: 100 + (i % 9) * 40 }
})
const column = (name: string, key: string, params: number[] = []): Array<number | null> => definition(name).calculate(bars, params).map(row => row[key])
const high = bars.map(b => b.high), low = bars.map(b => b.low), close = bars.map(b => b.close), volume = bars.map(b => b.volume as number)

describe('the 0.13 indicator definitions', () => {
  it('every registered name has exactly one definition, and the new ten are present', () => {
    expect(TECHNICAL_INDICATOR_DEFINITIONS.map(d => d.name).sort()).toEqual([...TECHNICAL_INDICATOR_NAMES].sort())
    for (const name of ['SC_AROON', 'SC_CMF', 'SC_ADL', 'SC_FORCE', 'SC_VORTEX', 'SC_TSI', 'SC_ULTIMATE', 'SC_ZIGZAG', 'SC_PIVOTS', 'SC_CHANDELIER', 'SC_SR']) expect(definition(name), name).toBeDefined()
  })
  it('SC_SR draws flat levels on the right side of the last close and rejects a bad strength', () => {
    const last = bars[bars.length - 1].close
    const above = column('SC_SR', 'r1'), below = column('SC_SR', 's1')
    expect(new Set(above).size).toBe(1)
    expect(new Set(below).size).toBe(1)
    if (above[0] !== null) expect(above[0]).toBeGreaterThan(last)
    if (below[0] !== null) expect(below[0]).toBeLessThanOrEqual(last)
    expect(() => column('SC_SR', 'r1', [0])).toThrow(RangeError)
  })
  it('their rows are the kernels, row key by row key, with the documented defaults', () => {
    expect(column('SC_AROON', 'up')).toEqual(ta.aroon(high, low, 14).up)
    expect(column('SC_AROON', 'down', [5])).toEqual(ta.aroon(high, low, 5).down)
    expect(column('SC_CMF', 'cmf')).toEqual(ta.cmf(high, low, close, volume, 20))
    expect(column('SC_ADL', 'adl')).toEqual(ta.adl(high, low, close, volume))
    expect(column('SC_FORCE', 'force')).toEqual(ta.forceIndex(close, volume, 13))
    expect(column('SC_VORTEX', 'minus')).toEqual(ta.vortex(high, low, close, 14).minus)
    expect(column('SC_TSI', 'signal')).toEqual(ta.tsi(close, 25, 13, 13).signal)
    expect(column('SC_ULTIMATE', 'uo')).toEqual(ta.ultimate(high, low, close, 7, 14, 28))
    expect(column('SC_ZIGZAG', 'zigzag')).toEqual(ta.zigzag(high, low, 5).line)
    expect(column('SC_CHANDELIER', 'short', [10, 2])).toEqual(ta.chandelier(high, low, close, 10, 2).short)
  })
  it('SC_PIVOTS uses the previous UTC day by default and honours the anchor, offset and kind', () => {
    const day = (anchor: number, offset: number): Array<number | null> => bars.map(b => ta.periodBucket(b.timestamp, anchor, offset))
    expect(column('SC_PIVOTS', 'pp')).toEqual(ta.pivotPoints(high, low, close, day(0, 0), 0).pp)
    expect(column('SC_PIVOTS', 'r2', [0, 0, 1])).toEqual(ta.pivotPoints(high, low, close, day(0, 0), 1).r2)
    expect(column('SC_PIVOTS', 's1', [1, -120, 0])).toEqual(ta.pivotPoints(high, low, close, day(1, -120), 0).s1)
    expect(column('SC_PIVOTS', 'pp').slice(0, 6)).toEqual([null, null, null, null, null, null])
    expect(column('SC_PIVOTS', 'pp')[6]).not.toBeNull()
  })
  it('rejects a parameter it cannot honour instead of calculating something else', () => {
    expect(() => column('SC_AROON', 'up', [0])).toThrow(RangeError)
    expect(() => column('SC_ZIGZAG', 'zigzag', [0])).toThrow(RangeError)
    expect(() => column('SC_CHANDELIER', 'long', [22, -1])).toThrow(RangeError)
    expect(() => column('SC_PIVOTS', 'pp', [5])).toThrow(/anchor must be/)
    expect(() => column('SC_PIVOTS', 'pp', [0, 0, 2])).toThrow(/kind must be 0 \(classic\) or 1 \(Fibonacci\)/)
    expect(() => column('SC_PIVOTS', 'pp', [0, 0, 0, 1])).toThrow(RangeError)
    expect(() => column('SC_VWAP', 'vwap', [9])).toThrow(/SC_VWAP anchor must be/)
  })
  it('puts price-scale indicators on the price pane and oscillators in their own', () => {
    for (const name of ['SC_ZIGZAG', 'SC_PIVOTS', 'SC_CHANDELIER', 'SC_SR']) expect(definition(name).pane, name).toBe('price')
    for (const name of ['SC_AROON', 'SC_CMF', 'SC_ADL', 'SC_FORCE', 'SC_VORTEX', 'SC_TSI', 'SC_ULTIMATE']) expect(definition(name).pane, name).toBe('separate')
  })
})
