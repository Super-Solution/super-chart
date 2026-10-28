import { describe, expect, it } from 'vitest'

import { dateRange, priceDateRange, priceRange } from './measure'

interface Bar { timestamp: number, open: number, high: number, low: number, close: number, volume: number }
const BAR_MS = 60_000

function bars (n: number): Bar[] {
  return Array.from({ length: n }, (_, i) => ({ timestamp: i * BAR_MS, open: 100 + i, high: 101 + i, low: 99 + i, close: 100 + i, volume: 10 }))
}

function params (data: Bar[], points: Array<{ dataIndex?: number, timestamp?: number, value?: number }>): any {
  return {
    overlay: { points },
    coordinates: points.map((_, i) => ({ x: i * 100, y: i * 50 })),
    bounding: { width: 900, height: 400, left: 0, top: 0, right: 900, bottom: 400 },
    barSpace: { bar: 6, halfBar: 3, gapBar: 4, halfGapBar: 2 },
    precision: { price: 2, volume: 0 },
    thousandsSeparator: ',',
    decimalFoldThreshold: 3,
    dateTimeFormat: new Intl.DateTimeFormat('en-US'),
    defaultStyles: { line: { color: '#1677FF' } },
    chart: { getDataList: () => data },
    xAxis: { convertToPixel: (i: number) => i * 6, convertFromPixel: (px: number) => px / 6 },
    yAxis: { convertToPixel: (v: number) => 1000 - v, convertFromPixel: (px: number) => 1000 - px }
  }
}

const textOf = (figs: unknown): string => (figs as any[]).find(f => f.type === 'text')?.attrs?.text ?? ''

describe('dateRange bar count (SC-161)', () => {
  it('counts bars from the timestamps, not a stale dataIndex, after older bars are prepended', () => {
    const original = bars(30)
    const points = [{ dataIndex: 5, timestamp: original[5].timestamp }, { dataIndex: 15, timestamp: original[15].timestamp }]
    const before = textOf((dateRange.createPointFigures?.(params(original, points)) ?? []))
    expect(before).toBe('10 bars')
    const prepended = [...bars(20).map((b, i) => ({ ...b, timestamp: (i - 20) * BAR_MS })), ...original]
    const after = textOf((dateRange.createPointFigures?.(params(prepended, points)) ?? []))
    // Same two bars by timestamp: still 10, not 610 (20 prepended + 10 real, the old bug).
    expect(after).toBe('10 bars')
  })

  it('reports the true count after one handle is dragged post-prepend', () => {
    const original = bars(30)
    const prepended = [...bars(20).map((b, i) => ({ ...b, timestamp: (i - 20) * BAR_MS })), ...original]
    // point A: the untouched original handle (its pre-prepend dataIndex is now
    // stale; only its timestamp still finds bar 5, now at prepended index 25).
    // point B: dragged AFTER the prepend to bar 15, so it carries a fresh
    // dataIndex + timestamp on the new (50-bar) grid, at prepended index 35.
    const points = [{ dataIndex: 5, timestamp: original[5].timestamp }, { dataIndex: 35, timestamp: prepended[35].timestamp }]
    const text = textOf((dateRange.createPointFigures?.(params(prepended, points)) ?? []))
    expect(text).toBe('10 bars')
  })

  it('omits the bar count instead of printing 0 when neither point has a timestamp or dataIndex', () => {
    const text = textOf(dateRange.createPointFigures?.(params(bars(10), [{}, {}])) ?? [])
    expect(text).toBe('')
  })

  it('draws a timestamp-only date range (host/MCP-created overlay)', () => {
    const data = bars(20)
    const text = textOf((dateRange.createPointFigures?.(params(data, [{ timestamp: data[2].timestamp }, { timestamp: data[12].timestamp }])) ?? []))
    expect(text).toBe('10 bars')
  })
})

describe('priceDateRange', () => {
  it('includes the bar count in the combined label', () => {
    const data = bars(20)
    const text = textOf((priceDateRange.createPointFigures?.(params(data, [{ dataIndex: 0, timestamp: data[0].timestamp, value: 100 }, { dataIndex: 10, timestamp: data[10].timestamp, value: 110 }])) ?? []))
    expect(text).toContain('10 bars')
    expect(text).toContain('+10.00')
  })

  it('drops the "· N bars" suffix when the bar count is unknown', () => {
    const text = textOf(priceDateRange.createPointFigures?.(params(bars(5), [{ value: 100 }, { value: 110 }])) ?? [])
    expect(text).not.toContain('bars')
  })
})

describe('priceRange (unaffected by SC-161, still value-based)', () => {
  it('still reports the price delta and percent', () => {
    const data = bars(5)
    const text = textOf((priceRange.createPointFigures?.(params(data, [{ value: 100 }, { value: 110 }])) ?? []))
    expect(text).toBe('+10.00 (+10.00%)')
  })
})
