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

import { applyLayout, buildLayout, readPersistedLayout, writePersistedLayout, type ChartLayoutV1, type LayoutApiDeps } from './layout'
import type { DrawingRecord } from '../drawing-editor/controller'
import type { IndicatorHandle, IndicatorSnapshot } from '../types'

function fakeDeps (initial: {
  chartType?: string
  timezone?: string
  indicators?: IndicatorSnapshot[]
  drawings?: Record<string, DrawingRecord[]>
  symbolKey?: string
} = {}): LayoutApiDeps & { indicators: IndicatorSnapshot[], drawings: Record<string, DrawingRecord[]> } {
  const state = {
    chartType: initial.chartType ?? 'candle_solid',
    timezone: initial.timezone ?? 'Etc/UTC',
    indicators: initial.indicators ?? [],
    drawings: initial.drawings ?? {},
    symbolKey: initial.symbolKey ?? 'BTC-USDT'
  }
  const deps: LayoutApiDeps & { indicators: IndicatorSnapshot[], drawings: Record<string, DrawingRecord[]> } = {
    get indicators () { return state.indicators },
    set indicators (v) { state.indicators = v },
    get drawings () { return state.drawings },
    set drawings (v) { state.drawings = v },
    getChartType: () => state.chartType as never,
    setChartType: type => { state.chartType = type; return true },
    getTimezone: () => state.timezone,
    setTimezone: tz => { state.timezone = tz },
    getIndicators: () => state.indicators,
    addIndicator: (name, options) => {
      const handle: IndicatorHandle = { paneId: options?.pane === 'main' ? 'candle_pane' : 'sub_1', name }
      state.indicators = [...state.indicators, { ...handle, calcParams: options?.calcParams ?? [], visible: true, owner: 'engine' }]
      return handle
    },
    updateIndicator: (handle, changes) => {
      state.indicators = state.indicators.map(i => (i.paneId === handle.paneId && i.name === handle.name
        ? { ...i, calcParams: changes.calcParams ?? i.calcParams, visible: changes.visible ?? i.visible }
        : i))
      return true
    },
    removeIndicator: handle => {
      state.indicators = state.indicators.filter(i => !(i.paneId === handle.paneId && i.name === handle.name))
      return true
    },
    getDrawings: key => state.drawings[key ?? state.symbolKey] ?? [],
    setDrawings: (records, key) => { state.drawings[key ?? state.symbolKey] = [...records] },
    getSymbolKey: () => state.symbolKey
  }
  return deps
}

const RECORD: DrawingRecord = { v: 1, name: 'segment', paneId: 'candle_pane', points: [{ timestamp: 0, value: 1 }], lock: false, visible: true }

describe('buildLayout (SC-121)', () => {
  it('captures chart type, timezone and the current symbol\'s drawings', () => {
    const deps = fakeDeps({ chartType: 'line', timezone: 'Asia/Taipei', drawings: { 'BTC-USDT': [RECORD] } })
    const layout = buildLayout(deps)
    expect(layout).toEqual({ v: 1, symbol: 'BTC-USDT', chartType: 'line', timezone: 'Asia/Taipei', indicators: [], drawings: [RECORD] })
  })

  it('captures only engine-owned indicators, never a host\'s', () => {
    const deps = fakeDeps({
      indicators: [
        { paneId: 'candle_pane', name: 'MA', calcParams: [5], visible: true, owner: 'engine' },
        { paneId: 'sub_1', name: 'HostThing', calcParams: [], visible: true, owner: 'host' }
      ]
    })
    const layout = buildLayout(deps)
    expect(layout.indicators).toEqual([{ name: 'MA', paneKind: 'main', calcParams: [5], visible: true }])
  })
})

describe('applyLayout (SC-121)', () => {
  const baseLayout: ChartLayoutV1 = { v: 1, symbol: 'BTC-USDT', chartType: 'candle_solid', timezone: 'Etc/UTC', indicators: [], drawings: [] }

  it('round-trips indicators and drawings through build -> apply on the SAME symbol', () => {
    const source = fakeDeps({ chartType: 'area', timezone: 'Asia/Tokyo', drawings: { 'BTC-USDT': [RECORD] } })
    source.indicators = [{ paneId: 'candle_pane', name: 'MA', calcParams: [20], visible: true, owner: 'engine' }]
    const layout = buildLayout(source)

    const target = fakeDeps() // same default symbolKey ('BTC-USDT') as `source`
    const result = applyLayout(target, layout)
    expect(result.drawingsApplied).toBe(true)
    expect(target.getChartType()).toBe('area')
    expect(target.getTimezone()).toBe('Asia/Tokyo')
    expect(target.getIndicators()).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'MA', calcParams: [20] })]))
    expect(target.getDrawings()).toEqual([RECORD])
  })

  it('never touches a host-owned indicator: it is not removed even though it is not in the target layout', () => {
    const target = fakeDeps({
      indicators: [{ paneId: 'sub_1', name: 'HostThing', calcParams: [], visible: true, owner: 'host' }]
    })
    applyLayout(target, baseLayout)
    expect(target.getIndicators()).toEqual([{ paneId: 'sub_1', name: 'HostThing', calcParams: [], visible: true, owner: 'host' }])
  })

  it('removes an engine indicator that is not in the target layout', () => {
    const target = fakeDeps({
      indicators: [{ paneId: 'candle_pane', name: 'MA', calcParams: [], visible: true, owner: 'engine' }]
    })
    applyLayout(target, baseLayout)
    expect(target.getIndicators()).toEqual([])
  })

  it('updates an existing matching indicator instead of duplicating it', () => {
    const target = fakeDeps({
      indicators: [{ paneId: 'candle_pane', name: 'MA', calcParams: [5], visible: true, owner: 'engine' }]
    })
    applyLayout(target, { ...baseLayout, indicators: [{ name: 'MA', paneKind: 'main', calcParams: [50], visible: false }] })
    expect(target.getIndicators()).toEqual([{ paneId: 'candle_pane', name: 'MA', calcParams: [50], visible: false, owner: 'engine' }])
  })

  it('reports a skipped indicator instead of throwing when addIndicator fails', () => {
    const target = fakeDeps()
    target.addIndicator = () => null
    const result = applyLayout(target, { ...baseLayout, indicators: [{ name: 'Unregistered', paneKind: 'sub', calcParams: [], visible: true }] })
    expect(result.skippedIndicators).toEqual(['Unregistered'])
  })

  it('skips chartType/timezone when told to', () => {
    const target = fakeDeps({ chartType: 'line', timezone: 'Asia/Taipei' })
    applyLayout(target, { ...baseLayout, chartType: 'area', timezone: 'Etc/UTC' }, { chartType: false, timezone: false })
    expect(target.getChartType()).toBe('line')
    expect(target.getTimezone()).toBe('Asia/Taipei')
  })

  it('a layout saved on ticker A restores NO drawings on ticker B (never misplaced onto a differently-priced symbol)', () => {
    const tickerA = fakeDeps({ symbolKey: 'BTC-USDT', drawings: { 'BTC-USDT': [RECORD] } })
    const layout = buildLayout(tickerA)
    expect(layout.symbol).toBe('BTC-USDT')

    const tickerB = fakeDeps({ symbolKey: 'ETH-USDT' })
    const result = applyLayout(tickerB, layout)
    expect(result.drawingsApplied).toBe(false)
    expect(tickerB.getDrawings()).toEqual([])
    expect(tickerB.drawings['ETH-USDT']).toBeUndefined()
    expect(tickerB.drawings['BTC-USDT']).toBeUndefined()
  })

  it('rejects a malformed layout before changing existing drawings or indicators', () => {
    const target = fakeDeps({ drawings: { 'BTC-USDT': [RECORD] }, indicators: [{ paneId: 'candle_pane', name: 'MA', calcParams: [20], visible: true, owner: 'engine' }] })
    expect(() => applyLayout(target, { v: 1, chartType: 'line', timezone: 'Etc/UTC', indicators: [], drawings: [] } as unknown as ChartLayoutV1)).toThrow('INVALID_ARGUMENT')
    expect(target.getDrawings()).toEqual([RECORD])
    expect(target.getIndicators()).toHaveLength(1)
    expect(target.getChartType()).toBe('candle_solid')
  })
})

describe('persisted layout storage', () => {
  function fakeStorage (): Storage {
    const map = new Map<string, string>()
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => { map.set(k, v) },
      removeItem: (k: string) => { map.delete(k) },
      clear: () => { map.clear() },
      key: () => null,
      length: 0
    } as unknown as Storage
  }

  it('round-trips through localStorage', () => {
    const storage = fakeStorage()
    vi.stubGlobal('window', { localStorage: storage })
    const layout: ChartLayoutV1 = { v: 1, symbol: 'BTC-USDT', chartType: 'line', timezone: 'Etc/UTC', indicators: [], drawings: [] }
    writePersistedLayout('k', layout)
    expect(readPersistedLayout('k')).toEqual(layout)
    vi.unstubAllGlobals()
  })

  it('is null for missing, malformed or wrong-version data — never throws', () => {
    const storage = fakeStorage()
    vi.stubGlobal('window', { localStorage: storage })
    expect(readPersistedLayout('missing')).toBeNull()
    storage.setItem('bad-json', '{not json')
    expect(readPersistedLayout('bad-json')).toBeNull()
    storage.setItem('wrong-version', JSON.stringify({ v: 2 }))
    expect(readPersistedLayout('wrong-version')).toBeNull()
    storage.setItem('incomplete-v1', JSON.stringify({ v: 1, symbol: 'BTC-USDT', chartType: 'line', timezone: 'Etc/UTC', indicators: [] }))
    expect(readPersistedLayout('incomplete-v1')).toBeNull()
    storage.setItem('broken-drawing', JSON.stringify({ v: 1, symbol: 'BTC-USDT', chartType: 'line', timezone: 'Etc/UTC', indicators: [], drawings: [{ v: 1, name: 'segment', paneId: 'candle_pane', points: null, lock: false, visible: true }] }))
    expect(readPersistedLayout('broken-drawing')).toBeNull()
    vi.unstubAllGlobals()
  })

  it('a throwing/blocked localStorage never propagates (private mode)', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => { throw new Error('blocked') },
        setItem: () => { throw new Error('blocked') }
      }
    })
    expect(() => { writePersistedLayout('k', { v: 1, symbol: 'BTC-USDT', chartType: 'line', timezone: 'Etc/UTC', indicators: [], drawings: [] }) }).not.toThrow()
    expect(readPersistedLayout('k')).toBeNull()
    vi.unstubAllGlobals()
  })
})
