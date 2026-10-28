import { describe, expect, it } from 'vitest'

import type { OverlayFigure, OverlayCreateFiguresCallbackParams, TextAttrs } from 'klinecharts'

import fibonacciExtension from './fibonacciExtension'

const OVERLAY = { points: [{ value: 100 }, { value: 200 }, { value: 150 }] }
const COORDINATES = [{ x: 50, y: 350 }, { x: 150, y: 250 }, { x: 250, y: 300 }]
const PRECISION = { price: 2, volume: 0 }

/** One cast here (a deliberately loose fake of the real params — this
 *  template reads only overlay.points, coordinates, precision and yAxis)
 *  instead of one at every call site below. */
function call (yAxis?: { convertToPixel: (v: number) => number }): OverlayFigure | OverlayFigure[] {
  const params = { overlay: OVERLAY, coordinates: COORDINATES, precision: PRECISION, yAxis } as unknown as OverlayCreateFiguresCallbackParams
  return fibonacciExtension.createPointFigures?.(params) ?? []
}

function textsOf (figures: OverlayFigure | OverlayFigure[]): string[] {
  const arr = Array.isArray(figures) ? figures : [figures]
  const text = arr.find(f => f.type === 'text')
  return ((text?.attrs as TextAttrs[] | undefined) ?? []).map(a => a.text)
}

describe('fibonacciExtension: value-space placement (SC-116)', () => {
  it('without a yAxis: unchanged from the original pixel interpolation', () => {
    // valueDif = points[1]-points[0] = 100; yDif = coords[1].y - coords[0].y = -100.
    // percent 0.5: y = coords[2].y + yDif*0.5 = 300 - 50 = 250; price = 150 + 100*0.5 = 200.
    expect(textsOf(call())[3]).toBe('200.00 (50.0%)')
  })

  it('with a yAxis: the line is drawn at yAxis.convertToPixel(price), agreeing with its label', () => {
    const yAxis = { convertToPixel: (v: number) => 1000 - Math.log10(v) * 200 }
    const figures = call(yAxis)
    const arr = Array.isArray(figures) ? figures : [figures]
    const fbLines = arr.find((f): f is OverlayFigure & { attrs: Array<{ coordinates: Array<{ y: number }> }> } => f.type === 'line' && Array.isArray(f.attrs))
    const price = 150 + (200 - 100) * 0.5 // 200
    expect(fbLines?.attrs[3]?.coordinates[0]?.y).toBeCloseTo(yAxis.convertToPixel(price), 6)
    expect(textsOf(figures)[3]).toBe('200.00 (50.0%)')
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

const create = (p: unknown): any[] => ([] as any[]).concat(fibonacciExtension.createPointFigures?.(p as never) ?? [])
const fbLinesOf = (figs: any[]): any[] => figs[1]?.attrs ?? []
const textAttrsOf = (figs: any[]): any[] => figs[2]?.attrs ?? []

describe('fibonacciExtension (SC-179)', () => {
  it('now defaults to TradingView\'s trend-based levels, including 161.8% and beyond (the old fixed set stopped at 100%)', () => {
    const figs = create(paramsWithLevels([{ value: 0 }, { value: 100 }, { value: 50 }]))
    const texts = textAttrsOf(figs)
    expect(fbLinesOf(figs)).toHaveLength(11) // 0, .236, .382, .5, .618, .786, 1, 1.618, 2.618, 3.618, 4.236
    expect(texts.some((t: any) => t.text.includes('161.8%'))).toBe(true)
    expect(texts.some((t: any) => t.text.includes('261.8%'))).toBe(true)
  })

  it('accepts a custom level set from extendData', () => {
    const figs = create(paramsWithLevels([{ value: 0 }, { value: 100 }, { value: 50 }], { levels: [0, 1] }))
    expect(fbLinesOf(figs)).toHaveLength(2)
  })

  it('draws nothing with fewer than 3 points', () => {
    const figs = create(paramsWithLevels([{ value: 0 }, { value: 100 }]))
    expect(fbLinesOf(figs)).toEqual([])
    expect(textAttrsOf(figs)).toEqual([])
  })
})
