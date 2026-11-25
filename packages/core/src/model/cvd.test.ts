// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { TECHNICAL_INDICATOR_DEFINITIONS } from './indicatorPack'
import type { MarketBar } from '../types'

const DAY = 86_400_000, T0 = Date.UTC(2026, 0, 5)
const definition = (name: string): (typeof TECHNICAL_INDICATOR_DEFINITIONS)[number] => TECHNICAL_INDICATOR_DEFINITIONS.find(item => item.name === name)!
const cvd = (name: string, bars: MarketBar[], params: number[] = []): Array<number | null> => definition(name).calculate(bars, params).map(row => row.cvd)
const bar = (i: number, extra: Partial<MarketBar> & { buyVolume?: number }, step = 3_600_000): MarketBar => ({ timestamp: T0 + i * step, open: 10, high: 12, low: 8, close: 10, volume: 100, ...extra })

describe('SC_CVD (exact, from buyVolume)', () => {
  it('adds buy minus sell volume bar by bar', () => {
    // 70 bought, 30 sold: +40. 20 bought, 80 sold: -60. 50/50: 0. All bought: +100.
    const bars = [bar(0, { buyVolume: 70 }), bar(1, { buyVolume: 20 }), bar(2, { buyVolume: 50 }), bar(3, { buyVolume: 100 })]
    expect(cvd('SC_CVD', bars)).toEqual([40, -20, -20, 80])
  })
  it('leaves a bar without usable trade direction as a gap and does not count it', () => {
    const bars = [bar(0, { buyVolume: 70 }), bar(1, {}), bar(2, { buyVolume: 150 }), bar(3, { buyVolume: -1 }), bar(4, { buyVolume: 0 }), bar(5, { volume: undefined, buyVolume: 5 }), bar(6, { buyVolume: 60 })]
    expect(cvd('SC_CVD', bars)).toEqual([40, null, null, null, -60, null, -40])
  })
  it('can restart at every UTC midnight', () => {
    const bars = [bar(0, { buyVolume: 70 }, 12 * 3_600_000), bar(1, { buyVolume: 70 }, 12 * 3_600_000), bar(2, { buyVolume: 20 }, 12 * 3_600_000), bar(3, { buyVolume: 20 }, 12 * 3_600_000)]
    expect(cvd('SC_CVD', bars, [1])).toEqual([40, 80, -60, -120])
    expect(cvd('SC_CVD', bars, [0])).toEqual([40, 80, 20, -40])
    expect(bars[2].timestamp - bars[0].timestamp).toBe(DAY)
  })
  it('refuses a reset value it does not know', () => {
    expect(() => cvd('SC_CVD', [bar(0, { buyVolume: 1 })], [2])).toThrow(RangeError)
    expect(() => cvd('SC_CVD', [bar(0, { buyVolume: 1 })], [0, 1])).toThrow(RangeError)
  })
})

describe('SC_CVD_EST (estimated from OHLCV)', () => {
  it('splits each bar by where the close sits in its range', () => {
    const bars = [
      bar(0, { close: 12 }), // at the high: all bought, +100
      bar(1, { close: 8 }), // at the low: all sold, -100
      bar(2, { close: 10 }), // in the middle: 0
      bar(3, { close: 11 }) // three quarters up: +50
    ]
    expect(cvd('SC_CVD_EST', bars)).toEqual([100, 0, 0, 50])
  })
  it('counts a bar with no range as zero and a bar without volume as a gap', () => {
    const bars = [bar(0, { high: 10, low: 10, close: 10 }), bar(1, { volume: undefined }), bar(2, { close: 12, volume: 40 })]
    expect(cvd('SC_CVD_EST', bars)).toEqual([0, null, 40])
  })
  it('is labelled as an estimate so it is never mistaken for the exact one', () => {
    expect(definition('SC_CVD_EST').figures[0].title).toMatch(/estimate/i)
    expect(definition('SC_CVD').figures[0].title).toBe('CVD')
    expect(definition('SC_CVD').pane).toBe('separate')
  })
})
