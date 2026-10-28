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

// prepare()'s two newest chained callbacks (SC-101 cursor feedback, SC-103
// magnet snap). Kept in a file of its own (not controller.test.ts) so it does
// not compete with PR 11's edits to that shared file. Exercises the chain
// directly (invoking the callbacks prepare() returns), not through FakeChart:
// FakeChart's createOverlay only forwards a fixed callback list and has no
// hover/drag/drawing-progress simulation, and extending it is PR 11's call to
// make, not this one's.
import { describe, it, expect, vi } from 'vitest'

import type { OverlayEvent } from 'klinecharts'

import { DrawingEditor } from './controller'
import type { EditorChart } from './controller'
import { FakeChart } from './fakeChart'

const BAR = { open: 100, high: 110, low: 90, close: 105 }
// Linear pixel space: value 110 -> y 0, value 90 -> y 100 (a normal, non-reversed axis).
const toY = (v: number): number => 110 - v
const toValue = (y: number): number => 110 - y

function fakeEditorChart (): EditorChart {
  return {
    createOverlay: vi.fn(),
    getOverlayById: vi.fn(() => null),
    overrideOverlay: vi.fn(),
    removeOverlay: vi.fn(),
    getStyles: vi.fn(() => ({ overlay: {} }) as unknown as ReturnType<EditorChart['getStyles']>),
    getDataList: () => [BAR] as unknown as ReturnType<EditorChart['getDataList']>,
    convertToPixel: ((points: unknown) => (points as Array<{ value?: number }>).map(p => (typeof p.value === 'number' ? { y: toY(p.value) } : {}))) as EditorChart['convertToPixel'],
    convertFromPixel: ((points: unknown) => (points as Array<{ x?: number, y?: number }>).map(p => (typeof p.y === 'number' ? { value: toValue(p.y) } : { dataIndex: 0 }))) as EditorChart['convertFromPixel']
  }
}

function setup (): { chart: EditorChart, editor: DrawingEditor, changes: () => number } {
  const chart = fakeEditorChart()
  let changes = 0
  const editor = new DrawingEditor({ getChart: () => chart, onChange: () => { changes++ } })
  return { chart, editor, changes: () => changes }
}

interface FakeArmedOverlay { id: string, points: Array<{ value?: number }>, currentStep: number, lock: boolean, mode: string | undefined }

/**
 * Arms a tracked overlay: prepare() + the onDrawStart chain (adds it to
 * _userIds), as ChartProComponent does. `mode` here is what the drawing bar
 * asked for when the overlay was created (create.mode, read once by
 * prepare()) — not something the caller can still change per onDrawing call.
 * prepare() itself always forces the RETURNED overlay's mode to 'normal'
 * (klinecharts' own weak/strong magnet crashed on 9.7.2 while a drawing was
 * in progress; the engine's own onDrawing hook below replaces it entirely),
 * so `overlay.mode` here reflects that override, matching what a real
 * onDrawStart event's overlay would show.
 */
function armed (editor: DrawingEditor, points: Array<{ value?: number }> = [{ value: 999 }], mode?: string): { create: ReturnType<DrawingEditor['prepare']>, overlay: FakeArmedOverlay } {
  const create = editor.prepare({ name: 'segment', points, mode } as never)
  const overlay: FakeArmedOverlay = { id: 'u1', points, currentStep: 1, lock: false, mode: 'normal' }
  create.onDrawStart?.({ overlay } as unknown as OverlayEvent)
  return { create, overlay }
}

describe('prepare(): cursor feedback (SC-101)', () => {
  it('onMouseEnter/onMouseLeave toggle hoveringUserDrawing for a tracked overlay', () => {
    const { editor } = setup()
    const { create, overlay } = armed(editor)
    expect(editor.hoveringUserDrawing).toBe(false)
    create.onMouseEnter?.({ overlay } as unknown as OverlayEvent)
    expect(editor.hoveringUserDrawing).toBe(true)
    create.onMouseLeave?.({ overlay } as unknown as OverlayEvent)
    expect(editor.hoveringUserDrawing).toBe(false)
  })

  it('onPressedMoveStart/End toggle draggingUserDrawing, but only for an unlocked drawing', () => {
    const { editor } = setup()
    const { create, overlay } = armed(editor)
    create.onPressedMoveStart?.({ overlay } as unknown as OverlayEvent)
    expect(editor.draggingUserDrawing).toBe(true)
    create.onPressedMoveEnd?.({ overlay } as unknown as OverlayEvent)
    expect(editor.draggingUserDrawing).toBe(false)

    const locked = { ...overlay, lock: true }
    create.onPressedMoveStart?.({ overlay: locked } as unknown as OverlayEvent)
    expect(editor.draggingUserDrawing).toBe(false)
  })

  it('onPressedMoveEnd leaves hoveringUserDrawing true (the pointer is still over it) and clearDragHint is a safety net', () => {
    const { editor } = setup()
    const { create, overlay } = armed(editor)
    create.onPressedMoveStart?.({ overlay } as unknown as OverlayEvent)
    create.onPressedMoveEnd?.({ overlay } as unknown as OverlayEvent)
    expect(editor.hoveringUserDrawing).toBe(true)
    editor.clearDragHint() // no-op, already cleared
    expect(editor.draggingUserDrawing).toBe(false)
  })

  it('every cursor callback returns false so klinecharts default handling still runs', () => {
    const { editor } = setup()
    const { create, overlay } = armed(editor)
    expect(create.onMouseEnter?.({ overlay } as unknown as OverlayEvent)).toBe(false)
    expect(create.onMouseLeave?.({ overlay } as unknown as OverlayEvent)).toBe(false)
    expect(create.onPressedMoveStart?.({ overlay } as unknown as OverlayEvent)).toBe(false)
    expect(create.onPressedMoveEnd?.({ overlay } as unknown as OverlayEvent)).toBe(false)
  })

  it('dispose() resets both hints', () => {
    const { editor } = setup()
    const { create, overlay } = armed(editor)
    create.onMouseEnter?.({ overlay } as unknown as OverlayEvent)
    create.onPressedMoveStart?.({ overlay } as unknown as OverlayEvent)
    editor.dispose()
    expect(editor.hoveringUserDrawing).toBe(false)
    expect(editor.draggingUserDrawing).toBe(false)
  })
})

describe('prepare(): magnet snap while drawing (SC-103)', () => {
  it('mode normal (the default when the drawing bar asked for none): onDrawing never touches the point', () => {
    const { editor } = setup()
    const points = [{ value: 999 }]
    const { create, overlay } = armed(editor, points)
    create.onDrawing?.({ overlay, x: 5, y: toY(110) } as unknown as OverlayEvent)
    expect(points[0].value).toBe(999)
  })

  it('strong magnet, asked for at arm time: onDrawing snaps the in-progress point to the nearest OHLC', () => {
    const { editor } = setup()
    const points = [{ value: 999 }]
    const { create, overlay } = armed(editor, points, 'strong_magnet')
    // The event's own overlay.mode is 'normal' (prepare()'s override, same as
    // a real klinecharts callback would report) and is intentionally ignored:
    // onDrawing uses the mode captured at prepare() time, not this field.
    create.onDrawing?.({ overlay, x: 5, y: toY(105) + 1 } as unknown as OverlayEvent)
    expect(points[0].value).toBeCloseTo(105, 5) // nearest to close(105)
  })

  it('klinecharts itself never sees weak_magnet/strong_magnet: prepare() always forces mode to normal', () => {
    const { editor } = setup()
    const create = editor.prepare({ name: 'segment', points: [{ value: 1 }], mode: 'weak_magnet' } as never)
    expect(create.mode).toBe('normal')
  })

  it('selectPlaced opens the toolbar (the editor\'s own selection) for a finished user drawing, e.g. a freehand stroke (SC-009)', () => {
    const chart = new FakeChart()
    let changes = 0
    const editor = new DrawingEditor({ getChart: () => chart as unknown as EditorChart, onChange: () => { changes++ } })
    const id = chart.createOverlay(editor.prepare({ name: 'brush', points: [{ dataIndex: 0, value: 1 }, { dataIndex: 1, value: 2 }] })) as string
    editor.track(id)
    expect(editor.selectedId).toBeNull()
    editor.selectPlaced(id, 'candle_pane')
    expect(editor.selectedId).toBe(id)
    expect(changes).toBeGreaterThan(0)
    // klinecharts' own selection is synced too, so an empty click deselects.
    expect(chart.click.instance?.id).toBe(id)
  })

  it('selectPlaced ignores an id that is not a tracked user drawing (a host overlay)', () => {
    const chart = new FakeChart()
    const editor = new DrawingEditor({ getChart: () => chart as unknown as EditorChart })
    const hostId = chart.createOverlay({ name: 'rect', points: [{ dataIndex: 0, value: 1 }, { dataIndex: 1, value: 2 }] }) as string
    editor.selectPlaced(hostId, 'candle_pane')
    expect(editor.selectedId).toBeNull()
  })

  it('a chart that throws (e.g. no data yet) leaves onDrawing a no-op, not an exception', () => {
    const broken: EditorChart = {
      ...fakeEditorChart(),
      getDataList: () => { throw new Error('boom') }
    }
    const editor = new DrawingEditor({ getChart: () => broken })
    const points = [{ value: 1 }]
    const create = editor.prepare({ name: 'segment', points, mode: 'strong_magnet' } as never)
    const overlay: FakeArmedOverlay = { id: 'u1', points, currentStep: 1, lock: false, mode: 'normal' }
    expect(() => create.onDrawing?.({ overlay, x: 5, y: 10 } as unknown as OverlayEvent)).not.toThrow()
    expect(points[0].value).toBe(1)
  })
})
