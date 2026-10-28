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
import type { OverlayMode } from 'klinecharts'

import {
  createDrawingCrossWatcher, createDrawingsApi, drawingLevelsAt, listDrawingToolsFrom,
  type DrawingsEditorLike, type DrawingsRawChart
} from './drawings'
import { FAKE_BAR_MS, FakeAnchorChart } from './testkit'

const PERIOD = { multiplier: 1, timespan: 'minute' as const, text: '1m' }
const CATALOG = [
  { name: 'horizontalStraightLine', group: 'builtin' as const },
  { name: 'segment', group: 'builtin' as const },
  { name: 'rect', group: 'builtin' as const },
  { name: 'text', group: 'builtin' as const }
]

function fakeEditor (): DrawingsEditorLike & { tracked: Set<string>, selected: string[] } {
  const tracked = new Set<string>()
  const selected: string[] = []
  return {
    tracked,
    selected,
    prepareNew: create => create,
    track: id => { if (typeof id === 'string' && id.length > 0) tracked.add(id) },
    isUserDrawing: id => typeof id === 'string' && tracked.has(id),
    selectPlaced: (id) => { selected.push(id) }
  }
}

function makeApi (chart: FakeAnchorChart, editor = fakeEditor()): {
  api: ReturnType<typeof createDrawingsApi>
  editor: ReturnType<typeof fakeEditor>
  notifyChange: ReturnType<typeof vi.fn>
  emitCreate: ReturnType<typeof vi.fn>
  emitChange: ReturnType<typeof vi.fn>
} {
  const notifyChange = vi.fn()
  const emitCreate = vi.fn()
  const emitChange = vi.fn()
  const api = createDrawingsApi({
    getChart: () => chart as unknown as DrawingsRawChart,
    editor,
    getDrawingBarLock: () => false,
    getDrawingBarMode: () => 'normal' as OverlayMode,
    getPeriod: () => PERIOD,
    getDrawingToolCatalog: () => CATALOG,
    notifyChange,
    emitCreate,
    emitChange
  })
  return { api, editor, notifyChange, emitCreate, emitChange }
}

describe('listDrawingToolsFrom', () => {
  it('is the catalogue\'s names', () => {
    expect(listDrawingToolsFrom(CATALOG)).toEqual(['horizontalStraightLine', 'segment', 'rect', 'text'])
  })
})

describe('createDrawingsApi.addDrawing (SC-127)', () => {
  it('rejects an unknown tool without creating anything', () => {
    const chart = new FakeAnchorChart()
    const { api } = makeApi(chart)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const id = api.addDrawing({ tool: 'notATool', points: [{ time: 0, price: 1 }] })
    expect(id).toBeNull()
    expect(chart.overlays.size).toBe(0)
    warn.mockRestore()
  })

  it('rejects empty points', () => {
    const chart = new FakeAnchorChart()
    const { api } = makeApi(chart)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(api.addDrawing({ tool: 'segment', points: [] })).toBeNull()
    warn.mockRestore()
  })

  it('creates a tracked, complete overlay and notifies', () => {
    const chart = new FakeAnchorChart({ bars: 10 })
    const { api, editor, notifyChange, emitCreate } = makeApi(chart)
    const id = api.addDrawing({ tool: 'segment', points: [{ time: 0, price: 10 }, { time: 5 * FAKE_BAR_MS, price: 20 }] })
    expect(id).not.toBeNull()
    expect(editor.tracked.has(id as string)).toBe(true)
    expect(chart.getOverlayById(id as string)?.name).toBe('segment')
    expect(notifyChange).toHaveBeenCalledTimes(1)
    expect(emitCreate).toHaveBeenCalledWith(id, 'segment')
  })

  it('maps a future time to a bare dataIndex, never a timestamp (SC-135)', () => {
    const chart = new FakeAnchorChart({ bars: 10 }) // last bar at index 9
    const { api } = makeApi(chart)
    const future = 9 * FAKE_BAR_MS + 4 * FAKE_BAR_MS
    const id = api.addDrawing({ tool: 'segment', points: [{ time: 0, price: 10 }, { time: future, price: 20 }] })
    const overlay = chart.getOverlayById(id as string)
    expect(overlay?.points[1]).toEqual({ dataIndex: 13, value: 20 })
    expect(overlay?.points[1]).not.toHaveProperty('timestamp')
  })

  it('never opens window.prompt for a text tool: the label comes from `text` directly', () => {
    const chart = new FakeAnchorChart()
    const { api } = makeApi(chart)
    const promptSpy = vi.fn()
    // @ts-expect-error test-only global shim
    globalThis.window = { prompt: promptSpy }
    const id = api.addDrawing({ tool: 'text', points: [{ time: 0, price: 5 }], text: 'hello' })
    expect(chart.getOverlayById(id as string)?.extendData).toBe('hello')
    expect(promptSpy).not.toHaveBeenCalled()
  })

  it('selects the new drawing when select: true, and not otherwise', () => {
    const chart = new FakeAnchorChart()
    const { api, editor } = makeApi(chart)
    const id = api.addDrawing({ tool: 'segment', points: [{ time: 0, price: 1 }, { time: FAKE_BAR_MS, price: 2 }], select: true })
    expect(editor.selected).toEqual([id])
  })

  it('inherits the rail\'s lock state when `locked` is not given', () => {
    const chart = new FakeAnchorChart()
    const editor = fakeEditor()
    const api = createDrawingsApi({
      getChart: () => chart as unknown as DrawingsRawChart,
      editor,
      getDrawingBarLock: () => true,
      getDrawingBarMode: () => 'normal' as OverlayMode,
      getPeriod: () => PERIOD,
      getDrawingToolCatalog: () => CATALOG,
      notifyChange: () => {}
    })
    const id = api.addDrawing({ tool: 'segment', points: [{ time: 0, price: 1 }, { time: FAKE_BAR_MS, price: 2 }] })
    expect(chart.getOverlayById(id as string)?.lock).toBe(true)
  })
})

describe('createDrawingsApi.updateDrawing', () => {
  it('is false for a host overlay (never tracked)', () => {
    const chart = new FakeAnchorChart()
    const { api } = makeApi(chart)
    const id = chart.createOverlay({ name: 'segment', points: [] }) // not tracked
    expect(api.updateDrawing(id, { visible: false })).toBe(false)
  })

  it('patches points/text/lock/visible and notifies', () => {
    const chart = new FakeAnchorChart({ bars: 10 })
    const { api, notifyChange, emitChange } = makeApi(chart)
    const id = api.addDrawing({ tool: 'segment', points: [{ time: 0, price: 1 }, { time: FAKE_BAR_MS, price: 2 }] }) as string
    notifyChange.mockClear()
    const ok = api.updateDrawing(id, { visible: false, locked: true, text: 'note' })
    expect(ok).toBe(true)
    const overlay = chart.getOverlayById(id)
    expect(overlay?.visible).toBe(false)
    expect(overlay?.lock).toBe(true)
    expect(overlay?.extendData).toBe('note')
    expect(emitChange).toHaveBeenCalledWith(id)
    expect(notifyChange).toHaveBeenCalledTimes(1)
  })

  it('is a true no-op (no overrideOverlay call) with nothing to change', () => {
    const chart = new FakeAnchorChart()
    const { api } = makeApi(chart)
    const id = api.addDrawing({ tool: 'segment', points: [{ time: 0, price: 1 }, { time: FAKE_BAR_MS, price: 2 }] }) as string
    const callsBefore = chart.calls.length
    api.updateDrawing(id, {})
    expect(chart.calls.length).toBe(callsBefore)
  })
})

describe('drawingLevelsAt (SC-180)', () => {
  it('is null for a tool with no price meaning', () => {
    const chart = new FakeAnchorChart()
    const id = chart.createOverlay({ name: 'verticalStraightLine', points: [{ dataIndex: 2 }] })
    expect(drawingLevelsAt(chart as unknown as DrawingsRawChart, id, 0, PERIOD)).toBeNull()
    const textId = chart.createOverlay({ name: 'text', points: [{ dataIndex: 2, value: 5 }] })
    expect(drawingLevelsAt(chart as unknown as DrawingsRawChart, textId, 0, PERIOD)).toBeNull()
  })

  it('a horizontal line is one constant level regardless of timestamp', () => {
    const chart = new FakeAnchorChart()
    const id = chart.createOverlay({ name: 'horizontalStraightLine', points: [{ dataIndex: 0, value: 42 }] })
    expect(drawingLevelsAt(chart as unknown as DrawingsRawChart, id, 0, PERIOD)).toEqual([{ key: 'line', price: 42 }])
    expect(drawingLevelsAt(chart as unknown as DrawingsRawChart, id, 10 * FAKE_BAR_MS, PERIOD)).toEqual([{ key: 'line', price: 42 }])
  })

  it('a rect gives constant top/bottom, independent of x', () => {
    const chart = new FakeAnchorChart()
    const id = chart.createOverlay({ name: 'rect', points: [{ dataIndex: 0, value: 10 }, { dataIndex: 5, value: 30 }] })
    const levels = drawingLevelsAt(chart as unknown as DrawingsRawChart, id, 2 * FAKE_BAR_MS, PERIOD)
    expect(levels).toEqual(expect.arrayContaining([{ key: 'top', price: 30 }, { key: 'bottom', price: 10 }]))
  })

  it('a segment on a LINEAR axis gives the arithmetic midpoint', () => {
    const chart = new FakeAnchorChart({ bars: 20 }) // linear: y = 1000 - value
    const id = chart.createOverlay({ name: 'segment', points: [{ dataIndex: 0, value: 100 }, { dataIndex: 10, value: 200 }] })
    const levels = drawingLevelsAt(chart as unknown as DrawingsRawChart, id, 5 * FAKE_BAR_MS, PERIOD)
    expect(levels?.[0].price).toBeCloseTo(150, 5)
  })

  it('a segment on a LOG axis gives the GEOMETRIC midpoint, not the arithmetic one (the whole point of SC-180)', () => {
    const chart = new FakeAnchorChart({ bars: 20, logAxis: { min: 1, max: 100_000, height: 800 } })
    const id = chart.createOverlay({ name: 'segment', points: [{ dataIndex: 0, value: 100 }, { dataIndex: 10, value: 400 }] })
    const levels = drawingLevelsAt(chart as unknown as DrawingsRawChart, id, 5 * FAKE_BAR_MS, PERIOD)
    const geometricMean = Math.sqrt(100 * 400) // 200
    expect(levels?.[0].price).toBeCloseTo(geometricMean, 3)
    expect(levels?.[0].price).not.toBeCloseTo(250, 0) // the arithmetic mean, which a log-naive implementation would give
  })

  it('is null outside a segment\'s span, but not outside a ray\'s single bound', () => {
    const chart = new FakeAnchorChart({ bars: 20 })
    const segment = chart.createOverlay({ name: 'segment', points: [{ dataIndex: 2, value: 10 }, { dataIndex: 5, value: 20 }] })
    expect(drawingLevelsAt(chart as unknown as DrawingsRawChart, segment, 0, PERIOD)).toBeNull()
    expect(drawingLevelsAt(chart as unknown as DrawingsRawChart, segment, 8 * FAKE_BAR_MS, PERIOD)).toBeNull()

    const ray = chart.createOverlay({ name: 'horizontalRayLine', points: [{ dataIndex: 2, value: 10 }, { dataIndex: 5, value: 20 }] })
    // horizontalRayLine is treated as a 1-point horizontal line by name (see HORIZONTAL_TOOLS):
    // constant regardless of x, including well past its second point.
    expect(drawingLevelsAt(chart as unknown as DrawingsRawChart, ray, 100 * FAKE_BAR_MS, PERIOD)).toEqual([{ key: 'line', price: 10 }])
  })
})

describe('createDrawingCrossWatcher (SC-180)', () => {
  function harness (chart: FakeAnchorChart, ids: string[]): {
    watcher: ReturnType<typeof createDrawingCrossWatcher>
    tick: () => void
    raf: ReturnType<typeof vi.fn>
    cancelRaf: ReturnType<typeof vi.fn>
    isBusy: ReturnType<typeof vi.fn>
  } {
    const frames: Array<() => void> = []
    const raf = vi.fn((cb: () => void) => { frames.push(cb); return frames.length })
    const cancelRaf = vi.fn()
    const isBusy = vi.fn(() => false)
    const watcher = createDrawingCrossWatcher({
      getChart: () => chart as unknown as DrawingsRawChart,
      listUserDrawingIds: () => ids,
      isBusy,
      getPeriod: () => PERIOD,
      raf,
      cancelRaf
    })
    const tick = (): void => { const cb = frames.shift(); cb?.() }
    return { watcher, tick, raf, cancelRaf, isBusy }
  }

  it('fires once going up across a level, and does not fire again while price stays above it', () => {
    const chart = new FakeAnchorChart({ bars: 1 })
    const id = chart.createOverlay({ name: 'horizontalStraightLine', points: [{ dataIndex: 0, value: 105 }] })
    const { watcher, tick } = harness(chart, [id])
    const events: unknown[] = []
    const unsub = watcher.subscribe(e => { events.push(e) })
    // bar 0: close 100 (below 105) — first sample, nothing to compare against yet.
    tick()
    expect(events).toEqual([])
    // "new" bar (close 106, crossing up) — the watcher only reacts to a bar
    // whose timestamp changed, so push a fresh bar.
    chart.overlays.get(id) // no-op read, keeps eslint happy about unused id use above
    ;(chart as unknown as { getDataList: () => Array<{ timestamp: number, close: number }> }).getDataList = () => [{ timestamp: FAKE_BAR_MS, close: 106 }]
    tick()
    expect(events).toEqual([{ id, key: 'line', direction: 'up', price: 105, timestamp: FAKE_BAR_MS }])
    // Same bar again (no timestamp change): no duplicate.
    tick()
    expect(events.length).toBe(1)
    unsub()
  })

  it('never evaluates while isBusy() (a history load or replay)', () => {
    const chart = new FakeAnchorChart({ bars: 1 })
    const id = chart.createOverlay({ name: 'horizontalStraightLine', points: [{ dataIndex: 0, value: 50 }] })
    const { watcher, tick, isBusy } = harness(chart, [id])
    isBusy.mockReturnValue(true)
    const cb = vi.fn()
    const unsub = watcher.subscribe(cb)
    tick()
    tick()
    expect(cb).not.toHaveBeenCalled()
    unsub()
  })

  it('stops polling once the last listener unsubscribes, and resumes for a new one', () => {
    const chart = new FakeAnchorChart({ bars: 1 })
    const { watcher, raf, cancelRaf } = harness(chart, [])
    const unsub = watcher.subscribe(() => {})
    expect(raf).toHaveBeenCalledTimes(1)
    unsub()
    expect(cancelRaf).toHaveBeenCalledTimes(1)
    watcher.subscribe(() => {})
    expect(raf).toHaveBeenCalledTimes(2)
  })

  it('a per-listener `ids` option scopes that listener without affecting others', () => {
    const chart = new FakeAnchorChart({ bars: 1 })
    const idA = chart.createOverlay({ name: 'horizontalStraightLine', points: [{ dataIndex: 0, value: 105 }] })
    const idB = chart.createOverlay({ name: 'horizontalStraightLine', points: [{ dataIndex: 0, value: 999 }] })
    const { watcher, tick } = harness(chart, [idA]) // default scope: idA only
    const scopedEvents: unknown[] = []
    const unsub = watcher.subscribe(e => { scopedEvents.push(e) }, { ids: [idB] })
    tick()
    ;(chart as unknown as { getDataList: () => Array<{ timestamp: number, close: number }> }).getDataList = () => [{ timestamp: FAKE_BAR_MS, close: 1000 }]
    tick()
    expect(scopedEvents).toEqual([{ id: idB, key: 'line', direction: 'up', price: 999, timestamp: FAKE_BAR_MS }])
    unsub()
  })
})
