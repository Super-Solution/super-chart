import { describe, expect, it } from 'vitest'
import { buildEngineFrame, validateEngineLayout, type FrameIndicator } from './frame'
import { axisStrip, financialGeometry } from '../financialModel'
import { RealtimeSeries } from '../realtimeSeries'
import { RealtimeView } from '../realtimeView'
import type { MarketBar } from '../types'

function frameOf (indicators: readonly FrameIndicator[], layout = {}, width = 800, height = 400): ReturnType<typeof buildEngineFrame> {
  const bars: MarketBar[] = Array.from({ length: 60 }, (_, i) => {
    const open = 100 + Math.sin(i / 5) * 5, close = open + (i % 2 === 0 ? 1 : -1)
    return { timestamp: 1_700_000_000_000 + i * 60_000, open, high: Math.max(open, close) + 1, low: Math.min(open, close) - 1, close, volume: 1000 + i * 10 }
  })
  const series = new RealtimeSeries()
  series.applyNewData(bars)
  const view = new RealtimeView(series, { count: 60 })
  return buildEngineFrame(view.getSnapshot(), series.getDataList(), indicators, width, height, layout)
}

describe('axis side', () => {
  it('puts the price strip on the right by default and keeps the older left layout on request', () => {
    const right = frameOf([]).panes[0].frame.model.geometry
    expect(right.axisSide).toBe('right')
    expect(right.right).toBeLessThan(right.width)
    expect(right.left).toBeLessThan(20)
    const left = frameOf([], { axisSide: 'left' }).panes[0].frame.model.geometry
    expect(left.axisSide).toBeUndefined()
    expect(left.left).toBeGreaterThanOrEqual(52)
  })

  it('describes the strip the labels sit in, on either side', () => {
    const r = axisStrip(financialGeometry(800, 400, 52, 12, 'right'))
    expect(r).toMatchObject({ side: 'right', align: 'left', inner: 748, from: 748, width: 52 })
    const l = axisStrip(financialGeometry(800, 400, 52, 12, 'left'))
    expect(l).toMatchObject({ side: 'left', align: 'right', inner: 52, from: 0, width: 52 })
  })

  it('rejects an unknown side', () => {
    expect(() => validateEngineLayout({ axisSide: 'top' as never })).toThrow(RangeError)
  })
})

describe('overlay band', () => {
  const volume = (overlay: boolean): FrameIndicator => ({
    id: 'vol', name: 'VOL', pane: 'price', overlay, figures: [{ key: 'volume', title: 'Volume', type: 'bar' }],
    rows: Array.from({ length: 60 }, (_, i) => ({ volume: 1000 + i * 10 }))
  })

  it('keeps an overlay out of the price scale and draws it in the bottom band', () => {
    const plain = frameOf([])
    const overlaid = frameOf([volume(true)])
    expect(overlaid.panes.length).toBe(1)
    // Volume in the thousands must not stretch the price axis.
    expect(overlaid.panes[0].frame.model.max).toBe(plain.panes[0].frame.model.max)
    const g = overlaid.panes[0].frame.model.geometry
    const series = overlaid.panes[0].frame.model.plottedSeries[0]
    expect(series.zeroY).toBe(g.bottom)
    const band = g.plotHeight * 0.2
    for (const point of series.points) {
      expect(point.y).toBeLessThanOrEqual(g.bottom + 1e-9)
      expect(point.y).toBeGreaterThanOrEqual(g.bottom - band - 1e-9)
    }
    const tallest = Math.min(...series.points.map(point => point.y))
    expect(g.bottom - tallest).toBeCloseTo(band, 6)
  })

  it('honours overlayRatio and rejects one out of range', () => {
    const g = frameOf([volume(true)], { overlayRatio: 0.4 }).panes[0].frame.model
    expect(g.geometry.bottom - Math.min(...g.plottedSeries[0].points.map(point => point.y))).toBeCloseTo(g.geometry.plotHeight * 0.4, 6)
    expect(() => validateEngineLayout({ overlayRatio: 0.9 })).toThrow(RangeError)
    expect(() => validateEngineLayout({ overlayRatio: 0.01 })).toThrow(RangeError)
  })

  it('lists price-pane indicators for the legend, overlay or not', () => {
    const frame = frameOf([volume(true), { id: 'ma', name: 'MA', label: 'MA 20', pane: 'price', figures: [{ key: 'ma', title: 'MA' , type: 'line' }], rows: Array.from({ length: 60 }, () => ({ ma: 100 })) }])
    expect(frame.panes[0].frame.legend?.map(entry => [entry.label, entry.overlay])).toEqual([['VOL', true], ['MA 20', false]])
  })
})
