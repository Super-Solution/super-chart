import type { RealtimeView } from '@supersolutions/super-chart-core'
import { viewportSpan, zoomViewport } from '@supersolutions/super-chart-core'
import type { Viewport } from '@supersolutions/super-chart-core'

/** Demo host adapter only. Native hosts keep their own gesture system. */
export function attachChartGestures (
  element: HTMLElement,
  view: RealtimeView,
  geometry: () => { left: number, plotWidth: number } | null,
  cursor: (x: number | null) => void
): () => void {
  const abort = new AbortController()
  const pointers = new Map<number, { x: number, y: number }>()
  let base: { viewport: Viewport, length: number, x: number, distance: number, left: number, width: number } | null = null
  let pendingViewport: Viewport | null = null
  const flushViewport = (): void => {
    const next = pendingViewport; pendingViewport = null
    const g = geometry()
    // Do not commit coordinates queued before history or layout changed.
    if (next !== null && base !== null && g !== null &&
        view.getSnapshot().length === base.length && g.left === base.left && g.plotWidth === base.width) view.setViewport(next)
  }
  let cursorFrame = 0
  let cursorX: number | null = null
  const position = (): { x: number, distance: number } => {
    const values = [...pointers.values()]
    const a = values[0], b = values[1]
    return b === undefined ? { x: a.x, distance: 0 } : { x: (a.x + b.x) / 2, distance: Math.hypot(b.x - a.x, b.y - a.y) }
  }
  const rebase = (): void => {
    flushViewport()
    const g = geometry()
    if (pointers.size === 0 || g === null || g.plotWidth <= 0) { base = null; return }
    const snapshot = view.getSnapshot(), p = position()
    base = { viewport: { ...snapshot.viewport }, length: snapshot.length, x: p.x, distance: p.distance, left: g.left, width: g.plotWidth }
  }
  const updateCursor = (x: number | null): void => {
    cursorX = x
    if (cursorFrame === 0) cursorFrame = requestAnimationFrame(() => { cursorFrame = 0; flushViewport(); cursor(cursorX) })
  }
  const clear = (): void => {
    const ids = [...pointers.keys()]
    pointers.clear(); base = null; pendingViewport = null
    for (const id of ids) if (element.hasPointerCapture(id)) element.releasePointerCapture(id)
    updateCursor(null)
  }
  const on = (type: string, listener: EventListener, passive = true): void => {
    element.addEventListener(type, listener, { signal: abort.signal, passive })
  }
  on('pointerdown', event => {
    const e = event as PointerEvent
    if (e.button !== 0 || pointers.size >= 2 || geometry() === null) return
    const rect = element.getBoundingClientRect()
    pointers.set(e.pointerId, { x: e.clientX - rect.left, y: e.clientY - rect.top })
    element.setPointerCapture(e.pointerId); element.focus(); rebase()
  })
  on('pointermove', event => {
    const e = event as PointerEvent, rect = element.getBoundingClientRect()
    const x = e.clientX - rect.left, y = e.clientY - rect.top
    if (pointers.has(e.pointerId)) {
      pointers.set(e.pointerId, { x, y })
      const g = geometry(), snapshot = view.getSnapshot()
      // History append/prepend and resize change the coordinate frame. Start anew.
      if (base === null || g === null || snapshot.length !== base.length || g.plotWidth !== base.width || g.left !== base.left) rebase()
      else {
        const p = position()
        const factor = pointers.size === 2 && base.distance > 1 ? Math.max(1, p.distance) / base.distance : 1
        const anchor = Math.max(0, Math.min(1, (base.x - base.left) / base.width))
        const zoomed = zoomViewport(base.viewport, snapshot.length, factor, anchor)
        const delta = Math.round((base.x - p.x) / base.width * Math.max(0, viewportSpan(zoomed) - 1))
        pendingViewport = { i0: zoomed.i0 + delta, i1: zoomed.i1 + delta }
      }
      updateCursor(position().x)
    } else if (pointers.size === 0) updateCursor(x)
  })
  on('pointerup', event => {
    const e = event as PointerEvent
    if (!pointers.delete(e.pointerId)) return
    if (element.hasPointerCapture(e.pointerId)) element.releasePointerCapture(e.pointerId)
    rebase()
    if (pointers.size === 0 && e.pointerType !== 'mouse') updateCursor(null)
  })
  on('pointercancel', clear)
  on('lostpointercapture', event => { if (pointers.has((event as PointerEvent).pointerId)) clear() })
  on('pointerleave', () => { if (pointers.size === 0) updateCursor(null) })
  on('blur', clear)
  window.addEventListener('blur', clear, { signal: abort.signal })
  document.addEventListener('visibilitychange', () => { if (document.hidden) clear() }, { signal: abort.signal })
  on('wheel', event => {
    const e = event as WheelEvent, g = geometry()
    if (g === null || g.plotWidth <= 0) return
    e.preventDefault()
    flushViewport()
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? element.clientHeight : 1
    const delta = Math.max(-400, Math.min(400, e.deltaY * unit))
    const x = e.clientX - element.getBoundingClientRect().left
    view.zoom(Math.exp(-delta * 0.002), (x - g.left) / g.plotWidth)
    rebase(); updateCursor(x)
  }, false)
  on('keydown', event => {
    const e = event as KeyboardEvent
    if (e.altKey || e.ctrlKey || e.metaKey) return
    if (e.key === 'Escape') { clear(); e.preventDefault(); return }
    if (!['ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', '+', '=', '-', 'Home'].includes(e.key)) return
    flushViewport()
    const span = viewportSpan(view.getSnapshot().viewport)
    switch (e.key) {
      case 'ArrowLeft': view.pan(-10); break
      case 'ArrowRight': view.pan(10); break
      case 'PageUp': view.pan(-Math.round(span * 0.8)); break
      case 'PageDown': view.pan(Math.round(span * 0.8)); break
      case '+': case '=': view.zoom(1.5); break
      case '-': view.zoom(1 / 1.5); break
      case 'Home': view.followLatest(); break
      default: return
    }
    e.preventDefault(); rebase()
  }, false)
  return () => {
    abort.abort(); clear()
    if (cursorFrame !== 0) cancelAnimationFrame(cursorFrame)
    cursorFrame = 0; cursor(null)
  }
}
