import { describe, expect, it } from 'vitest'

import scFibonacciLine from './fibonacciLine'

// Like arrow.ts / fibonacciSpiral.ts, this template calls klinecharts' own
// `utils` (formatThousands / formatFoldDecimal) to match the built-in
// fibonacciLine's exact label formatting. Under vitest's node environment,
// klinecharts' CJS build exports no `utils` (accent.test.ts hit the same
// wall: "Under node, klinecharts resolves to its UMD file without its
// functions"), so the label-formatting path is exercised by the browser e2e
// suite instead. What is safe and worth pinning here in node: the template's
// shape (name, step count) and every path that returns before touching
// `utils` — the level SELECTION itself is fibLevels.ts's job and is fully
// covered in fibLevels.test.ts.

function params (points: Array<{ value?: number }>, extendData?: unknown): any {
  const coordinates = points.map((p, i) => ({ x: i * 50, y: 200 - (p.value ?? 0) }))
  return {
    overlay: { points, extendData },
    coordinates,
    bounding: { width: 800, height: 400, left: 0, top: 0, right: 800, bottom: 400 },
    barSpace: { bar: 6, halfBar: 3, gapBar: 4, halfGapBar: 2 },
    precision: { price: 2, volume: 0, excludePriceVolumeMax: 2 },
    thousandsSeparator: ',',
    decimalFoldThreshold: 3,
    dateTimeFormat: new Intl.DateTimeFormat('en-US'),
    defaultStyles: {},
    yAxis: { isInCandle: () => true, convertToPixel: () => 0, convertFromPixel: () => 0 }
  }
}

const create = (p: unknown): any[] => ([] as any[]).concat(scFibonacciLine.createPointFigures?.(p as never) ?? [])

describe('SC_fibonacciLine (SC-179)', () => {
  it('is registered under the SC_ prefix, never the built-in name (no global re-registration of a klinecharts built-in)', () => {
    expect(scFibonacciLine.name).toBe('SC_fibonacciLine')
    expect(scFibonacciLine.totalStep).toBe(3)
  })

  it('draws nothing with no points at all', () => {
    expect(create(params([]))).toEqual([])
  })

  it('draws empty line/text figures with only one point (no crash before a second point exists)', () => {
    expect(create(params([{ value: 0 }]))).toEqual([
      { type: 'line', attrs: [] },
      { type: 'text', ignoreEvent: true, attrs: [] }
    ])
  })

  it('draws empty figures when a point has no numeric value yet (still being placed)', () => {
    expect(create(params([{}, {}]))).toEqual([
      { type: 'line', attrs: [] },
      { type: 'text', ignoreEvent: true, attrs: [] }
    ])
  })
})
