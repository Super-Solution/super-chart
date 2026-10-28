import { describe, expect, it } from 'vitest'

import type { OverlayFigure, OverlayCreateFiguresCallbackParams, TextAttrs } from 'klinecharts'

import fibonacciSegment from './fibonacciSegment'

// SC-116: each level's price must agree with where its line and label are
// drawn, on a log/percentage y-axis and not only on a normal one.

const OVERLAY = { points: [{ value: 200 }, { value: 100 }] }
const COORDINATES = [{ x: 100, y: 100 }, { x: 300, y: 300 }]
const PRECISION = { price: 2, volume: 0 }

/** The fixtures above are a deliberately loose fake of the real params (this
 *  template reads only overlay.points, coordinates, precision and yAxis) —
 *  one cast here, instead of one at every call site below. */
function call (yAxis?: { convertToPixel: (v: number) => number }): OverlayFigure | OverlayFigure[] {
  const params = { overlay: OVERLAY, coordinates: COORDINATES, precision: PRECISION, yAxis } as unknown as OverlayCreateFiguresCallbackParams
  return fibonacciSegment.createPointFigures?.(params) ?? []
}

function textsOf (figures: OverlayFigure | OverlayFigure[]): string[] {
  const arr = Array.isArray(figures) ? figures : [figures]
  const text = arr.find(f => f.type === 'text')
  return ((text?.attrs as TextAttrs[] | undefined) ?? []).map(a => a.text)
}

function linesOf (figures: OverlayFigure | OverlayFigure[]): Array<{ coordinates: Array<{ y: number }> }> {
  const arr = Array.isArray(figures) ? figures : [figures]
  return (arr.find(f => f.type === 'line')?.attrs as Array<{ coordinates: Array<{ y: number }> }> | undefined) ?? []
}

describe('fibonacciSegment: value-space placement (SC-116)', () => {
  it('without a yAxis (unit tests, older callers): unchanged from the original pixel interpolation', () => {
    expect(textsOf(call())).toEqual([
      '200.00 (100.0%)', '178.60 (78.6%)', '161.80 (61.8%)', '150.00 (50.0%)', '138.20 (38.2%)', '123.60 (23.6%)', '100.00 (0.0%)'
    ])
  })

  it('with a yAxis: each line is drawn at yAxis.convertToPixel(price), agreeing with its label', () => {
    // A non-linear "log-like" axis: 10x the price maps to a fixed pixel offset.
    const yAxis = { convertToPixel: (v: number) => 1000 - Math.log10(v) * 200 }
    const figures = call(yAxis)
    const lines = linesOf(figures)
    const texts = textsOf(figures)
    // The 0.5 level: price = 100 + (200-100)*0.5 = 150.
    const expectedY = yAxis.convertToPixel(150)
    expect(lines[3]?.coordinates[0]?.y).toBeCloseTo(expectedY, 6)
    expect(texts[3]).toBe('150.00 (50.0%)')
    // On a straight pixel interpolation (the old bug) this line would instead
    // sit at coordinates[1].y + (100-300)*0.5 = 200, which disagrees with the
    // log-axis position above by more than a rounding error.
    expect(Math.abs((lines[3]?.coordinates[0]?.y ?? 0) - 200)).toBeGreaterThan(50)
  })

  it('with a yAxis: the 100% and 0% levels sit exactly at the two endpoints', () => {
    const yAxis = { convertToPixel: (v: number) => 500 - v }
    const lines = linesOf(call(yAxis))
    expect(lines[0]?.coordinates[0]?.y).toBe(yAxis.convertToPixel(200)) // 100%
    expect(lines[6]?.coordinates[0]?.y).toBe(yAxis.convertToPixel(100)) // 0%
  })
})

function paramsWithLevels (points: Array<{ value?: number }>, extendData?: unknown): any {
  const coordinates = points.map((p, i) => ({ x: i * 50, y: 200 - (p.value ?? 0) }))
  return {
    overlay: { points, extendData },
    coordinates,
    precision: { price: 2, volume: 0 }
  }
}

const create = (p: unknown): any[] => ([] as any[]).concat(fibonacciSegment.createPointFigures?.(p as never) ?? [])
const linesAttrsOf = (figs: any[]): any[] => figs.find(f => f.type === 'line')?.attrs ?? []
const textAttrsOf = (figs: any[]): any[] => figs.find(f => f.type === 'text')?.attrs ?? []

describe('fibonacciSegment (SC-179)', () => {
  it('keeps its 7-level retracement default, unchanged, with no extendData', () => {
    const figs = create(paramsWithLevels([{ value: 0 }, { value: 100 }]))
    expect(linesAttrsOf(figs)).toHaveLength(7)
    const texts = textAttrsOf(figs)
    expect(texts.map((t: any) => t.text)).toEqual([
      '0.00 (100.0%)', '21.40 (78.6%)', '38.20 (61.8%)', '50.00 (50.0%)', '61.80 (38.2%)', '76.40 (23.6%)', '100.00 (0.0%)'
    ])
  })

  it('draws a custom level set, including an extension target above 100%', () => {
    const figs = create(paramsWithLevels([{ value: 0 }, { value: 100 }], { levels: [0, 1, 1.618] }))
    expect(linesAttrsOf(figs)).toHaveLength(3)
    const texts = textAttrsOf(figs)
    expect(texts.some((t: any) => t.text.includes('161.8%'))).toBe(true)
  })

  it('falls back to the default set for a string extendData (a text tool never uses this template, but nothing should crash)', () => {
    const figs = create(paramsWithLevels([{ value: 0 }, { value: 100 }], 'not levels'))
    expect(linesAttrsOf(figs)).toHaveLength(7)
  })

  it('draws nothing with fewer than 2 points', () => {
    // A third figure (the SC-100 hit path) is always appended, even empty.
    expect(create(paramsWithLevels([{ value: 0 }]))).toEqual([
      { type: 'line', attrs: [] },
      { type: 'text', ignoreEvent: true, attrs: [] },
      { type: 'superChartHitPath', attrs: [] }
    ])
  })
})
