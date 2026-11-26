import { describe, expect, it } from 'vitest'
import { timeAxisTicks, zoneOffset } from './timeAxis'

const HOUR = 3600000, MINUTE = 60000, DAY = 24 * HOUR
/** `count` bars every `step` ms from `start`, drawn `px` apart starting at x = 50. */
function bars (start: number, step: number, count: number, px: number): { t: number[], x: number[] } {
  const t = Array.from({ length: count }, (_, i) => start + i * step)
  return { t, x: t.map((_, i) => 50 + i * px) }
}
const label = (ticks: ReturnType<typeof timeAxisTicks>, t: number[]): string[] => ticks.map(tick => `${tick.label}@${new Date(t[tick.index]).toISOString().slice(0, 16)}`)

describe('timeAxisTicks', () => {
  it('puts minute bars on round times, spaced for the width', () => {
    const { t, x } = bars(Date.UTC(2026, 10, 25, 15, 49), MINUTE, 75, 14) // the 1m chart that used to show 15:49 .. 17:03
    const ticks = timeAxisTicks(t, x, { minSpacing: 70, left: 50, right: 1100 })
    expect(ticks.length).toBeGreaterThanOrEqual(4)
    for (const tick of ticks) expect(new Date(t[tick.index]).getUTCMinutes() % 5).toBe(0)
    for (let i = 1; i < ticks.length; i++) expect(x[ticks[i].index] - x[ticks[i - 1].index]).toBeGreaterThanOrEqual(70)
    expect(ticks.map(tick => tick.label)).toContain('16:00')
  })

  it('gets coarser as the width shrinks and finer as it grows', () => {
    const { t, x } = bars(Date.UTC(2026, 10, 25, 9), MINUTE, 480, 2)
    const wide = timeAxisTicks(t, x.map(v => v * 2), { minSpacing: 70, left: 0, right: 2000 })
    const narrow = timeAxisTicks(t, x, { minSpacing: 70, left: 0, right: 1000 })
    const phone = timeAxisTicks(t, x.map(v => v / 3), { minSpacing: 70, left: 0, right: 330 })
    expect(wide.length).toBeGreaterThan(narrow.length)
    expect(narrow.length).toBeGreaterThan(phone.length)
    expect(phone.length).toBeGreaterThanOrEqual(1)
  })

  it('names the day at midnight and the month at a month start, in the viewer zone', () => {
    const { t, x } = bars(Date.UTC(2026, 9, 28, 12), 4 * HOUR, 60, 16)
    const utc = timeAxisTicks(t, x, { minSpacing: 70, left: 50, right: 1010 })
    expect(utc.find(tick => tick.level === 'month')?.label).toBe('Nov')
    expect(utc.filter(tick => tick.level === 'day').length).toBeGreaterThan(0)
    // In Taipei (UTC+8) midnight is 16:00 UTC: the same bar is the first of the day there.
    const taipei = timeAxisTicks(t, x, { minSpacing: 70, left: 50, right: 1010, timeZone: 'Asia/Taipei' })
    const day = taipei.find(tick => tick.level === 'day' || tick.level === 'month')
    expect(day).toBeDefined()
    expect(new Date(t[(day as { index: number }).index]).getUTCHours()).toBe(16)
  })

  it('reads half-hour zones on their own clock', () => {
    const { t, x } = bars(Date.UTC(2026, 10, 25, 3, 40), 5 * MINUTE, 100, 12)
    const ticks = timeAxisTicks(t, x, { minSpacing: 70, left: 50, right: 1250, timeZone: 'Asia/Kolkata' })
    for (const tick of ticks) expect(tick.label).toMatch(/^\d\d:(00|15|30|45)$/)
    expect(ticks.map(tick => tick.label)).toContain('10:00')
  })

  it('follows a daylight-saving change', () => {
    expect(zoneOffset('America/New_York', Date.UTC(2026, 2, 8, 6))).toBe(-5 * HOUR)
    expect(zoneOffset('America/New_York', Date.UTC(2026, 2, 8, 8))).toBe(-4 * HOUR)
    expect(zoneOffset('Not/AZone', 0)).toBe(0)
  })

  it('draws day-and-larger bars as dates only, with days between the months', () => {
    const { t, x } = bars(Date.UTC(2026, 8, 1), DAY, 120, 8)
    const ticks = timeAxisTicks(t, x, { minSpacing: 60, left: 50, right: 1010, timespan: 'day' })
    expect(ticks.every(tick => tick.level === 'year' || tick.level === 'month' || tick.level === 'day')).toBe(true)
    expect(ticks.map(tick => tick.label)).toEqual(expect.arrayContaining(['Oct', 'Nov', 'Dec']))
    expect(ticks.some(tick => tick.level === 'day')).toBe(true)
  })

  it('reads a symbol-zone session date, not the instant', () => {
    // 2026-11-02 00:00 UTC is still 1 November in New York.
    const t = [Date.UTC(2026, 10, 2), Date.UTC(2026, 10, 3)], x = [50, 400]
    const utc = timeAxisTicks(t, x, { minSpacing: 70, timespan: 'day' })
    const york = timeAxisTicks(t, x, { minSpacing: 70, timespan: 'day', symbolTimezone: 'America/New_York' })
    expect(utc[0].label).toBe('2')
    expect(york[0].label).toBe('Nov')
  })

  it('labels months and days in the requested locale and falls back for a bad tag', () => {
    const { t, x } = bars(Date.UTC(2026, 9, 28), DAY, 20, 40)
    const tw = timeAxisTicks(t, x, { minSpacing: 70, left: 0, right: 900, timespan: 'day', locale: 'zh-TW' })
    expect(tw.some(tick => tick.label === '11月')).toBe(true)
    const bad = timeAxisTicks(t, x, { minSpacing: 70, left: 0, right: 900, timespan: 'day', locale: 'not a locale!' })
    expect(bad.some(tick => tick.label === 'Nov')).toBe(true)
  })

  it('handles empty input, a single bar, bars off screen and non-finite stamps', () => {
    expect(timeAxisTicks([], [], { minSpacing: 70 })).toEqual([])
    expect(timeAxisTicks([Date.UTC(2026, 0, 1)], [100], { minSpacing: 70 })[0]?.label).toBe('2026')
    expect(timeAxisTicks([0, 1], [-500, -400], { minSpacing: 70, left: 0, right: 100 })).toEqual([])
    expect(timeAxisTicks([NaN, Date.UTC(2026, 0, 1, 12)], [10, 20], { minSpacing: 5 }).length).toBeLessThanOrEqual(2)
  })

  it('keeps the year over the month over the day when they fall on one bar', () => {
    const t = [Date.UTC(2025, 11, 31, 23), Date.UTC(2026, 0, 1, 0), Date.UTC(2026, 0, 1, 1)], x = [50, 60, 70]
    const ticks = timeAxisTicks(t, x, { minSpacing: 40, left: 0, right: 100 })
    expect(label(ticks, t)[0]).toBe('2026@2026-01-01T00:00')
  })
})
