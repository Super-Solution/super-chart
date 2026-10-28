/**
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at

 * http://www.apache.org/licenses/LICENSE-2.0

 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { describe, expect, it, vi } from 'vitest'
import { attachHighLowTags, buildHighLowOverlayTemplate, visibleHighLow, type HighLowChart, type RegisterOverlayFn } from './highLowTags'

describe('buildHighLowOverlayTemplate: createYAxisFigures (the actual paint output)', () => {
  const template = buildHighLowOverlayTemplate()
  const figuresFor = (extendData: unknown, yAxis?: { convertToPixel: (v: number) => number }): Array<{ type: string, attrs: { y: number, text: string }, styles: { backgroundColor?: string } }> =>
    template.createYAxisFigures({ overlay: { extendData }, bounding: { width: 60 }, yAxis } as never) as never

  it('places each tag on its PRICE with the axis it is painted with (never a pixel computed earlier)', () => {
    const axisA = { convertToPixel: (v: number) => 300 - v * 10 }
    const axisB = { convertToPixel: (v: number) => 500 - v * 2 } // the same pan, one frame later: the axis rescaled
    const data = { high: 15, low: 3, highText: '15.00', lowText: '3.00' }
    expect(figuresFor(data, axisA).map(f => f.attrs.y)).toEqual([150, 270])
    expect(figuresFor(data, axisB).map(f => f.attrs.y)).toEqual([470, 494])
    // Prices win over a stale fixed pixel.
    expect(figuresFor({ ...data, highY: 1, lowY: 2 }, axisA).map(f => f.attrs.y)).toEqual([150, 270])
  })

  it('returns two text figures with the up/down default background colours when extendData.color is unset', () => {
    const figs = figuresFor({ highY: 10, lowY: 200, highText: '150.00', lowText: '90.00' })
    expect(figs).toHaveLength(2)
    expect(figs.every(f => f.type === 'text')).toBe(true)
    expect(figs[0].styles.backgroundColor).toBe('#26A69A') // high tag: green
    expect(figs[1].styles.backgroundColor).toBe('#EF5350') // low tag: red
  })

  it('an explicit color overrides both tags', () => {
    const figs = figuresFor({ highY: 10, lowY: 200, highText: '150.00', lowText: '90.00', color: '#123456' })
    expect(figs.every(f => f.styles.backgroundColor === '#123456')).toBe(true)
  })

  it('empty extendData, or neither prices (with an axis) nor fixed pixels, draws nothing rather than a broken tag', () => {
    expect(figuresFor(undefined)).toEqual([])
    expect(figuresFor({ highText: '150.00' })).toEqual([]) // no highY/lowY
    expect(figuresFor({ high: 15, low: 3, highText: '15', lowText: '3' })).toEqual([]) // prices but no axis
    expect(figuresFor({ high: 15, low: 3, highText: '15', lowText: '3' }, { convertToPixel: () => NaN })).toEqual([])
  })

  it('put-back: an empty string for color is NOT treated as "unset" (a caller must omit the key, not pass "") — this is the exact bug attachHighLowTags once had, where extendData.color was hardcoded to \'\' and both tags rendered white-on-white', () => {
    const figs = figuresFor({ highY: 10, lowY: 200, highText: '150.00', lowText: '90.00', color: '' })
    // Documents the real (surprising) behaviour of `??` with an empty string,
    // so a future edit that reintroduces `color: ''` in attachHighLowTags's
    // paint() is caught here, not just visually: '' is not null/undefined,
    // so it is NOT replaced by the green/red default, and backgroundColor
    // ends up '' (invalid, silently non-rendering) instead.
    expect(figs[0].styles.backgroundColor).toBe('')
    expect(figs[1].styles.backgroundColor).toBe('')
  })
})

describe('visibleHighLow', () => {
  it('null for an empty range or empty data', () => {
    expect(visibleHighLow([], 0, 5)).toBeNull()
    expect(visibleHighLow([{ high: 1, low: 0 }], 3, 1)).toBeNull()
  })

  it('the max high / min low over [from, to] inclusive, clamped to the data bounds', () => {
    const bars = [{ high: 10, low: 5 }, { high: 15, low: 8 }, { high: 12, low: 3 }, { high: 20, low: 9 }]
    expect(visibleHighLow(bars, 0, 3)).toEqual({ high: 20, low: 3, highIndex: 3, lowIndex: 2 })
    expect(visibleHighLow(bars, 0, 1)).toEqual({ high: 15, low: 5, highIndex: 1, lowIndex: 0 })
    expect(visibleHighLow(bars, -5, 100)).toEqual({ high: 20, low: 3, highIndex: 3, lowIndex: 2 }) // clamps out-of-range indices
  })

  it('skips a non-finite bar rather than letting NaN win the max/min', () => {
    const bars = [{ high: 10, low: 5 }, { high: NaN, low: NaN }, { high: 12, low: 3 }]
    expect(visibleHighLow(bars, 0, 2)).toEqual({ high: 12, low: 3, highIndex: 2, lowIndex: 2 })
  })

  it('a single bar is both the high and the low', () => {
    expect(visibleHighLow([{ high: 10, low: 5 }], 0, 0)).toEqual({ high: 10, low: 5, highIndex: 0, lowIndex: 0 })
  })
})

// ---- attachHighLowTags -------------------------------------------------------

function fakeChart (bars: Array<{ high: number, low: number }>, overrides: Partial<HighLowChart> = {}): HighLowChart & { overlays: Map<string, unknown>, actions: Map<string, () => void> } {
  const overlays = new Map<string, unknown>()
  const actions = new Map<string, () => void>()
  let seq = 0
  return {
    overlays,
    actions,
    getDataList: () => bars,
    getVisibleRange: () => ({ from: 0, to: bars.length - 1 }),
    createOverlay: value => {
      const id = `ov${++seq}`
      overlays.set(id, value)
      return id
    },
    overrideOverlay: ({ id, extendData }) => { overlays.set(id, { ...(overlays.get(id) as object), extendData }) },
    removeOverlay: remove => {
      const r = remove as { id?: string } | undefined
      if (r?.id !== undefined) overlays.delete(r.id)
      else overlays.clear()
    },
    subscribeAction: (type, cb) => { actions.set(type, cb) },
    unsubscribeAction: type => { actions.delete(type) },
    ...overrides
  }
}

function fakeRegisterOverlay (): RegisterOverlayFn {
  return vi.fn()
}

describe('attachHighLowTags', () => {
  it('creates the overlay immediately with the visible high/low as prices and formatted labels', () => {
    const chart = fakeChart([{ high: 10, low: 5 }, { high: 15, low: 3 }])
    const dispose = attachHighLowTags(chart, {
      registerOverlay: fakeRegisterOverlay(),
      formatPrice: v => v.toFixed(2),
      actionTypes: ['OnVisibleRangeChange']
    })
    expect(chart.overlays.size).toBe(1)
    const [[, overlay]] = chart.overlays
    const data = (overlay as { extendData: { high: number, low: number, highText: string, lowText: string } }).extendData
    expect(data).toEqual({ high: 15, low: 3, highText: '15.00', lowText: '3.00' })
    // Put-back for the white-on-white bug: the overlay must never carry a
    // `color` key at all (undefined lets the template's own per-tag default
    // apply; '' does not — see the buildHighLowOverlayTemplate suite).
    expect('color' in data).toBe(false)
    dispose()
  })

  it('a new visible high lands in the same refresh (no easing that trails the axis)', () => {
    const chart = fakeChart([{ high: 10, low: 5 }])
    const dispose = attachHighLowTags(chart, {
      registerOverlay: fakeRegisterOverlay(),
      formatPrice: v => v.toFixed(0),
      actionTypes: ['OnVisibleRangeChange']
    })
    const [id] = [...chart.overlays.keys()]
    chart.getDataList = () => [{ high: 10, low: 5 }, { high: 50, low: 5 }]
    chart.getVisibleRange = () => ({ from: 0, to: 1 })
    chart.actions.get('OnVisibleRangeChange')?.()
    expect((chart.overlays.get(id) as { extendData: { high: number, highText: string } }).extendData).toMatchObject({ high: 50, highText: '50' })
    dispose()
  })

  it('an action that changes neither the high/low nor their labels does not touch the overlay (no repaint per pan frame)', () => {
    const chart = fakeChart([{ high: 10, low: 5 }, { high: 15, low: 3 }])
    let overrides = 0
    const override = chart.overrideOverlay
    chart.overrideOverlay = o => { overrides++; override(o) }
    const dispose = attachHighLowTags(chart, {
      registerOverlay: fakeRegisterOverlay(),
      formatPrice: v => v.toFixed(2),
      actionTypes: ['OnScroll']
    })
    expect(overrides).toBe(1)
    for (let i = 0; i < 20; i++) chart.actions.get('OnScroll')?.()
    expect(overrides).toBe(1)
    chart.getDataList = () => [{ high: 10, low: 5 }, { high: 15, low: 2 }]
    chart.actions.get('OnScroll')?.()
    expect(overrides).toBe(2)
    dispose()
  })

  it('removes the overlay when disabled, and recreates it once re-enabled', () => {
    const chart = fakeChart([{ high: 10, low: 5 }])
    let enabled = true
    const dispose = attachHighLowTags(chart, {
      registerOverlay: fakeRegisterOverlay(),
      formatPrice: v => String(v),
      actionTypes: ['OnVisibleRangeChange'],
      enabled: () => enabled
    })
    expect(chart.overlays.size).toBe(1)
    enabled = false
    chart.actions.get('OnVisibleRangeChange')?.()
    expect(chart.overlays.size).toBe(0)
    enabled = true
    chart.actions.get('OnVisibleRangeChange')?.()
    expect(chart.overlays.size).toBe(1)
    dispose()
  })

  it('dispose removes the overlay and unsubscribes every action', () => {
    const chart = fakeChart([{ high: 10, low: 5 }])
    const dispose = attachHighLowTags(chart, {
      registerOverlay: fakeRegisterOverlay(),
      formatPrice: v => String(v),
      actionTypes: ['OnVisibleRangeChange', 'OnScroll']
    })
    expect(chart.actions.size).toBe(2)
    dispose()
    expect(chart.overlays.size).toBe(0)
    expect(chart.actions.size).toBe(0)
  })
})
