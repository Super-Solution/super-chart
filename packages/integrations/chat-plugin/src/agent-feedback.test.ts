import { describe, expect, it } from 'vitest'
import { checkMarkShapes, correctTimeUnits, explainProblem, levelsOf, summarizeData, swingsOf, whyNotShown } from './agent-feedback'
import type { ChartAnnotation } from '@supersolutions/super-protocol'

const level = (key: string, time: number, price: number): ChartAnnotation => ({ key, kind: 'level', anchors: [{ time, price }] }) as ChartAnnotation
const data = summarizeData(300, 1_700_000_000_000, 1_700_100_000_000, [
  { timestamp: 1_700_099_000_000, high: 120, low: 100, close: 110 }, { timestamp: 1_700_100_000_000, high: 125, low: 105, close: 118 }
])

describe('agent feedback', () => {
  it('turns seconds into milliseconds only when every time is clearly seconds', () => {
    const { annotations, warnings } = correctTimeUnits([level('a', 1_700_000_000, 100), level('b', 1_700_000_000_000, 100)])
    expect(annotations[0].anchors[0].time).toBe(1_700_000_000_000)
    expect(annotations[1].anchors[0].time).toBe(1_700_000_000_000)
    expect(warnings.map(item => item.key)).toEqual(['a'])
  })

  it('summarises the reach of the data', () => {
    expect(data).toMatchObject({ count: 300, low: 100, high: 125, lastClose: 118 })
    expect(summarizeData(0, null, null, [])).toMatchObject({ low: null, high: null, lastClose: null })
  })

  it('says why an accepted mark is not on screen', () => {
    expect(whyNotShown(level('x', 1_700_050_000_000, 100), 'visible', data)).toBeNull()
    expect(whyNotShown(level('x', 1_600_000_000_000, 110), 'offscreen', data)).toMatch(/before the first loaded bar/)
    expect(whyNotShown(level('x', 1_800_000_000_000, 110), 'offscreen', data)).toMatch(/after the last bar/)
    expect(whyNotShown(level('x', 1_700_050_000_000, 900), 'offscreen', data)).toMatch(/above the recent range 100 to 125/)
    expect(whyNotShown(level('x', 1_700_050_000_000, 5), 'offscreen', data)).toMatch(/below the recent range/)
    expect(whyNotShown(level('x', 1_700_050_000_000, 110), 'unprojectable', data)).toMatch(/milliseconds/)
    expect(whyNotShown(level('x', 1_700_050_000_000, 110), 'offscreen', data)).toMatch(/outside the part of the chart on screen/)
  })
})

describe('levelsOf', () => {
  const swing = Array.from({ length: 160 }, (_, i) => {
    const c = 105 - 5 * Math.cos((i / 36) * Math.PI * 2)
    return { timestamp: 1_700_000_000_000 + i * 60_000, high: c + 0.5, low: c - 0.5, close: c }
  })
  it('gives prices on each side of the last close with when they last held', () => {
    const { support, resistance, lastClose } = levelsOf(swing, 3)
    expect(lastClose).toBe(swing[159].close)
    expect(support.length + resistance.length).toBeGreaterThan(0)
    for (const level of support) expect(level.price).toBeLessThanOrEqual(lastClose as number)
    for (const level of resistance) expect(level.price).toBeGreaterThan(lastClose as number)
    expect(resistance[0].lastTime).toBeGreaterThan(swing[0].timestamp)
  })
  it('is empty without bars', () => { expect(levelsOf([])).toEqual({ support: [], resistance: [], lastClose: null }) })
})

describe('checkMarkShapes', () => {
  const mark = (key: string, kind: string, prices: number[]): ChartAnnotation => ({ key, kind, anchors: prices.map((price, index) => ({ time: 1_700_000_000_000 + index * 60_000, price })) }) as ChartAnnotation
  it('flags a plan whose stop is on the target side, and passes a sound long and short', () => {
    expect(checkMarkShapes([mark('bad', 'plan', [100, 110, 105])]).map(w => w.code)).toEqual(['invalid_plan'])
    expect(checkMarkShapes([mark('long', 'plan', [100, 110, 95]), mark('short', 'plan', [100, 90, 105])])).toEqual([])
  })
  it('flags a valid plan whose entry and target share one time (it has no width)', () => {
    const same = { key: 'same', kind: 'plan', anchors: [100, 110, 95].map(price => ({ time: 1_700_000_000_000, price })) } as ChartAnnotation
    expect(checkMarkShapes([same]).map(w => w.code)).toEqual(['plan_no_width'])
  })
  it('flags a zone or retracement with no height', () => {
    expect(checkMarkShapes([mark('z', 'zone', [100, 100]), mark('f', 'fibonacci', [5, 5])]).map(w => w.code)).toEqual(['flat_range', 'flat_range'])
    expect(checkMarkShapes([mark('ok', 'zone', [100, 101])])).toEqual([])
  })
  it('flags level lines within 0.1% of each other, once per extra line', () => {
    const warnings = checkMarkShapes([mark('support', 'level', [100]), mark('key_support', 'level', [100.05]), mark('far', 'level', [101])])
    expect(warnings.map(w => [w.key, w.code])).toEqual([['key_support', 'near_duplicate']])
  })
})

describe('swingsOf', () => {
  const bars = Array.from({ length: 120 }, (_, i) => { const c = 105 - 5 * Math.cos((i / 30) * Math.PI * 2); return { timestamp: 1_700_000_000_000 + i * 60_000, high: c + 0.5, low: c - 0.5, close: c } })
  it('returns alternating swings on real bar times and the last leg', () => {
    const { swings, lastLeg } = swingsOf(bars, 3, 4)
    expect(swings).toHaveLength(4)
    const times = new Set(bars.map(bar => bar.timestamp))
    for (const swing of swings) expect(times.has(swing.time)).toBe(true)
    expect(lastLeg?.to).toEqual(swings[3])
    expect(lastLeg?.from).toEqual(swings[2])
    expect(lastLeg?.direction).toBe(swings[3].price >= swings[2].price ? 'up' : 'down')
  })
  it('has no swings and no leg for a chart with no bars', () => {
    expect(swingsOf([], 5)).toEqual({ swings: [], lastLeg: null })
  })
  it('has no leg when there are too few bars', () => {
    expect(swingsOf(bars.slice(0, 4), 3)).toEqual({ swings: [], lastLeg: null })
  })

  it('adds a hint to the validator\'s complaint only when a time was sent as a string', () => {
    const problem = 'annotation anchors need a finite time.'
    expect(explainProblem(problem, [{ anchors: [{ time: '2026-11-27T10:00:00Z', price: 1 }] }])).toMatch(/milliseconds since the epoch/)
    expect(explainProblem(problem, [{ anchors: [{ price: 1 }] }])).toBe(problem)
    expect(explainProblem('annotation.kind must be level.', [{ anchors: [{ time: 'x' }] }])).toBe('annotation.kind must be level.')
  })
})
