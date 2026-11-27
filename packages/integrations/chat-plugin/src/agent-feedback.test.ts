import { describe, expect, it } from 'vitest'
import { correctTimeUnits, levelsOf, summarizeData, whyNotShown } from './agent-feedback'
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
