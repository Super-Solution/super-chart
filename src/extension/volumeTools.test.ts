import { describe, expect, it } from 'vitest'

import { anchoredVWAP, fixedRangeVolumeProfile, anchoredVolumeProfile, regressionTrend } from './volumeTools'

interface Bar { timestamp: number, open: number, high: number, low: number, close: number, volume: number }

const BAR_MS = 60_000

function bars (n: number, startClose = 100): Bar[] {
  return Array.from({ length: n }, (_, i) => {
    const close = startClose + i
    return { timestamp: i * BAR_MS, open: close, high: close + 1, low: close - 1, close, volume: 10 }
  })
}

/** Linear axes: 1 bar = 6px; value 0 = y 1000, value v = y (1000 - v). Counts calls for the perf assertions. */
function fakeAxes (): { xAxis: any, yAxis: any, calls: { toPixel: number, fromPixel: number } } {
  const calls = { toPixel: 0, fromPixel: 0 }
  return {
    calls,
    xAxis: {
      convertToPixel: (i: number) => { calls.toPixel++; return i * 6 },
      convertFromPixel: (px: number) => { calls.fromPixel++; return px / 6 }
    },
    yAxis: {
      convertToPixel: (v: number) => 1000 - v,
      convertFromPixel: (px: number) => 1000 - px
    }
  }
}

function params (data: Bar[], points: Array<{ dataIndex?: number, timestamp?: number, value?: number }>, extra: Record<string, unknown> = {}): any {
  const { xAxis, yAxis, calls } = fakeAxes()
  return {
    p: {
      overlay: { points },
      coordinates: points.map(() => ({ x: 0, y: 0 })),
      bounding: { width: 900, height: 400, left: 0, top: 0, right: 900, bottom: 400 },
      barSpace: { bar: 6, halfBar: 3, gapBar: 4, halfGapBar: 2 },
      precision: { price: 2, volume: 0 },
      thousandsSeparator: ',',
      decimalFoldThreshold: 3,
      dateTimeFormat: new Intl.DateTimeFormat('en-US'),
      defaultStyles: {},
      chart: { getDataList: () => data },
      xAxis,
      yAxis,
      ...extra
    },
    calls
  }
}

const coordsOf = (figs: unknown): Array<{ x: number, y: number }> =>
  (Array.isArray(figs) ? figs : [figs]).find((f: any) => f?.type === 'line')?.attrs?.coordinates ?? []

describe('anchoredVWAP', () => {
  it('matches a brute-force VWAP from the anchor to the last bar', () => {
    const data = bars(60)
    const { p } = params(data, [{ dataIndex: 10 }])
    const coords = coordsOf((anchoredVWAP.createPointFigures?.(p)) ?? [])
    expect(coords.length).toBeGreaterThan(0)
    // volume is constant, so VWAP at the end = mean typical price from bar 10 to 59
    let sum = 0
    for (let i = 10; i < data.length; i++) sum += (data[i].high + data[i].low + data[i].close) / 3
    const expected = sum / (data.length - 10)
    const lastY = coords[coords.length - 1].y
    expect(1000 - lastY).toBeCloseTo(expected, 6)
  })

  it('anchors on the point\'s timestamp, not a stale dataIndex, after older bars are prepended (SC-161)', () => {
    // The point was created when bar 5 was dataIndex 5 (timestamp 5*BAR_MS).
    // After 20 older bars are prepended, dataIndex 5 is a different bar, but
    // the timestamp still finds the same bar (now at dataIndex 25).
    const original = bars(30)
    const point = { dataIndex: 5, timestamp: original[5].timestamp }
    const prepended = [...bars(20, -20).map((b, i) => ({ ...b, timestamp: (i - 20) * BAR_MS })), ...original]
    const { p: pBefore } = params(original, [point])
    const { p: pAfter } = params(prepended, [point])
    const before = coordsOf((anchoredVWAP.createPointFigures?.(pBefore)) ?? [])
    const after = coordsOf((anchoredVWAP.createPointFigures?.(pAfter)) ?? [])
    // Same anchor bar (by timestamp) and the same trailing history -> the VWAP's
    // final value is identical whether or not older bars were prepended.
    expect(after[after.length - 1].y).toBeCloseTo(before[before.length - 1].y, 6)
  })

  it('draws from a timestamp-only point (how a host or an MCP-created overlay supplies points)', () => {
    const data = bars(40)
    const { p } = params(data, [{ timestamp: data[8].timestamp }])
    const coords = coordsOf((anchoredVWAP.createPointFigures?.(p)) ?? [])
    expect(coords.length).toBeGreaterThan(0)
  })

  it('converts only the visible bars (+ padding), not the whole anchor-to-end range (SC-007)', () => {
    const data = bars(5000)
    const { p, calls } = params(data, [{ dataIndex: 0 }])
    const coords = coordsOf((anchoredVWAP.createPointFigures?.(p)) ?? [])
    expect(coords.length).toBeGreaterThan(1)
    // bounding.width=900 at 6px/bar -> ~150 visible bars, +2 padding
    expect(calls.toPixel).toBeLessThan(160)
    expect(calls.toPixel).toBeLessThan(data.length)
  })

  it('reuses the cumulative sum across repeated frames with unchanged data (an appended bar only extends it)', () => {
    // Wide enough bounding that the whole range (up to 201 bars) stays "visible",
    // so the last coordinate is always the series' actual last bar.
    const wide = { bounding: { width: 2000, height: 400, left: 0, top: 0, right: 2000, bottom: 400 } }
    const data = bars(200)
    const { p: p1 } = params(data, [{ dataIndex: 0 }], wide)
    const first = coordsOf((anchoredVWAP.createPointFigures?.(p1)) ?? [])
    const { p: p2 } = params(data, [{ dataIndex: 0 }], wide)
    const second = coordsOf((anchoredVWAP.createPointFigures?.(p2)) ?? [])
    expect(second[second.length - 1].y).toBeCloseTo(first[first.length - 1].y, 9)
    // Append one bar (new array, as klinecharts does): still consistent.
    const appended = [...data, { timestamp: 200 * BAR_MS, open: 300, high: 301, low: 299, close: 300, volume: 10 }]
    const { p: p3 } = params(appended, [{ dataIndex: 0 }], wide)
    const third = coordsOf((anchoredVWAP.createPointFigures?.(p3)) ?? [])
    let pv = 0, vol = 0
    for (let i = 0; i < appended.length; i++) { pv += ((appended[i].high + appended[i].low + appended[i].close) / 3) * appended[i].volume; vol += appended[i].volume }
    expect(1000 - third[third.length - 1].y).toBeCloseTo(pv / vol, 6)
  })

  it('returns nothing with no data, no resolvable anchor, or no axes', () => {
    expect(anchoredVWAP.createPointFigures?.(params([], [{ dataIndex: 0 }]).p) ?? []).toEqual([])
    expect(anchoredVWAP.createPointFigures?.(params(bars(5), [{}]).p) ?? []).toEqual([])
    const { p } = params(bars(5), [{ dataIndex: 0 }])
    expect(anchoredVWAP.createPointFigures?.({ ...p, xAxis: null }) ?? []).toEqual([])
  })
})

describe('fixedRangeVolumeProfile / anchoredVolumeProfile', () => {
  it('bins volume across the anchored range using the timestamp-resolved bars', () => {
    const data = bars(50)
    const { p } = params(data, [{ timestamp: data[10].timestamp }, { timestamp: data[30].timestamp }])
    const figs = (fixedRangeVolumeProfile.createPointFigures?.(p) ?? []) as any[]
    expect(figs.length).toBeGreaterThan(0)
    // Each non-empty volume bin is a polygon, plus a single dashed 'line' for
    // the point-of-control (SC-171's spread-across-touched-rows algorithm).
    expect(figs.every(f => f.type === 'polygon' || f.type === 'line')).toBe(true)
    expect(figs.some(f => f.type === 'polygon')).toBe(true)
  })

  it('anchored volume profile spans from the anchor to the last bar', () => {
    const data = bars(50)
    const { p } = params(data, [{ timestamp: data[40].timestamp }])
    const figs = (anchoredVolumeProfile.createPointFigures?.(p) ?? []) as any[]
    expect(figs.length).toBeGreaterThan(0)
  })

  it('stays correct after a prepend, unlike a stale dataIndex would', () => {
    const original = bars(30)
    const points = [{ dataIndex: 5, timestamp: original[5].timestamp }, { dataIndex: 20, timestamp: original[20].timestamp }]
    const prepended = [...bars(15, -15).map((b, i) => ({ ...b, timestamp: (i - 15) * BAR_MS })), ...original]
    const { p: pBefore } = params(original, points)
    const { p: pAfter } = params(prepended, points)
    const before = (fixedRangeVolumeProfile.createPointFigures?.(pBefore) ?? []) as any[]
    const after = (fixedRangeVolumeProfile.createPointFigures?.(pAfter) ?? []) as any[]
    expect(after.length).toBe(before.length)
  })
})

describe('regressionTrend', () => {
  it('fits a line through a perfectly linear close series (slope visible in the pixel span)', () => {
    const data = bars(40) // close increases by 1 per bar
    const { p } = params(data, [{ dataIndex: 0 }, { dataIndex: 39 }])
    const figs = (regressionTrend.createPointFigures?.(p) ?? []) as any[]
    const lines = figs.filter(f => f.type === 'line')
    const mid = lines.find(f => f.styles?.size === 2)
    expect(mid).toBeDefined()
    const [c0, c1] = mid.attrs.coordinates
    // close is exactly linear: a midline + an upper and lower ±2σ band, the
    // bands collapsing onto the midline (sd ~ 0, up to floating point).
    expect(lines.length).toBe(3)
    lines.forEach(l => { expect(l.attrs.coordinates[0].y).toBeCloseTo(c0.y, 6); expect(l.attrs.coordinates[1].y).toBeCloseTo(c1.y, 6) })
    expect(c1.y).toBeLessThan(c0.y) // rising close -> falling y (y = 1000 - value)
  })

  it('stays correct after a prepend', () => {
    const original = bars(30)
    const points = [{ dataIndex: 0, timestamp: original[0].timestamp }, { dataIndex: 29, timestamp: original[29].timestamp }]
    const prepended = [...bars(10, -10).map((b, i) => ({ ...b, timestamp: (i - 10) * BAR_MS })), ...original]
    const { p: pBefore } = params(original, points)
    const { p: pAfter } = params(prepended, points)
    const before = (regressionTrend.createPointFigures?.(pBefore) ?? []) as any[]
    const after = (regressionTrend.createPointFigures?.(pAfter) ?? []) as any[]
    expect(after[0].attrs.coordinates[0].y).toBeCloseTo(before[0].attrs.coordinates[0].y, 6)
  })
})
