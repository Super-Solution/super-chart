import { describe, it, expect, vi, afterEach } from 'vitest'
import type { OverlayCreate } from 'klinecharts'
import { createHoldController, type HoldHost, type HoldPointer } from './controller'
import { createHoldNavigation } from './navigation'
import { isHoldKeyTarget } from './focus'
import { DrawingEditor } from '../drawing-editor/controller'
import { FakeChart } from '../drawing-editor/fakeChart'

const pointer = (x = 10, y = 80, extra: Partial<HoldPointer> = {}): HoldPointer => ({
  pointerId: 1,
  isPrimary: true,
  button: 0,
  buttons: 1,
  clientX: x,
  clientY: y,
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  target: { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() } as unknown as Element,
  preventDefault: vi.fn(),
  stopPropagation: vi.fn(),
  ...extra
})
const key = (name: string, extra: Partial<KeyboardEvent> = {}): KeyboardEvent => ({
  key: name,
  keyCode: 0,
  isComposing: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  target: null,
  preventDefault: vi.fn(),
  ...extra
} as unknown as KeyboardEvent)

function setup (): { host: HoldHost, controller: ReturnType<typeof createHoldController> } {
  vi.useFakeTimers()
  const host: HoldHost = {
    paneAt: vi.fn(() => 'candle_pane'),
    blocked: vi.fn(() => false),
    start: vi.fn(),
    finish: vi.fn(),
    preview: vi.fn(),
    clearPreview: vi.fn(),
    create: vi.fn(() => 'gesture'),
    replace: vi.fn(() => true),
    remove: vi.fn(() => true),
    exists: vi.fn(() => true),
    erase: vi.fn(() => 0),
    status: vi.fn()
  }
  return { host, controller: createHoldController(host) }
}

const draw = (controller: ReturnType<typeof createHoldController>): void => {
  controller.down(pointer())
  vi.advanceTimersByTime(333)
  controller.move(pointer(40, 60))
  controller.move(pointer(90, 30))
  controller.up(pointer(120, 10, { buttons: 0 }))
}

afterEach(() => { vi.useRealTimers() })

describe('hold pointer lifecycle', () => {
  it('arms at 333ms only and never consumes the initial press', () => {
    const { host, controller } = setup()
    const down = pointer()
    controller.down(down)
    vi.advanceTimersByTime(332)
    expect(host.start).not.toHaveBeenCalled()
    expect(down.preventDefault).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(controller.active()).toBe(true)
    expect(host.start).toHaveBeenCalledTimes(1)
    controller.cancel()
    expect(host.finish).toHaveBeenCalledTimes(1)
  })
  it('lets an immediate drag pan and a short click remain ordinary chart events', () => {
    const { host, controller } = setup()
    controller.down(pointer())
    const move = pointer(22, 80)
    controller.move(move)
    vi.advanceTimersByTime(1000)
    expect(move.stopPropagation).not.toHaveBeenCalled()
    expect(host.start).not.toHaveBeenCalled()
    expect(host.create).not.toHaveBeenCalled()
    controller.down(pointer())
    controller.up(pointer())
    vi.advanceTimersByTime(1000)
    expect(host.start).not.toHaveBeenCalled()
  })
  it('samples a held stroke, consumes movement and creates only after release', () => {
    const { host, controller } = setup()
    controller.down(pointer())
    vi.advanceTimersByTime(333)
    const move = pointer(90, 30)
    controller.move(move)
    expect(move.preventDefault).toHaveBeenCalledOnce()
    expect(host.preview).toHaveBeenCalledOnce()
    expect(host.create).not.toHaveBeenCalled()
    controller.up(pointer(120, 10, { buttons: 0 }))
    expect(host.clearPreview).toHaveBeenCalledOnce()
    expect(host.finish).toHaveBeenCalledOnce()
    expect(host.create).toHaveBeenCalledOnce()
    expect(controller.active()).toBe(false)
  })
  it('does not create a held point or accept another pointer as a stroke endpoint', () => {
    const { host, controller } = setup()
    controller.down(pointer())
    vi.advanceTimersByTime(333)
    controller.up(pointer(120, 10, { pointerId: 2 }))
    expect(controller.active()).toBe(true)
    controller.up(pointer())
    expect(host.create).not.toHaveBeenCalled()
  })
  it('does not ghost-arm after leaving a plot or releasing outside before capture', () => {
    const { host, controller } = setup()
    controller.down(pointer())
    controller.leave()
    vi.advanceTimersByTime(1000)
    expect(host.start).not.toHaveBeenCalled()
    controller.down(pointer())
    // The window capture listener delivers this release even if the target is host UI.
    controller.up(pointer(14, 80, { target: null, buttons: 0 }))
    vi.advanceTimersByTime(1000)
    expect(host.start).not.toHaveBeenCalled()
    controller.down(pointer())
    vi.mocked(host.paneAt).mockReturnValue(null)
    controller.move(pointer(14, 80))
    vi.advanceTimersByTime(1000)
    expect(host.start).not.toHaveBeenCalled()
    vi.mocked(host.paneAt).mockReturnValue('candle_pane')
    controller.down(pointer())
    vi.advanceTimersByTime(333)
    controller.leave()
    expect(controller.active()).toBe(true)
    controller.cancelPointer({ pointerId: 2 })
    expect(controller.active()).toBe(true)
    controller.cancelPointer({ pointerId: 1 })
    expect(controller.active()).toBe(false)
  })
  it('aborts for a second finger, cancellation, disposal, and modifiers without leaving a preview', () => {
    const { host, controller } = setup()
    controller.down(pointer())
    vi.advanceTimersByTime(333)
    controller.down(pointer(20, 80, { pointerId: 2, isPrimary: false }))
    expect(host.finish).toHaveBeenCalledOnce()
    expect(host.create).not.toHaveBeenCalled()
    controller.down(pointer())
    controller.cancel()
    vi.advanceTimersByTime(500)
    expect(host.start).toHaveBeenCalledOnce()
    controller.down(pointer())
    vi.advanceTimersByTime(333)
    controller.move(pointer(90, 30, { shiftKey: true }))
    expect(host.finish).toHaveBeenCalledTimes(2)
    controller.down(pointer())
    vi.advanceTimersByTime(333)
    controller.dispose()
    controller.down(pointer())
    vi.advanceTimersByTime(500)
    expect(host.start).toHaveBeenCalledTimes(3)
    expect(host.finish).toHaveBeenCalledTimes(3)
  })
  it('leaves active tools, axes, non-primary presses and command modifiers untouched', () => {
    const { host, controller } = setup()
    vi.mocked(host.blocked).mockReturnValue(true)
    controller.down(pointer())
    vi.mocked(host.blocked).mockReturnValue(false)
    controller.down(pointer(10, 80, { ctrlKey: true }))
    controller.down(pointer(10, 80, { button: 2 }))
    controller.down(pointer(10, 80, { isPrimary: false }))
    vi.mocked(host.paneAt).mockReturnValue(null)
    controller.down(pointer())
    vi.advanceTimersByTime(1000)
    expect(host.start).not.toHaveBeenCalled()
  })
  it('rechecks modal/tool blocking when the timer arms and before committing', () => {
    const { host, controller } = setup()
    controller.down(pointer())
    vi.mocked(host.blocked).mockReturnValue(true)
    vi.advanceTimersByTime(333)
    expect(host.start).not.toHaveBeenCalled()
    vi.mocked(host.blocked).mockReturnValue(false)
    controller.down(pointer())
    vi.advanceTimersByTime(333)
    controller.move(pointer(90, 30))
    vi.mocked(host.blocked).mockReturnValue(true)
    controller.up(pointer(120, 10))
    expect(host.create).not.toHaveBeenCalled()
    expect(host.finish).toHaveBeenCalledOnce()
  })
})

describe('latest result keys', () => {
  it('yields control Tab, Shift+Tab and Escape and never revives their old candidate on plot refocus', () => {
    const { host, controller } = setup()
    const button = { tagName: 'BUTTON' } as unknown as EventTarget
    for (const event of [key('Tab', { target: button }), key('Tab', { target: button, shiftKey: true }), key('Escape', { target: button })]) {
      draw(controller)
      expect(controller.key(event)).toBe(false)
      expect(event.preventDefault).not.toHaveBeenCalled()
      expect(controller.key(key('Tab'))).toBe(false)
      expect(controller.key(key('Escape'))).toBe(false)
    }
    expect(host.replace).not.toHaveBeenCalled()
    expect(host.remove).not.toHaveBeenCalled()
    expect(host.create).toHaveBeenCalledTimes(3)
  })
  it('checks host plot ownership as well as composed control targets', () => {
    const { host, controller } = setup()
    const doc = { body: {}, documentElement: {} } as unknown as Document
    const canvas = { nodeType: 1 } as unknown as EventTarget
    const chrome = { nodeType: 1 } as unknown as EventTarget
    const plot = { ownerDocument: doc, contains: (node: unknown) => node === canvas } as unknown as HTMLElement
    const root = { ownerDocument: doc } as unknown as HTMLElement
    host.keyTarget = target => isHoldKeyTarget(target, root, plot)
    draw(controller)
    expect(controller.key(key('Tab', { target: canvas }))).toBe(true)
    expect(controller.key(key('Tab', { target: root, shiftKey: true }))).toBe(true)
    expect(controller.key(key('Escape', { target: doc.body }))).toBe(true)
    draw(controller)
    const outside = key('Tab', { target: chrome })
    expect(controller.key(outside)).toBe(false)
    expect(outside.preventDefault).not.toHaveBeenCalled()
    expect(controller.key(key('Tab', { target: canvas }))).toBe(false)
    draw(controller)
    const svg = { tagName: 'path', closest: () => ({ tagName: 'BUTTON' }) } as unknown as EventTarget
    const retargeted = key('Tab', { target: root, composedPath: () => [svg, root] })
    expect(controller.key(retargeted)).toBe(false)
    expect(retargeted.preventDefault).not.toHaveBeenCalled()
    expect(controller.key(key('Escape', { target: canvas }))).toBe(false)
    expect(host.replace).toHaveBeenCalledTimes(2)
    expect(host.remove).toHaveBeenCalledOnce()
  })
  it('cycles forward/backward, then Escape removes once', () => {
    const { host, controller } = setup()
    expect(controller.key(key('Tab'))).toBe(false)
    draw(controller)
    const tab = key('Tab')
    expect(controller.key(tab)).toBe(true)
    expect(tab.preventDefault).toHaveBeenCalledOnce()
    const alternative = vi.mocked(host.replace).mock.calls[0][1].kind
    expect(controller.key(key('Tab', { shiftKey: true }))).toBe(true)
    expect(vi.mocked(host.replace).mock.calls[1][1].kind).not.toBe(alternative)
    expect(controller.key(key('Escape'))).toBe(true)
    expect(host.remove).toHaveBeenCalledOnce()
    expect(controller.key(key('Escape'))).toBe(false)
  })
  it('never takes IME or text entry keys; undo, another selection or a new press invalidates the latest result', () => {
    const { host, controller } = setup()
    draw(controller)
    expect(controller.key(key('Tab', { isComposing: true }))).toBe(false)
    expect(controller.key(key('Tab', { target: { tagName: 'INPUT', type: 'text' } as unknown as EventTarget }))).toBe(false)
    expect(host.replace).not.toHaveBeenCalled()
    expect(controller.key(key('z', { ctrlKey: true }))).toBe(false)
    expect(controller.key(key('Escape'))).toBe(false)
    draw(controller)
    controller.selection('other')
    expect(controller.key(key('Escape'))).toBe(false)
    draw(controller)
    controller.down(pointer())
    expect(controller.key(key('Tab'))).toBe(false)
  })
  it('does not delete a result removed/locked by another actor and cancels an unfinished stroke', () => {
    const { host, controller } = setup()
    draw(controller)
    vi.mocked(host.exists).mockReturnValue(false)
    expect(controller.key(key('Escape'))).toBe(false)
    expect(host.remove).not.toHaveBeenCalled()
    controller.down(pointer())
    vi.advanceTimersByTime(333)
    expect(controller.key(key('Escape'))).toBe(true)
    expect(controller.active()).toBe(false)
  })
})

describe('navigation and real drawing-editor history', () => {
  it('restores exact disabled flags after pointer cancellation and disposal', () => {
    const { host, controller } = setup()
    let scroll = false; let zoom = true
    const navigation = createHoldNavigation(() => ({
      isScrollEnabled: () => scroll,
      isZoomEnabled: () => zoom,
      setScrollEnabled: v => { scroll = v },
      setZoomEnabled: v => { zoom = v }
    }))
    host.start = navigation.start; host.finish = navigation.finish
    controller.down(pointer())
    vi.advanceTimersByTime(333)
    expect([scroll, zoom]).toEqual([false, false])
    controller.cancel()
    expect([scroll, zoom]).toEqual([false, true])
    scroll = true; zoom = false
    controller.down(pointer())
    vi.advanceTimersByTime(333)
    controller.dispose()
    expect([scroll, zoom]).toEqual([true, false])
  })
  it('creates, alternates and removes through native history without touching host overlays', () => {
    const { host, controller } = setup()
    const chart = new FakeChart({ withZLevel: true })
    const editor = new DrawingEditor({ getChart: () => chart as unknown as ReturnType<ConstructorParameters<typeof DrawingEditor>[0]['getChart']> })
    const spec = (candidate: Parameters<HoldHost['create']>[0]): OverlayCreate => ({ name: candidate.tool, points: candidate.points.map(p => ({ dataIndex: p.x / 10, value: p.y })) })
    host.create = (candidate, pane) => editor.createGestureDrawing(spec(candidate), pane)
    host.replace = (id, candidate, pane) => editor.replaceGestureDrawing(id, spec(candidate), pane)
    host.remove = id => editor.removeGestureDrawings([id]) > 0
    host.exists = id => editor.isUserDrawing(id)
    chart.createOverlay({ id: 'host', name: 'segment', points: [{ dataIndex: 0, value: 1 }, { dataIndex: 1, value: 2 }] })
    draw(controller)
    expect(editor.listDrawings()).toHaveLength(1)
    const id = editor.listDrawings()[0].id
    const original = chart.getOverlayById(id)?.name
    controller.key(key('Tab'))
    expect(chart.getOverlayById(id)?.name).not.toBe(original)
    expect(editor.undo()).toBe(true)
    expect(chart.getOverlayById(id)?.name).toBe(original)
    expect(editor.redo()).toBe(true)
    controller.key(key('Escape'))
    expect(editor.listDrawings()).toHaveLength(0)
    expect(editor.undo()).toBe(true)
    expect(editor.listDrawings()).toHaveLength(1)
    expect(chart.getOverlayById('host')).not.toBeNull()
  })
  it('erases several user drawings as one action while protecting locked, hidden and host drawings', () => {
    const chart = new FakeChart({ withZLevel: true })
    const editor = new DrawingEditor({ getChart: () => chart as unknown as ReturnType<ConstructorParameters<typeof DrawingEditor>[0]['getChart']> })
    const create = { name: 'segment', points: [{ dataIndex: 0, value: 1 }, { dataIndex: 1, value: 2 }] }
    const a = editor.createGestureDrawing(create, 'candle_pane') as string
    const b = editor.createGestureDrawing(create, 'candle_pane') as string
    const locked = editor.createGestureDrawing({ ...create, lock: true }, 'candle_pane') as string
    const hidden = editor.createGestureDrawing(create, 'candle_pane') as string
    editor.setDrawingVisible(hidden, false)
    chart.createOverlay({ ...create, id: 'host' })
    expect(editor.removeGestureDrawings([a, b, a, locked, hidden, 'host'])).toBe(2)
    expect(editor.listDrawings().map(row => row.id).sort()).toEqual([hidden, locked].sort())
    expect(chart.getOverlayById('host')).not.toBeNull()
    expect(editor.replaceGestureDrawing(locked, { ...create, name: 'arrow' }, 'candle_pane')).toBe(false)
    expect(editor.replaceGestureDrawing('host', { ...create, name: 'arrow' }, 'candle_pane')).toBe(false)
    expect(editor.undo()).toBe(true)
    expect(editor.listDrawings()).toHaveLength(4)
    expect(editor.redo()).toBe(true)
    expect(editor.listDrawings()).toHaveLength(2)
    expect(chart.getOverlayById(locked)?.lock).toBe(true)
    expect(chart.getOverlayById(hidden)?.visible).toBe(false)
  })
})
