import { zoomContinuousViewport, type EngineFrame, type EngineLayout, type RealtimeView, type Viewport } from '@supersolutions/super-chart-core'

/** Axis and pane gestures are independent from plot navigation and drawing edits. */
export function attachPaneInteraction (
  element: HTMLElement,
  frame: () => EngineFrame | null,
  layout: () => EngineLayout,
  setLayout: (value: EngineLayout) => void,
  cancelNavigation: () => void,
  view?: RealtimeView,
  scheduler?: { request: (callback: (time: number) => void) => number, cancel: (id: number) => void }
): () => void {
  const win = element.ownerDocument.defaultView
  if (win === null) return () => {}
  const frames = scheduler ?? { request: (callback: (time: number) => void) => win.requestAnimationFrame(callback), cancel: (id: number) => win.cancelAnimationFrame(id) }
  const abort = new win.AbortController(), originalCursor = element.style.cursor
  type Area = number | null | 'time'
  interface Drag {
    pointer: number, x: number, y: number, initial: EngineFrame, width: number, height: number
    area: Area, observed: Readonly<Viewport>
  }
  let drag: Drag | null = null, pending: { x: number, y: number } | null = null
  let raf: number | null = null, rectFrame: number | null = null, rect: DOMRect | null = null
  const invalidateRect = (): void => { rect = null }
  const bounds = (): DOMRect => {
    if (rect === null) rect = element.getBoundingClientRect()
    if (rectFrame === null) rectFrame = frames.request(() => { rectFrame = null; rect = null })
    return rect
  }
  const point = (event: MouseEvent): { x: number, y: number } => {
    const r = bounds()
    return { x: event.clientX - r.left, y: event.clientY - r.top }
  }
  const area = (value: EngineFrame, x: number, y: number): Area | undefined => {
    for (let i = 1; i < value.panes.length; i++) if (Math.abs(y - value.panes[i].top) <= 5) return i
    const g = value.model.geometry
    const onAxis = g.axisSide === 'right' ? x > g.right && x <= g.width : x >= 0 && x < g.left
    if (onAxis && y >= g.top && y <= g.bottom) return null
    const last = value.panes[value.panes.length - 1]
    if (view !== undefined && last !== undefined && x >= g.left && x <= g.right &&
      y >= last.top + last.frame.model.geometry.bottom && y <= last.top + last.height) return 'time'
    return undefined
  }
  const stop = (): void => {
    if (raf !== null) frames.cancel(raf)
    raf = null; pending = null
    const previous = drag
    drag = null; element.style.cursor = originalCursor
    if (previous?.area === 'time') view?.endNavigation()
    if (previous !== null && element.hasPointerCapture(previous.pointer)) element.releasePointerCapture(previous.pointer)
  }
  const applyPending = (): void => {
    const p = pending
    pending = null
    if (p === null || drag === null) return
    const value = frame(), r = bounds(), initial = drag.initial
    if (value === null || r.width !== drag.width || r.height !== drag.height ||
      value.panes.map(pane => pane.id).join('\n') !== initial.panes.map(pane => pane.id).join('\n')) { stop(); return }
    if (drag.area === 'time') {
      if (view === undefined || view.getSnapshot().viewport !== drag.observed || view.getSnapshot().length !== initial.snapshot.length) { stop(); return }
      const g = initial.model.geometry, anchor = Math.max(0, Math.min(1, (drag.x - g.left) / g.plotWidth))
      const factor = Math.exp(Math.max(-4, Math.min(4, (p.x - drag.x) / g.plotWidth * 3)))
      view.setViewport(zoomContinuousViewport(initial.snapshot.viewport, initial.snapshot.length, factor, anchor, view.getLimits()))
      drag.observed = view.getSnapshot().viewport
      return
    }
    if (value.snapshot.viewport !== initial.snapshot.viewport) { stop(); return }
    if (typeof drag.area === 'number') {
      const before = initial.panes[drag.area - 1], after = initial.panes[drag.area]
      const minimum = Math.min(48, drag.height / initial.panes.length)
      const delta = Math.max(minimum - before.height, Math.min(after.height - minimum, p.y - drag.y))
      const weights: Record<string, number> = Object.create(null)
      for (const pane of initial.panes) weights[pane.id] = Math.max(1e-9, pane.height + (pane === before ? delta : pane === after ? -delta : 0))
      setLayout({ paneWeights: weights })
    } else {
      const scale = initial.panes[0].scale, g = initial.model.geometry
      const factor = Math.exp(Math.max(-4, Math.min(4, (p.y - drag.y) / g.plotHeight * 2)))
      const a = scale.value(drag.y + (g.top - drag.y) * factor), b = scale.value(drag.y + (g.bottom - drag.y) * factor)
      if (Number.isFinite(a) && Number.isFinite(b) && a !== b && (layout().priceScale?.mode !== 'log' || Math.min(a, b) > 0)) {
        setLayout({ priceScale: { ...layout().priceScale, range: [Math.min(a, b), Math.max(a, b)] } })
      }
    }
  }
  const schedule = (): void => {
    if (raf === null) raf = frames.request(() => { raf = null; applyPending() })
  }
  const consume = (event: Event): void => { event.preventDefault(); event.stopImmediatePropagation() }
  element.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary || drag !== null) return
    const value = frame(), p = point(event)
    if (value === null || value.snapshot.length === 0) return
    const hit = area(value, p.x, p.y)
    if (hit === undefined) return
    consume(event); cancelNavigation()
    if (hit === 'time') view?.beginNavigation()
    const r = bounds()
    drag = { pointer: event.pointerId, x: p.x, y: p.y, initial: value, width: r.width, height: r.height, area: hit, observed: value.snapshot.viewport }
    element.setPointerCapture(event.pointerId); element.focus({ preventScroll: true })
  }, { signal: abort.signal, passive: false })
  element.addEventListener('pointermove', event => {
    const coalesced = event.getCoalescedEvents?.()
    const latest = coalesced === undefined || coalesced.length === 0 ? event : coalesced[coalesced.length - 1]
    const p = point(latest)
    if (drag === null) {
      const value = frame(), hit = value === null ? undefined : area(value, p.x, p.y)
      element.style.cursor = hit === undefined ? originalCursor : hit === 'time' ? 'ew-resize' : 'ns-resize'
      return
    }
    if (event.pointerId !== drag.pointer) return
    consume(event); pending = p; schedule()
  }, { signal: abort.signal, passive: false })
  element.addEventListener('pointerup', event => {
    if (event.pointerId !== drag?.pointer) return
    consume(event); pending = point(event); applyPending(); stop()
  }, { signal: abort.signal })
  element.addEventListener('pointercancel', stop, { signal: abort.signal })
  element.addEventListener('lostpointercapture', event => { if (event.pointerId === drag?.pointer) stop() }, { signal: abort.signal })
  element.addEventListener('dblclick', event => {
    const value = frame(), p = point(event)
    if (value === null) return
    const hit = area(value, p.x, p.y)
    if (hit === undefined) return
    consume(event); stop(); cancelNavigation()
    if (hit === 'time') view?.resetViewport()
    else setLayout(hit === null ? { priceScale: { ...layout().priceScale, range: undefined } } : { paneWeights: undefined })
  }, { signal: abort.signal })
  element.addEventListener('keydown', event => { if (event.key === 'Escape' && drag !== null) { consume(event); stop() } }, { signal: abort.signal })
  element.addEventListener('blur', stop, { signal: abort.signal })
  win.addEventListener('blur', stop, { signal: abort.signal })
  win.addEventListener('resize', invalidateRect, { signal: abort.signal })
  element.ownerDocument.addEventListener('scroll', invalidateRect, { signal: abort.signal, capture: true, passive: true })
  element.ownerDocument.addEventListener('visibilitychange', () => { if (element.ownerDocument.hidden) stop() }, { signal: abort.signal })
  return () => {
    abort.abort(); stop()
    if (rectFrame !== null) frames.cancel(rectFrame)
    rectFrame = null; rect = null
  }
}
