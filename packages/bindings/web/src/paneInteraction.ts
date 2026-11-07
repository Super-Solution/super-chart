import type { EngineFrame, EngineLayout } from '@supersolutions/super-chart-core'

/** Axis and pane gestures are independent from time navigation and drawing edits. */
export function attachPaneInteraction (
  element: HTMLElement,
  frame: () => EngineFrame | null,
  layout: () => EngineLayout,
  setLayout: (value: EngineLayout) => void,
  cancelNavigation: () => void
): () => void {
  const win = element.ownerDocument.defaultView
  if (win === null) return () => {}
  const abort = new win.AbortController(), originalCursor = element.style.cursor
  interface Drag { pointer: number, y: number, initial: EngineFrame, width: number, height: number, separator: number | null }
  let drag: Drag | null = null
  const point = (event: MouseEvent): { x: number, y: number } => {
    const rect = element.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }
  const area = (value: EngineFrame, x: number, y: number): number | null | undefined => {
    for (let i = 1; i < value.panes.length; i++) if (Math.abs(y - value.panes[i].top) <= 5) return i
    const g = value.model.geometry
    return x >= 0 && x < g.left && y >= g.top && y <= g.bottom ? null : undefined
  }
  const stop = (): void => {
    const previous = drag; drag = null; element.style.cursor = originalCursor
    if (previous !== null && element.hasPointerCapture(previous.pointer)) element.releasePointerCapture(previous.pointer)
  }
  const consume = (event: Event): void => { event.preventDefault(); event.stopImmediatePropagation() }
  element.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary || drag !== null) return
    const value = frame(), p = point(event)
    if (value === null || value.snapshot.length === 0) return
    const separator = area(value, p.x, p.y)
    if (separator === undefined) return
    consume(event); cancelNavigation()
    const rect = element.getBoundingClientRect()
    drag = { pointer: event.pointerId, y: p.y, initial: value, width: rect.width, height: rect.height, separator }
    element.setPointerCapture(event.pointerId); element.focus({ preventScroll: true })
  }, { signal: abort.signal, passive: false })
  element.addEventListener('pointermove', event => {
    const value = frame(), p = point(event)
    if (drag === null) {
      if (value !== null) element.style.cursor = area(value, p.x, p.y) === undefined ? originalCursor : 'ns-resize'
      return
    }
    if (event.pointerId !== drag.pointer) return
    consume(event)
    const rect = element.getBoundingClientRect(), initial = drag.initial
    if (value === null || rect.width !== drag.width || rect.height !== drag.height || value.snapshot.viewport !== initial.snapshot.viewport ||
      value.panes.map(pane => pane.id).join('\n') !== initial.panes.map(pane => pane.id).join('\n')) { stop(); return }
    if (drag.separator !== null) {
      const before = initial.panes[drag.separator - 1], after = initial.panes[drag.separator]
      const minimum = Math.min(48, drag.height / initial.panes.length)
      const delta = Math.max(minimum - before.height, Math.min(after.height - minimum, p.y - drag.y))
      const weights: Record<string, number> = Object.create(null)
      for (const pane of initial.panes) weights[pane.id] = Math.max(1e-9, pane.height + (pane === before ? delta : pane === after ? -delta : 0))
      setLayout({ paneWeights: weights })
    } else {
      const scale = initial.panes[0].scale, g = initial.model.geometry
      const factor = Math.exp(Math.max(-4, Math.min(4, (p.y - drag.y) / g.plotHeight * 2)))
      const a = scale.value(drag.y + (g.top - drag.y) * factor)
      const b = scale.value(drag.y + (g.bottom - drag.y) * factor)
      if (Number.isFinite(a) && Number.isFinite(b) && a !== b && (layout().priceScale?.mode !== 'log' || Math.min(a, b) > 0)) {
        setLayout({ priceScale: { ...layout().priceScale, range: [Math.min(a, b), Math.max(a, b)] } })
      }
    }
  }, { signal: abort.signal, passive: false })
  element.addEventListener('pointerup', event => { if (event.pointerId === drag?.pointer) { consume(event); stop() } }, { signal: abort.signal })
  element.addEventListener('pointercancel', stop, { signal: abort.signal })
  element.addEventListener('lostpointercapture', event => { if (event.pointerId === drag?.pointer) stop() }, { signal: abort.signal })
  element.addEventListener('dblclick', event => {
    const value = frame(), p = point(event)
    if (value === null) return
    const separator = area(value, p.x, p.y)
    if (separator === undefined) return
    consume(event); stop(); cancelNavigation()
    setLayout(separator === null ? { priceScale: { ...layout().priceScale, range: undefined } } : { paneWeights: undefined })
  }, { signal: abort.signal })
  element.addEventListener('keydown', event => { if (event.key === 'Escape' && drag !== null) { consume(event); stop() } }, { signal: abort.signal })
  element.addEventListener('blur', stop, { signal: abort.signal })
  win.addEventListener('blur', stop, { signal: abort.signal })
  element.ownerDocument.addEventListener('visibilitychange', () => { if (element.ownerDocument.hidden) stop() }, { signal: abort.signal })
  return () => { abort.abort(); stop() }
}
