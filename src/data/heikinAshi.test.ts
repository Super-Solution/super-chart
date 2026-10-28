/**
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at

 * http://www.apache.org/licenses/LICENSE-2.0

 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { describe, expect, it } from 'vitest'
import { isHeikinAshiUp, toHeikinAshi, type OhlcBar } from './heikinAshi'

function bar (timestamp: number, open: number, high: number, low: number, close: number, volume = 100): OhlcBar {
  return { timestamp, open, high, low, close, volume }
}

describe('toHeikinAshi', () => {
  it('is total: same length out as in, empty in -> empty out', () => {
    expect(toHeikinAshi([])).toEqual([])
    const bars = [bar(0, 1, 2, 0.5, 1.5), bar(1, 1.5, 2.5, 1, 2)]
    expect(toHeikinAshi(bars).length).toBe(bars.length)
  })

  it('first bar: haOpen = (O+C)/2, haClose = (O+H+L+C)/4', () => {
    const [ha] = toHeikinAshi([bar(0, 10, 12, 9, 11)])
    expect(ha.open).toBeCloseTo((10 + 11) / 2, 10)
    expect(ha.close).toBeCloseTo((10 + 12 + 9 + 11) / 4, 10)
  })

  it('second bar: haOpen = average of the PREVIOUS ha open and ha close (not the raw previous bar)', () => {
    const bars = [bar(0, 10, 12, 9, 11), bar(1, 11, 13, 10.5, 12)]
    const [ha0, ha1] = toHeikinAshi(bars)
    expect(ha1.open).toBeCloseTo((ha0.open + ha0.close) / 2, 10)
    expect(ha1.close).toBeCloseTo((11 + 13 + 10.5 + 12) / 4, 10)
  })

  it('haHigh/haLow always include the wick extremes and both ha open/close (never a narrower range than the real bar)', () => {
    const bars = [bar(0, 10, 20, 1, 15), bar(1, 15, 16, 14, 15.5)]
    const result = toHeikinAshi(bars)
    for (const [i, ha] of result.entries()) {
      const raw = bars[i]
      expect(ha.high).toBeGreaterThanOrEqual(Math.max(ha.open, ha.close))
      expect(ha.high).toBeGreaterThanOrEqual(raw.high)
      expect(ha.low).toBeLessThanOrEqual(Math.min(ha.open, ha.close))
      expect(ha.low).toBeLessThanOrEqual(raw.low)
    }
  })

  it('leaves volume, turnover and timestamp untouched', () => {
    const bars = [{ ...bar(1000, 10, 12, 9, 11, 250), turnover: 9999 }]
    const [ha] = toHeikinAshi(bars)
    expect(ha.timestamp).toBe(1000)
    expect(ha.volume).toBe(250)
    expect(ha.turnover).toBe(9999)
  })

  it('is deterministic regardless of how many times it is re-run over the same prefix (stable scroll-back)', () => {
    const bars = [bar(0, 10, 12, 9, 11), bar(1, 11, 13, 10.5, 12), bar(2, 12, 12.5, 11, 11.5)]
    const full = toHeikinAshi(bars)
    const prefixThenExtended = toHeikinAshi(bars.slice(0, 2))
    // The first two HA bars must be identical whether computed alone or as a prefix of the full series.
    expect(prefixThenExtended[0]).toEqual(full[0])
    expect(prefixThenExtended[1]).toEqual(full[1])
  })

  it('a non-finite OHLC bar passes through unchanged rather than poisoning the whole series with NaN', () => {
    const bars = [bar(0, 10, 12, 9, 11), bar(1, NaN, 13, 10.5, 12), bar(2, 12, 12.5, 11, 11.5)]
    const result = toHeikinAshi(bars)
    expect(result[1]).toEqual(bars[1]) // untouched
    expect(Number.isFinite(result[2].open)).toBe(true) // recovers on the next good bar
    expect(Number.isFinite(result[2].close)).toBe(true)
  })

  it('put-back: without averaging with the PREVIOUS ha candle (using the raw previous bar instead), bar 2 would differ from this expected value', () => {
    // Chosen so H+L != O+C for bar 0, so ha0.open != ha0.close (unlike the
    // other fixtures above, where that coincidence would mask this bug).
    const bars = [bar(0, 10, 20, 5, 11), bar(1, 11, 13, 10.5, 12)]
    const [ha0, ha1] = toHeikinAshi(bars)
    expect(ha0.open).not.toBeCloseTo(ha0.close, 6)
    const wrongOpen = (bars[0].open + bars[0].close) / 2 // the bug: using raw bar 0's O/C instead of ha0's
    expect(ha1.open).toBeCloseTo((ha0.open + ha0.close) / 2, 10)
    expect(ha1.open).not.toBeCloseTo(wrongOpen, 6)
  })
})

describe('isHeikinAshiUp', () => {
  it('true when close >= open', () => {
    expect(isHeikinAshiUp({ open: 10, close: 10.01 })).toBe(true)
    expect(isHeikinAshiUp({ open: 10, close: 10 })).toBe(true)
    expect(isHeikinAshiUp({ open: 10, close: 9.99 })).toBe(false)
  })
})
