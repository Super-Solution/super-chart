import { viewportSpan, clampContinuousViewport as clampViewport, zoomContinuousViewport as zoomViewport, type RealtimeView, type Viewport } from '@supersolutions/super-chart-core'

interface Geometry { left: number, plotWidth: number }
interface Point { x: number, y: number }
interface Frame {
  length: number
  left: number
  width: number
  observed: Readonly<Viewport>
}
interface Drag extends Frame {
  start: Viewport
  x: number
  distance: number
}

/** Browser input for the owned engine. Native hosts retain their native gestures. */
export function attachEngineGestures (
  element: HTMLElement,
  view: RealtimeView,
  geometry: () => Geometry | null,
  cursor: (x: number | null) => void,
  options: {
    inertia?: boolean
    reducedMotion?: boolean
    frameScheduler?: {
      request: (callback: (time: number) => void) => number
      cancel: (id: number) => void
    }
  } = {}
): (() => void) & { cancelInput: () => void } {
  const doc = element.ownerDocument
  const win = doc.defaultView
  if (win === null) return Object.assign(() => {}, { cancelInput: () => {} })
  const frameScheduler = options.frameScheduler ?? {
    request: (callback: (time: number) => void) => win.requestAnimationFrame(callback),
    cancel: (id: number) => win.cancelAnimationFrame(id)
  }
  const abort = new win.AbortController()
  const pointers = new Map<number, Point>()
  const reduced = win.matchMedia?.('(prefers-reduced-motion: reduce)')
  const oldTouchAction = element.style.touchAction
  element.style.touchAction = 'none'
  let disposed = false
  let drag: Drag | null = null
  let pending: { next: Viewport, frame: Frame } | null = null
  let wheel: { start: Viewport, delta: number, frame: Frame } | null = null
  let raf: number | null = null
  let velocity = 0
  let sample = { x: 0, time: 0 }
  let coast: { frame: Frame, start: Viewport, velocity: number, elapsed: number, time: number } | null = null

  const editable = (target: EventTarget | null): boolean =>
    target instanceof win.Element && target.closest('input,textarea,select,button,a,[contenteditable]:not([contenteditable="false"])') !== null
  const readFrame = (): Frame | null => {
    const g = geometry(), snapshot = view.getSnapshot()
    return g !== null && Number.isFinite(g.left) && Number.isFinite(g.plotWidth) && g.plotWidth > 0 && snapshot.length > 0
      ? { length: snapshot.length, left: g.left, width: g.plotWidth, observed: snapshot.viewport }
      : null
  }
  const valid = (frame: Frame): boolean => {
    const now = readFrame()
    return now !== null && now.length === frame.length && now.left === frame.left && now.width === frame.width && now.observed === frame.observed
  }
  const commit = (): void => {
    const value = pending
    pending = null; wheel = null
    if (value === null || !valid(value.frame)) return
    view.setViewport(value.next)
    if (drag !== null) drag.observed = view.getSnapshot().viewport
    if (coast !== null) coast.frame.observed = view.getSnapshot().viewport
    const snapshot = view.getSnapshot()
    if (snapshot.viewport.i0 === 0 && snapshot.hasMore) view.requestMore()
  }
  const schedule = (): void => {
    if (disposed || raf !== null) return
    raf = frameScheduler.request(time => {
      raf = null
      if (disposed) return
      if (coast !== null) {
        if (!valid(coast.frame) || reduced?.matches === true || options.reducedMotion === true) coast = null
        else {
          const dt = Math.max(0, Math.min(50, time - coast.time))
          coast.time = time; coast.elapsed += dt
          const decay = Math.exp(-coast.elapsed / 180)
          const distance = coast.velocity * 180 * (1 - decay)
          const delta = -distance / coast.frame.width * Math.max(0, viewportSpan(coast.start) - 1)
          const next = clampViewport({ i0: coast.start.i0 + delta, i1: coast.start.i1 + delta }, coast.frame.length)
          pending = { next, frame: coast.frame }
          const blocked = (delta < 0 && next.i0 === 0) || (delta > 0 && next.i1 === coast.frame.length - 1)
          if (Math.abs(coast.velocity * decay) < 0.01 || coast.elapsed >= 1000 || blocked) coast = null
        }
      }
      // Queue the next input update before setViewport notifies the renderer.
      if (coast !== null) schedule()
      commit()
    })
  }
  const cancelScheduled = (): void => {
    if (raf !== null) frameScheduler.cancel(raf)
    raf = null
  }
  const flush = (): void => {
    cancelScheduled()
    commit()
  }
  const stop = (): void => {
    cancelScheduled()
    pending = null; wheel = null; coast = null; velocity = 0
  }
  const position = (): { x: number, distance: number } => {
    const [a, b] = [...pointers.values()]
    return b === undefined ? { x: a.x, distance: 0 } : { x: (a.x + b.x) / 2, distance: Math.hypot(b.x - a.x, b.y - a.y) }
  }
  const rebase = (): void => {
    const frame = readFrame()
    if (pointers.size === 0 || frame === null) { drag = null; return }
    const p = position()
    drag = { ...frame, start: { ...frame.observed }, x: p.x, distance: p.distance }
    sample = { x: p.x, time: win.performance.now() }; velocity = 0
  }
  const clear = (): void => {
    stop(); drag = null
    const ids = [...pointers.keys()]
    pointers.clear()
    for (const id of ids) if (element.hasPointerCapture(id)) element.releasePointerCapture(id)
    cursor(null)
  }
  const on = (type: string, listener: EventListener, passive = true): void => {
    element.addEventListener(type, listener, { signal: abort.signal, passive })
  }
  on('pointerdown', event => {
    const e = event as PointerEvent
    if (e.button !== 0 || pointers.size >= 2 || editable(e.target) || readFrame() === null) return
    flush(); stop()
    const rect = element.getBoundingClientRect()
    pointers.set(e.pointerId, { x: e.clientX - rect.left, y: e.clientY - rect.top })
    element.setPointerCapture(e.pointerId)
    element.focus({ preventScroll: true })
    rebase()
  })
  on('pointermove', event => {
    const e = event as PointerEvent, rect = element.getBoundingClientRect()
    const x = e.clientX - rect.left, y = e.clientY - rect.top
    if (!pointers.has(e.pointerId)) { if (pointers.size === 0 && !editable(e.target)) cursor(x); return }
    pointers.set(e.pointerId, { x, y })
    if (drag === null || !valid(drag)) { pending = null; rebase(); return }
    const p = position(), now = win.performance.now()
    const factor = pointers.size === 2 && drag.distance > 1 ? Math.max(1, p.distance) / drag.distance : 1
    const anchor = Math.max(0, Math.min(1, (drag.x - drag.left) / drag.width))
    const zoomed = zoomViewport(drag.start, drag.length, factor, anchor)
    const delta = (drag.x - p.x) / drag.width * Math.max(0, viewportSpan(zoomed) - 1)
    pending = { next: { i0: zoomed.i0 + delta, i1: zoomed.i1 + delta }, frame: drag }
    const elapsed = now - sample.time
    if (pointers.size === 1 && elapsed > 0) velocity = Math.max(-3, Math.min(3, (p.x - sample.x) / elapsed))
    else velocity = 0
    sample = { x: p.x, time: now }
    schedule(); cursor(p.x)
  })
  on('pointerup', event => {
    const e = event as PointerEvent
    if (!pointers.has(e.pointerId)) return
    const wasSingle = pointers.size === 1, recent = win.performance.now() - sample.time < 80
    const currentDrag = drag !== null && valid(drag)
    flush()
    pointers.delete(e.pointerId)
    if (element.hasPointerCapture(e.pointerId)) element.releasePointerCapture(e.pointerId)
    if (pointers.size > 0) { rebase(); return }
    const frame = readFrame(), speed = velocity
    drag = null
    if (wasSingle && currentDrag && recent && frame !== null && options.inertia === true && options.reducedMotion !== true && reduced?.matches !== true && Math.abs(speed) > 0.05) {
      coast = { frame, start: { ...frame.observed }, velocity: speed, elapsed: 0, time: win.performance.now() }
      schedule()
    }
    if (e.pointerType !== 'mouse') cursor(null)
  })
  on('pointercancel', clear)
  on('lostpointercapture', event => { if (pointers.has((event as PointerEvent).pointerId)) clear() })
  on('pointerleave', () => { if (pointers.size === 0) cursor(null) })
  on('blur', clear)
  on('focusin', event => { if (editable(event.target)) clear() })
  win.addEventListener('blur', clear, { signal: abort.signal })
  doc.addEventListener('visibilitychange', () => { if (doc.hidden) clear() }, { signal: abort.signal })
  on('wheel', event => {
    const e = event as WheelEvent, frame = readFrame()
    if (frame === null || editable(e.target) || pointers.size > 0) return
    e.preventDefault(); coast = null
    if (wheel === null || !valid(wheel.frame)) wheel = { start: { ...frame.observed }, delta: 0, frame }
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? element.clientHeight : 1
    wheel.delta = Math.max(-4000, Math.min(4000, wheel.delta + Math.max(-400, Math.min(400, e.deltaY * unit))))
    const x = e.clientX - element.getBoundingClientRect().left
    pending = { next: zoomViewport(wheel.start, frame.length, Math.exp(-wheel.delta * 0.002), (x - frame.left) / frame.width), frame: wheel.frame }
    schedule(); cursor(x)
  }, false)
  on('keydown', event => {
    const e = event as KeyboardEvent
    if (editable(e.target) || e.altKey || e.ctrlKey || e.metaKey || e.isComposing) return
    if (e.key === 'Escape') { clear(); e.preventDefault(); return }
    if (!['ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', '+', '=', '-', 'Home'].includes(e.key)) return
    flush(); clear()
    const span = viewportSpan(view.getSnapshot().viewport)
    switch (e.key) {
      case 'ArrowLeft': view.pan(-10); break
      case 'ArrowRight': view.pan(10); break
      case 'PageUp': view.pan(-Math.round(span * 0.8)); break
      case 'PageDown': view.pan(Math.round(span * 0.8)); break
      case '+': case '=': view.zoom(1.5); break
      case '-': view.zoom(1 / 1.5); break
      case 'Home': view.followLatest(); break
    }
    const snapshot = view.getSnapshot()
    if (e.key !== 'Home' && snapshot.viewport.i0 === 0 && snapshot.hasMore) view.requestMore()
    e.preventDefault()
  }, false)
  const cleanup = (): void => {
    if (disposed) return
    disposed = true; abort.abort(); clear()
    element.style.touchAction = oldTouchAction
  }
  return Object.assign(cleanup, { cancelInput: clear })
}
