import { recognizeStroke, type DrawingAnchor, type DrawingPoint, type DrawingStore, type Drawing, type DrawingType, type EngineFrame, type RecognizedShape, type ShapeCandidate } from '@supersolutions/super-chart-core'

/**
 * Hold to draw: rest a pointer on the chart for `holdMs`, then draw a stroke; on release the stroke becomes the
 * geometric drawing it resembles (line, horizontal or vertical line, rectangle, ellipse, circle, triangle) or, when it
 * is a scribble over the person's own unlocked drawings, erases them. Tab then tries the next best shape and Escape
 * takes the new drawing back. Anything the recognizer is not sure of is left alone.
 *
 * A pointer that moves before the hold completes is an ordinary pan, so a host can enable this on an editable chart
 * without losing panning. It is off unless the host asks for it.
 */
export interface DrawByHoldingOptions {
  /** Milliseconds the pointer must rest (within 8px) before drawing starts. 150 to 2000, default 333. */
  holdMs?: number
  /** A scribble over unlocked drawings erases them. Default true. */
  erase?: boolean
}
export type HoldDrawEvent =
  /** The hold completed; the stroke now draws. */
  | { readonly phase: 'armed' }
  /** A stroke became a drawing. `index` is the shape shown among `shapes`, best first; Tab advances it. */
  | { readonly phase: 'recognized', readonly shape: RecognizedShape, readonly shapes: readonly RecognizedShape[], readonly index: number }
  /** The stroke was too short, too ambiguous, or scribbled over nothing erasable. Nothing was drawn. */
  | { readonly phase: 'unrecognized' }
  /** The recognized drawing was taken back with Escape. */
  | { readonly phase: 'removed' }
  /** A scribble removed this many of the person's drawings (one undo step each). */
  | { readonly phase: 'erased', readonly count: number }

export const HOLD_DRAW_LIMITS = Object.freeze({ minHoldMs: 150, maxHoldMs: 2000, defaultHoldMs: 333, slop: 8, maxPoints: 2048, maxErase: 32 })

export interface ResolvedHoldDraw { readonly holdMs: number, readonly erase: boolean }
export function resolveHoldDraw (value: boolean | DrawByHoldingOptions | undefined): ResolvedHoldDraw | null {
  if (value === undefined || value === false) return null
  const options = value === true ? {} : value
  if (options === null || typeof options !== 'object') throw new TypeError('drawByHolding must be a boolean or an options object')
  const holdMs = options.holdMs ?? HOLD_DRAW_LIMITS.defaultHoldMs
  if (typeof holdMs !== 'number' || !Number.isFinite(holdMs) || holdMs < HOLD_DRAW_LIMITS.minHoldMs || holdMs > HOLD_DRAW_LIMITS.maxHoldMs) throw new RangeError('drawByHolding.holdMs must be 150 to 2000 milliseconds')
  if (options.erase !== undefined && typeof options.erase !== 'boolean') throw new TypeError('drawByHolding.erase must be a boolean')
  return Object.freeze({ holdMs, erase: options.erase ?? true })
}

interface Hooks {
  /** Current options; null while the feature is off. */
  options: () => ResolvedHoldDraw | null
  /** False while a tool, text editor or another stroke owns the pointer. */
  canStart: () => boolean
  /** Stop the chart's own pan and inspection so the stroke owns the pointer. */
  onInteractionStart: () => void
  onPreview: (drawing: Drawing | null) => void
  onEvent: (event: HoldDrawEvent) => void
}
type Phase =
  | { kind: 'pending', pointerId: number, origin: DrawingPoint, timer: number }
  | { kind: 'stroke', pointerId: number, id: string, points: DrawingPoint[], spacing: number, before: ReturnType<DrawingStore['getSnapshot']>['drawings'], frameId: number }

let sequence = 0

export function attachHoldDraw (
  element: HTMLElement,
  store: DrawingStore,
  getFrame: () => EngineFrame | null,
  hooks: Hooks
): { cancel: () => void, dispose: () => void } {
  const doc = element.ownerDocument, win = doc.defaultView
  if (win === null) return { cancel: () => {}, dispose: () => {} }
  const abort = new win.AbortController()
  let phase: Phase | null = null
  let disposed = false
  /** The drawing a stroke just made, while Tab and Escape may still swap or take it back. */
  let recent: { id: string, candidates: readonly ShapeCandidate[], index: number, drawings: ReturnType<DrawingStore['getSnapshot']>['drawings'] } | null = null

  const consume = (event: Event): void => { event.preventDefault(); event.stopImmediatePropagation() }
  const editable = (target: EventTarget | null): boolean => target instanceof win.Element &&
    target.closest('input,textarea,select,button,a,[contenteditable]:not([contenteditable="false"])') !== null
  const frame = (): EngineFrame | null => {
    const value = getFrame(), g = value?.model.geometry, rect = element.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0 && value !== null && value.snapshot.length > 0 && g !== undefined &&
      [g.left, g.right, g.top, g.bottom].every(Number.isFinite) && g.right > g.left && g.bottom > g.top ? value : null
  }
  const local = (event: PointerEvent): DrawingPoint => { const rect = element.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top } }
  const clampToPlot = (point: DrawingPoint, current: EngineFrame): DrawingPoint => {
    const g = current.model.geometry
    return { x: Math.max(g.left, Math.min(g.right, point.x)), y: Math.max(g.top, Math.min(g.bottom, point.y)) }
  }
  const release = (id: number): void => { try { if (element.hasPointerCapture(id)) element.releasePointerCapture(id) } catch { /* the pointer is already gone */ } }
  const setArmed = (armed: boolean): void => { if (armed) element.dataset.holdDraw = 'armed'; else delete element.dataset.holdDraw }
  const stop = (): void => {
    const active = phase; phase = null
    if (active?.kind === 'pending') win.clearTimeout(active.timer)
    if (active?.kind === 'stroke' && active.frameId !== 0) win.cancelAnimationFrame(active.frameId)
    if (active !== null) release(active.pointerId)
    setArmed(false); hooks.onPreview(null)
  }
  const anchorOf = (point: DrawingPoint, current: EngineFrame): DrawingAnchor | null => {
    const anchor = current.unproject(point.x, point.y)
    if (anchor === null || !Number.isFinite(anchor.timestamp) || Math.abs(anchor.timestamp) > 8.64e15 || !Number.isFinite(anchor.price)) return null
    const back = current.project(anchor.timestamp, anchor.price)
    // A clamped history edge would collapse the shape: refuse rather than store a different one.
    return back !== null && Math.abs(back.x - point.x) <= 0.75 && Math.abs(back.y - point.y) <= 0.75 ? Object.freeze({ timestamp: anchor.timestamp, price: anchor.price }) : null
  }
  const preview = (): void => {
    const active = phase
    if (active?.kind !== 'stroke') return
    active.frameId = 0
    const current = frame()
    if (current === null || active.points.length < 2) { hooks.onPreview(null); return }
    const anchors: DrawingAnchor[] = []
    for (const point of active.points) { const anchor = anchorOf(point, current); if (anchor === null) { hooks.onPreview(null); return } anchors.push(anchor) }
    hooks.onPreview(Object.freeze({ id: active.id, type: 'brush' as DrawingType, anchors: Object.freeze(anchors), locked: false, hidden: false, strokeWidth: 2 }))
  }
  const newId = (): string => {
    let id: string
    do { id = `hold-${Date.now().toString(36)}-${(++sequence).toString(36)}` } while (store.getSnapshot().drawings.some(item => item.id === id))
    return id
  }
  const place = (candidate: ShapeCandidate, id: string, current: EngineFrame): boolean => {
    const anchors: DrawingAnchor[] = []
    for (const point of candidate.points) { const anchor = anchorOf(point, current); if (anchor === null) return false; anchors.push(anchor) }
    try { store.add({ id, type: candidate.type, anchors, locked: false, hidden: false }); store.select(id); return true } catch { return false }
  }
  const erase = (path: readonly DrawingPoint[], current: EngineFrame): number => {
    const g = current.model.geometry, hits = new Map<string, number>()
    for (const point of path) {
      const hit = store.hitTest(point, current.project, g, 6, current.drawingContext)
      if (hit !== null) hits.set(hit.id, (hits.get(hit.id) ?? 0) + 1)
    }
    const snapshot = store.getSnapshot().drawings
    // Conservative: a drawing needs several scribble points on it, and locked or hidden ones are never touched.
    const doomed = snapshot.filter(item => !item.locked && !item.hidden && (hits.get(item.id) ?? 0) >= 3).slice(0, HOLD_DRAW_LIMITS.maxErase)
    for (const item of doomed) store.remove(item.id)
    return doomed.length
  }
  const finish = (): void => {
    const active = phase
    if (active?.kind !== 'stroke') return
    const points = active.points, current = frame(), before = active.before
    stop()
    if (current === null || store.getSnapshot().drawings !== before) return
    const result = recognizeStroke(points)
    if (result.kind === 'scribble') {
      const options = hooks.options()
      const count = options?.erase === false ? 0 : erase(result.path, current)
      hooks.onEvent(count > 0 ? { phase: 'erased', count } : { phase: 'unrecognized' }); return
    }
    if (result.kind !== 'shape') { hooks.onEvent({ phase: 'unrecognized' }); return }
    const id = newId()
    if (!place(result.candidates[0], id, current)) { hooks.onEvent({ phase: 'unrecognized' }); return }
    recent = { id, candidates: result.candidates, index: 0, drawings: store.getSnapshot().drawings }
    hooks.onEvent({ phase: 'recognized', shape: result.candidates[0].type, shapes: result.candidates.map(item => item.type), index: 0 })
  }
  const on = (type: string, listener: EventListener): void => { element.addEventListener(type, listener, { capture: true, passive: false, signal: abort.signal }) }

  on('pointerdown', event => {
    const e = event as PointerEvent
    recent = null
    const options = hooks.options()
    if (options === null || phase !== null || e.button !== 0 || editable(e.target) || !hooks.canStart()) return
    const current = frame()
    if (current === null) return
    const origin = local(e), g = current.model.geometry
    if (origin.x < g.left || origin.x > g.right || origin.y < g.top || origin.y > g.bottom) return
    const pointerId = e.pointerId
    const timer = win.setTimeout(() => {
      if (disposed || phase?.kind !== 'pending' || phase.pointerId !== pointerId || !hooks.canStart()) { stop(); return }
      const armed = frame()
      if (armed === null) { stop(); return }
      // The chart's pan began on pointerdown: end it before this pointer becomes a pen.
      hooks.onInteractionStart()
      try { element.setPointerCapture(pointerId) } catch { stop(); return }
      phase = { kind: 'stroke', pointerId, id: newId(), points: [clampToPlot(origin, armed)], spacing: 2, before: store.getSnapshot().drawings, frameId: 0 }
      setArmed(true); element.focus({ preventScroll: true })
      hooks.onEvent({ phase: 'armed' })
    }, options.holdMs)
    phase = { kind: 'pending', pointerId, origin, timer }
  })
  on('pointermove', event => {
    const e = event as PointerEvent, active = phase
    if (active === null || e.pointerId !== active.pointerId) return
    if (active.kind === 'pending') {
      const p = local(e)
      // Resting, not travelling: jitter inside the slop belongs to nobody; real travel is a pan.
      if (Math.hypot(p.x - active.origin.x, p.y - active.origin.y) <= HOLD_DRAW_LIMITS.slop) { consume(e); return }
      win.clearTimeout(active.timer); phase = null; return
    }
    consume(e)
    const current = frame()
    if (current === null) { stop(); return }
    const samples = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : []
    const step = Math.max(1, Math.ceil(samples.length / 64))
    const add = (sample: PointerEvent): void => {
      const next = clampToPlot(local(sample), current), last = active.points[active.points.length - 1]
      if (Math.hypot(next.x - last.x, next.y - last.y) < active.spacing) return
      if (active.points.length >= HOLD_DRAW_LIMITS.maxPoints) { active.points = active.points.filter((_, index) => index % 2 === 0); active.spacing *= 2 }
      active.points.push(next)
    }
    for (let i = 0; i < samples.length; i += step) add(samples[i])
    add(e)
    if (active.frameId === 0) active.frameId = win.requestAnimationFrame(preview)
  })
  on('pointerup', event => {
    const e = event as PointerEvent, active = phase
    if (active === null || e.pointerId !== active.pointerId) return
    if (active.kind === 'pending') { win.clearTimeout(active.timer); phase = null; return }
    consume(e)
    const current = frame()
    if (current !== null) { const last = active.points[active.points.length - 1], next = clampToPlot(local(e), current); if (Math.hypot(next.x - last.x, next.y - last.y) > 0.01) active.points.push(next) }
    finish()
  })
  const cancelStroke = (event: Event): void => {
    const active = phase
    if (active === null || (event as PointerEvent).pointerId !== active.pointerId) return
    if (active.kind === 'stroke') consume(event)
    stop()
  }
  on('pointercancel', cancelStroke)
  on('lostpointercapture', event => { if (phase?.kind === 'stroke') cancelStroke(event) })
  on('keydown', event => {
    const e = event as KeyboardEvent
    if (e.isComposing || editable(e.target)) return
    if (phase?.kind === 'stroke' && e.key === 'Escape') { consume(e); stop(); return }
    const held = recent
    if (held === null) return
    // Any other change to the drawings ends the window in which Tab and Escape speak for the last stroke.
    if (store.getSnapshot().drawings !== held.drawings || !store.getSnapshot().drawings.some(item => item.id === held.id)) { recent = null; return }
    if (e.key === 'Escape' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      consume(e); recent = null
      if (store.getSnapshot().canUndo) store.undo()
      hooks.onEvent({ phase: 'removed' }); return
    }
    if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey && held.candidates.length > 1) {
      consume(e)
      const current = frame()
      if (current === null) return
      const index = (held.index + (e.shiftKey ? held.candidates.length - 1 : 1)) % held.candidates.length
      // Undo the previous shape, then add the next: history keeps one entry for the stroke, not a chain of swaps.
      if (store.getSnapshot().canUndo) store.undo()
      if (!place(held.candidates[index], held.id, current)) { recent = null; hooks.onEvent({ phase: 'unrecognized' }); return }
      recent = { ...held, index, drawings: store.getSnapshot().drawings }
      hooks.onEvent({ phase: 'recognized', shape: held.candidates[index].type, shapes: held.candidates.map(item => item.type), index })
    }
  })
  win.addEventListener('blur', stop, { signal: abort.signal })
  doc.addEventListener('visibilitychange', () => { if (doc.hidden) stop() }, { signal: abort.signal })
  return {
    cancel: stop,
    dispose: () => { if (disposed) return; disposed = true; abort.abort(); stop(); recent = null }
  }
}
