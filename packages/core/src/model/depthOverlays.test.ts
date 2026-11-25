// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { RealtimeSeries } from '../realtimeSeries'
import { RealtimeView } from '../realtimeView'
import { buildEngineFrame } from './frame'
import { projectDepthHeatmap, projectLiquidationMap, type DepthSnapshot } from './depthOverlays'
import type { MarketBar } from '../types'

const MINUTE = 60_000, T0 = Date.UTC(2026, 0, 5)
/** 60 one-minute bars wandering between 100 and 107; the last close is 105. */
function bars (): MarketBar[] {
  return Array.from({ length: 60 }, (_, i) => {
    const wave = i % 5
    return { timestamp: T0 + i * MINUTE, open: 100 + wave, high: 100 + wave + 3, low: 100 + wave - 0.5, close: 100 + wave + 1, volume: 10 }
  })
}
function frameOf (list: MarketBar[] = bars(), height = 420): ReturnType<typeof buildEngineFrame> {
  const series = new RealtimeSeries({ referenceIndicators: false })
  series.applyNewData(list.map(bar => ({ ...bar })), false)
  const view = new RealtimeView(series, { count: list.length, continuous: true })
  return buildEngineFrame(view.getSnapshot(), series.getDataList(), [], 900, height, {}, undefined, series.version)
}
/** Row of the frame's price band that contains `price` for a heatmap or map with `rows` rows. */
function rowOf (frame: ReturnType<typeof buildEngineFrame>, rows: number, price: number): number {
  const g = frame.model.geometry
  return Math.min(rows - 1, Math.max(0, Math.floor((frame.panes[0].scale.y(price) - g.top) / ((g.bottom - g.top) / rows))))
}
const snap = (minute: number, levels: Array<[number, number]>): DepthSnapshot => ({ timestamp: T0 + minute * MINUTE, levels })

describe('order-book heatmap', () => {
  it('lights the price band that holds a wall, in the columns where it rests', () => {
    const frame = frameOf(), list = bars()
    const out = projectDepthHeatmap(frame, list, [snap(0, [[103.5, 1000], [101, 5], [106, 5]])])
    expect(out.status).toBe('ready')
    expect(out.rows * out.columns).toBe(out.intensity.length)
    expect(out.peakSize).toBe(1000)
    const wall = rowOf(frame, out.rows, 103.5), thin = rowOf(frame, out.rows, 101)
    for (const c of [0, Math.floor(out.columns / 2), out.columns - 1]) {
      expect(out.intensity[wall * out.columns + c]).toBeGreaterThan(out.intensity[thin * out.columns + c])
      expect(out.intensity[thin * out.columns + c]).toBeGreaterThan(0)
    }
    // Far from any level nothing is lit.
    expect(out.intensity[rowOf(frame, out.rows, 104.9) * out.columns]).toBe(0)
  })

  it('counts each level in exactly one row: linear brightness at the clip limit adds up to the book', () => {
    const frame = frameOf(), list = bars()
    const levels: Array<[number, number]> = Array.from({ length: 40 }, (_, i) => [100.2 + i * 0.13, 1 + (i % 4)])
    const out = projectDepthHeatmap(frame, list, [snap(0, levels)], { intensity: 'linear', clip: 1 })
    expect(out.status).toBe('ready')
    let total = 0
    for (let r = 0; r < out.rows; r++) total += out.intensity[r * out.columns] * out.saturationSize
    const scale = frame.panes[0].scale, inRange = levels.filter(([price]) => price >= scale.min && price < scale.max).reduce((sum, [, size]) => sum + size, 0)
    expect(total).toBeCloseTo(inRange, 6)
  })

  it('carries the last snapshot forward, up to maxAgeMs, and takes the strongest of several inside a column', () => {
    const frame = frameOf(), list = bars()
    const first = snap(0, [[103.5, 100]])
    const carried = projectDepthHeatmap(frame, list, [first], { intensity: 'linear', clip: 1 })
    const row = rowOf(frame, carried.rows, 103.5)
    expect(carried.intensity[row * carried.columns + carried.columns - 1]).toBe(1)
    const stale = projectDepthHeatmap(frame, list, [first], { maxAgeMs: 5 * MINUTE })
    expect(stale.intensity[row * stale.columns]).toBeGreaterThan(0)
    expect(stale.intensity[row * stale.columns + stale.columns - 1]).toBe(0)
    // Two snapshots in the same minute: the cell keeps the larger.
    const two = projectDepthHeatmap(frame, list, [snap(0, [[103.5, 10]]), { timestamp: T0 + 20 * MINUTE + 10, levels: [[103.5, 40]] }, { timestamp: T0 + 20 * MINUTE + 20, levels: [[103.5, 20]] }], { intensity: 'linear', clip: 1 })
    expect(two.peakSize).toBe(40)
  })

  it('reports empty input as empty and bad input as invalid, and never draws the bad input', () => {
    const frame = frameOf(), list = bars()
    expect(projectDepthHeatmap(frame, list, []).status).toBe('empty')
    expect(projectDepthHeatmap(frame, list, [snap(0, [])]).status).toBe('empty')
    expect(projectDepthHeatmap(frame, list, [snap(5, [[103, 1]]), snap(1, [[103, 1]])]).status).toBe('invalid-data')
    expect(projectDepthHeatmap(frame, list, [snap(0, [[103, -1]])]).status).toBe('invalid-data')
    expect(projectDepthHeatmap(frame, list, [snap(0, [[NaN, 1]])]).status).toBe('invalid-data')
    expect(projectDepthHeatmap(frame, list, [{ timestamp: NaN, levels: [[103, 1]] }]).status).toBe('invalid-data')
    // Snapshots entirely after the data light nothing.
    expect(projectDepthHeatmap(frame, list, [snap(500, [[103, 5]])]).status).toBe('empty')
  })

  it('refuses unknown options visibly', () => {
    const frame = frameOf(), list = bars(), data = [snap(0, [[103, 1]])]
    expect(() => projectDepthHeatmap(frame, list, data, { intensity: 'cubic' as never })).toThrow(RangeError)
    expect(() => projectDepthHeatmap(frame, list, data, { clip: 0.2 })).toThrow(RangeError)
    expect(() => projectDepthHeatmap(frame, list, data, { maxRows: 0 })).toThrow(RangeError)
    expect(() => projectDepthHeatmap(frame, list, data, { maxColumns: 1.5 })).toThrow(RangeError)
    expect(() => projectDepthHeatmap(frame, list, data, { maxAgeMs: -1 })).toThrow(RangeError)
  })

  it('stays bounded on a large book and a long history of snapshots', () => {
    const frame = frameOf(), list = bars()
    const snapshots: DepthSnapshot[] = Array.from({ length: 30_000 }, (_, i) => ({ timestamp: T0 + i * 100, levels: Array.from({ length: 200 }, (_, k) => [100 + k * 0.04, 1 + ((i + k) % 9)] as [number, number]) }))
    const started = performance.now()
    const out = projectDepthHeatmap(frame, list, snapshots)
    expect(out.status).toBe('ready')
    expect(out.columns).toBeLessThanOrEqual(300)
    expect(out.rows).toBeLessThanOrEqual(120)
    // Not a timing assertion on a fast machine, only a guard against work that grows with the number of snapshots.
    expect(performance.now() - started).toBeLessThan(2000)
  })
})

describe('very small charts and short histories', () => {
  it('draw something sensible, or nothing, and never throw', () => {
    for (const height of [60, 120]) {
      const frame = frameOf(bars(), height), list = bars()
      const heat = projectDepthHeatmap(frame, list, [snap(0, [[103.5, 10], [101, 5]])])
      expect(['ready', 'empty']).toContain(heat.status)
      if (heat.status === 'ready') expect(heat.rows).toBeGreaterThanOrEqual(1)
      const map = projectLiquidationMap(frame, list, [{ price: 103, long: 1 }, { price: 106, short: 2 }])
      expect(['ready', 'empty']).toContain(map.status)
    }
    // One bar only.
    const one = bars().slice(0, 1), frame = frameOf(one)
    expect(() => projectDepthHeatmap(frame, one, [snap(0, [[100, 1]])])).not.toThrow()
    expect(() => projectLiquidationMap(frame, one, [{ price: 100, long: 1 }])).not.toThrow()
  })
})

describe('liquidation map', () => {
  it('sums the levels in each row and sizes the bars against the largest row', () => {
    const frame = frameOf(), list = bars()
    const out = projectLiquidationMap(frame, list, [{ price: 101, long: 5 }, { price: 101.01, long: 3 }, { price: 106, short: 8 }, { price: 103, long: 2, short: 2 }])
    expect(out.status).toBe('ready')
    const at = (price: number): typeof out.rows[number] => out.rows[rowOf(frame, out.rows.length, price)]
    expect(at(101).long).toBe(8)
    expect(at(106).short).toBe(8)
    expect(at(103).long + at(103).short).toBe(4)
    expect(out.peak).toBe(8)
    // The biggest row fills widthFraction of the plot, hanging from the right edge; shorts sit left of longs.
    const g = frame.model.geometry
    expect(at(101).longRect?.width).toBeCloseTo(g.plotWidth * 0.25, 6)
    expect((at(101).longRect?.x ?? 0) + (at(101).longRect?.width ?? 0)).toBeCloseTo(g.right, 6)
    expect(at(103).shortRect?.x).toBeCloseTo(g.right - (at(103).longRect?.width ?? 0) - (at(103).shortRect?.width ?? 0), 6)
    expect(at(104.8).longRect).toBeNull()
  })

  it('cumulative view counts away from the last close, and ignores levels already triggered', () => {
    const frame = frameOf(), list = bars() // last close is 105
    const levels = [
      { price: 104, long: 3 }, { price: 103, long: 4 }, { price: 102, long: 5 },
      { price: 106, short: 2 }, { price: 107, short: 6 },
      { price: 106.5, long: 99 }, // a long above the close: already triggered
      { price: 100.5, short: 77 } // a short below the close: already triggered
    ]
    const out = projectLiquidationMap(frame, list, levels, { cumulative: true })
    expect(out.status).toBe('ready')
    expect(out.referencePrice).toBe(105)
    const at = (price: number): typeof out.rows[number] => out.rows[rowOf(frame, out.rows.length, price)]
    expect(at(104).long).toBe(3) // from the close down to this row's lower edge: only the 104 level
    expect(at(102).long).toBe(12) // 104 + 103 + 102
    expect(at(102).short).toBe(0)
    expect(at(106).short).toBe(2)
    expect(at(107).short).toBe(8) // 106 + 107
    expect(at(107).long).toBe(0)
    // Cumulative totals only ever grow away from the close.
    const below = out.rows.filter(row => row.priceHigh <= 105).map(row => row.long)
    for (let i = 1; i < below.length; i++) expect(below[i]).toBeGreaterThanOrEqual(below[i - 1])
    const above = out.rows.filter(row => row.priceLow >= 105).map(row => row.short)
    for (let i = 1; i < above.length; i++) expect(above[i]).toBeLessThanOrEqual(above[i - 1])
  })

  it('reports empty and invalid input as such, and refuses bad options', () => {
    const frame = frameOf(), list = bars()
    expect(projectLiquidationMap(frame, list, []).status).toBe('empty')
    expect(projectLiquidationMap(frame, list, [{ price: 103 }]).status).toBe('empty')
    expect(projectLiquidationMap(frame, list, [{ price: 103, long: -1 }]).status).toBe('invalid-data')
    expect(projectLiquidationMap(frame, list, [{ price: NaN, long: 1 }]).status).toBe('invalid-data')
    expect(projectLiquidationMap(frame, list, [{ price: 103, short: Infinity }]).status).toBe('invalid-data')
    expect(() => projectLiquidationMap(frame, list, [{ price: 103, long: 1 }], { maxRows: 500 })).toThrow(RangeError)
    expect(() => projectLiquidationMap(frame, list, [{ price: 103, long: 1 }], { widthFraction: 2 })).toThrow(RangeError)
  })
})
