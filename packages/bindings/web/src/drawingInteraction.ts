import { type DrawingStore, drawingAnchorCount, drawingUsesText, type EngineFrame, type Drawing, type DrawingAnchor, type DrawingPoint, type DrawingType } from '@supersolutions/super-chart-core'
import { attachFreehandDrawingInput } from './freehandDrawing'
import { createDrawingImage, DrawingImageRenderer } from './drawingMedia'
import { snapToBar } from './magnet'
import { attachHoldDraw, type HoldDrawEvent, type ResolvedHoldDraw } from './holdDraw'

/** How a tool ended: a drawing was placed (`completed`), or the person backed out (`cancelled`: Escape, leaving a text editor). */
export type ToolEnd = 'completed' | 'cancelled'

interface Drag {
  pointerId: number
  start: DrawingPoint
  original: Drawing | null
  preview: Drawing
  projected: readonly DrawingPoint[]
  anchorIndex: number | null
  moved: boolean
}

let nextId = 0

/** Drawing edits are user transactions: previews never enter retained state or undo history. */
export function attachDrawingInteraction (
  element: HTMLElement,
  store: DrawingStore,
  getFrame: () => EngineFrame | null,
  onPreview: (drawing: Drawing | null) => void,
  onToolComplete?: (reason: ToolEnd) => void,
  onInteractionStart?: () => void,
  imageRenderer?: DrawingImageRenderer,
  hold?: { options: () => ResolvedHoldDraw | null, onEvent: (event: HoldDrawEvent) => void },
  behavior?: { magnet: () => boolean }
): { setTool: (tool: DrawingType | null) => void, dispose: () => void } {
  const doc = element.ownerDocument, win = doc.defaultView
  if (win === null) return { setTool: () => {}, dispose: () => {} }
  const abort = new win.AbortController()
  let tool: DrawingType | null = null
  let drag: Drag | null = null
  let placement: { preview: Drawing, nextAnchor: number } | null = null
  let editor: { input: HTMLTextAreaElement, original: Drawing | null, close: () => void } | null = null
  let media: { abort: AbortController, input: HTMLInputElement } | null = null
  let disposed = false

  const editable = (target: EventTarget | null): boolean => target instanceof win.Element &&
    target.closest('input,textarea,select,button,a,[contenteditable]:not([contenteditable="false"])') !== null
  const consume = (event: Event): void => { event.preventDefault(); event.stopImmediatePropagation() }
  const point = (event: PointerEvent): DrawingPoint => {
    const rect = element.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }
  const frame = (): EngineFrame | null => {
    const value = getFrame(), g = value?.model.geometry, rect = element.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0 && value !== null && value.snapshot.length > 0 && g !== undefined &&
      [g.left, g.right, g.top, g.bottom].every(Number.isFinite) && g.left < g.right && g.top < g.bottom ? value : null
  }
  const anchor = (value: DrawingAnchor | null): value is DrawingAnchor => value !== null &&
    Number.isFinite(value.timestamp) && Math.abs(value.timestamp) <= 8.64e15 && Number.isFinite(value.price)
  const release = (id: number): void => { if (element.hasPointerCapture(id)) element.releasePointerCapture(id) }
  const cancel = (): void => {
    const previous = drag
    drag = null; placement = null
    if (previous !== null) release(previous.pointerId)
    editor?.close()
    if (media !== null) { media.abort.abort(); media.input.remove(); media = null }
    onPreview(null)
  }
  const finishTool = (reason: ToolEnd = 'cancelled'): void => {
    if (tool === null) return
    tool = null; onToolComplete?.(reason)
  }
  /** The anchor under the pointer; with the magnet on, the open, high, low or close of a bar within reach of it. */
  const anchorAt = (current: EngineFrame, p: DrawingPoint): DrawingAnchor | null => {
    const next = current.unproject(p.x, p.y)
    return next !== null && behavior?.magnet() === true ? snapToBar(current, p, next) : next
  }
  let freehandTool = false
  const freehand = attachFreehandDrawingInput(element, store, getFrame, onPreview, onToolComplete, onInteractionStart)
  const current = (value: Drag): boolean => value.original === null ||
    store.getSnapshot().drawings.find(item => item.id === value.original?.id) === value.original
  const setPlacementAnchor = (preview: Drawing, index: number, next: DrawingAnchor): Drawing => ({
    ...preview,
    anchors: preview.anchors.map((item, i) => i >= index ? next : item)
  })
  const editText = (preview: Drawing, original: Drawing | null): void => {
    editor?.close()
    const currentFrame = frame(), first = preview.anchors[preview.type === 'callout' ? 1 : 0]
    const position = currentFrame?.project(first.timestamp, first.price)
    if (position === undefined || position === null) { onPreview(null); finishTool(); return }
    const input = doc.createElement('textarea')
    input.setAttribute('aria-label', 'Drawing text'); input.placeholder = 'Label (Enter saves, Shift+Enter adds a line)'
    input.maxLength = 512; input.rows = 3; input.value = preview.text ?? ''
    const width = Math.min(260, element.clientWidth), height = Math.min(100, element.clientHeight)
    input.style.cssText = `position:absolute;z-index:4;box-sizing:border-box;resize:none;width:${width}px;height:${height}px;left:${Math.max(0, Math.min(position.x, element.clientWidth - width))}px;top:${Math.max(0, Math.min(position.y, element.clientHeight - height))}px;padding:6px;background:#10151d;color:#eee;border:1px solid #8bafff;font:12px system-ui;`
    let closed = false
    const close = (): void => {
      if (closed) return
      closed = true; if (editor?.input === input) editor = null
      input.remove(); onPreview(null)
    }
    const commit = (): void => {
      if (closed) return
      if (original !== null && store.getSnapshot().drawings.find(item => item.id === original.id) !== original) { close(); return }
      try {
        const content = input.value
        // Store validation owns length, line count and control-character rules.
        if (original === null) { store.add({ ...preview, text: content }); store.select(preview.id) }
        else store.update(original.id, { text: content })
      } catch (error) {
        input.setCustomValidity(error instanceof Error ? error.message : 'Invalid drawing text'); input.reportValidity(); return
      }
      close(); finishTool('completed'); element.focus({ preventScroll: true })
    }
    editor = { input, original, close }; element.append(input)
    input.addEventListener('input', () => { input.setCustomValidity(''); onPreview({ ...preview, text: input.value }) })
    input.addEventListener('keydown', event => {
      event.stopPropagation()
      if (event.key === 'Escape') { event.preventDefault(); close(); finishTool(); element.focus({ preventScroll: true }) }
      else if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); commit() }
    })
    // Leaving an editor cancels rather than silently saving a partial annotation.
    input.addEventListener('blur', () => { close(); finishTool() })
    onPreview(preview); input.focus(); input.select()
  }
  const insertImage = (preview: Drawing): void => {
    const input = doc.createElement('input'), controller = new win.AbortController()
    input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp'; input.hidden = true
    media = { abort: controller, input }; element.append(input)
    const finish = (): void => {
      input.remove()
      if (media?.abort === controller) { media = null; onPreview(null); finishTool() }
    }
    input.addEventListener('cancel', finish, { once: true })
    input.addEventListener('change', () => {
      const file = input.files?.[0]
      if (file === undefined) { finish(); return }
      const decoder = imageRenderer ?? new DrawingImageRenderer(async blob => await win.createImageBitmap(blob))
      let source: string | undefined
      void (async () => {
        try {
          const image = await createDrawingImage(file, controller.signal)
          source = image
          await decoder.prepare(image)
          if (disposed || controller.signal.aborted || media?.abort !== controller) return
          store.add({ ...preview, image }); store.select(preview.id)
        } catch (error) {
          if (!controller.signal.aborted) {
            console.warn('[super-chart] Image drawing was not saved', error)
            element.dispatchEvent(new win.CustomEvent('drawingerror', { bubbles: true, detail: error }))
          }
        } finally {
          if (imageRenderer === undefined) decoder.dispose()
          else if (source !== undefined && !store.getSnapshot().drawings.some(item => item.image === source)) decoder.release(source)
          finish()
        }
      })()
    }, { once: true })
    input.click()
  }
  const completeWave = (): void => {
    if (placement?.preview.type !== 'any-waves') return
    const value = placement.preview, committed = value.anchors.slice(0, placement.nextAnchor).filter((point, i, all) => i === 0 || point.timestamp !== all[i - 1].timestamp || point.price !== all[i - 1].price)
    if (committed.length < 2) return
    placement = null
    store.add({ ...value, anchors: committed }); store.select(value.id); onPreview(null); finishTool('completed')
  }
  const updatePreview = (event: PointerEvent): boolean => {
    const value = drag, currentFrame = frame()
    if (value === null) return false
    if (value.preview.locked) return true
    if (currentFrame === null) { cancel(); return false }
    if (!current(value)) { cancel(); return false }
    const p = point(event), dx = p.x - value.start.x, dy = p.y - value.start.y
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return false
    if (Math.hypot(dx, dy) > 2) value.moved = true
    if (value.original !== null && !value.moved) return true
    let anchors: readonly DrawingAnchor[]
    if (value.original === null) {
      const next = anchorAt(currentFrame, p)
      if (!anchor(next)) return false
      anchors = drawingAnchorCount(value.preview.type) === 1
        ? [next] : setPlacementAnchor(value.preview, value.anchorIndex ?? 1, next).anchors
    } else if (value.anchorIndex !== null) {
      const next = anchorAt(currentFrame, p)
      if (!anchor(next)) return false
      anchors = value.original.anchors.map((item, i) => i === value.anchorIndex ? next : item)
    } else {
      const moved: DrawingAnchor[] = []
      // Keep the grabbed pixels fixed when live prices change the scale during a drag.
      for (const projected of value.projected) {
        const x = projected.x + dx, y = projected.y + dy
        const next = currentFrame.unproject(x, y)
        if (!anchor(next)) return false
        const checked = currentFrame.project(next.timestamp, next.price)
        // A clamped timestamp must not collapse a two-anchor shape at the history boundary.
        if (checked === null || Math.abs(checked.x - x) > 0.5 || Math.abs(checked.y - y) > 0.5) return false
        moved.push(next)
      }
      anchors = moved
    }
    value.preview = { ...value.preview, anchors }
    onPreview(value.preview)
    return true
  }
  const on = (type: string, listener: EventListener): void => {
    element.addEventListener(type, listener, { capture: true, passive: false, signal: abort.signal })
  }

  on('pointerdown', event => {
    const e = event as PointerEvent
    if (editor !== null && editable(e.target)) return
    if (media !== null) { consume(e); return }
    if (drag !== null) { consume(e); return }
    if (e.button !== 0 || editable(e.target)) return
    if (tool !== null) { consume(e); onInteractionStart?.() }
    const currentFrame = frame()
    if (currentFrame === null) return
    const p = point(e), g = currentFrame.model.geometry
    const inside = p.x >= g.left && p.x <= g.right && p.y >= g.top && p.y <= g.bottom
    if (tool !== null) {
      if (!inside) return
      const first = anchorAt(currentFrame, p)
      if (!anchor(first)) return
      let preview: Drawing, nextAnchor: number | null = null
      if (placement !== null) {
        nextAnchor = placement.nextAnchor
        preview = setPlacementAnchor(placement.preview, nextAnchor, first); placement = null
      } else {
        let id: string
        do { id = `drawing-${Date.now().toString(36)}-${(++nextId).toString(36)}` } while (store.getSnapshot().drawings.some(item => item.id === id))
        preview = { id, type: tool, anchors: Array.from({ length: drawingAnchorCount(tool) }, () => first), locked: false, hidden: false }
      }
      drag = { pointerId: e.pointerId, start: p, original: null, preview, projected: [], anchorIndex: nextAnchor, moved: false }
      onPreview(preview)
    } else {
      const hit = inside ? store.hitTest(p, currentFrame.project, g, e.pointerType === 'touch' ? 10 : 6, currentFrame.drawingContext) : null
      if (hit === null) { store.select(null); return }
      const original = store.getSnapshot().drawings.find(item => item.id === hit.id)
      if (original === undefined) return
      store.select(hit.id)
      // Locked drawings remain selectable without stealing pan/pinch from the chart.
      if (original.locked) return
      consume(e); onInteractionStart?.()
      const projected: DrawingPoint[] = []
      for (const item of original.anchors) {
        const position = currentFrame.project(item.timestamp, item.price)
        if (position === null || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return
        projected.push({ ...position })
      }
      drag = { pointerId: e.pointerId, start: p, original, preview: original, projected, anchorIndex: hit.anchorIndex, moved: false }
    }
    try { element.setPointerCapture(e.pointerId) } catch { cancel(); return }
    element.focus({ preventScroll: true })
  })
  on('pointermove', event => {
    const e = event as PointerEvent
    if (drag === null) {
      if (placement === null || editable(e.target)) return
      const p = point(e), currentFrame = frame(), next = currentFrame === null ? null : anchorAt(currentFrame, p)
      if (next !== null && anchor(next)) { placement.preview = setPlacementAnchor(placement.preview, placement.nextAnchor, next); onPreview(placement.preview) }
      consume(e); return
    }
    consume(e)
    if (e.pointerId === drag.pointerId) updatePreview(e)
  })
  on('pointerup', event => {
    if (drag === null) return
    const e = event as PointerEvent
    consume(e)
    if (e.pointerId !== drag.pointerId) return
    if (!updatePreview(e)) { cancel(); return }
    const value = drag
    if (value === null) return
    drag = null; release(value.pointerId)
    if (value.original === null && value.preview.type === 'any-waves') {
      const nextAnchor = value.anchorIndex === null ? value.moved ? 2 : 1 : value.anchorIndex + 1
      if (nextAnchor >= 256) {
        store.add(value.preview); store.select(value.preview.id); onPreview(null); finishTool('completed'); return
      }
      const anchors = value.preview.anchors.slice(0, nextAnchor)
      anchors.push(anchors[anchors.length - 1])
      placement = { preview: { ...value.preview, anchors }, nextAnchor }; onPreview(placement.preview); return
    }
    const count = drawingAnchorCount(value.preview.type)
    if (value.original === null && count > 2 && value.anchorIndex !== count - 1) {
      placement = { preview: value.preview, nextAnchor: value.anchorIndex === null ? value.moved ? 2 : 1 : value.anchorIndex + 1 }
      onPreview(value.preview); return
    }
    if (value.original === null && drawingUsesText(value.preview.type)) { editText(value.preview, null); return }
    if (value.original === null && value.preview.type === 'image') { if (value.moved) insertImage(value.preview); else onPreview(null); return }
    try {
      if (value.original === null) {
        if (!value.moved && drawingAnchorCount(value.preview.type) === 2) return
        store.add(value.preview); store.select(value.preview.id); finishTool('completed')
      } else if (value.moved && !value.original.locked && current(value)) store.update(value.original.id, { anchors: value.preview.anchors })
    } finally { onPreview(null) }
  })
  on('dblclick', event => {
    if (placement?.preview.type === 'any-waves') { consume(event); completeWave(); return }
    if (tool !== null || drag !== null || placement !== null || editable(event.target)) return
    const currentFrame = frame()
    if (currentFrame === null) return
    const p = point(event as PointerEvent), hit = store.hitTest(p, currentFrame.project, currentFrame.model.geometry, 6, currentFrame.drawingContext)
    const original = store.getSnapshot().drawings.find(item => item.id === hit?.id)
    if (original === undefined || !drawingUsesText(original.type) || original.locked) return
    consume(event); store.select(original.id); onInteractionStart?.(); editText(original, original)
  })
  on('pointercancel', event => {
    if (drag !== null && (event as PointerEvent).pointerId === drag.pointerId) { consume(event); cancel() }
  })
  on('lostpointercapture', event => {
    if (drag !== null && (event as PointerEvent).pointerId === drag.pointerId) cancel()
  })
  on('blur', event => {
    if (media !== null) return
    const next = (event as FocusEvent).relatedTarget
    if (!(next instanceof win.Node) || !element.contains(next)) cancel()
  })
  win.addEventListener('blur', () => { if (media === null) cancel() }, { signal: abort.signal })
  doc.addEventListener('visibilitychange', () => { if (doc.hidden && media === null) cancel() }, { signal: abort.signal })
  on('keydown', event => {
    const e = event as KeyboardEvent, active = doc.activeElement
    if (editable(e.target) || e.isComposing || active === null || !element.contains(active)) return
    if (e.key === 'Enter' && placement?.preview.type === 'any-waves') { consume(e); completeWave(); return }
    if (e.key === 'Escape' && (drag !== null || placement !== null || tool !== null)) { consume(e); cancel(); finishTool(); return }
    const snapshot = store.getSnapshot(), modified = e.ctrlKey || e.metaKey
    if (modified && !e.altKey) {
      const key = e.key.toLowerCase(), redo = (key === 'z' && e.shiftKey) || (key === 'y' && !e.shiftKey)
      const undo = key === 'z' && !e.shiftKey
      if ((redo && snapshot.canRedo) || (undo && snapshot.canUndo)) {
        consume(e); cancel(); freehand.setTool(null); if (redo) store.redo(); else store.undo()
      }
    } else if (!e.altKey && !e.shiftKey && (e.key === 'Delete' || e.key === 'Backspace')) {
      const selected = snapshot.drawings.find(item => item.id === snapshot.selectedId)
      if (selected !== undefined && !selected.locked) { consume(e); cancel(); store.remove(selected.id) }
    }
  })
  const unsubscribe = store.subscribe(() => {
    if (drag !== null && !current(drag)) cancel()
    if (editor?.original !== null && editor?.original !== undefined && store.getSnapshot().drawings.find(item => item.id === editor?.original?.id) !== editor.original) editor.close()
  })
  // Registered after the pointer handlers above, so a press on one of the person's drawings is theirs first.
  const holdDraw = hold === undefined ? null : attachHoldDraw(element, store, getFrame, {
    options: hold.options,
    onEvent: hold.onEvent,
    onPreview,
    onInteractionStart: () => { onInteractionStart?.() },
    canStart: () => tool === null && !freehandTool && drag === null && placement === null && editor === null && media === null
  })
  return {
    setTool: next => {
      if (disposed) return
      cancel(); holdDraw?.cancel(); freehandTool = next === 'brush' || next === 'highlighter'; freehand.setTool(next === 'brush' || next === 'highlighter' ? next : null)
      tool = next === 'brush' || next === 'highlighter' ? null : next
    },
    dispose: () => {
      if (disposed) return
      disposed = true; abort.abort(); unsubscribe(); cancel(); freehand.dispose(); holdDraw?.dispose(); tool = null
    }
  }
}
