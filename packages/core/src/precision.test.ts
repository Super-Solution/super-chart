import { describe, expect, it } from 'vitest'

import { derivePrecision, resolvePricePrecision } from './precision'

function bars (...closes: number[]): Array<{ open: number, high: number, low: number, close: number }> {
  return closes.map(c => ({ open: c, high: c * 1.001, low: c * 0.999, close: c }))
}

describe('SC-020: derivePrecision', () => {
  it('BONK-sized prices (~0.00002) get 8 decimals', () => {
    expect(derivePrecision(bars(0.0000189, 0.0000201, 0.0000207))).toBe(8)
  })

  it('a 0.64 asset gets 4 decimals', () => {
    expect(derivePrecision(bars(0.64, 0.645, 0.638))).toBe(4)
  })

  it('BTC-sized prices get 2 decimals', () => {
    expect(derivePrecision(bars(64000, 64123.456789, 63980.1))).toBe(2)
  })

  it('long float BTC data still gets 2, not 9, decimals (magnitude drives it, not the feed\'s own decimals)', () => {
    expect(derivePrecision(bars(64123.456789123, 64000.000000001))).toBe(2)
  })

  it('no bars: 2 (the pre-load default)', () => {
    expect(derivePrecision([])).toBe(2)
  })

  it('all-zero data: 2 (no positive price to derive from)', () => {
    expect(derivePrecision(bars(0, 0, 0))).toBe(2)
  })

  it('a range narrower than one tick at the first-pass precision is raised further', () => {
    // minPositive 0.64 alone gives 4 (ceil(-log10(0.64)) + 3), but the two
    // bars differ by 3e-7: a range narrower than 10^-4 there, so precision
    // must be raised until the range is resolvable.
    const flat = { open: 0.64, high: 0.64, low: 0.64, close: 0.64 }
    const nudged = { open: 0.6400003, high: 0.6400003, low: 0.6400003, close: 0.6400003 }
    const p = derivePrecision([flat, nudged])
    expect(p).toBeGreaterThan(4)
    expect(p).toBeLessThanOrEqual(10)
  })

  it('an exactly flat price (zero range) is not raised to the cap: there is no range to resolve', () => {
    const flat = { open: 0.64, high: 0.64, low: 0.64, close: 0.64 }
    expect(derivePrecision([flat, flat, flat])).toBe(4)
  })

  it('a mixed-magnitude series (a gap-up) derives from the smallest positive price seen, not the largest', () => {
    const withGapUp = derivePrecision(bars(1, 1, 100000))
    const withoutGapUp = derivePrecision(bars(1, 1))
    expect(withGapUp).toBe(withoutGapUp)
  })
})

describe('SC-020: resolvePricePrecision', () => {
  it('an explicit number always wins over the data', () => {
    expect(resolvePricePrecision(2, bars(0.0000189))).toBe(2)
    expect(resolvePricePrecision(6, [])).toBe(6)
  })

  it('"auto" derives from the bars', () => {
    expect(resolvePricePrecision('auto', bars(0.0000189))).toBe(8)
  })

  it('omitted (undefined) derives from the bars, same as "auto"', () => {
    expect(resolvePricePrecision(undefined, bars(64000))).toBe(2)
  })
})
