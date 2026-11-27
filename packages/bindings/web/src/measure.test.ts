import { describe, expect, it } from 'vitest'
import { formatDuration, measureBetween, measureLines, nearestBarTime } from './measure'

const bars = Array.from({ length: 10 }, (_, i) => ({ timestamp: 1000 + i * 60_000 }))

describe('measureBetween', () => {
  it('reports change, percent, bars after the start and elapsed time', () => {
    const m = measureBetween({ timestamp: 1000, price: 100 }, { timestamp: 1000 + 4 * 60_000, price: 110 }, bars)
    expect(m).toEqual({ change: 10, percent: 10, bars: 4, duration: 240_000 })
  })
  it('is negative both ways when the end is earlier and lower', () => {
    const m = measureBetween({ timestamp: 1000 + 4 * 60_000, price: 110 }, { timestamp: 1000, price: 99 }, bars)
    expect(m.change).toBe(-11)
    expect(m.bars).toBe(-4)
    expect(m.duration).toBe(-240_000)
  })
  it('leaves percent out when the start price is zero', () => {
    expect(measureBetween({ timestamp: 1000, price: 0 }, { timestamp: 1000, price: 5 }, bars).percent).toBeNull()
  })
})

describe('formatDuration', () => {
  it('keeps the two largest units', () => {
    expect(formatDuration(90_000)).toBe('1m 30s')
    expect(formatDuration(4_500_000)).toBe('1h 15m')
    expect(formatDuration(2.5 * 86_400_000)).toBe('2d 12h')
    expect(formatDuration(-60_000)).toBe('1m')
    expect(formatDuration(0)).toBe('0s')
  })
})

describe('measureLines', () => {
  it('signs the change and gives bars and time on the second line', () => {
    const lines = measureLines({ change: -2.5, percent: -1.25, bars: -3, duration: -180_000 }, v => v.toFixed(2), { bars: n => `${n} bars` })
    expect(lines).toEqual(['−2.50 (−1.25%)', '3 bars, 3m'])
  })
})

describe('nearestBarTime', () => {
  it('takes the nearest bar either side, and the time itself with no bars', () => {
    expect(nearestBarTime(bars, 1000 + 61_000)).toBe(1000 + 60_000)
    expect(nearestBarTime(bars, 1000 + 119_000)).toBe(1000 + 120_000)
    expect(nearestBarTime(bars, 0)).toBe(1000)
    expect(nearestBarTime(bars, 10 ** 9)).toBe(1000 + 9 * 60_000)
    expect(nearestBarTime([], 5)).toBe(5)
  })
})
