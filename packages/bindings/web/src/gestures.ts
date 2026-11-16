import { viewportSpan, clampContinuousViewport as clampViewport, zoomContinuousViewport as zoomViewport, type RealtimeView, type Viewport } from '@supersolutions/super-chart-core'

interface Geometry { left: number, plotWidth: number }
interface Point { x: number, y: number }
interface Frame { length: number, left: number, width: number, observed: Readonly<Viewport> }
/** tan(22.5 degrees): the weaker wheel axis below this share of the stronger one is ignored. */
const AXIS_SNAP = 0.4142
interface Drag extends Frame { start: Viewport, x: number, distance: number }

/** Browser input for the owned engine. Native hosts retain their native gestures. */
export function attachEngineGestures (
  element: HTMLElement,
  view: RealtimeView,
  geometry: () => Geometry | null,
  cursor: (x: number | null) => void,
  options: {
    inertia?: boolean
    reducedMotion?: boolean
    frameScheduler?: { request: (callback: (time: number) => void) => number, cancel: (id: number) => void }
  } = {}
): (() => void) & { cancelInput: () => void } {
  const doc = element.ownerDocument, win = doc.defaultView
  if (win === null) return Object.assign(() => {}, { cancelInput: () => {} })
  const frameScheduler = options.frameScheduler ?? {
    request: (callback: (time: number) => void) => win.requestAnimationFrame(callback),
    cancel: (id: number) => win.cancelAnimationFrame(id)
  }
  const abort = new win.AbortController(), pointers = new Map<number, Point>()
  const reduced = win.matchMedia?.('(prefers-reduced-motion: reduce)')
  const oldTouchAction = element.style.touchAction
  element.style.touchAction = 'none'
  let disposed = false, inspection = false
  let drag: Drag | null = null
  let pending: { next: Viewport, frame: Frame } | null = null
  let wheel: { target: Viewport, pan: number, zoom: number, frame: Frame, time: number, lastInput: number } | null = null
  let raf: number | null = null, rectFrame: number | null = null
  let rect: DOMRect | null = null
  let velocity = 0, sample = { x: 0, time: 0 }
  let coast: { frame: Frame, start: Viewport, velocity: number, started: number } | null = null
  let hold: { id: number, point: Point, timer: number } | null = null

  const editable = (target: EventTarget | null): boolean =>
    target instanceof win.Element && target.closest('input,textarea,select,button,a,[contenteditable]:not([contenteditable="false"])') !== null
  const invalidateRect = (): void => { rect = null }
  const bounds = (): DOMRect => {
    if (rect === null) rect = element.getBoundingClientRect()
    if (rectFrame === null) rectFrame = frameScheduler.request(() => { rectFrame = null; rect = null })
    return rect
  }
  const eventTime = (event: PointerEvent): number => {
    const now = win.performance.now()
    return Number.isFinite(event.timeStamp) && Math.abs(event.timeStamp - now) < 60000 ? event.timeStamp : now
  }
  const cancelHold = (): void => {
    if (hold !== null) win.clearTimeout(hold.timer)
    hold = null
  }
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
    pending = null
    if (value === null || !valid(value.frame)) return
    view.setViewport(value.next)
    const snapshot = view.getSnapshot()
    if (drag !== null) drag.observed = snapshot.viewport
    if (coast !== null) coast.frame.observed = snapshot.viewport
    if (wheel !== null) wheel.frame.observed = snapshot.viewport
  }
  const schedule = (): void => {
    if (disposed || raf !== null) return
    raf = frameScheduler.request(time => {
      raf = null
      if (disposed) return
      if (coast !== null) {
        if (!valid(coast.frame) || reduced?.matches === true || options.reducedMotion === true) coast = null
        else {
          // Absolute elapsed time avoids extending momentum after a long foreground frame.
          const elapsed = Math.max(0, time - coast.started), decay = Math.exp(-elapsed / 220)
          const distance = coast.velocity * 220 * (1 - decay)
          const delta = -distance / coast.frame.width * Math.max(0, viewportSpan(coast.start) - 1)
          const proposed = { i0: coast.start.i0 + delta, i1: coast.start.i1 + delta }
          const next = clampViewport(proposed, coast.frame.length, view.getLimits())
          pending = { next, frame: coast.frame }
          const blocked = (delta < 0 && next.i0 > proposed.i0 + 1e-9) || (delta > 0 && next.i1 < proposed.i1 - 1e-9)
          if (Math.abs(coast.velocity * decay) < 0.01 || elapsed >= 1400 || blocked) coast = null
        }
      }
      if (wheel !== null) {
        if (!valid(wheel.frame)) wheel = null
        else {
          const current = view.getSnapshot().viewport, target = wheel.target
          const dt = Math.max(0, time - wheel.time)
          wheel.time = time
          const alpha = options.reducedMotion === true || reduced?.matches === true ? 1 : 1 - Math.exp(-dt / 40)
          const span = viewportSpan(current), targetSpan = viewportSpan(target)
          const nextSpan = span * Math.exp(Math.log(targetSpan / span) * alpha)
          const blend = Math.abs(targetSpan - span) > 1e-9 ? (nextSpan - span) / (targetSpan - span) : alpha
          const next = { i0: current.i0 + (target.i0 - current.i0) * blend, i1: current.i1 + (target.i1 - current.i1) * blend }
          const remainingPixels = Math.max(Math.abs(next.i0 - target.i0), Math.abs(next.i1 - target.i1)) * wheel.frame.width / Math.max(1, targetSpan - 1)
          const settled = alpha === 1 || remainingPixels < 0.15 || time - wheel.lastInput >= 280
          pending = { next: settled ? target : next, frame: wheel.frame }
          if (settled) wheel = null
        }
      }
      if (coast !== null || wheel !== null) schedule()
      commit()
      if (pointers.size === 0 && coast === null && wheel === null) view.endNavigation()
    })
  }
  const cancelScheduled = (): void => {
    if (raf !== null) frameScheduler.cancel(raf)
    raf = null
  }
  const flush = (): void => { cancelScheduled(); wheel = null; coast = null; commit() }
  const stop = (): void => { cancelScheduled(); pending = null; wheel = null; coast = null; velocity = 0 }
  const position = (): { x: number, distance: number } => {
    const iterator = pointers.values(), a = iterator.next().value as Point, b = iterator.next().value as Point | undefined
    return b === undefined ? { x: a.x, distance: 0 } : { x: (a.x + b.x) / 2, distance: Math.hypot(b.x - a.x, b.y - a.y) }
  }
  const rebase = (): void => {
    const frame = readFrame()
    if (pointers.size === 0 || frame === null) { drag = null; return }
    const p = position()
    view.beginNavigation()
    drag = { ...frame, start: { ...frame.observed }, x: p.x, distance: p.distance }
    sample = { x: p.x, time: win.performance.now() }; velocity = 0
  }
  const clear = (): void => {
    stop(); cancelHold(); drag = null; inspection = false
    const ids = [...pointers.keys()]
    pointers.clear()
    for (const id of ids) if (element.hasPointerCapture(id)) element.releasePointerCapture(id)
    view.endNavigation(); cursor(null)
  }
  const on = (type: string, listener: EventListener, passive = true): void => {
    element.addEventListener(type, listener, { signal: abort.signal, passive })
  }
  on('pointerdown', event => {
    const e = event as PointerEvent
    if (e.button !== 0 || pointers.size >= 2 || editable(e.target) || readFrame() === null) return
    flush(); stop(); cancelHold()
    if (pointers.size === 0) view.endNavigation()
    inspection = false
    view.beginNavigation()
    const r = bounds(), point = { x: e.clientX - r.left, y: e.clientY - r.top }
    pointers.set(e.pointerId, point)
    element.setPointerCapture(e.pointerId); element.focus({ preventScroll: true }); rebase()
    if (e.pointerType === 'touch' && pointers.size === 1) {
      const id = e.pointerId
      hold = {
        id,
        point,
        timer: win.setTimeout(() => {
          const current = pointers.get(id)
          if (hold?.id !== id || current === undefined || pointers.size !== 1 || drag === null || !valid(drag)) { cancelHold(); return }
          hold = null; inspection = true; pending = null; velocity = 0
          view.endNavigation(); cursor(current.x)
        }, 450)
      }
    } else cursor(null)
  })
  const movePointer = (e: PointerEvent, target: EventTarget | null = e.target): void => {
    const r = bounds(), x = e.clientX - r.left, y = e.clientY - r.top
    if (!pointers.has(e.pointerId)) {
      if (pointers.size === 0 && !inspection && !editable(target)) cursor(x)
      return
    }
    pointers.set(e.pointerId, { x, y })
    if (hold !== null) {
      if (Math.hypot(x - hold.point.x, y - hold.point.y) <= 8) return
      cancelHold()
    }
    if (inspection && pointers.size === 1) { cursor(x); return }
    if (drag === null || !valid(drag)) { pending = null; rebase(); return }
    const p = position(), now = eventTime(e)
    const factor = pointers.size === 2 && drag.distance > 1 ? Math.max(1, p.distance) / drag.distance : 1
    const anchor = Math.max(0, Math.min(1, (drag.x - drag.left) / drag.width))
    const zoomed = zoomViewport(drag.start, drag.length, factor, anchor, view.getLimits())
    const delta = (drag.x - p.x) / drag.width * Math.max(0, viewportSpan(zoomed) - 1)
    pending = { next: { i0: zoomed.i0 + delta, i1: zoomed.i1 + delta }, frame: drag }
    const elapsed = now - sample.time
    if (pointers.size === 1 && elapsed > 0) {
      const instantaneous = Math.max(-3, Math.min(3, (p.x - sample.x) / elapsed))
      if (elapsed > 80 || instantaneous * velocity < 0) velocity = 0
      velocity += (instantaneous - velocity) * (1 - Math.exp(-elapsed / 30))
    } else if (pointers.size !== 1) velocity = 0
    sample = { x: p.x, time: now }
    schedule(); cursor(p.x)
  }
  on('pointermove', event => {
    const e = event as PointerEvent, coalesced = e.getCoalescedEvents?.()
    // The final physical sample controls the viewport; intermediate samples need no layout work.
    const latest = coalesced === undefined || coalesced.length === 0 ? e : coalesced[coalesced.length - 1]
    movePointer(latest, e.target)
  })
  on('pointerup', event => {
    const e = event as PointerEvent
    if (!pointers.has(e.pointerId)) return
    const last = pointers.get(e.pointerId)!, r = bounds()
    if (last.x !== e.clientX - r.left || last.y !== e.clientY - r.top) movePointer(e)
    const wasSingle = pointers.size === 1, recent = win.performance.now() - sample.time < 80
    const currentDrag = drag !== null && valid(drag)
    flush(); cancelHold(); pointers.delete(e.pointerId)
    if (element.hasPointerCapture(e.pointerId)) element.releasePointerCapture(e.pointerId)
    if (pointers.size > 0) { rebase(); return }
    const frame = readFrame(), speed = velocity
    drag = null
    if (!inspection && wasSingle && currentDrag && recent && frame !== null && options.inertia === true && options.reducedMotion !== true && reduced?.matches !== true && Math.abs(speed) > 0.05) {
      coast = { frame, start: { ...frame.observed }, velocity: speed, started: win.performance.now() }
      schedule()
    } else view.endNavigation()
    if (e.pointerType !== 'mouse' && !inspection) cursor(null)
  })
  on('pointercancel', clear)
  on('lostpointercapture', event => { if (pointers.has((event as PointerEvent).pointerId)) clear() })
  on('pointerleave', () => { if (pointers.size === 0 && !inspection) cursor(null) })
  on('blur', clear)
  on('focusin', event => { if (editable(event.target)) clear() })
  win.addEventListener('blur', clear, { signal: abort.signal })
  win.addEventListener('resize', invalidateRect, { signal: abort.signal })
  doc.addEventListener('scroll', invalidateRect, { signal: abort.signal, capture: true, passive: true })
  doc.addEventListener('visibilitychange', () => { if (doc.hidden) clear() }, { signal: abort.signal })
  on('wheel', event => {
    const e = event as WheelEvent, frame = readFrame()
    if (frame === null || editable(e.target) || pointers.size > 0) return
    const unitX = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? frame.width : 1
    const unitY = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? element.clientHeight : 1
    const rawX = e.deltaX * unitX, rawY = e.deltaY * unitY, now = win.performance.now()
    // Vertical wheel zooms, horizontal wheel pans, both at once do both (a diagonal trackpad swipe). There is no mode
    // that sticks: each event is read on its own, so a vertical scale can turn into a horizontal move and back without
    // a pause. Only a clearly dominant axis drops the other one (within 22.5 degrees of an axis, so eight directions),
    // which keeps a nearly straight swipe from drifting.
    let panInput = e.shiftKey && rawX === 0 ? rawY : rawX, zoomInput = e.shiftKey ? 0 : rawY
    if (e.ctrlKey) panInput = 0
    const major = Math.max(Math.abs(panInput), Math.abs(zoomInput)), minor = Math.min(Math.abs(panInput), Math.abs(zoomInput))
    if (minor < major * AXIS_SNAP) { if (Math.abs(panInput) < Math.abs(zoomInput)) panInput = 0; else zoomInput = 0 }
    const pan = Math.max(-400, Math.min(400, panInput)), zoom = Math.max(-400, Math.min(400, zoomInput))
    if (!Number.isFinite(pan) || !Number.isFinite(zoom) || (pan === 0 && zoom === 0)) return
    e.preventDefault()
    if (coast !== null) { flush(); view.endNavigation() }
    coast = null; cancelHold(); inspection = false
    const panSign = Math.sign(pan), zoomSign = Math.sign(zoom)
    // Reversing an axis starts from where the view is now, so the remaining glide in the old direction is dropped.
    const reversed = wheel !== null && ((panSign !== 0 && wheel.pan !== 0 && wheel.pan !== panSign) || (zoomSign !== 0 && wheel.zoom !== 0 && wheel.zoom !== zoomSign))
    if (wheel === null || !valid(wheel.frame) || reversed) {
      if (wheel === null) view.beginNavigation()
      wheel = { target: { ...frame.observed }, pan: 0, zoom: 0, frame, time: now, lastInput: now }
    }
    if (panSign !== 0) wheel.pan = panSign
    if (zoomSign !== 0) wheel.zoom = zoomSign
    const x = e.clientX - bounds().left
    if (zoom !== 0) wheel.target = zoomViewport(wheel.target, frame.length, Math.exp(-zoom * 0.002), (x - frame.left) / frame.width, view.getLimits())
    if (pan !== 0) {
      const bars = pan / frame.width * Math.max(0, viewportSpan(wheel.target) - 1)
      wheel.target = clampViewport({ i0: wheel.target.i0 + bars, i1: wheel.target.i1 + bars }, frame.length, view.getLimits())
    }
    wheel.lastInput = now
    schedule(); cursor(x)
  }, false)
  on('keydown', event => {
    const e = event as KeyboardEvent
    if (editable(e.target) || e.ctrlKey || e.metaKey || e.isComposing) return
    if (e.altKey) {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        flush(); clear()
        if (e.key === 'ArrowLeft') view.undoNavigation(); else view.redoNavigation()
        e.preventDefault()
      }
      return
    }
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
    e.preventDefault()
  }, false)
  const cleanup = (): void => {
    if (disposed) return
    disposed = true; abort.abort(); clear()
    if (rectFrame !== null) frameScheduler.cancel(rectFrame)
    rectFrame = null; rect = null
    element.style.touchAction = oldTouchAction
  }
  return Object.assign(cleanup, { cancelInput: clear })
}
