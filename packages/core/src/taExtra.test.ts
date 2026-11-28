import { describe, expect, it } from 'vitest'
import { chaikinOscillator, dpo, fisher, linearRegression, ppo } from './taExtra'
import { ema, sma } from './ta'

const ramp = Array.from({ length: 40 }, (_, i) => 100 + i)

describe('ppo', () => {
  it('is the EMA gap as a percent of the slow EMA, and its hist is line minus signal', () => {
    const r = ppo(ramp, 3, 6, 4)
    const f = ema(ramp, 3), s = ema(ramp, 6)
    const i = 20
    expect(r.ppo[i]).toBeCloseTo(((f[i] as number) - (s[i] as number)) / (s[i] as number) * 100, 10)
    expect(r.hist[i]).toBeCloseTo((r.ppo[i] as number) - (r.signal[i] as number), 10)
    expect(r.ppo[0]).toBeNull()
  })
  it('gives null, not a number, where the slow EMA is zero', () => {
    expect(ppo(new Array(20).fill(0), 2, 4, 3).ppo.every(v => v === null)).toBe(true)
  })
})

describe('chaikinOscillator', () => {
  it('is zero when the close is always mid-range, since nothing accumulates', () => {
    const h = new Array(30).fill(11), l = new Array(30).fill(9), c = new Array(30).fill(10), v = new Array(30).fill(100)
    expect(chaikinOscillator(h, l, c, v, 3, 10).filter(x => x !== null).every(x => x === 0)).toBe(true)
  })
  it('turns positive when closes sit at the highs on volume', () => {
    const h = new Array(30).fill(11), l = new Array(30).fill(9), c = new Array(30).fill(11), v = Array.from({ length: 30 }, (_, i) => 100 + i * 10)
    const out = chaikinOscillator(h, l, c, v, 3, 10)
    expect(out[29]).toBeGreaterThan(0)
  })
})

describe('dpo', () => {
  it('is the price len/2+1 bars back minus the average now', () => {
    const out = dpo(ramp, 10), average = sma(ramp, 10)
    expect(out[20]).toBeCloseTo(ramp[20 - 6] - (average[20] as number), 10)
    expect(out[3]).toBeNull()
  })
  it('is flat for a straight ramp, because the trend is what it removes', () => {
    const out = dpo(ramp, 10).filter(x => x !== null) as number[]
    expect(Math.max(...out) - Math.min(...out)).toBeCloseTo(0, 10)
  })
})

describe('linearRegression', () => {
  it('follows a straight line exactly and has no width', () => {
    const r = linearRegression(ramp, 10, 2)
    expect(r.mid[39]).toBeCloseTo(139, 10)
    expect((r.upper[39] as number) - (r.lower[39] as number)).toBeCloseTo(0, 8)
    expect(r.mid[8]).toBeNull()
  })
  it('widens on noise and keeps the middle between the bands', () => {
    const noisy = ramp.map((v, i) => v + (i % 2 === 0 ? 3 : -3))
    const r = linearRegression(noisy, 10, 2)
    expect((r.upper[30] as number) - (r.lower[30] as number)).toBeGreaterThan(5)
    expect(r.mid[30]).toBeGreaterThan(r.lower[30] as number)
    expect(r.mid[30]).toBeLessThan(r.upper[30] as number)
  })
  it('skips a window with a gap', () => {
    const gap = ramp.slice(); gap[25] = null
    expect(linearRegression(gap, 10, 2).mid[30]).toBeNull()
    expect(linearRegression(gap, 10, 2).mid[39]).not.toBeNull()
  })
})

describe('fisher', () => {
  it('rises in an uptrend and its trigger is the previous value', () => {
    const high = ramp.map(v => v + 1), low = ramp.map(v => v - 1)
    const r = fisher(high, low, 9)
    expect((r.fisher[39] as number)).toBeGreaterThan(0)
    expect(r.trigger[20]).toBe(r.fisher[19])
  })
  it('stays finite on a flat market', () => {
    const r = fisher(new Array(30).fill(10), new Array(30).fill(10), 9)
    expect(r.fisher.every(v => v === null || Number.isFinite(v))).toBe(true)
  })
})
