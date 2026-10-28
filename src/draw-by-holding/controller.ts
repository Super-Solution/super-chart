import { hasCommandModifier, isEscape } from '../common/keyDispatcher'
import { recognizeStroke, type DrawingCandidate, type Point } from './recognizer'
import { isHoldControlTarget } from './focus'

export interface HoldStatus {
  mode: 'idle' | 'pending' | 'drawing' | 'result'
  label: string
  alternatives: boolean
}

export interface HoldPointer {
  pointerId: number
  isPrimary: boolean
  button: number
  buttons: number
  clientX: number
  clientY: number
  shiftKey: boolean
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  target: EventTarget | null
  preventDefault: () => void
  stopPropagation: () => void
}

export interface HoldHost {
  paneAt: (x: number, y: number) => string | null
  blocked: () => boolean
  start: () => void
  finish: () => void
  preview: (points: readonly Point[], pane: string) => void
  clearPreview: () => void
  create: (candidate: DrawingCandidate, pane: string) => string | null
  replace: (id: string, candidate: DrawingCandidate, pane: string) => boolean
  remove: (id: string) => boolean
  exists: (id: string) => boolean
  erase: (points: readonly Point[], pane: string) => number
  status: (status: HoldStatus) => void
  /** Whether focus is on this plot, its root or the chart-owned default document focus. */
  keyTarget?: (target: EventTarget | null) => boolean
  candidates?: (candidates: readonly DrawingCandidate[], stroke: readonly Point[], pane: string) => DrawingCandidate[]
}

export interface HoldClock {
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (id: unknown) => void
}

const idle: HoldStatus = { mode: 'idle', label: '', alternatives: false }
const modified = (e: HoldPointer): boolean => e.shiftKey || e.altKey || e.ctrlKey || e.metaKey
const point = (e: HoldPointer): Point => ({ x: e.clientX, y: e.clientY })

/** Pointer state is separate from the DOM/editor adapter so timing and cancellation can be tested exactly. */
export function createHoldController (host: HoldHost, delayMs = 333, clock: HoldClock = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: id => { clearTimeout(id as ReturnType<typeof setTimeout>) }
}): {
    down: (e: HoldPointer) => void
    move: (e: HoldPointer) => void
    up: (e: HoldPointer) => void
    cancel: () => void
    cancelPointer: (e: Pick<HoldPointer, 'pointerId'>) => boolean
    leave: () => void
    key: (e: KeyboardEvent) => boolean
    active: () => boolean
    selection: (id: string | null) => void
    dispose: () => void
  } {
  let disposed = false
  let timer: unknown = null
  let pointer: number | null = null
  let pane: string | null = null
  let target: Element | null = null
  let armed = false
  let points: Point[] = []
  let latest: { id: string, pane: string, candidates: DrawingCandidate[], index: number } | null = null
  const delay = Number.isFinite(delayMs) ? Math.max(150, Math.min(2000, delayMs)) : 333
  const clearTimer = (): void => {
    if (timer !== null) clock.clearTimeout(timer)
    timer = null
  }
  const resetPointer = (): void => {
    clearTimer()
    const previousPointer = pointer
    pointer = null
    pane = null
    points = []
    if (armed) {
      armed = false
      host.clearPreview()
      host.finish()
    }
    if (previousPointer !== null) {
      try { target?.releasePointerCapture(previousPointer) } catch { /* already released */ }
    }
    target = null
  }
  const clearLatest = (): void => {
    latest = null
    host.status(idle)
  }
  const cancel = (): void => { resetPointer(); clearLatest() }
  const consume = (e: HoldPointer): void => { e.preventDefault(); e.stopPropagation() }
  const sample = (e: HoldPointer): void => {
    const p = point(e)
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return
    const last = points[points.length - 1]
    if (last !== undefined && Math.hypot(p.x - last.x, p.y - last.y) < 2) return
    // A long stroke remains bounded while preserving its most recent endpoint.
    if (points.length >= 2048) points = points.filter((_, i) => i % 2 === 0)
    points.push(p)
  }
  return {
    down (e) {
      if (disposed) return
      // A second finger cancels the hold and lets the chart's pinch handler take over.
      if (pointer !== null) { cancel(); return }
      clearLatest()
      if (!e.isPrimary || e.button !== 0 || modified(e) || host.blocked() || isHoldControlTarget(e.target)) return
      const at = host.paneAt(e.clientX, e.clientY)
      if (at === null || !Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) return
      pointer = e.pointerId
      pane = at
      points = [point(e)]
      target = e.target as Element | null
      host.status({ mode: 'pending', label: '', alternatives: false })
      // The original press is deliberately untouched: a quick drag still belongs to klinecharts.
      timer = clock.setTimeout(() => {
        timer = null
        if (disposed || pointer === null || pane === null) return
        if (host.blocked()) { cancel(); return }
        armed = true
        host.start()
        try { target?.setPointerCapture(pointer) } catch { /* unsupported capture */ }
        host.status({ mode: 'drawing', label: 'Draw one stroke', alternatives: false })
      }, delay)
    },
    move (e) {
      if (disposed || e.pointerId !== pointer || pane === null) return
      if (modified(e) || e.buttons === 0 || host.blocked()) { cancel(); return }
      if (!armed) {
        const origin = points[0]
        if (host.paneAt(e.clientX, e.clientY) !== pane || Math.abs(e.clientX - origin.x) + Math.abs(e.clientY - origin.y) >= 5) cancel()
        return
      }
      consume(e)
      sample(e)
      host.preview(points, pane)
    },
    up (e) {
      if (disposed || e.pointerId !== pointer || pane === null) return
      if (!armed) { resetPointer(); host.status(idle); return }
      consume(e)
      if (modified(e) || host.blocked()) { cancel(); return }
      sample(e)
      const stroke = points.slice()
      const strokePane = pane
      resetPointer()
      const recognition = recognizeStroke(stroke)
      if (recognition.scribble) {
        const count = host.erase(stroke, strokePane)
        if (count > 0) {
          host.status({ mode: 'result', label: `Removed ${count} drawing${count === 1 ? '' : 's'} · Undo to restore`, alternatives: false })
          return
        }
      }
      const candidates = host.candidates?.(recognition.candidates, stroke, strokePane) ?? recognition.candidates
      if (candidates.length === 0) { host.status(idle); return }
      const id = host.create(candidates[0], strokePane)
      if (id === null) { host.status(idle); return }
      latest = { id, pane: strokePane, candidates, index: 0 }
      host.status({ mode: 'result', label: candidates[0].label, alternatives: candidates.length > 1 })
    },
    cancel,
    cancelPointer (e) { if (e.pointerId !== pointer) return false; cancel(); return true },
    leave () { if (pointer !== null && !armed) cancel() },
    key (e) {
      if (disposed || e.isComposing || e.keyCode === 229) return false
      const target = e.composedPath?.()[0] ?? e.target
      // Focus moving into controls ends the short-lived candidate keys. Tab must
      // reach the button/menu/input, even if it lives inside this chart's root.
      if (isHoldControlTarget(target) || host.keyTarget?.(target) === false) { clearLatest(); return false }
      if (hasCommandModifier(e)) { cancel(); return false }
      if (isEscape(e) && pointer !== null) { e.preventDefault(); cancel(); return true }
      if (latest === null) return false
      if (!host.exists(latest.id)) { clearLatest(); return false }
      if (isEscape(e)) {
        if (!host.remove(latest.id)) { clearLatest(); return false }
        e.preventDefault()
        clearLatest()
        return true
      }
      if (e.key === 'Tab' && latest.candidates.length > 1) {
        const next = (latest.index + (e.shiftKey ? latest.candidates.length - 1 : 1)) % latest.candidates.length
        if (!host.replace(latest.id, latest.candidates[next], latest.pane)) { clearLatest(); return false }
        latest.index = next
        e.preventDefault()
        host.status({ mode: 'result', label: latest.candidates[next].label, alternatives: true })
        return true
      }
      // Undo/redo or another chart command ends the short-lived Tab/Escape affordance.
      if (e.key !== 'Shift') clearLatest()
      return false
    },
    active: () => armed,
    selection (id) { if (latest !== null && latest.id !== id) clearLatest() },
    dispose () { cancel(); disposed = true }
  }
}
