import { MAX_FREEHAND_POINTS as MAX_POINTS, type DrawingAnchor, type DrawingPoint, type EngineFrame, type FreehandDrawing, type FreehandTool } from '@supersolutions/super-chart-core'
import type { ToolEnd } from './drawingInteraction'

export { projectFreehandDrawing } from '@supersolutions/super-chart-core'
export type { FreehandDrawing, FreehandPrimitive, FreehandTool } from '@supersolutions/super-chart-core'

interface FreehandStore {
  add: (drawing: FreehandDrawing) => unknown
  select: (id: string | null) => unknown
  getSnapshot: () => { readonly drawings: ReadonlyArray<{ readonly id: string }> }
  subscribe?: (listener: () => void) => () => void
}
let sequence = 0
const validAnchor = (point: DrawingAnchor | null): point is DrawingAnchor => point !== null && Number.isFinite(point.timestamp) && Math.abs(point.timestamp) <= 8.64e15 && Number.isFinite(point.price)

/** Capture one user stroke; preview/cancellation never mutate the shared drawing history. */
export function attachFreehandDrawingInput (
  element: HTMLElement,
  store: FreehandStore,
  getFrame: () => EngineFrame | null,
  onPreview: (drawing: FreehandDrawing | null) => void,
  onToolComplete?: (reason: ToolEnd) => void,
  onInteractionStart?: () => void
): { setTool: (tool: FreehandTool | null) => void, dispose: () => void } {
  const doc = element.ownerDocument, win = doc.defaultView
  if (win === null) return { setTool: () => {}, dispose: () => {} }
  const abort = new win.AbortController()
  let tool: FreehandTool | null = null, disposed = false, frameId = 0, generation = 0
  let stroke: { id: string, type: FreehandTool, pointerId: number, points: DrawingPoint[], spacing: number, original: ReadonlyArray<{ readonly id: string }> } | null = null
  const consume = (event: Event): void => { event.preventDefault(); event.stopImmediatePropagation() }
  const editable = (target: EventTarget | null): boolean => target instanceof win.Element && target.closest('input,textarea,select,button,a,[contenteditable]:not([contenteditable="false"])') !== null
  const frame = (): EngineFrame | null => {
    const current = getFrame(), rect = element.getBoundingClientRect(), g = current?.model.geometry
    return current !== null && current.snapshot.length > 0 && rect.width > 0 && rect.height > 0 && g !== undefined &&
      [g.left, g.right, g.top, g.bottom].every(Number.isFinite) && g.right > g.left && g.bottom > g.top ? current : null
  }
  const release = (id: number): void => { if (element.hasPointerCapture(id)) element.releasePointerCapture(id) }
  const cancel = (): void => {
    generation++
    if (frameId !== 0) win.cancelAnimationFrame(frameId)
    frameId = 0
    const active = stroke; stroke = null
    if (active !== null) release(active.pointerId)
    onPreview(null)
  }
  const preview = (): FreehandDrawing | null => {
    const current = frame(), active = stroke
    if (active === null || current === null || active.points.length < 2) return null
    const anchors: DrawingAnchor[] = []
    for (const point of active.points) {
      const anchor = current.unproject(point.x, point.y)
      if (!validAnchor(anchor)) return null
      const projected = current.project(anchor.timestamp, anchor.price)
      // Do not commit collapsed coordinates when a projection clamps history edges.
      if (projected === null || Math.abs(projected.x - point.x) > 0.5 || Math.abs(projected.y - point.y) > 0.5) return null
      anchors.push(Object.freeze({ ...anchor }))
    }
    return Object.freeze({ id: active.id, type: active.type, anchors: Object.freeze(anchors), locked: false, hidden: false, strokeWidth: active.type === 'highlighter' ? 16 : 2 })
  }
  const publish = (): void => {
    frameId = 0
    if (!disposed && stroke !== null) onPreview(preview())
  }
  const point = (event: PointerEvent): DrawingPoint | null => {
    const current = frame()
    if (current === null) return null
    const rect = element.getBoundingClientRect(), g = current.model.geometry
    const x = event.clientX - rect.left, y = event.clientY - rect.top
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null
    return { x: Math.max(g.left, Math.min(g.right, x)), y: Math.max(g.top, Math.min(g.bottom, y)) }
  }
  const sample = (event: PointerEvent, force = false): void => {
    const active = stroke, next = point(event)
    if (active === null || next === null) return
    const last = active.points[active.points.length - 1], distance = Math.hypot(next.x - last.x, next.y - last.y)
    if (distance < (force ? 0.01 : active.spacing)) return
    if (active.points.length >= MAX_POINTS) {
      // Adaptively reduce spatial density, retaining first/last and an explicit bound.
      active.points = active.points.filter((_, index) => index % 2 === 0 || index === active.points.length - 1)
      active.spacing *= 2
    }
    active.points.push(next)
  }
  const on = (type: string, callback: EventListener): void => { element.addEventListener(type, callback, { capture: true, passive: false, signal: abort.signal }) }
  on('pointerdown', event => {
    const e = event as PointerEvent
    if (tool === null || editable(e.target) || e.button !== 0) return
    if (stroke !== null) { consume(e); return }
    const current = frame(), rect = element.getBoundingClientRect(), g = current?.model.geometry
    if (current === null || g === undefined || e.clientX - rect.left < g.left || e.clientX - rect.left > g.right || e.clientY - rect.top < g.top || e.clientY - rect.top > g.bottom) return
    const epoch = generation, selectedTool = tool
    consume(e); onInteractionStart?.()
    if (disposed || epoch !== generation || tool !== selectedTool) return
    const first = point(e)
    if (first === null) return
    let id: string
    do { id = `stroke-${Date.now().toString(36)}-${(++sequence).toString(36)}` } while (store.getSnapshot().drawings.some(item => item.id === id))
    stroke = { id, type: selectedTool, pointerId: e.pointerId, points: [first], spacing: 2, original: store.getSnapshot().drawings }
    try { element.setPointerCapture(e.pointerId) } catch { cancel(); return }
    element.focus({ preventScroll: true })
  })
  on('pointermove', event => {
    const e = event as PointerEvent
    if (stroke === null) return
    consume(e)
    if (e.pointerId !== stroke.pointerId) return
    const samples = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : []
    // Keep callback work bounded even if a browser batches a long stalled input stream.
    const step = Math.max(1, Math.ceil(samples.length / 64))
    for (let i = 0; i < samples.length; i += step) sample(samples[i])
    sample(e)
    if (frameId === 0) frameId = win.requestAnimationFrame(publish)
  })
  on('pointerup', event => {
    const e = event as PointerEvent
    if (stroke === null) return
    consume(e)
    if (e.pointerId !== stroke.pointerId) return
    sample(e, true)
    const drawing = preview(), active = stroke, epoch = generation + 1
    cancel()
    if (disposed || epoch !== generation || drawing === null || active === null || tool !== active.type || store.getSnapshot().drawings !== active.original || active.points.every(point => Math.hypot(point.x - active.points[0].x, point.y - active.points[0].y) < 2)) return
    // Store owns validation and a single undo transaction for the whole stroke.
    store.add(drawing); store.select(drawing.id); tool = null; onToolComplete?.('completed')
  })
  on('pointercancel', event => { if (stroke?.pointerId === (event as PointerEvent).pointerId) { consume(event); cancel() } })
  on('lostpointercapture', event => { if (stroke?.pointerId === (event as PointerEvent).pointerId) cancel() })
  on('keydown', event => {
    const key = event as KeyboardEvent
    if (key.key === 'Escape' && !key.isComposing && !editable(key.target) && (stroke !== null || tool !== null)) {
      consume(key); cancel(); tool = null; onToolComplete?.('cancelled')
    }
  })
  on('blur', event => { const next = (event as FocusEvent).relatedTarget; if (!(next instanceof win.Node) || !element.contains(next)) cancel() })
  win.addEventListener('blur', cancel, { signal: abort.signal })
  doc.addEventListener('visibilitychange', () => { if (doc.hidden) cancel() }, { signal: abort.signal })
  const unsubscribe = store.subscribe?.(() => { if (stroke !== null && store.getSnapshot().drawings !== stroke.original) cancel() })
  return {
    setTool: value => { if (disposed) return; if (value !== null && value !== 'brush' && value !== 'highlighter') throw new TypeError('Unknown freehand tool'); cancel(); tool = value },
    dispose: () => { if (disposed) return; disposed = true; abort.abort(); unsubscribe?.(); cancel(); tool = null }
  }
}
