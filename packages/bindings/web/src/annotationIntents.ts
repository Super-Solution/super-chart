import type { EngineAnnotations } from './annotations'

/**
 * What the person asked for by dragging a `draggable` level. The chart never applies it: the host validates the
 * request (a trading system checks the order, the risk and the venue) and, if it accepts, calls `setAnnotations`
 * with the new price. Until then a ghost line shows where the drag is, and a refusal simply leaves the level put.
 */
export interface AnnotationIntentEvent {
  readonly phase: 'start' | 'move' | 'commit' | 'cancel'
  /** The annotation's stable id, and the layer and key the host wrote it under. */
  readonly id: string
  readonly layer: string
  readonly key: string
  /** Where the level was when the drag began. */
  readonly from: number
  /** Where the drag is now; on `commit`, where the person let go. On `cancel` it equals `from`. */
  readonly price: number
}

/** The pointer reach, in CSS pixels, within which a press picks up a level. Touch gets the wider reach. */
export const ANNOTATION_INTENT_REACH = Object.freeze({ mouse: 6, touch: 12 })

/**
 * Lets the person drag `draggable` levels and reports each step as intent.
 * `host` is the element that contains the chart (the workspace's chart host, or the element given to `EngineChart`):
 * the listener runs in its capture phase, so a press on a draggable level is this drag's before it is a pan or a
 * drawing. Returns a function that detaches everything.
 */
export function attachAnnotationIntents (host: HTMLElement, annotations: EngineAnnotations, onIntent: (event: AnnotationIntentEvent) => void): () => void {
  const doc = host.ownerDocument, win = doc.defaultView
  if (win === null) return () => {}
  const abort = new win.AbortController()
  let drag: { pointerId: number, id: string, layer: string, key: string, from: number, price: number, startY: number, moved: boolean } | null = null
  const consume = (event: Event): void => { event.preventDefault(); event.stopImmediatePropagation() }
  const editable = (target: EventTarget | null): boolean => target instanceof win.Element && target.closest('input,textarea,select,button,a,[contenteditable]:not([contenteditable="false"])') !== null
  const local = (event: PointerEvent): { x: number, y: number } => { const rect = host.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top } }
  const inside = (x: number): boolean => {
    const bounds = annotations.getSnapshot().bounds
    return bounds !== null && x >= bounds.left && x <= bounds.right
  }
  const emit = (phase: AnnotationIntentEvent['phase'], value: NonNullable<typeof drag>, price: number): void => {
    try { onIntent(Object.freeze({ phase, id: value.id, layer: value.layer, key: value.key, from: value.from, price })) } catch (error) { win.console.warn('Annotation intent listener failed', error) }
  }
  const end = (phase: 'commit' | 'cancel'): void => {
    const value = drag; drag = null
    if (value === null) return
    try { if (host.hasPointerCapture(value.pointerId)) host.releasePointerCapture(value.pointerId) } catch { /* already released */ }
    annotations.setGhost(null)
    host.style.cursor = ''
    // A press that never moved is a click on the line, not a request.
    emit(phase === 'commit' && value.moved ? 'commit' : 'cancel', value, phase === 'commit' && value.moved ? value.price : value.from)
  }
  const on = (type: string, listener: (event: PointerEvent) => void): void => { host.addEventListener(type, event => { listener(event as PointerEvent) }, { capture: true, passive: false, signal: abort.signal }) }
  on('pointerdown', event => {
    if (drag !== null || event.button !== 0 || editable(event.target)) return
    const p = local(event)
    if (!inside(p.x)) return
    const hit = annotations.hitTestDraggable(p.y, event.pointerType === 'touch' ? ANNOTATION_INTENT_REACH.touch : ANNOTATION_INTENT_REACH.mouse)
    if (hit === null) return
    consume(event)
    try { host.setPointerCapture(event.pointerId) } catch { return }
    drag = { pointerId: event.pointerId, id: hit.id, layer: hit.layer, key: hit.key, from: hit.price, price: hit.price, startY: p.y, moved: false }
    host.style.cursor = 'ns-resize'
    emit('start', drag, hit.price)
  })
  on('pointermove', event => {
    if (drag === null) {
      // Hover: show that the level can be picked up, without claiming the pointer.
      if (event.buttons === 0 && event.pointerType === 'mouse') {
        const p = local(event), over = inside(p.x) && annotations.hitTestDraggable(p.y, ANNOTATION_INTENT_REACH.mouse) !== null
        host.style.cursor = over ? 'ns-resize' : ''
      }
      return
    }
    if (event.pointerId !== drag.pointerId) return
    consume(event)
    const p = local(event), price = annotations.priceAt(p.y)
    if (price === null) return
    if (Math.abs(p.y - drag.startY) > 2) drag.moved = true
    if (!drag.moved) return
    drag.price = price
    annotations.setGhost(drag.id, price)
    emit('move', drag, price)
  })
  on('pointerup', event => { if (drag !== null && event.pointerId === drag.pointerId) { consume(event); end('commit') } })
  on('pointercancel', event => { if (drag !== null && event.pointerId === drag.pointerId) end('cancel') })
  on('lostpointercapture', event => { if (drag !== null && event.pointerId === drag.pointerId) end('cancel') })
  host.addEventListener('keydown', event => { if (drag !== null && event.key === 'Escape') { consume(event); end('cancel') } }, { capture: true, signal: abort.signal })
  win.addEventListener('blur', () => { end('cancel') }, { signal: abort.signal })
  return () => { abort.abort(); end('cancel'); host.style.cursor = '' }
}
