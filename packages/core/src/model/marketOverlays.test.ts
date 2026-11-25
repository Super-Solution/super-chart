// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { RealtimeSeries } from '../realtimeSeries'
import { RealtimeView } from '../realtimeView'
import { buildEngineFrame } from './frame'
import { projectMarketOverlays, MARKET_PROFILE_SESSION_LIMIT, type MarketOverlayOptions } from './marketOverlays'
import type { MarketBar } from '../types'

const HOUR = 3_600_000, DAY = 24 * HOUR
const MIDNIGHT = Date.UTC(2026, 0, 5)

/** Hourly bars from midnight UTC; price drifts up a day at a time so every day has its own price band. */
function hourly (days: number, step = HOUR): MarketBar[] {
  const count = Math.round(days * DAY / step)
  return Array.from({ length: count }, (_, i) => {
    const day = Math.floor(i * step / DAY), base = 100 + day * 10, wave = (i % 5)
    return { timestamp: MIDNIGHT + i * step, open: base + wave, high: base + wave + 3, low: base + wave - 1, close: base + wave + 1, volume: 10 + (i % 7) }
  })
}
function frameOf (bars: MarketBar[], viewport?: { i0: number, i1: number }): ReturnType<typeof buildEngineFrame> {
  const series = new RealtimeSeries({ referenceIndicators: false })
  series.applyNewData(bars.map(bar => ({ ...bar })), false)
  const view = new RealtimeView(series, { count: Math.min(bars.length, 400), continuous: true })
  if (viewport !== undefined) view.setViewport(viewport)
  return buildEngineFrame(view.getSnapshot(), series.getDataList(), [], 900, 420, {}, undefined, series.version)
}
const sum = (bars: MarketBar[]): number => bars.reduce((total, bar) => total + (bar.volume ?? 0), 0)
function project (bars: MarketBar[], volumeProfile: MarketOverlayOptions['volumeProfile'], viewport?: { i0: number, i1: number }): ReturnType<typeof projectMarketOverlays> {
  return projectMarketOverlays(frameOf(bars, viewport), bars, { volumeProfile })
}

describe('volume profile modes', () => {
  it('visible mode is unchanged: one profile across the plot, no session profiles', () => {
    const bars = hourly(3)
    const out = project(bars, true)
    expect(out.status.volumeProfile).toBe('ready')
    expect(out.sessionProfiles).toEqual([])
    expect(out.profile?.totalVolume).toBeCloseTo(sum(bars), 9)
    expect(out.profile?.span).toEqual({ left: out.bounds.left, right: out.bounds.right })
  })

  it('session mode draws one profile per day, each counting exactly that day', () => {
    const bars = hourly(3)
    const out = project(bars, { mode: 'session' })
    expect(out.status.volumeProfile).toBe('ready')
    expect(out.profile).toBeNull()
    expect(out.sessionProfiles.map(entry => [entry.startIndex, entry.endIndex])).toEqual([[0, 23], [24, 47], [48, 71]])
    out.sessionProfiles.forEach(entry => {
      expect(entry.profile.totalVolume).toBeCloseTo(sum(bars.slice(entry.startIndex, entry.endIndex + 1)), 9)
      // The days sit at different prices: each profile's POC is inside its own day's band.
      const day = entry.startIndex / 24
      expect(entry.profile.poc).toBeGreaterThanOrEqual(100 + day * 10 - 1)
      expect(entry.profile.poc).toBeLessThanOrEqual(100 + day * 10 + 7)
    })
    // The histograms hang from the left of each day and stay inside it.
    const spans = out.sessionProfiles.map(entry => entry.profile.span)
    spans.forEach((span, i) => { if (i > 0) expect(span.left).toBeGreaterThanOrEqual(spans[i - 1].right - 1e-6) })
    for (const entry of out.sessionProfiles) for (const row of entry.profile.rows) {
      if (row.rect !== null) { expect(row.rect.x).toBeCloseTo(entry.profile.span.left, 6); expect(row.rect.x + row.rect.width).toBeLessThanOrEqual(entry.profile.span.right + 1e-6) }
    }
  })

  it('a day that is only partly in view still uses all of its bars', () => {
    const bars = hourly(3)
    const out = project(bars, { mode: 'session' }, { i0: 30, i1: 60 })
    expect(out.sessionProfiles.map(entry => [entry.startIndex, entry.endIndex])).toEqual([[24, 47], [48, 71]])
    expect(out.sessionProfiles[0].profile.totalVolume).toBeCloseTo(sum(bars.slice(24, 48)), 9)
    // Day 2 starts left of the view, so its histogram is clipped to the plot.
    expect(out.sessionProfiles[0].profile.span.left).toBe(out.bounds.left)
  })

  it('the time zone decides where a day starts', () => {
    const bars = hourly(3)
    // Taipei is UTC+8: its day starts at 16:00 UTC, so the first full day is bars 8 to 31 (with bars 0-7 before it).
    const out = project(bars, { mode: 'session', timeZone: 'Asia/Taipei' })
    expect(out.sessionProfiles.map(entry => [entry.startIndex, entry.endIndex])).toEqual([[0, 15], [16, 39], [40, 63], [64, 71]])
    expect(() => project(bars, { mode: 'session', timeZone: 'Not/AZone' })).toThrow(RangeError)
  })

  it('a day with no reported volume gets no profile, and no volume anywhere says so', () => {
    const bars = hourly(2).map((bar, i) => i < 24 ? { ...bar, volume: undefined } : bar)
    const out = project(bars, { mode: 'session' })
    expect(out.sessionProfiles.map(entry => entry.startIndex)).toEqual([24])
    expect(out.status.volumeProfile).toBe('ready')
    const none = project(hourly(2).map(bar => ({ ...bar, volume: undefined })), { mode: 'session' })
    expect(none.status.volumeProfile).toBe('missing-volume')
    expect(none.sessionProfiles).toEqual([])
  })

  it('refuses to draw more sessions than can be read, and says so', () => {
    const bars = hourly(MARKET_PROFILE_SESSION_LIMIT + 5, 6 * HOUR)
    const out = project(bars, { mode: 'session' })
    expect(out.status.volumeProfile).toBe('too-wide')
    expect(out.sessionProfiles).toEqual([])
  })

  it('range mode profiles the bars from the first to the last timestamp, whole range even when partly in view', () => {
    const bars = hourly(3)
    const range = { from: bars[10].timestamp, to: bars[40].timestamp }
    const out = project(bars, { mode: 'range', range })
    expect(out.status.volumeProfile).toBe('ready')
    expect(out.profile?.startIndex).toBe(10)
    expect(out.profile?.endIndex).toBe(40)
    expect(out.profile?.totalVolume).toBeCloseTo(sum(bars.slice(10, 41)), 9)
    // Timestamps between bars pick the bars inside the range.
    const inside = project(bars, { mode: 'range', range: { from: bars[10].timestamp + 1, to: bars[40].timestamp - 1 } })
    expect([inside.profile?.startIndex, inside.profile?.endIndex]).toEqual([11, 39])
    // Partly off screen: still counts the whole range, histogram clipped to the plot.
    const clipped = project(bars, { mode: 'range', range }, { i0: 25, i1: 70 })
    expect(clipped.profile?.startIndex).toBe(10)
    expect(clipped.profile?.span.left).toBe(clipped.bounds.left)
  })

  it('range mode reports an empty or off-screen range as empty and refuses a bad range or an oversized one', () => {
    const bars = hourly(3)
    expect(project(bars, { mode: 'range', range: { from: MIDNIGHT - 5 * DAY, to: MIDNIGHT - 4 * DAY } }).status.volumeProfile).toBe('empty')
    expect(project(bars, { mode: 'range', range: { from: bars[0].timestamp, to: bars[5].timestamp } }, { i0: 40, i1: 70 }).status.volumeProfile).toBe('empty')
    expect(() => project(bars, { mode: 'range' })).toThrow(RangeError)
    expect(() => project(bars, { mode: 'range', range: { from: 5, to: 4 } })).toThrow(RangeError)
    expect(() => project(bars, { mode: 'range', range: { from: NaN, to: 4 } })).toThrow(RangeError)
    expect(() => project(bars, { mode: 'nope' as never })).toThrow(RangeError)
  })

  it('invalid prices in a session make that overlay unavailable instead of drawing garbage', () => {
    // The chart's own series rejects such bars; the projection still guards the raw list it is handed.
    const bars = hourly(2), broken = bars.map(bar => ({ ...bar }))
    broken[30] = { ...broken[30], high: NaN }
    const out = projectMarketOverlays(frameOf(bars), broken, { volumeProfile: { mode: 'session' } })
    expect(out.status.volumeProfile).toBe('invalid-data')
    expect(out.sessionProfiles.map(entry => entry.startIndex)).toEqual([0])
  })
})
