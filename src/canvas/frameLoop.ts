/**
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at

 * http://www.apache.org/licenses/LICENSE-2.0

 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// One animation frame per chart for everything that paints.
//
// klinecharts 9 gives every canvas layer (each pane's candle/indicator layer,
// its drawings-and-crosshair layer, both axes) its own requestAnimationFrame.
// A layer's pixel-size change reaches it later, from a ResizeObserver, as a
// callback that must run in that layer's next repaint. Both hosted versions
// lose that callback when a repaint is already queued: 9.8.12 skips it
// (`_executeListener` returns early while a frame is pending), 9.7.2 cancels
// it when the next plain repaint comes in. The layer then keeps its old
// `_width` forever, every later `update()` takes the "size changed, wait for
// the observer" branch, the observer never fires again (the size is not
// changing any more), and the layer never repaints again: drawings stay where
// they were while the candles move on (seen in production 2026-09-28; the
// trigger is the price axis changing width mid-pan, e.g. at 100,000). A draw
// that throws has the same end on 9.8.12: the pending id is never cleared.
//
// So this module takes over the scheduling of a chart's own canvas layers
// (each klinecharts `Canvas` instance's `_executeListener`, feature-detected
// and patched per instance, never on klinecharts' prototype, so another chart
// on the page is untouched): a request queues its callback instead of
// dropping it, every dirty layer of the chart repaints in ONE frame callback,
// and a throwing layer is reported without freezing the others. The motion
// code (fling, eased zoom) runs through `clock`, whose frames run at the
// start of that same callback, BEFORE the layers repaint: a frame shows
// where the chart is, not where it was one step earlier.
//
// Part of SUPer-Chart (Apache-2.0).

import type { TweenClock } from '../motion/easing'

/** The fields of a klinecharts 9.7/9.8 `Canvas` instance this module relies on. */
export interface KlineCanvasLike {
  _executeListener: (fn?: () => void) => void
  _listener: () => void
  _ctx: { clearRect: (x: number, y: number, w: number, h: number) => void }
  _width: number
  _height: number
}

export interface FrameLoopEnv {
  raf: (cb: (t: number) => void) => number
  cancel: (handle: number) => void
  now: () => number
  /** Where a throwing layer or task is reported. @default reportError / console.error */
  onError: (e: unknown) => void
}

export interface FrameLoop {
  /** A TweenClock whose callbacks run at the start of the next frame, before any layer repaints. */
  readonly clock: TweenClock
  /** Takes over the scheduling of these canvases (klinecharts `Canvas` objects; anything else is ignored). Idempotent; returns how many were newly adopted. */
  adopt: (canvases: Iterable<unknown>) => number
  /** Queues a repaint of `canvas` (and `fn` to run before it, once). */
  request: (canvas: KlineCanvasLike, fn?: () => void) => void
  /** Frames painted so far (tests). */
  readonly frames: number
  dispose: () => void
}

export function isKlineCanvas (value: unknown): value is KlineCanvasLike {
  const c = value as Partial<KlineCanvasLike> | null
  return c !== null && typeof c === 'object' &&
    typeof c._executeListener === 'function' &&
    typeof c._listener === 'function' &&
    typeof c._ctx?.clearRect === 'function' &&
    typeof c._width === 'number' && typeof c._height === 'number'
}

function defaultEnv (): FrameLoopEnv {
  const g = globalThis as unknown as {
    requestAnimationFrame?: (cb: (t: number) => void) => number
    cancelAnimationFrame?: (h: number) => void
    reportError?: (e: unknown) => void
    performance?: { now: () => number }
  }
  return {
    raf: cb => (typeof g.requestAnimationFrame === 'function' ? g.requestAnimationFrame(cb) : (setTimeout(() => { cb(Date.now()) }, 16) as unknown as number)),
    cancel: h => { if (typeof g.cancelAnimationFrame === 'function') g.cancelAnimationFrame(h); else clearTimeout(h) },
    now: () => (g.performance !== undefined ? g.performance.now() : Date.now()),
    onError: e => {
      if (typeof g.reportError === 'function') g.reportError(e)
      else console.error(e)
    }
  }
}

const IN_FRAME = -2

export function createFrameLoop (envOverrides: Partial<FrameLoopEnv> = {}): FrameLoop {
  const env: FrameLoopEnv = { ...defaultEnv(), ...envOverrides }
  let handle: number | null = null
  let disposed = false
  let frames = 0

  // Layers waiting to repaint, in request order; callbacks to run first (a
  // pixel-ratio reset), kept per layer so none is ever dropped.
  const dirty = new Set<KlineCanvasLike>()
  const pre = new Map<KlineCanvasLike, Array<() => void>>()
  const adopted = new Set<KlineCanvasLike>()
  // A reusable snapshot of `dirty` for the paint pass: a layer that asks
  // again while painting goes to the NEXT frame, never loops in this one.
  const painting: KlineCanvasLike[] = []

  // Clock callbacks, double-buffered so a tween re-arming itself from inside
  // its own callback runs next frame (and nothing is allocated per frame).
  let taskIds: number[] = []
  let taskCbs: Array<((t: number) => void) | null> = []
  let runIds: number[] = []
  let runCbs: Array<((t: number) => void) | null> = []
  let nextId = 1
  let running = false

  const schedule = (): void => {
    if (handle === null && !disposed) {
      handle = env.raf(frame)
    }
  }

  const paint = (canvas: KlineCanvasLike): void => {
    try {
      canvas._ctx.clearRect(0, 0, canvas._width, canvas._height)
    } catch (e) {
      env.onError(e)
    }
    const fns = pre.get(canvas)
    if (fns !== undefined) {
      pre.delete(canvas)
      for (const fn of fns) {
        try { fn() } catch (e) { env.onError(e) }
      }
    }
    try {
      canvas._listener()
    } catch (e) {
      env.onError(e)
    }
  }

  function frame (): void {
    if (disposed) { handle = null; return }
    // While this frame runs, requests join it instead of arming another one.
    handle = IN_FRAME
    frames++
    const now = env.now()
    // 1) Motion first: whatever it moves is painted in this same frame.
    const ids = taskIds
    const cbs = taskCbs
    taskIds = runIds
    taskCbs = runCbs
    runIds = ids
    runCbs = cbs
    running = true
    for (let i = 0; i < cbs.length; i++) {
      const cb = cbs[i]
      if (cb === null) continue
      cbs[i] = null
      try { cb(now) } catch (e) { env.onError(e) }
    }
    running = false
    ids.length = 0
    cbs.length = 0
    // 2) Every dirty layer, once.
    painting.length = 0
    for (const c of dirty) painting.push(c)
    dirty.clear()
    // A layer that asks again while painting (or a tween that re-armed)
    // goes to the next frame.
    handle = null
    for (let i = 0; i < painting.length; i++) paint(painting[i])
    painting.length = 0
    if (dirty.size > 0 || taskIds.length > 0) schedule()
  }

  const request = (canvas: KlineCanvasLike, fn?: () => void): void => {
    if (disposed) return
    if (fn !== undefined) {
      const list = pre.get(canvas)
      if (list === undefined) pre.set(canvas, [fn])
      else list.push(fn)
    }
    dirty.add(canvas)
    schedule()
  }

  const clock: TweenClock = {
    now: () => env.now(),
    raf: cb => {
      const id = nextId++
      taskIds.push(id)
      taskCbs.push(cb)
      schedule()
      return id
    },
    cancel: id => {
      // Either queue: a tween stopped from inside another tween's callback
      // (the one currently running) must not run afterwards in this frame.
      let i = taskIds.indexOf(id)
      if (i >= 0) { taskCbs[i] = null; return }
      if (running) {
        i = runIds.indexOf(id)
        if (i >= 0) runCbs[i] = null
      }
    }
  }

  const adopt = (canvases: Iterable<unknown>): number => {
    if (disposed) return 0
    // Forget layers of panes that were removed since (their element left the
    // document), so a chart that adds and drops indicators does not keep them.
    for (const c of adopted) {
      const el = (c as unknown as { _element?: { isConnected?: boolean } })._element
      if (el?.isConnected === false) {
        adopted.delete(c)
        dirty.delete(c)
        pre.delete(c)
      }
    }
    let n = 0
    for (const value of canvases) {
      if (!isKlineCanvas(value) || adopted.has(value)) continue
      const canvas = value
      adopted.add(canvas)
      // An own property shadows klinecharts' prototype method for THIS
      // instance only; dispose() deletes it again.
      Object.defineProperty(canvas, '_executeListener', {
        configurable: true,
        writable: true,
        value: (fn?: () => void) => { request(canvas, fn) }
      })
      n++
    }
    return n
  }

  return {
    clock,
    adopt,
    request,
    get frames () { return frames },
    dispose: () => {
      if (disposed) return
      disposed = true
      if (handle !== null && handle !== IN_FRAME) env.cancel(handle)
      handle = null
      for (const c of adopted) {
        delete (c as unknown as Record<string, unknown>)._executeListener
      }
      adopted.clear()
      dirty.clear()
      pre.clear()
      taskIds.length = 0
      taskCbs.length = 0
    }
  }
}

/** The klinecharts objects `collectCanvases` walks (all private in 9.x, all feature-detected). */
interface WidgetLike { _mainCanvas?: unknown, _overlayCanvas?: unknown }
interface PaneLike { getMainWidget?: () => WidgetLike | null, getYAxisWidget?: () => WidgetLike | null }
interface ChartLike { getAllDrawPanes?: () => PaneLike[], getXAxisPane?: () => PaneLike | null }

/** Every canvas layer of a klinecharts 9 chart: each pane's main and y-axis widgets, and the x-axis pane. */
export function collectCanvases (chart: unknown): unknown[] {
  const c = chart as ChartLike | null
  const out: unknown[] = []
  const panes: PaneLike[] = []
  try {
    for (const p of c?.getAllDrawPanes?.() ?? []) panes.push(p)
    const x = c?.getXAxisPane?.()
    if (x !== null && x !== undefined && !panes.includes(x)) panes.push(x)
  } catch {
    return out
  }
  for (const pane of panes) {
    for (const widget of [pane.getMainWidget?.(), pane.getYAxisWidget?.()]) {
      if (widget === null || widget === undefined) continue
      out.push(widget._mainCanvas, widget._overlayCanvas)
    }
  }
  return out
}

/**
 * Installs a frame loop on a live klinecharts chart: adopts its layers now,
 * and again whenever a pane adds canvases to `root` (a new indicator pane,
 * a remount of an axis), so every layer the chart ever has is covered.
 * `onPanesAdded` runs after each such pass (Super Chart adopts the new
 * panes' axes for the sticky axis width there).
 */
export function attachFrameLoop (chart: unknown, root: HTMLElement | null | undefined, options: Partial<FrameLoopEnv> & { onPanesAdded?: () => void } = {}): FrameLoop {
  const { onPanesAdded, ...envOverrides } = options
  const loop = createFrameLoop(envOverrides)
  loop.adopt(collectCanvases(chart))
  let observer: MutationObserver | null = null
  if (root !== null && root !== undefined && typeof MutationObserver === 'function') {
    observer = new MutationObserver(records => {
      for (const r of records) {
        for (const node of r.addedNodes) {
          if (node.nodeName === 'CANVAS' || (node as Element).querySelector?.('canvas') != null) {
            loop.adopt(collectCanvases(chart))
            onPanesAdded?.()
            return
          }
        }
      }
    })
    observer.observe(root, { childList: true, subtree: true })
  }
  const dispose = loop.dispose
  return Object.assign(loop, {
    dispose: () => {
      observer?.disconnect()
      observer = null
      dispose()
    }
  })
}
