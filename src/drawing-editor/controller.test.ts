import { describe, it, expect, beforeEach } from 'vitest'

import type { OverlayCreate, OverlayEvent } from 'klinecharts'

import { addHostOverlay, DrawingEditor, DRAWING_GROUP_ID, nextZLevel } from './controller'
import type { DrawingEditorOptions, EditorChart } from './controller'
import { paneIdOf, clearChartSelection, canReorderInPane } from './compat'
import { FakeChart, RECT_TEMPLATE_STYLES } from './fakeChart'
import type { FakeOverlay } from './fakeChart'

const RECT_POINTS = [{ dataIndex: 1, timestamp: 60_000, value: 10 }, { dataIndex: 3, timestamp: 180_000, value: 20 }]

type EditorCallbackOptions = Partial<Pick<DrawingEditorOptions, 'onHistoryChange' | 'onDrawingsChange' | 'onDrawingDefaultsChange' | 'historyCap'>>

function setup (
  chartOptions: ConstructorParameters<typeof FakeChart>[0] = {},
  editorOptions: EditorCallbackOptions = {}
): { chart: FakeChart, editor: DrawingEditor, changes: () => number } {
  const chart = new FakeChart(chartOptions)
  let changes = 0
  const editor = new DrawingEditor({ getChart: () => chart as unknown as EditorChart, onChange: () => { changes++ }, ...editorOptions })
  return { chart, editor, changes: () => changes }
}

/** A drawing made from the drawing bar (goes through prepare). */
function draw (chart: FakeChart, editor: DrawingEditor, create: OverlayCreate, paneId?: string): string {
  const id = chart.createOverlay(editor.prepare(create), paneId)
  editor.track(id)
  return id as string
}

/** A host overlay (e.g. the wallet's agent layer via getChart().createOverlay): no group, no editor callbacks. */
function host (chart: FakeChart, create: OverlayCreate): FakeOverlay {
  const id = chart.createOverlay(create) as string
  return chart.getOverlayById(id) as FakeOverlay
}

const snapshotOf = (o: FakeOverlay): string => JSON.stringify({ styles: o.styles, lock: o.lock, visible: o.visible, mode: o.mode, points: o.points, zLevel: o.zLevel })

describe('prepare / tracking', () => {
  it('puts drawings in the drawing group, visible, with editor callbacks, and tracks them', () => {
    const { chart, editor } = setup()
    const id = draw(chart, editor, { name: 'segment', points: RECT_POINTS, visible: false })
    const o = chart.getOverlayById(id) as FakeOverlay
    expect(o.groupId).toBe(DRAWING_GROUP_ID)
    expect(o.visible).toBe(true)
    expect(typeof o.onSelected).toBe('function')
    expect(editor.isUserDrawing(id)).toBe(true)
  })

  it('does not mutate the object it is given, and keeps callbacks already on it', () => {
    const { editor } = setup()
    let theirs = 0
    const create: OverlayCreate = { name: 'segment', onClick: () => { theirs++; return false } }
    const prepared = editor.prepare(create)
    expect(prepared).not.toBe(create)
    expect(create.groupId).toBeUndefined()
    prepared.onClick?.({ overlay: { id: 'x', currentStep: 1 } } as unknown as OverlayEvent)
    expect(theirs).toBe(1)
  })

  it('never tracks host overlays', () => {
    const { chart, editor } = setup()
    const h = host(chart, { name: 'rect', points: RECT_POINTS })
    expect(editor.isUserDrawing(h.id)).toBe(false)
    editor.select(h.id)
    expect(editor.selectedId).toBeNull()
  })
})

describe('selection', () => {
  let chart: FakeChart
  let editor: DrawingEditor
  beforeEach(() => { ({ chart, editor } = setup()) })

  it('selects a finished user drawing on click and exposes its state', () => {
    const id = draw(chart, editor, { name: 'segment', points: RECT_POINTS })
    chart.clickOverlay(id, { pageX: 321, pageY: 123 })
    expect(editor.selectedId).toBe(id)
    expect(editor.anchor).toEqual({ pageX: 321, pageY: 123 })
    const snap = editor.snapshot()
    expect(snap).toMatchObject({ id, name: 'segment', locked: false, lineColor: '#1677FF', lineWidth: 1, lineStyle: 'solid', defaultColor: '#1677FF' })
    expect(snap?.controls).toEqual({ lineColor: true, textColor: false, lineWidth: true, lineStyle: true })
  })

  it('ignores onSelected while the drawing is still being placed, then selects it on draw end', () => {
    const id = draw(chart, editor, { name: 'rect' })
    chart.placeProgress(1) // first click: klinecharts selects the in-progress overlay
    expect(editor.selectedId).toBeNull()
    chart.placeProgress(1) // last click completes it
    expect(editor.selectedId).toBe(id)
  })

  it('does not open for host overlays and closes when a host overlay is clicked', () => {
    const id = draw(chart, editor, { name: 'segment', points: RECT_POINTS })
    const h = host(chart, { name: 'segment', points: RECT_POINTS })
    chart.clickOverlay(h.id)
    expect(editor.selectedId).toBeNull()
    chart.clickOverlay(id)
    expect(editor.selectedId).toBe(id)
    chart.clickOverlay(h.id)
    expect(editor.selectedId).toBeNull()
  })

  it('closes on a click on empty chart space', () => {
    const id = draw(chart, editor, { name: 'segment', points: RECT_POINTS })
    chart.clickOverlay(id)
    chart.clickEmpty()
    expect(editor.selectedId).toBeNull()
  })

  it('switches between drawings, one at a time', () => {
    const a = draw(chart, editor, { name: 'segment', points: RECT_POINTS })
    const b = draw(chart, editor, { name: 'rect', points: RECT_POINTS })
    chart.clickOverlay(a)
    const key = editor.selectionKey
    chart.clickOverlay(b)
    expect(editor.selectedId).toBe(b)
    expect(editor.selectionKey).toBeGreaterThan(key)
  })

  it('reopens when the same drawing is clicked again after Escape', () => {
    const id = draw(chart, editor, { name: 'segment', points: RECT_POINTS })
    chart.clickOverlay(id)
    editor.deselect()
    expect(editor.selectedId).toBeNull()
    expect(chart.click.instance).toBeNull() // klinecharts' own selection cleared too
    chart.clickOverlay(id)
    expect(editor.selectedId).toBe(id)
  })

  it('reopens on a second click even when klinecharts still thinks it is selected (no onSelected)', () => {
    const { chart: c, editor: e } = setup({ withoutStore: true })
    const id = draw(c, e, { name: 'segment', points: RECT_POINTS })
    c.clickOverlay(id)
    e.deselect() // cannot clear klinecharts' selection without the store
    c.clickOverlay(id) // same id: klinecharts fires only onClick
    expect(e.selectedId).toBe(id)
  })

  it('ignores a stale onDeselected for a drawing that was already removed', () => {
    const seen: Array<string | null> = []
    const c = new FakeChart()
    const recording: DrawingEditor = new DrawingEditor({ getChart: () => c as unknown as EditorChart, onChange: () => { seen.push(recording.selectedId) } })
    const a = draw(c, recording, { name: 'segment', points: RECT_POINTS })
    const b = draw(c, recording, { name: 'segment', points: RECT_POINTS })
    c.clickOverlay(a)
    c.removeOverlay({ id: a }) // klinecharts keeps a removed overlay as its click instance (SC-090: right-click no longer removes a finished drawing, so this is simulated via a direct removal instead)
    expect(recording.selectedId).toBeNull()
    expect(c.click.instance?.id).toBe(a)
    seen.length = 0
    c.clickOverlay(b) // onClick(b), then onDeselected(a) for the removed overlay, then onSelected(b)
    expect(recording.selectedId).toBe(b)
    // the stale deselect must not close the editor in between (no flicker)
    expect(seen).not.toContain(null)
  })

  it('select() refuses a drawing that is still being placed', () => {
    const id = draw(chart, editor, { name: 'rect' })
    editor.select(id)
    expect(editor.selectedId).toBeNull()
  })

  it('closes when the host removes the selected drawing', () => {
    const id = draw(chart, editor, { name: 'segment', points: RECT_POINTS })
    chart.clickOverlay(id)
    chart.removeOverlay()
    expect(editor.selectedId).toBeNull()
    expect(editor.snapshot()).toBeNull()
    expect(editor.isUserDrawing(id)).toBe(false)
  })
})

describe('editing never touches host overlays', () => {
  let chart: FakeChart
  let editor: DrawingEditor
  let hostRect: FakeOverlay
  let hostLine: FakeOverlay
  let mine: string
  let before: string[]

  beforeEach(() => {
    ({ chart, editor } = setup())
    hostRect = host(chart, { name: 'rect', points: RECT_POINTS })
    hostLine = host(chart, { name: 'horizontalStraightLine', points: RECT_POINTS.slice(0, 1) })
    mine = draw(chart, editor, { name: 'rect', points: RECT_POINTS })
    chart.clickOverlay(mine)
    before = [snapshotOf(hostRect), snapshotOf(hostLine)]
  })

  const hostsUnchanged = (): void => {
    expect(chart.getOverlayById(hostRect.id)).toBe(hostRect)
    expect(chart.getOverlayById(hostLine.id)).toBe(hostLine)
    expect([snapshotOf(hostRect), snapshotOf(hostLine)]).toEqual(before)
  }

  it('style changes go to the selected drawing only, as a fresh object', () => {
    editor.applyStyle({ kind: 'lineColor', color: '#F23645' })
    editor.applyStyle({ kind: 'lineWidth', width: 3 })
    editor.applyStyle({ kind: 'lineStyle', style: 'dashed' })
    const o = chart.getOverlayById(mine) as FakeOverlay
    expect(o.styles).toEqual({ polygon: { color: 'rgba(242, 54, 69, 0.15)', borderColor: '#F23645', borderSize: 3, borderStyle: 'dashed', borderDashedValue: [6, 4] } })
    // the template object shared by every rect (host ones included) is untouched
    expect(RECT_TEMPLATE_STYLES).toEqual({ polygon: { color: 'rgba(22, 119, 255, 0.15)' } })
    expect(hostRect.styles).toBe(RECT_TEMPLATE_STYLES)
    expect(editor.snapshot()).toMatchObject({ lineColor: '#F23645', lineWidth: 3, lineStyle: 'dashed' })
    hostsUnchanged()
    // every override named an id
    chart.calls.filter(c => c.method === 'overrideOverlay').forEach(c => { expect((c.arg as { id?: string }).id).toBe(mine) })
  })

  it('lock toggles the selected drawing only; a finished drawing survives a right-click, locked or not (SC-090)', () => {
    editor.toggleLock()
    expect(chart.getOverlayById(mine)?.lock).toBe(true)
    expect(editor.snapshot()?.locked).toBe(true)
    chart.rightClick(mine)
    expect(chart.getOverlayById(mine)).not.toBeNull()
    expect(editor.menu).toEqual({ id: mine, anchor: expect.anything() })
    editor.closeMenu()
    editor.toggleLock()
    chart.rightClick(mine) // unlocked now, but still finished: still survives
    expect(chart.getOverlayById(mine)).not.toBeNull()
    expect(editor.menu?.id).toBe(mine)
    hostsUnchanged()
  })

  it('delete removes the selected drawing only', () => {
    editor.remove()
    expect(chart.getOverlayById(mine)).toBeNull()
    expect(editor.selectedId).toBeNull()
    expect(chart.click.instance).toBeNull()
    hostsUnchanged()
    // a second delete with nothing selected does nothing
    editor.remove()
    expect(chart.all().length).toBe(2)
  })

  it('actions do nothing once nothing is selected', () => {
    editor.deselect()
    editor.applyStyle({ kind: 'lineColor', color: '#000000' })
    editor.toggleLock()
    editor.remove()
    editor.hide()
    expect(editor.clone()).toBeNull()
    expect(chart.getOverlayById(mine)?.styles).toBe(RECT_TEMPLATE_STYLES)
    hostsUnchanged()
  })

  it('hide hides only the selected drawing, closes the editor, and show-all brings it back', () => {
    editor.hide()
    expect(chart.getOverlayById(mine)?.visible).toBe(false)
    expect(editor.selectedId).toBeNull()
    hostsUnchanged()
    editor.setAllVisible(true)
    expect(chart.getOverlayById(mine)?.visible).toBe(true)
    hostsUnchanged()
  })

  it('drawing-bar lock / hide-all / magnet / remove-all apply to user drawings only', () => {
    const other = draw(chart, editor, { name: 'segment', points: RECT_POINTS })
    editor.setAllLocked(true)
    editor.setAllVisible(false)
    editor.setAllMode('strong_magnet' as never)
    expect([mine, other].map(id => chart.getOverlayById(id))).toEqual([
      expect.objectContaining({ lock: true, visible: false, mode: 'strong_magnet' }),
      expect.objectContaining({ lock: true, visible: false, mode: 'strong_magnet' })
    ])
    expect(editor.selectedId).toBeNull() // hide-all closes the editor
    hostsUnchanged()
    editor.removeAll()
    expect(chart.getOverlayById(mine)).toBeNull()
    expect(chart.getOverlayById(other)).toBeNull()
    expect(editor.userDrawingIds()).toEqual([])
    hostsUnchanged()
  })

  it('clone copies the selected drawing, offset, and selects the copy', () => {
    const copyId = editor.clone()
    expect(typeof copyId).toBe('string')
    const copy = chart.getOverlayById(copyId as string) as FakeOverlay
    const original = chart.getOverlayById(mine) as FakeOverlay
    expect(copy.name).toBe('rect')
    expect(copy.groupId).toBe(DRAWING_GROUP_ID)
    expect(copy.styles).toEqual(original.styles)
    expect(copy.styles).not.toBe(original.styles)
    // 5 bars loaded (0..4): the second point lands past the last bar, so it keeps
    // only its dataIndex (a timestamp there would be drawn at bar 3).
    expect(copy.points).toEqual([
      { dataIndex: 4, timestamp: 240_000, value: 0 },
      { dataIndex: 6, value: 10 }
    ])
    copy.points.forEach((p, i) => { expect(chart.drawnDataIndex(p)).toBe((chart.drawnDataIndex(original.points[i]) as number) + 3) })
    expect(editor.isUserDrawing(copyId)).toBe(true)
    expect(editor.selectedId).toBe(copyId)
    expect(chart.click.instance?.id).toBe(copyId)
    expect(original.points).toEqual(RECT_POINTS)
    hostsUnchanged()
  })

  it('bring to front / send to back reorder the pane on klinecharts 9.1.1 (no zLevel)', () => {
    const pane = (): string[] => (chart.panes.get('candle_pane') ?? []).map(o => o.id)
    editor.sendToBack()
    expect(pane()[0]).toBe(mine)
    editor.bringToFront()
    expect(pane()[pane().length - 1]).toBe(mine)
    hostsUnchanged()
  })
})

describe('clone of a drawing finished with fewer points than its tool\'s steps', () => {
  /** Draw a tool from the drawing bar, place `clicks` points, finish with a double-click. */
  function drawAndDoubleClick (chart: FakeChart, editor: DrawingEditor, name: string, clicks: number): string {
    const id = draw(chart, editor, { name })
    chart.placeProgress(clicks)
    chart.doubleClick()
    return id
  }

  const expectFinishedAndSelected = (chart: FakeChart, editor: DrawingEditor, copyId: string | null): void => {
    expect(typeof copyId).toBe('string')
    const copy = chart.getOverlayById(copyId as string) as FakeOverlay
    expect(copy.currentStep).toBe(-1)
    expect(chart.progress).toBeNull() // not left as the drawing in progress
    expect(chart.panes.get('candle_pane')?.map(o => o.id)).toContain(copyId)
    expect(editor.selectedId).toBe(copyId)
    expect(chart.click.instance?.id).toBe(copyId)
  }

  it('finishes an Any Waves copy (open-ended tool) instead of leaving it following the pointer', () => {
    const { chart, editor } = setup()
    const id = drawAndDoubleClick(chart, editor, 'anyWaves', 4)
    expect(editor.selectedId).toBe(id)
    const copyId = editor.clone()
    expectFinishedAndSelected(chart, editor, copyId)
    expect((chart.getOverlayById(copyId as string) as FakeOverlay).points).toHaveLength(4)
    // the next click on empty space deselects, like with any finished drawing
    chart.clickEmpty()
    expect(editor.selectedId).toBeNull()
  })

  it('finishes a copy of a multi-point tool that was ended early with a double-click', () => {
    const { chart, editor } = setup()
    drawAndDoubleClick(chart, editor, 'threeWaves', 2)
    expectFinishedAndSelected(chart, editor, editor.clone())
  })

  it('does not replace a drawing that is already in progress (a host\'s, say)', () => {
    const { chart, editor } = setup()
    const id = drawAndDoubleClick(chart, editor, 'anyWaves', 4)
    const hostInProgress = host(chart, { name: 'rect' }) // no points yet: klinecharts' drawing in progress
    expect(chart.progress?.overlay).toBe(hostInProgress)
    expect(editor.clone()).toBeNull()
    expect(chart.progress?.overlay).toBe(hostInProgress)
    expect(editor.userDrawingIds()).toEqual([id])
    // a drawing that comes back finished can still be cloned meanwhile
    const seg = draw(chart, editor, { name: 'segment', points: RECT_POINTS })
    chart.clickOverlay(seg)
    expect(typeof editor.clone()).toBe('string')
    expect(chart.progress?.overlay).toBe(hostInProgress)
  })

  it('makes no copy at all when this klinecharts cannot finish it', () => {
    const { chart, editor } = setup({ withoutForceComplete: true })
    const id = drawAndDoubleClick(chart, editor, 'anyWaves', 4)
    const before = chart.all().map(o => o.id)
    expect(editor.clone()).toBeNull()
    expect(chart.progress).toBeNull()
    expect(chart.all().map(o => o.id)).toEqual(before)
    expect(editor.userDrawingIds()).toEqual([id])
    expect(editor.selectedId).toBe(id)
  })
})

describe('clone value offset', () => {
  it('moves every point 16 px down at its own price on a log axis, keeping values positive', () => {
    const { chart, editor } = setup({ logAxis: { min: 3000, max: 100_000, height: 500 } })
    const points = [{ dataIndex: 1, timestamp: 60_000, value: 4000 }, { dataIndex: 2, timestamp: 120_000, value: 60_000 }]
    const id = draw(chart, editor, { name: 'segment', points })
    chart.clickOverlay(id)
    const copy = chart.getOverlayById(editor.clone() as string) as FakeOverlay
    copy.points.forEach((p, i) => {
      expect(p.value).toBeGreaterThan(0)
      expect(chart.valueToY(p.value as number)).toBeCloseTo(chart.valueToY(points[i].value) + 16, 6)
    })
  })
})

describe('data context (symbol)', () => {
  it('closes the editor when the symbol changes, not when it is set again or first recorded', () => {
    const { chart, editor } = setup()
    const id = draw(chart, editor, { name: 'segment', points: RECT_POINTS })
    chart.clickOverlay(id)
    editor.setDataContext('BTCUSDT')
    expect(editor.selectedId).toBe(id)
    editor.setDataContext('BTCUSDT')
    expect(editor.selectedId).toBe(id)
    editor.setDataContext('ETHUSDT')
    expect(editor.selectedId).toBeNull()
    expect(editor.snapshot()).toBeNull()
    expect(chart.click.instance).toBeNull() // klinecharts' handles cleared too
  })

  it('BTC->ETH shows zero BTC drawings, and BTC->ETH->BTC restores them exactly (SC-120)', () => {
    const { chart, editor } = setup()
    editor.setDataContext('BTCUSDT') // first record: nothing to save yet
    const id = draw(chart, editor, { name: 'segment', points: RECT_POINTS })
    chart.clickOverlay(id)
    editor.toggleLock()
    editor.setDataContext('ETHUSDT')
    expect(chart.getOverlayById(id)).toBeNull() // gone: no BTC drawing leaks onto ETH
    expect(editor.userDrawingIds()).toEqual([])
    // a drawing made on ETH is unaffected by BTC's saved state
    const ethId = draw(chart, editor, { name: 'rect', points: RECT_POINTS })
    editor.restoreForSymbol('ETHUSDT') // no-op: nothing was saved for ETH yet
    expect(editor.userDrawingIds()).toEqual([ethId])
    editor.setDataContext('BTCUSDT')
    expect(chart.getOverlayById(ethId)).toBeNull() // the ETH drawing does not leak onto BTC either
    editor.restoreForSymbol('BTCUSDT')
    expect(editor.userDrawingIds()).toHaveLength(1)
    const restoredId = editor.userDrawingIds()[0]
    const restored = chart.getOverlayById(restoredId) as FakeOverlay
    expect(restored.name).toBe('segment')
    expect(restored.lock).toBe(true)
    // Restored by timestamp, not by dataIndex (which is redundant and would
    // go stale after a loadMore) — same bars, same values, not the same object shape.
    restored.points.forEach((p, i) => {
      expect(chart.drawnDataIndex(p)).toBe(chart.drawnDataIndex(RECT_POINTS[i]))
      expect(p.value).toBe(RECT_POINTS[i].value)
    })
  })

  it('restoreForSymbol is a no-op once a newer symbol change has superseded it', () => {
    const { chart, editor } = setup()
    editor.setDataContext('BTCUSDT')
    draw(chart, editor, { name: 'segment', points: RECT_POINTS })
    editor.setDataContext('ETHUSDT')
    editor.setDataContext('SOLUSDT')
    editor.restoreForSymbol('ETHUSDT') // stale: SOL is current now
    expect(editor.userDrawingIds()).toEqual([])
  })

  it('clears the undo stack on a symbol change (its entries would name ids from the old symbol)', () => {
    const { chart, editor } = setup()
    editor.setDataContext('BTCUSDT')
    draw(chart, editor, { name: 'segment', points: RECT_POINTS })
    expect(editor.canUndo()).toBe(true)
    editor.setDataContext('ETHUSDT')
    expect(editor.canUndo()).toBe(false)
  })
})

describe('draw order with zLevel (klinecharts 9.8)', () => {
  it('moves only the selected drawing\'s zLevel', () => {
    const { chart, editor } = setup({ withZLevel: true })
    const h = host(chart, { name: 'rect', points: RECT_POINTS })
    const a = draw(chart, editor, { name: 'segment', points: RECT_POINTS })
    const b = draw(chart, editor, { name: 'segment', points: RECT_POINTS })
    chart.clickOverlay(a)
    expect(editor.snapshot()?.canReorder).toBe(true)
    editor.bringToFront()
    expect(chart.getOverlayById(a)?.zLevel).toBe(1)
    editor.sendToBack()
    expect(chart.getOverlayById(a)?.zLevel).toBe(-1)
    expect(chart.getOverlayById(b)?.zLevel).toBe(0)
    expect(h.zLevel).toBe(0)
    expect((chart.panes.get('candle_pane') ?? [])[0].id).toBe(a)
  })

  it('clones onto the source drawing\'s pane', () => {
    const { chart, editor } = setup({ withZLevel: true })
    const a = draw(chart, editor, { name: 'segment', points: RECT_POINTS }, 'pane_rsi')
    chart.clickOverlay(a)
    const copy = editor.clone() as string
    expect(chart.panes.get('pane_rsi')?.map(o => o.id)).toEqual([a, copy])
  })
})

describe('nextZLevel', () => {
  it('goes above / below every known level and the host default of 0', () => {
    expect(nextZLevel('front', [])).toBe(1)
    expect(nextZLevel('back', [])).toBe(-1)
    expect(nextZLevel('front', [3, -2])).toBe(4)
    expect(nextZLevel('back', [3, -2])).toBe(-3)
    expect(nextZLevel('front', [NaN])).toBe(1)
  })
})

describe('compat', () => {
  it('finds the pane from overlay.paneId, then klinecharts\' click info, then the candle pane', () => {
    const chart = new FakeChart()
    expect(paneIdOf(chart, { id: 'x', paneId: 'pane_macd' })).toBe('pane_macd')
    const id = chart.createOverlay({ name: 'segment', points: RECT_POINTS }, 'pane_rsi') as string
    expect(paneIdOf(chart, { id })).toBe('candle_pane')
    chart.clickOverlay(id)
    expect(paneIdOf(chart, { id })).toBe('pane_rsi')
  })

  it('degrades without the private store', () => {
    const chart = new FakeChart({ withoutStore: true })
    expect(clearChartSelection(chart)).toBe(false)
    expect(canReorderInPane(chart)).toBe(false)
    expect(paneIdOf(chart, { id: 'x' })).toBe('candle_pane')
    expect(clearChartSelection(null)).toBe(false)
    expect(clearChartSelection({ getChartStore: () => { throw new Error('boom') } })).toBe(false)
  })

  it('reports no reordering on 9.1.1 without the store', () => {
    const { chart, editor } = setup({ withoutStore: true })
    const id = draw(chart, editor, { name: 'segment', points: RECT_POINTS })
    chart.clickOverlay(id)
    expect(editor.snapshot()?.canReorder).toBe(false)
    expect(editor.bringToFront()).toBe(false)
  })
})

describe('accent styles (src/extension/accent.ts)', () => {
  // A chart whose drawing default is a host accent, and Super Chart's rect,
  // whose fill comes from the accent at draw time instead of its template.
  const accent = '#1414B0'
  const overlayDefaults = {
    line: { style: 'solid', smooth: false, color: accent, size: 1, dashedValue: [2, 2] },
    polygon: { style: 'fill', color: accent, borderColor: accent, borderSize: 1, borderStyle: 'solid', borderDashedValue: [2, 2] }
  }

  it("shows the colour a tool draws in, and a new colour keeps the fill's opacity", () => {
    const { chart, editor } = setup({ overlayDefaults, rectWithoutTemplateStyles: true })
    const id = draw(chart, editor, { name: 'rect', points: RECT_POINTS })
    chart.clickOverlay(id)
    expect(editor.snapshot()).toMatchObject({ lineColor: accent, defaultColor: accent })
    editor.applyStyle({ kind: 'lineColor', color: '#F23645' })
    expect(chart.getOverlayById(id)?.styles).toEqual({ polygon: { color: 'rgba(242, 54, 69, 0.15)', borderColor: '#F23645' } })
  })

  it("shows a note's text as drawn: white or dark ink on the accent box", () => {
    const { chart, editor } = setup({ overlayDefaults })
    const note = draw(chart, editor, { name: 'note', points: RECT_POINTS.slice(0, 1) })
    chart.clickOverlay(note)
    expect(editor.snapshot()?.textColor).toBe('#FFFFFF')
    const light = setup({ overlayDefaults: { ...overlayDefaults, line: { ...overlayDefaults.line, color: '#A0A8FF' } } })
    const note2 = draw(light.chart, light.editor, { name: 'note', points: RECT_POINTS.slice(0, 1) })
    light.chart.clickOverlay(note2)
    expect(light.editor.snapshot()?.textColor).toBe('#131722')
  })
})

// ---------------------------------------------------------------------------
// SC-090: right-click opens a menu instead of deleting a finished drawing;
// an in-progress one can still be cancelled by right-click or Escape.
// ---------------------------------------------------------------------------

describe('right-click (SC-090)', () => {
  it('keeps a finished, unlocked drawing and opens the context menu at the press point', () => {
    const { chart, editor } = setup()
    const id = draw(chart, editor, { name: 'segment', points: RECT_POINTS })
    chart.clickOverlay(id)
    chart.rightClick(id, { pageX: 42, pageY: 99 })
    expect(chart.getOverlayById(id)).not.toBeNull()
    expect(editor.menu).toEqual({ id, anchor: { pageX: 42, pageY: 99 } })
    expect(editor.selectedId).toBe(id) // right-click also selects it
  })

  it('still cancels a half-placed multi-point drawing (the only way to cancel one)', () => {
    const { chart, editor } = setup()
    const id = draw(chart, editor, { name: 'threeWaves' })
    chart.placeProgress(1) // 1 of however many points threeWaves needs
    chart.rightClick(id)
    expect(chart.getOverlayById(id)).toBeNull()
    expect(editor.menu).toBeNull()
    expect(editor.userDrawingIds()).toEqual([])
  })

  it('closeMenu() closes it; consumeRightClickHandled() reports and clears the flag exactly once', () => {
    const { chart, editor } = setup()
    const id = draw(chart, editor, { name: 'segment', points: RECT_POINTS })
    expect(editor.consumeRightClickHandled()).toBe(false) // nothing happened yet
    chart.rightClick(id)
    expect(editor.menu).not.toBeNull()
    expect(editor.consumeRightClickHandled()).toBe(true)
    expect(editor.consumeRightClickHandled()).toBe(false) // cleared
    chart.rightClick(id)
    editor.closeMenu()
    expect(editor.menu).toBeNull()
  })

  it('a right-click on a host overlay is untouched by the editor (klinecharts\' own default applies)', () => {
    const { chart, editor } = setup()
    const h = host(chart, { name: 'rect', points: RECT_POINTS })
    chart.rightClick(h.id) // no onRightClick on a host overlay: klinecharts removes it
    expect(chart.getOverlayById(h.id)).toBeNull()
    expect(editor.menu).toBeNull()
  })

  it('removing the menu\'s drawing (Delete, or another right-click elsewhere) closes the menu, and its own onChange already sees it null', () => {
    const chart = new FakeChart()
    // Read editor.menu from INSIDE the onChange callback (what
    // ChartProComponent's setContextMenu(editor.menu) actually reads), not
    // after remove() returns: the real bug this guards was _setSelection's
    // own emit firing while _menu had not been cleared yet, so
    // DrawingContextMenu's onClose()->closeMenu() (a no-op once menu is
    // already null) was the only remaining chance to notify — and never did.
    let menuAtLastChange: { id: string } | null | 'never called' = 'never called'
    const editor = new DrawingEditor({ getChart: () => chart as unknown as EditorChart, onChange: () => { menuAtLastChange = editor.menu } })
    const id = draw(chart, editor, { name: 'segment', points: RECT_POINTS })
    chart.clickOverlay(id)
    chart.rightClick(id)
    expect(editor.menu?.id).toBe(id)
    editor.remove()
    expect(editor.menu).toBeNull()
    expect(menuAtLastChange).toBeNull()
  })
})

describe('cancelInProgress (Escape while placing a tool)', () => {
  it('removes the in-progress drawing and records no history', () => {
    const { chart, editor } = setup()
    const id = draw(chart, editor, { name: 'threeWaves' })
    chart.placeProgress(1)
    expect(editor.cancelInProgress()).toBe(true)
    expect(chart.getOverlayById(id)).toBeNull()
    expect(editor.canUndo()).toBe(false)
  })

  it('returns false with nothing in progress', () => {
    const { editor } = setup()
    expect(editor.cancelInProgress()).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// SC-091: host overlays that opt in to surviving right-click, with drag left
// exactly as the host asked.
// ---------------------------------------------------------------------------

describe('addHostOverlay (SC-091)', () => {
  it('defaults to locked (immovable) and always survives right-click', () => {
    const chart = new FakeChart()
    const id = addHostOverlay(chart as unknown as EditorChart, { name: 'priceLine', points: RECT_POINTS.slice(0, 1) }) as string
    const before = JSON.stringify(chart.getOverlayById(id)?.points)
    chart.rightClick(id)
    expect(chart.getOverlayById(id)).not.toBeNull()
    expect(chart.getOverlayById(id)?.lock).toBe(true)
    expect(JSON.stringify(chart.getOverlayById(id)?.points)).toBe(before)
  })

  it('draggable: true keeps it unlocked and still survives right-click; onChange fires only on a real change', () => {
    const chart = new FakeChart()
    const changes: unknown[] = []
    const id = addHostOverlay(chart as unknown as EditorChart, { name: 'segment', points: RECT_POINTS }, {
      draggable: true,
      onChange: pts => { changes.push(pts) }
    }) as string
    expect(chart.getOverlayById(id)?.lock).toBe(false)
    chart.pressedMove(id, RECT_POINTS) // same points: no real change
    expect(changes).toHaveLength(0)
    const moved = [{ dataIndex: 5, timestamp: 300_000, value: 50 }, { dataIndex: 6, timestamp: 360_000, value: 60 }]
    chart.pressedMove(id, moved)
    expect(changes).toEqual([moved])
    chart.rightClick(id)
    expect(chart.getOverlayById(id)).not.toBeNull()
  })

  it('onRemove fires with the id when it is removed', () => {
    const chart = new FakeChart()
    const removed: string[] = []
    const id = addHostOverlay(chart as unknown as EditorChart, { name: 'rect', points: RECT_POINTS }, { onRemove: rid => { removed.push(rid) } }) as string
    chart.removeOverlay({ id })
    expect(removed).toEqual([id])
  })

  it('keeps any onRightClick/onPressedMoveEnd/onRemoved the host already set', () => {
    const chart = new FakeChart()
    let theirRightClick = 0
    const id = addHostOverlay(chart as unknown as EditorChart, {
      name: 'rect',
      points: RECT_POINTS,
      onRightClick: () => { theirRightClick++; return false }
    }) as string
    chart.rightClick(id)
    expect(theirRightClick).toBe(1)
    expect(chart.getOverlayById(id)).not.toBeNull() // still survives: addHostOverlay's own true wins
  })

  it('never enters the editor\'s tracked drawings, undo stack or object tree', () => {
    const { chart, editor } = setup()
    const id = addHostOverlay(chart as unknown as EditorChart, { name: 'rect', points: RECT_POINTS }) as string
    expect(editor.isUserDrawing(id)).toBe(false)
    expect(editor.listDrawings()).toEqual([])
    expect(editor.canUndo()).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// SC-092: undo / redo.
// ---------------------------------------------------------------------------

describe('undo / redo: create', () => {
  it('undo removes a freshly drawn overlay; redo restores it under the same id', () => {
    const { chart, editor } = setup()
    const id = draw(chart, editor, { name: 'segment', points: RECT_POINTS })
    expect(editor.canUndo()).toBe(true)
    expect(editor.canRedo()).toBe(false)
    expect(editor.undo()).toBe(true)
    expect(chart.getOverlayById(id)).toBeNull()
    expect(editor.isUserDrawing(id)).toBe(false)
    expect(editor.canRedo()).toBe(true)
    expect(editor.redo()).toBe(true)
    expect(chart.getOverlayById(id)?.name).toBe('segment')
    expect(editor.isUserDrawing(id)).toBe(true)
    expect(editor.selectedId).toBe(id)
  })

  it('restores an Any Waves drawing completed, not half-drawn, after undo of its removal and redo of its creation', () => {
    const { chart, editor } = setup()
    const id = draw(chart, editor, { name: 'anyWaves' })
    chart.placeProgress(4)
    chart.doubleClick()
    expect(editor.canUndo()).toBe(true)
    editor.undo() // undoes the creation: removes it
    expect(chart.getOverlayById(id)).toBeNull()
    editor.redo()
    const restored = chart.getOverlayById(id) as FakeOverlay
    expect(restored.currentStep).toBe(-1)
    expect(chart.progress).toBeNull()
    expect(restored.points).toHaveLength(4)
  })

  it('a new action after an undo drops the redo', () => {
    const { chart, editor } = setup()
    const a = draw(chart, editor, { name: 'segment', points: RECT_POINTS })
    editor.undo()
    draw(chart, editor, { name: 'rect', points: RECT_POINTS })
    expect(editor.canRedo()).toBe(false)
    expect(chart.getOverlayById(a)).toBeNull() // a stays gone
  })

  it('never records or restores a host overlay', () => {
    const { chart, editor } = setup()
    const h = host(chart, { name: 'rect', points: RECT_POINTS })
    const before = snapshotOf(h)
    expect(editor.canUndo()).toBe(false)
    draw(chart, editor, { name: 'segment', points: RECT_POINTS })
    editor.undo()
    expect(snapshotOf(chart.getOverlayById(h.id) as FakeOverlay)).toBe(before)
  })
})

describe('undo / redo: remove and remove-all', () => {
  it('undo of remove() restores id, points, styles, lock and z-order', () => {
    const { chart, editor } = setup({ withZLevel: true })
    const id = draw(chart, editor, { name: 'rect', points: RECT_POINTS })
    chart.clickOverlay(id)
    editor.applyStyle({ kind: 'lineColor', color: '#F23645' })
    editor.toggleLock()
    editor.bringToFront()
    const before = snapshotOf(chart.getOverlayById(id) as FakeOverlay)
    editor.remove()
    expect(chart.getOverlayById(id)).toBeNull()
    expect(editor.undo()).toBe(true)
    const restored = chart.getOverlayById(id) as FakeOverlay
    expect(restored.id).toBe(id)
    // Restored by timestamp (never dataIndex, which klinecharts itself would
    // treat as stale after a loadMore), so points compare by drawn bar +
    // value rather than by exact object shape; everything else is exact.
    expect(JSON.parse(before)).toMatchObject({
      styles: { polygon: { color: 'rgba(242, 54, 69, 0.15)', borderColor: '#F23645' } },
      lock: true,
      visible: true,
      mode: 'normal',
      zLevel: 1
    })
    expect(restored.styles).toEqual({ polygon: { color: 'rgba(242, 54, 69, 0.15)', borderColor: '#F23645' } })
    expect(restored.lock).toBe(true)
    expect(restored.zLevel).toBe(1)
    restored.points.forEach((p, i) => {
      expect(chart.drawnDataIndex(p)).toBe(chart.drawnDataIndex(RECT_POINTS[i]))
      expect(p.value).toBe(RECT_POINTS[i].value)
    })
  })

  it('remove-all is one history entry: one undo brings every removed drawing back', () => {
    const { chart, editor } = setup()
    const a = draw(chart, editor, { name: 'segment', points: RECT_POINTS })
    const b = draw(chart, editor, { name: 'rect', points: RECT_POINTS })
    const h = host(chart, { name: 'rect', points: RECT_POINTS })
    const hostBefore = snapshotOf(h)
    editor.removeAll()
    expect(chart.getOverlayById(a)).toBeNull()
    expect(chart.getOverlayById(b)).toBeNull()
    expect(editor.undo()).toBe(true)
    expect(chart.getOverlayById(a)).not.toBeNull()
    expect(chart.getOverlayById(b)).not.toBeNull()
    expect(editor.userDrawingIds().sort()).toEqual([a, b].sort())
    expect(snapshotOf(chart.getOverlayById(h.id) as FakeOverlay)).toBe(hostBefore)
    expect(editor.redo()).toBe(true)
    expect(chart.getOverlayById(a)).toBeNull()
    expect(chart.getOverlayById(b)).toBeNull()
  })

  it('a right-click delete of an in-progress drawing (cancel) is not itself undo-able', () => {
    const { chart, editor } = setup()
    const id = draw(chart, editor, { name: 'threeWaves' })
    chart.placeProgress(1)
    chart.rightClick(id) // cancels the half-placed drawing
    expect(chart.getOverlayById(id)).toBeNull()
    expect(editor.canUndo()).toBe(false)
  })
})

describe('undo / redo: style, lock, visibility, move (coalesced gestures)', () => {
  it('one slider drag (many onInput-like calls) undoes in a single step', () => {
    const { chart, editor } = setup()
    const id = draw(chart, editor, { name: 'segment', points: RECT_POINTS })
    chart.clickOverlay(id)
    const before = (chart.getOverlayById(id) as FakeOverlay).styles
    for (let a = 10; a <= 100; a += 10) {
      editor.applyStyle({ kind: 'lineColor', color: `rgba(242, 54, 69, ${a / 100})` })
    }
    expect(editor.canUndo()).toBe(true)
    editor.undo() // undoes the whole drag in one step
    expect((chart.getOverlayById(id) as FakeOverlay).styles).toEqual(before)
    expect(editor.canUndo()).toBe(true) // the create is still there, on its own
    editor.undo()
    expect(chart.getOverlayById(id)).toBeNull()
    expect(editor.canUndo()).toBe(false)
  })

  it('a different action in between starts a new coalescing group', () => {
    const { chart, editor } = setup()
    const id = draw(chart, editor, { name: 'segment', points: RECT_POINTS })
    chart.clickOverlay(id)
    editor.applyStyle({ kind: 'lineColor', color: '#F23645' })
    editor.toggleLock()
    editor.toggleLock() // back to unlocked, but still its own history entries
    editor.applyStyle({ kind: 'lineColor', color: '#00FF00' })
    expect(editor.undo()).toBe(true) // undoes only the 2nd colour
    expect((chart.getOverlayById(id) as FakeOverlay).styles?.line?.color).toBe('#F23645')
    editor.undo(); editor.undo() // the two lock toggles
    expect((chart.getOverlayById(id) as FakeOverlay).lock).toBe(false)
  })

  it('lineWidth and lineColor coalesce separately (a discrete click never merges into a color drag)', () => {
    const { chart, editor } = setup()
    const id = draw(chart, editor, { name: 'segment', points: RECT_POINTS })
    chart.clickOverlay(id)
    editor.applyStyle({ kind: 'lineColor', color: '#F23645' })
    editor.applyStyle({ kind: 'lineWidth', width: 3 })
    expect(editor.undo()).toBe(true)
    // lineWidth was never set before this action: undoing it clears the key,
    // not "resets" it to some default (there is none stored on styles).
    expect((chart.getOverlayById(id) as FakeOverlay).styles?.line?.size).toBeUndefined()
    expect((chart.getOverlayById(id) as FakeOverlay).styles?.line?.color).toBe('#F23645') // colour change kept
    expect(editor.snapshot()?.lineWidth).toBe(1) // the toolbar still shows the fallback width
  })

  it('hide is undo-able (visible restored) and closes the editor', () => {
    const { chart, editor } = setup()
    const id = draw(chart, editor, { name: 'segment', points: RECT_POINTS })
    chart.clickOverlay(id)
    editor.hide()
    expect(chart.getOverlayById(id)?.visible).toBe(false)
    expect(editor.selectedId).toBeNull()
    expect(editor.undo()).toBe(true)
    expect(chart.getOverlayById(id)?.visible).toBe(true)
  })

  it('a drag (onPressedMoveStart/End) is undo-able only when the points actually changed', () => {
    const { chart, editor } = setup()
    const id = draw(chart, editor, { name: 'segment', points: RECT_POINTS })
    chart.pressedMove(id, RECT_POINTS) // no-op drag
    expect(editor.canUndo()).toBe(true) // only the create so far
    const moved = [{ dataIndex: 5, timestamp: 300_000, value: 50 }, { dataIndex: 6, timestamp: 360_000, value: 60 }]
    chart.pressedMove(id, moved)
    editor.undo() // undoes the move
    expect((chart.getOverlayById(id) as FakeOverlay).points).toEqual(RECT_POINTS)
    editor.redo()
    expect((chart.getOverlayById(id) as FakeOverlay).points).toEqual(moved)
  })

  it('calls onHistoryChange whenever canUndo()/canRedo() may have changed', () => {
    let calls = 0
    const { chart, editor } = setup({}, { onHistoryChange: () => { calls++ } })
    draw(chart, editor, { name: 'segment', points: RECT_POINTS })
    expect(calls).toBeGreaterThan(0)
    const before = calls
    editor.undo()
    expect(calls).toBeGreaterThan(before)
  })
})

// ---------------------------------------------------------------------------
// SC-109: copy / paste / nudge.
// ---------------------------------------------------------------------------

describe('copy / paste (SC-109)', () => {
  it('paste creates an offset copy of the last copy(), selected, undo-able', () => {
    const { chart, editor } = setup()
    const id = draw(chart, editor, { name: 'rect', points: RECT_POINTS })
    chart.clickOverlay(id)
    expect(editor.copy()).toBe(true)
    const pastedId = editor.paste()
    expect(typeof pastedId).toBe('string')
    expect(pastedId).not.toBe(id)
    const original = chart.getOverlayById(id) as FakeOverlay
    const pasted = chart.getOverlayById(pastedId as string) as FakeOverlay
    expect(pasted.name).toBe('rect')
    expect(JSON.stringify(pasted.points)).not.toBe(JSON.stringify(original.points))
    expect(editor.selectedId).toBe(pastedId)
    expect(editor.undo()).toBe(true)
    expect(chart.getOverlayById(pastedId as string)).toBeNull()
  })

  it('each paste offsets a little further than the last', () => {
    const { chart, editor } = setup()
    const id = draw(chart, editor, { name: 'segment', points: RECT_POINTS })
    chart.clickOverlay(id)
    editor.copy()
    const p1 = chart.getOverlayById(editor.paste() as string) as FakeOverlay
    const p2 = chart.getOverlayById(editor.paste() as string) as FakeOverlay
    expect(chart.drawnDataIndex(p2.points[0])).toBeGreaterThan(chart.drawnDataIndex(p1.points[0]) as number)
  })

  it('paste() with nothing copied, or nothing selected for copy(), does nothing', () => {
    const { editor } = setup()
    expect(editor.paste()).toBeNull()
    expect(editor.copy()).toBe(false)
  })

  it('never copies a host overlay', () => {
    const { chart, editor } = setup()
    host(chart, { name: 'rect', points: RECT_POINTS })
    expect(editor.copy()).toBe(false)
  })
})

describe('nudge (SC-109)', () => {
  it('left/right shift one bar, price unchanged; up/down move on the value axis (10x with big)', () => {
    const { chart, editor } = setup()
    const id = draw(chart, editor, { name: 'segment', points: RECT_POINTS })
    chart.clickOverlay(id)
    expect(editor.nudge('right')).toBe(true)
    const afterRight = (chart.getOverlayById(id) as FakeOverlay).points
    afterRight.forEach((p, i) => { expect(chart.drawnDataIndex(p)).toBe((chart.drawnDataIndex(RECT_POINTS[i]) as number) + 1); expect(p.value).toBe(RECT_POINTS[i].value) })
    editor.undo()
    expect(editor.nudge('up')).toBe(true)
    const afterUp = (chart.getOverlayById(id) as FakeOverlay).points
    // "up" on screen = higher value on this fake chart's linear axis (value = 110 - y/1.6)
    afterUp.forEach((p, i) => { expect(p.value).toBeGreaterThan(RECT_POINTS[i].value as number) })
    editor.undo()
    editor.nudge('down', true)
    const afterBigDown = (chart.getOverlayById(id) as FakeOverlay).points
    const smallDelta = (afterUp[0].value as number) - (RECT_POINTS[0].value as number)
    const bigDelta = (RECT_POINTS[0].value as number) - (afterBigDown[0].value as number)
    expect(bigDelta).toBeCloseTo(smallDelta * 10, 5)
  })

  it('repeated nudges with nothing else in between merge into one undo step', () => {
    const { chart, editor } = setup()
    const id = draw(chart, editor, { name: 'segment', points: RECT_POINTS })
    chart.clickOverlay(id)
    editor.nudge('right'); editor.nudge('right'); editor.nudge('right')
    const afterThree = (chart.getOverlayById(id) as FakeOverlay).points
    expect(editor.undo()).toBe(true)
    expect((chart.getOverlayById(id) as FakeOverlay).points).toEqual(RECT_POINTS)
    editor.redo()
    expect((chart.getOverlayById(id) as FakeOverlay).points).toEqual(afterThree)
  })

  it('refuses to nudge a locked drawing, or with nothing selected', () => {
    const { chart, editor } = setup()
    const id = draw(chart, editor, { name: 'segment', points: RECT_POINTS })
    chart.clickOverlay(id)
    editor.toggleLock()
    expect(editor.nudge('right')).toBe(false)
    editor.deselect()
    expect(editor.nudge('right')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// SC-119: per-tool style defaults.
// ---------------------------------------------------------------------------

describe('drawing defaults (SC-119)', () => {
  it('a second drawing of the same tool inherits the last-used style via prepareNew', () => {
    const { chart, editor } = setup()
    const id1 = chart.createOverlay(editor.prepareNew({ name: 'segment', points: RECT_POINTS })) as string
    editor.track(id1)
    chart.clickOverlay(id1)
    editor.applyStyle({ kind: 'lineColor', color: '#F23645' })
    editor.applyStyle({ kind: 'lineWidth', width: 3 })
    const id2 = chart.createOverlay(editor.prepareNew({ name: 'segment', points: RECT_POINTS })) as string
    const second = chart.getOverlayById(id2) as FakeOverlay
    expect(second.styles?.line?.color).toBe('#F23645')
    expect(second.styles?.line?.size).toBe(3)
  })

  it('clone() and restore() never apply remembered defaults: a copy matches its original exactly', () => {
    const { chart, editor } = setup()
    editor.setDrawingDefaults('rect', [{ kind: 'lineColor', color: '#00FF00' }])
    const id = draw(chart, editor, { name: 'rect', points: RECT_POINTS }) // drawn via prepare(), not prepareNew(): theme/template default, not the remembered green
    const original = chart.getOverlayById(id) as FakeOverlay
    expect(original.styles).toEqual(RECT_TEMPLATE_STYLES) // sanity: not green
    chart.clickOverlay(id)
    const copyId = editor.clone()
    const copy = chart.getOverlayById(copyId as string) as FakeOverlay
    expect(copy.styles).toEqual(original.styles) // matches the original exactly, not the remembered green
  })

  it('setDrawingDefaults / getDrawingDefaults / clearDrawingDefaults work without an existing drawing', () => {
    const { editor } = setup({}, {})
    expect(editor.getDrawingDefaults('rect')).toBeNull()
    editor.setDrawingDefaults('rect', [{ kind: 'lineColor', color: '#123456' }])
    expect(editor.getDrawingDefaults('rect')?.polygon).toMatchObject({ borderColor: '#123456' })
    editor.clearDrawingDefaults('rect')
    expect(editor.getDrawingDefaults('rect')).toBeNull()
  })

  it('calls onDrawingDefaultsChange when the remembered style changes', () => {
    let calls = 0
    const { editor } = setup({}, { onDrawingDefaultsChange: () => { calls++ } })
    editor.setDrawingDefaults('rect', [{ kind: 'lineColor', color: '#123456' }])
    expect(calls).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// SC-151: id-based object-tree operations.
// ---------------------------------------------------------------------------

describe('id-based ops (listDrawings / setDrawingVisible / setDrawingLocked / removeDrawing)', () => {
  it('listDrawings lists only tracked drawings, never a host overlay', () => {
    const { chart, editor } = setup()
    host(chart, { name: 'rect', points: RECT_POINTS })
    const a = draw(chart, editor, { name: 'segment', points: RECT_POINTS })
    expect(editor.listDrawings()).toEqual([{ id: a, name: 'segment', visible: true, locked: false }])
  })

  it("setDrawingVisible/setDrawingLocked toggle exactly that row, undo-ably, and closing the toolbar only when it is hidden", () => {
    const { chart, editor } = setup()
    const a = draw(chart, editor, { name: 'segment', points: RECT_POINTS })
    chart.clickOverlay(a)
    editor.setDrawingLocked(a, true)
    expect(chart.getOverlayById(a)?.lock).toBe(true)
    expect(editor.selectedId).toBe(a) // locking from the panel does not deselect
    editor.setDrawingVisible(a, false)
    expect(editor.selectedId).toBeNull()
    expect(editor.undo()).toBe(true)
    expect(chart.getOverlayById(a)?.visible).toBe(true)
    expect(editor.undo()).toBe(true)
    expect(chart.getOverlayById(a)?.lock).toBe(false)
  })

  it('removeDrawing removes exactly that row and is undo-able; ignores an unknown or host id', () => {
    const { chart, editor } = setup()
    const h = host(chart, { name: 'rect', points: RECT_POINTS })
    const a = draw(chart, editor, { name: 'segment', points: RECT_POINTS })
    editor.removeDrawing(h.id)
    expect(chart.getOverlayById(h.id)).not.toBeNull()
    editor.removeDrawing('not-an-id')
    editor.removeDrawing(a)
    expect(chart.getOverlayById(a)).toBeNull()
    expect(editor.undo()).toBe(true)
    expect(chart.getOverlayById(a)).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// SC-120 (API surface tested here; the symbol-swap itself is under "data
// context (symbol)" above): getDrawings / setDrawings / clearDrawings.
// ---------------------------------------------------------------------------

describe('getDrawings / setDrawings / clearDrawings', () => {
  it('getDrawings() mirrors serialize() for the current symbol', () => {
    const { chart, editor } = setup()
    draw(chart, editor, { name: 'segment', points: RECT_POINTS })
    expect(editor.getDrawings()).toEqual(editor.serialize())
    expect(editor.getDrawings()).toHaveLength(1)
  })

  it('setDrawings() replaces the current drawings; clearDrawings() empties them', () => {
    const { chart, editor } = setup()
    draw(chart, editor, { name: 'segment', points: RECT_POINTS })
    const saved = editor.getDrawings()
    editor.setDrawings([])
    expect(editor.userDrawingIds()).toEqual([])
    editor.setDrawings(saved)
    expect(editor.userDrawingIds()).toHaveLength(1)
    editor.clearDrawings()
    expect(editor.userDrawingIds()).toEqual([])
  })

  it('a key argument other than the current symbol reads/writes that symbol\'s saved state without touching the live chart', () => {
    const { chart, editor } = setup()
    editor.setDataContext('BTCUSDT')
    const id = draw(chart, editor, { name: 'segment', points: RECT_POINTS })
    editor.setDataContext('ETHUSDT') // BTC's drawing is now only in the saved map
    expect(editor.getDrawings('BTCUSDT')).toHaveLength(1)
    expect(editor.userDrawingIds()).toEqual([]) // ETH's live chart is untouched
    editor.clearDrawings('BTCUSDT')
    expect(editor.getDrawings('BTCUSDT')).toEqual([])
    void id
  })
})

// ---------------------------------------------------------------------------
// Freehand strokes (runSuppressed / recordFreehandStroke): the preview
// overlay's own remove+recreate cycle must never enter undo history.
// ---------------------------------------------------------------------------

describe('freehand stroke recording', () => {
  it('one entry for the whole stroke, none for its intermediate previews', () => {
    const { chart, editor } = setup()
    let previewId = '' // '' means "no preview yet" (avoids a string|null union here)
    const strokes = [[{ dataIndex: 0, value: 0 }], [{ dataIndex: 0, value: 0 }, { dataIndex: 1, value: 1 }], [{ dataIndex: 0, value: 0 }, { dataIndex: 1, value: 1 }, { dataIndex: 2, value: 2 }]]
    strokes.forEach(points => {
      editor.runSuppressed(() => {
        if (previewId !== '') chart.removeOverlay({ id: previewId })
        const id = chart.createOverlay(editor.prepare({ name: 'brush', points }))
        editor.track(id)
        previewId = id as string
      })
    })
    expect(editor.canUndo()).toBe(false) // nothing recorded yet
    editor.recordFreehandStroke(previewId)
    expect(editor.canUndo()).toBe(true)
    expect(editor.undo()).toBe(true)
    expect(chart.getOverlayById(previewId)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// dispose(): every piece of state this PR added is torn down too.
// ---------------------------------------------------------------------------

describe('dispose (SC-092/109/119/120/151 state)', () => {
  it('clears history, clipboard, defaults, saved symbols and the menu', () => {
    const { chart, editor } = setup()
    editor.setDataContext('BTCUSDT')
    const id = draw(chart, editor, { name: 'segment', points: RECT_POINTS })
    chart.clickOverlay(id)
    editor.copy()
    editor.setDrawingDefaults('segment', [{ kind: 'lineColor', color: '#123456' }])
    chart.rightClick(id)
    editor.setDataContext('ETHUSDT') // saves BTC's state
    editor.dispose()
    expect(editor.canUndo()).toBe(false)
    expect(editor.canRedo()).toBe(false)
    expect(editor.paste()).toBeNull()
    expect(editor.getDrawingDefaults('segment')).toBeNull()
    expect(editor.menu).toBeNull()
    expect(editor.getDrawings('BTCUSDT')).toEqual([])
  })
})
