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

// The programmatic drawings API (SC-127): create/update a user (rail-tracked,
// editable) drawing from plain JSON — time/price points instead of the
// drawing bar's click-to-place gesture — plus a price-alert primitive over
// user drawings (SC-180). Never touches a host's own getChart().createOverlay
// layer: everything here is built on the SAME `DrawingEditor.prepareNew`/
// `track` path the drawing bar itself uses (src/drawing-editor/controller.ts,
// owned by an earlier batch — this module only calls its already-public
// methods, never edits it), so a drawing made this way is exactly as
// editable, undo-able and rail-manageable as one drawn by hand.
//
// Part of SUPer-Chart (Apache-2.0).

import type { OverlayCreate, OverlayMode } from 'klinecharts'

import type { DrawingToolCatalogEntry } from '../indicators/catalog'
import type { Period } from '../types'
import { completeDrawing } from '../drawing-editor/compat'
import { timeToPoint, pointToTime, type TimelineBar } from './anchors'

// ---- shapes ------------------------------------------------------------------

/** A JSON-safe point: `price` is optional for tools that only need a time (a vertical line). */
export interface DrawingTimePoint {
  time: number
  price?: number
}

export interface AddDrawingSpec {
  /** A name from listDrawingTools(). */
  tool: string
  points: DrawingTimePoint[]
  styles?: Record<string, unknown>
  /** For a text/note/callout/signpost/image tool: never a window.prompt — the label/URL is given directly (SC-093 stays true for API callers too). */
  text?: string
  /** @default the drawing rail's current lock state */
  locked?: boolean
  /** Select it once placed, opening the floating toolbar as a hand-drawn one would. @default false */
  select?: boolean
}

export interface UpdateDrawingChanges {
  points?: DrawingTimePoint[]
  styles?: Record<string, unknown>
  text?: string
  locked?: boolean
  visible?: boolean
}

// ---- pane/tool interfaces (a minimal Pick of the klinecharts Chart methods used here) --------

export interface DrawingsRawChart {
  createOverlay: (create: unknown, paneId?: string) => unknown
  overrideOverlay: (create: Record<string, unknown>) => boolean
  getOverlayById: (id: string) => DrawingOverlayLike | null
  getDataList: () => readonly TimelineBar[]
  convertToPixel: (points: unknown, options: { paneId: string }) => unknown
  convertFromPixel: (points: unknown, options: { paneId: string }) => unknown
}

export interface DrawingOverlayLike {
  id: string
  name: string
  points: ReadonlyArray<{ timestamp?: number, dataIndex?: number, value?: number }>
  currentStep?: number
  lock?: boolean
  visible?: boolean
  extendData?: unknown
}

export interface DrawingsEditorLike {
  prepareNew: (create: OverlayCreate) => OverlayCreate
  track: (id: unknown) => void
  isUserDrawing: (id: string | null | undefined) => boolean
  selectPlaced: (id: string, paneId: string) => void
}

export interface DrawingsApiDeps {
  getChart: () => DrawingsRawChart | null
  editor: DrawingsEditorLike
  getDrawingBarLock: () => boolean
  getDrawingBarMode: () => OverlayMode
  getPeriod: () => Period
  getDrawingToolCatalog: () => readonly DrawingToolCatalogEntry[]
  /** Called after a successful add/update, so the host's onDrawingsChange/object-tree stay in sync. */
  notifyChange: () => void
  /** Emits SuperChartEventMap's 'drawingCreate'/'drawingChange' (best-effort; never required for correctness). */
  emitCreate?: (id: string, name: string) => void
  emitChange?: (id: string) => void
}

export interface DrawingsApi {
  listDrawingTools: () => string[]
  addDrawing: (spec: AddDrawingSpec) => string | null
  updateDrawing: (id: string, changes: UpdateDrawingChanges) => boolean
  drawingLevelsAt: (id: string, timestamp: number) => DrawingLevel[] | null
}

// ---- tool catalogue -----------------------------------------------------------

export function listDrawingToolsFrom (catalog: readonly DrawingToolCatalogEntry[]): string[] {
  return catalog.map(e => e.name)
}

// ---- add / update -------------------------------------------------------------

function toOverlayPoints (points: readonly DrawingTimePoint[], dataList: readonly TimelineBar[], period: Period): Array<Record<string, number>> {
  return points.map(p => {
    const anchor = timeToPoint(p.time, dataList, period)
    return typeof p.price === 'number' && Number.isFinite(p.price) ? { ...anchor, value: p.price } : { ...anchor }
  })
}

const isComplete = (o: Pick<DrawingOverlayLike, 'currentStep'> | null | undefined): boolean => o?.currentStep === -1

/**
 * Create a factory bound to one chart instance. `deps` are small closures
 * over ChartProComponent's own local state (the widget, the drawing editor,
 * the rail's lifted lock/mode signals) — this module never reaches into
 * Solid signals or the DOM itself, so it stays plain and unit-testable
 * against a fake chart (see drawings.test.ts).
 */
export function createDrawingsApi (deps: DrawingsApiDeps): DrawingsApi {
  const listDrawingTools = (): string[] => listDrawingToolsFrom(deps.getDrawingToolCatalog())

  const addDrawing = (spec: AddDrawingSpec): string | null => {
    const chart = deps.getChart()
    if (chart === null) {
      return null
    }
    if (typeof spec.tool !== 'string' || spec.tool.length === 0) {
      console.warn('[super-chart] addDrawing needs a tool name. Ignored.')
      return null
    }
    if (!listDrawingTools().includes(spec.tool)) {
      console.warn(`[super-chart] addDrawing: unknown tool ${JSON.stringify(spec.tool)}. Ignored.`)
      return null
    }
    if (!Array.isArray(spec.points) || spec.points.length === 0) {
      console.warn('[super-chart] addDrawing needs at least one point. Ignored.')
      return null
    }
    const dataList = chart.getDataList()
    const points = toOverlayPoints(spec.points, dataList, deps.getPeriod())
    const create = {
      name: spec.tool,
      points,
      visible: true,
      lock: spec.locked ?? deps.getDrawingBarLock(),
      mode: deps.getDrawingBarMode(),
      ...(spec.styles !== undefined ? { styles: spec.styles } : {}),
      ...(typeof spec.text === 'string' ? { extendData: spec.text } : {})
    } as unknown as OverlayCreate
    const created = chart.createOverlay(deps.editor.prepareNew(create))
    const id = Array.isArray(created) ? created[0] : created
    if (typeof id !== 'string' || id.length === 0) {
      return null
    }
    deps.editor.track(id)
    const overlay = chart.getOverlayById(id)
    if (overlay !== null && !isComplete(overlay)) {
      // Fewer points than the tool needs (a partial multi-step tool, e.g. Any
      // Waves): klinecharts keeps it "in progress" and would swallow the next
      // click on the chart. Finish it the way a double-click would (the same
      // helper clone()/restore() use); if this klinecharts version cannot
      // (completeDrawing returns false), remove the half-made drawing rather
      // than leave a ghost armed on the pane.
      if (!completeDrawing(chart, overlay)) {
        chart.overrideOverlay({ id, visible: false })
      }
    }
    if (spec.select === true) {
      deps.editor.selectPlaced(id, 'candle_pane')
    }
    deps.emitCreate?.(id, spec.tool)
    deps.notifyChange()
    return id
  }

  const updateDrawing = (id: string, changes: UpdateDrawingChanges): boolean => {
    if (!deps.editor.isUserDrawing(id)) {
      return false
    }
    const chart = deps.getChart()
    if (chart === null) {
      return false
    }
    const patch: Record<string, unknown> = { id }
    let touched = false
    if (changes.points !== undefined) {
      patch.points = toOverlayPoints(changes.points, chart.getDataList(), deps.getPeriod())
      touched = true
    }
    if (changes.styles !== undefined) {
      patch.styles = changes.styles
      touched = true
    }
    if (typeof changes.text === 'string') {
      patch.extendData = changes.text
      touched = true
    }
    if (typeof changes.locked === 'boolean') {
      patch.lock = changes.locked
      touched = true
    }
    if (typeof changes.visible === 'boolean') {
      patch.visible = changes.visible
      touched = true
    }
    if (!touched) {
      return true
    }
    const ok = chart.overrideOverlay(patch)
    if (ok) {
      deps.emitChange?.(id)
      deps.notifyChange()
    }
    return ok
  }

  return { listDrawingTools, addDrawing, updateDrawing, drawingLevelsAt: (id, ts) => drawingLevelsAt(deps.getChart(), id, ts, deps.getPeriod()) }
}

// ---- price levels at a timestamp (SC-180) -------------------------------------

export interface DrawingLevel {
  key: string
  price: number
}

/** Tools with a single price and no x-dependence (a horizontal line). */
const HORIZONTAL_TOOLS = new Set(['horizontalStraightLine', 'horizontalRayLine', 'priceLine'])
/** Tools with no price meaning at all. */
const NO_PRICE_TOOLS = new Set([
  'verticalStraightLine', 'text', 'note', 'callout', 'signpost', 'image', 'brush', 'highlighter',
  'simpleTag', 'simpleAnnotation'
])

function toPixelPoint (p: unknown): { x: number, y: number } | null {
  const v = Array.isArray(p) ? p[0] : p
  const x = (v as { x?: unknown })?.x
  const y = (v as { y?: unknown })?.y
  return typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
}

/** Only the x pixel: the query point has no price, so its own y (if a chart even bothers to compute one for a valueless point) is not what this reads — the y at that x is INTERPOLATED from the two anchor points instead. */
function toPixelX (p: unknown): number | null {
  const v = Array.isArray(p) ? p[0] : p
  const x = (v as { x?: unknown })?.x
  return typeof x === 'number' && Number.isFinite(x) ? x : null
}

function toPriceValue (p: unknown): number | null {
  const v = Array.isArray(p) ? p[0] : p
  const value = (v as { value?: unknown })?.value
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * The price level(s) a user drawing sits at at `timestamp`, in the pane's own
 * coordinate space — geometric on a log axis, matching what is drawn, because
 * the interpolation happens in PIXEL space via convertToPixel/convertFromPixel
 * rather than in price space. Null for a tool with no price meaning, or a
 * segment/ray outside its span.
 *
 * Tool coverage is intentionally not exhaustive: every 2-point line-like tool
 * (segment, straight/ray lines, a channel's base line, …) gets a correct
 * sloped-line level from its first two points; a 1-point horizontal line gets
 * a constant level; a rect gets its top/bottom edges. Tools with additional,
 * ratio-based levels (fibonacci retracements, a channel's offset line) are not
 * decomposed per-ratio here — out of scope for this batch's time budget, noted
 * in the PR body — and fall back to the same first-two-point line, labelled
 * 'line'.
 */
export function drawingLevelsAt (
  chart: DrawingsRawChart | null,
  id: string,
  timestamp: number,
  period?: Period | null
): DrawingLevel[] | null {
  if (chart === null) {
    return null
  }
  const overlay = chart.getOverlayById(id)
  if (overlay === null || NO_PRICE_TOOLS.has(overlay.name)) {
    return null
  }
  const points = overlay.points
  if (points.length === 0) {
    return null
  }
  if (points.length === 1 || HORIZONTAL_TOOLS.has(overlay.name)) {
    const v = points[0]?.value
    return typeof v === 'number' && Number.isFinite(v) ? [{ key: 'line', price: v }] : null
  }
  const paneId = 'candle_pane'
  if (overlay.name === 'rect' || overlay.name === 'rectangle' || overlay.name === 'parallelogram') {
    const values = points.map(p => p.value).filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    if (values.length < 2) {
      return null
    }
    return [{ key: 'top', price: Math.max(...values) }, { key: 'bottom', price: Math.min(...values) }]
  }
  const p0 = points[0]
  const p1 = points[1]
  if (p0 === undefined || p1 === undefined) {
    return null
  }
  const dataList = chart.getDataList()
  const query = timeToPoint(timestamp, dataList, period)
  try {
    const pixels = chart.convertToPixel([p0, p1, query], { paneId })
    const arr = Array.isArray(pixels) ? pixels : [pixels]
    const a = toPixelPoint(arr[0])
    const b = toPixelPoint(arr[1])
    const qx = toPixelX(arr[2])
    if (a === null || b === null || qx === null || a.x === b.x) {
      return null
    }
    const lower = overlay.name.toLowerCase()
    if (lower.includes('ray')) {
      // A ray is bounded on the start side only; direction is p0 -> p1.
      const startX = b.x >= a.x ? a.x : b.x
      const forward = b.x >= a.x
      if ((forward && qx < startX) || (!forward && qx > startX)) {
        return null
      }
    } else if (overlay.name === 'segment' || lower.includes('segment')) {
      if (qx < Math.min(a.x, b.x) || qx > Math.max(a.x, b.x)) {
        return null
      }
    }
    const t = (qx - a.x) / (b.x - a.x)
    const y = a.y + t * (b.y - a.y)
    const priceBack = chart.convertFromPixel([{ x: qx, y }], { paneId })
    const price = toPriceValue(priceBack)
    return price === null ? null : [{ key: 'line', price }]
  } catch {
    return null
  }
}

// ---- price-cross watcher (SC-180) ---------------------------------------------

export interface DrawingCrossEvent {
  id: string
  key: string
  direction: 'up' | 'down'
  price: number
  timestamp: number
}

export interface DrawingCrossDeps {
  getChart: () => DrawingsRawChart | null
  /** ids to evaluate; when omitted, every currently-listed user drawing. */
  listUserDrawingIds: () => string[]
  /** True while a historical load, scroll-back or replay is in flight — the watcher only reacts to settled, live data. */
  isBusy: () => boolean
  getPeriod: () => Period
  /** requestAnimationFrame, injectable for tests. */
  raf?: (cb: () => void) => unknown
  cancelRaf?: (handle: unknown) => void
}

/**
 * Fires `cb` once per crossing of a user drawing's price level by the latest
 * bar's close, evaluated ONLY while at least one listener is installed and
 * ONLY when `isBusy()` is false (never during history loads, loadMore or
 * replay — see the corrected fix; this polls the settled last-bar close each
 * frame rather than tapping the datafeed pipeline directly, which stays out
 * of this batch's files, and is observationally the same for this purpose:
 * a value that has not changed produces no comparison). Returns the
 * unsubscribe function; the underlying loop stops entirely once the last
 * listener unsubscribes.
 */
export function createDrawingCrossWatcher (deps: DrawingCrossDeps): {
  subscribe: (cb: (event: DrawingCrossEvent) => void, options?: { ids?: readonly string[] }) => () => void
  dispose: () => void
} {
  const raf = deps.raf ?? ((cb: () => void) => requestAnimationFrame(cb))
  const cancel = deps.cancelRaf ?? ((h: unknown) => { cancelAnimationFrame(h as number) })
  interface Entry { cb: (event: DrawingCrossEvent) => void, ids?: readonly string[] }
  const listeners = new Set<Entry>()
  const lastClose = new Map<string, number>() // `${id}:${key}` -> last-seen close compared against that level
  let handle: unknown = null
  let lastBarTs: number | null = null

  const evaluateFor = (entry: Entry, chart: DrawingsRawChart, last: TimelineBar, close: number): void => {
    const ids = entry.ids ?? deps.listUserDrawingIds()
    for (const id of ids) {
      const levels = drawingLevelsAt(chart, id, last.timestamp, deps.getPeriod())
      if (levels === null) {
        continue
      }
      for (const level of levels) {
        const cacheKey = `${id}:${level.key}`
        const prev = lastClose.get(cacheKey)
        lastClose.set(cacheKey, close)
        if (prev === undefined) {
          continue
        }
        if (prev < level.price && close >= level.price) {
          emit(entry, { id, key: level.key, direction: 'up', price: level.price, timestamp: last.timestamp })
        } else if (prev > level.price && close <= level.price) {
          emit(entry, { id, key: level.key, direction: 'down', price: level.price, timestamp: last.timestamp })
        }
      }
    }
  }

  const evaluate = (): void => {
    const chart = deps.getChart()
    if (chart === null || deps.isBusy()) {
      return
    }
    const bars = chart.getDataList()
    const last = bars[bars.length - 1]
    if (last === undefined) {
      return
    }
    if (last.timestamp === lastBarTs) {
      return
    }
    const close = (last as unknown as { close?: number }).close
    lastBarTs = last.timestamp
    if (typeof close !== 'number' || !Number.isFinite(close)) {
      return
    }
    for (const entry of [...listeners]) {
      evaluateFor(entry, chart, last, close)
    }
  }

  const emit = (entry: Entry, event: DrawingCrossEvent): void => {
    try {
      entry.cb(event)
    } catch (e) {
      console.warn('[super-chart] an onDrawingCross listener threw.', e)
    }
  }

  const loop = (): void => {
    if (listeners.size === 0) {
      handle = null
      return
    }
    evaluate()
    handle = raf(loop)
  }

  return {
    subscribe (cb: (event: DrawingCrossEvent) => void, options?: { ids?: readonly string[] }): () => void {
      const entry: Entry = { cb, ids: options?.ids }
      listeners.add(entry)
      if (handle === null) {
        handle = raf(loop)
      }
      return () => {
        listeners.delete(entry)
        if (listeners.size === 0 && handle !== null) {
          cancel(handle)
          handle = null
        }
      }
    },
    dispose (): void {
      listeners.clear()
      if (handle !== null) {
        cancel(handle)
        handle = null
      }
    }
  }
}

export { pointToTime }
