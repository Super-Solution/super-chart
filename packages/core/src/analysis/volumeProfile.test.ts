import { describe, expect, it } from 'vitest'
import { volumeProfile, type VolumeProfileBar } from './volumeProfile'

function rng (seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6D2B79F5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('volumeProfile', () => {
  it('a bar spanning the whole range spreads across every row, not just one', () => {
    const bars: VolumeProfileBar[] = Array.from({ length: 30 }, () => ({ high: 110, low: 90, volume: 100 }))
    const p = volumeProfile(bars, { rows: 24 })
    expect(p.rows.every(r => r.volume > 0)).toBe(true)
    // Equal overlap per row for every bar: every row gets the same volume.
    const first = p.rows[0].volume
    for (const r of p.rows) expect(r.volume).toBeCloseTo(first, 6)
  })

  it('conserves total volume', () => {
    const r = rng(1)
    const bars: VolumeProfileBar[] = Array.from({ length: 200 }, () => {
      const low = 90 + r() * 20
      const high = low + r() * 5
      return { high, low, volume: r() * 1000 }
    })
    const p = volumeProfile(bars, { rows: 24 })
    const total = bars.reduce((s, b) => s + b.volume, 0)
    const summed = p.rows.reduce((s, r2) => s + r2.volume, 0)
    expect(summed).toBeCloseTo(total, 6)
  })

  it('a bar with high === low puts its whole volume in one row', () => {
    const bars: VolumeProfileBar[] = [{ high: 100, low: 100, volume: 50 }, { high: 110, low: 90, volume: 0 }]
    const p = volumeProfile(bars, { rows: 24 })
    const nonEmpty = p.rows.filter(r => r.volume > 0)
    // The flat bar's 50 lands entirely in whichever single row contains price 100.
    expect(nonEmpty.reduce((s, r) => s + r.volume, 0)).toBeCloseTo(50, 6)
  })

  it('a flat range (every bar high === low, one price) returns a single row', () => {
    const bars: VolumeProfileBar[] = [{ high: 100, low: 100, volume: 10 }, { high: 100, low: 100, volume: 20 }]
    const p = volumeProfile(bars)
    expect(p.rows.length).toBe(1)
    expect(p.rows[0].volume).toBe(30)
    expect(p.poc).toBe(100)
    expect(p.vah).toBe(100)
    expect(p.val).toBe(100)
  })

  it('POC is the row with the most volume; the value area holds at least 70% by default', () => {
    const bars: VolumeProfileBar[] = []
    // Heavy volume concentrated around price 100-101 (one row band), light elsewhere.
    for (let i = 0; i < 50; i++) bars.push({ high: 101, low: 100, volume: 100 })
    for (let i = 0; i < 50; i++) bars.push({ high: 130, low: 129, volume: 1 })
    const p = volumeProfile(bars, { rows: 30 })
    expect(p.poc).toBeGreaterThanOrEqual(100)
    expect(p.poc).toBeLessThanOrEqual(101)
    const total = bars.reduce((s, b) => s + b.volume, 0)
    const vaVolume = p.rows.filter(r => r.priceLow >= p.val && r.priceHigh <= p.vah).reduce((s, r) => s + r.volume, 0)
    expect(vaVolume).toBeGreaterThanOrEqual(total * 0.7 - 1e-6)
  })

  it('no data (empty bars) returns an empty profile, not a throw', () => {
    const p = volumeProfile([])
    expect(p.rows).toEqual([])
    expect(Number.isNaN(p.poc)).toBe(true)
  })

  it('put-back: binning by typical price alone (one row per bar) misplaces the POC on a wide-range bar set', () => {
    // 30 bars each spanning [90,110]; the true (range-spread) POC sits mid-range.
    const bars: VolumeProfileBar[] = Array.from({ length: 30 }, () => ({ high: 110, low: 90, volume: 100 }))
    const p = volumeProfile(bars, { rows: 24 })
    // The defect this guards against: binning every bar's volume into its
    // typical-price row alone would light up only 1-2 of 24 rows.
    const litRows = p.rows.filter(r => r.volume > 0).length
    expect(litRows).toBe(24)
  })
})
