import { describe, expect, it } from 'vitest'
import { supportResistance, swingPivots, type LevelBar } from './supportResistance'

/** A price that swings between 100 and 110 four times and ends on the way up. */
function ranging (): LevelBar[] {
  return Array.from({ length: 160 }, (_, i) => {
    const c = 105 - 5 * Math.cos((i / 36) * Math.PI * 2)
    return { high: c + 0.5, low: c - 0.5, close: c }
  })
}

describe('supportResistance', () => {
  it('finds the floor and the ceiling a range keeps touching', () => {
    const levels = supportResistance(ranging(), { strength: 3, tolerance: 1 })
    expect(levels.support.length).toBeGreaterThan(0)
    expect(levels.resistance.length).toBeGreaterThan(0)
    expect(levels.support[0].price).toBeGreaterThan(99)
    expect(levels.support[0].price).toBeLessThan(101.5)
    expect(levels.support[0].touches).toBeGreaterThanOrEqual(2)
    expect(levels.resistance[0].price).toBeGreaterThan(109)
  })
  it('orders each side by distance from the last close', () => {
    const { support, resistance } = supportResistance(ranging(), { strength: 3, tolerance: 1 })
    const last = ranging()[159].close
    for (const side of [support, resistance]) for (let i = 1; i < side.length; i++) {
      expect(Math.abs(side[i].price - last)).toBeGreaterThanOrEqual(Math.abs(side[i - 1].price - last))
    }
  })
  it('returns nothing when there are too few bars or no repeated touch', () => {
    expect(supportResistance(ranging().slice(0, 5)).support).toEqual([])
    const trend = Array.from({ length: 80 }, (_, i) => ({ high: i + 1, low: i - 1, close: i }))
    expect(supportResistance(trend, { strength: 3 }).resistance).toEqual([])
  })
  it('rejects unusable options instead of changing them', () => {
    expect(() => supportResistance(ranging(), { strength: 0 })).toThrow(RangeError)
    expect(() => supportResistance(ranging(), { lookback: 1.5 })).toThrow(RangeError)
    expect(() => supportResistance(ranging(), { tolerance: -1 })).toThrow(RangeError)
  })
})

describe('swingPivots', () => {
  it('alternates highs and lows in time order along a swinging price', () => {
    const pivots = swingPivots(ranging(), { strength: 3 })
    expect(pivots.length).toBeGreaterThanOrEqual(6)
    for (let i = 1; i < pivots.length; i++) {
      expect(pivots[i].kind).not.toBe(pivots[i - 1].kind)
      expect(pivots[i].index).toBeGreaterThan(pivots[i - 1].index)
    }
    for (const pivot of pivots) expect(pivot.kind === 'high' ? pivot.price > 109 : pivot.price < 101).toBe(true)
  })
  it('keeps the more extreme of two highs with no low between them', () => {
    const bars: LevelBar[] = [1, 3, 9, 8, 8.5, 8.2, 9.5, 12, 3, 1, 0].map(h => ({ high: h, low: h - 0.5, close: h - 0.25 }))
    const highs = swingPivots(bars, { strength: 2 }).filter(p => p.kind === 'high')
    expect(highs.map(p => p.price)).toContain(12)
    expect(highs.map(p => p.price)).not.toContain(9)
  })
  it('is empty when there are too few bars, and refuses a bad strength', () => {
    expect(swingPivots(ranging().slice(0, 5), { strength: 3 })).toEqual([])
    expect(() => swingPivots(ranging(), { strength: 0 })).toThrow(RangeError)
  })
})
