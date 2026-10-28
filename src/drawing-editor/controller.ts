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

// DrawingEditor — the logic behind the floating drawing toolbar, the
// right-click menu, undo/redo, copy/paste/nudge, per-tool style defaults and
// per-symbol persistence. Kept out of the Solid component so it can be
// unit-tested against a fake chart.
//
// Which overlays are "user drawings": ONLY the ones Super Chart itself creates
// from the drawing bar (and freehand strokes). Those go through prepare(), which
// forces the 'drawing_tools' group and attaches this editor's callbacks; their
// ids are tracked in `userIds`. Host overlays (e.g. the wallet's agent layers,
// created via getChart().createOverlay) share names with drawing tools (rect,
// segment, priceLine, ...) and never set a group, so they cannot be told apart by
// name — they are told apart by never having passed through prepare(). Every
// action checks the tracked set and targets overlays by id, so a host overlay is
// never restyled, locked, hidden, reordered, removed or entered into undo/redo
// or the object tree by the editor. Hosts that want their own overlays to
// survive an accidental right-click use addHostOverlay() (SC-091) below.
//
// Selection model (klinecharts 9.x): a click on an overlay fires onClick, then
// onDeselected on the previous one and onSelected on the new one — the last two
// only when the id changes. onSelected also fires mid-drawing (first placement
// click), so a drawing is only selected once currentStep === -1 (complete), and
// onDrawEnd selects a freshly finished drawing. removeOverlay does not clear
// klinecharts' own selection, so a later onDeselected may name an overlay that is
// already gone: the editor tracks its own selected id and ignores those.
//
// Right-click (SC-090): klinecharts removes ANY overlay on a right press unless
// onRightClick returns true — including one still being placed, which is the
// only way a half-placed multi-point tool gets cancelled. So onRightClick
// returns false (letting klinecharts cancel it) for an in-progress drawing, and
// true — opening this editor's own context menu instead of deleting anything —
// for a finished one, locked or not.
//
// Undo/redo (SC-092): a capped History (history.ts) of {undo, redo} closures,
// covering only tracked drawings. Every entry restores state through the same
// prepare()+createOverlay()+track() path a fresh drawing takes, under its
// ORIGINAL id (OverlayCreate accepts one, and klinecharts' ids are never
// reused), so a later entry that still names that id keeps working after an
// undo/redo cycle. Recording is suppressed while an undo/redo/restore itself
// runs, so it never re-records its own side effects.
//
// Part of SUPer-Chart (Apache-2.0).

import type { Chart, Nullable, Overlay, OverlayCreate, OverlayEvent, OverlayMode } from 'klinecharts'

import {
  applyStyleChange, editorControlsFor, profileFor, readStrokeState, readTextColor, deepClone, deepMerge,
  EditorControls, LineStyleKind, StyleChange, StyleRecord
} from './styles'
import { accentStyles, drawingAccent } from '../extension/accent'
import { fallbackValueShift, shiftPoints, CloneShift, CLONE_OFFSET_BARS, CLONE_OFFSET_PX, DataPoint } from './clone'
import {
  CANDLE_PANE_ID, canReorderInPane, clearChartSelection, completeDrawing, drawingInProgress,
  paneIdOf, progressOverlayId, reorderInPane, selectInChart
} from './compat'
import { applyMagnetSnap } from './magnet'
import type { MagnetChart, MagnetOverlayEvent } from './magnet'
import { History } from './history'

/** The group every user drawing is created in (also used by the drawing bar). */
export const DRAWING_GROUP_ID = 'drawing_tools'

/** The subset of the klinecharts Chart the editor uses (a fake implements it in tests). */
export type EditorChart = Pick<Chart,
'createOverlay' | 'getOverlayById' | 'overrideOverlay' | 'removeOverlay' | 'getStyles' | 'convertToPixel' | 'convertFromPixel' | 'getDataList'>

export interface SelectionAnchor {
  pageX: number
  pageY: number
}

export interface DrawingSnapshot {
  id: string
  name: string
  locked: boolean
  controls: EditorControls
  lineColor: string
  lineWidth: number
  lineStyle: LineStyleKind
  textColor: string
  /** The theme's default drawing colour, first swatch of the palette. */
  defaultColor: string
  /** Bring to front / send to back are available on this klinecharts version. */
  canReorder: boolean
}

/** The context menu the editor wants shown: a finished drawing, right-clicked. */
export interface ContextMenuState {
  id: string
  anchor: SelectionAnchor
}

export interface DrawingEditorOptions {
  getChart: () => Nullable<EditorChart>
  /** Called whenever the selection, the selected drawing's state, or the context menu changes. */
  onChange?: () => void
  /** Called whenever canUndo()/canRedo() may have changed. */
  onHistoryChange?: () => void
  /** Called (debounced) whenever a tracked drawing is created, changed, reordered or removed. */
  onDrawingsChange?: () => void
  /** Called whenever a tool's remembered style (setDrawingDefaults, or drawing then restyling) changes. */
  onDrawingDefaultsChange?: () => void
  /** Cap on the undo/redo stack. @default 100 */
  historyCap?: number
}

type Callback = ((event: OverlayEvent) => boolean) | null | undefined

/** The zLevel that puts a drawing in front of / behind every level in `levels` (host overlays default to 0). */
export function nextZLevel (direction: 'front' | 'back', levels: readonly number[]): number {
  const all = [0, ...levels.filter(l => Number.isFinite(l))]
  return direction === 'front' ? Math.max(...all) + 1 : Math.min(...all) - 1
}

const isComplete = (overlay: Pick<Overlay, 'currentStep'> | null | undefined): boolean => overlay?.currentStep === -1

function anchorOf (event: OverlayEvent | undefined): SelectionAnchor | null {
  if (event !== undefined && typeof event.pageX === 'number' && typeof event.pageY === 'number') {
    return { pageX: event.pageX, pageY: event.pageY }
  }
  return null
}

function chain (own: (event: OverlayEvent) => boolean, theirs: Callback): (event: OverlayEvent) => boolean {
  if (typeof theirs !== 'function') {
    return own
  }
  return (event: OverlayEvent) => {
    const a = own(event)
    const b = theirs(event)
    return a || b
  }
}

const sameJSON = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

// ---------------------------------------------------------------------------
// Serialize / restore (SC-092's undo/redo payload and SC-120's per-symbol
// persistence share this shape): a plain, JSON-safe snapshot of a drawing that
// survives outside the chart. Points are stored by timestamp — what klinecharts
// itself draws from — with a `barsFromLast` fallback for a point past the last
// loaded bar (which has no timestamp to store; dataIndexToTimestamp has nothing
// to return there, so klinecharts itself stores it the same way).
// ---------------------------------------------------------------------------

export interface DrawingPointRecord {
  timestamp?: number
  barsFromLast?: number
  value?: number
}

export interface DrawingRecord {
  v: 1
  name: string
  paneId: string
  points: DrawingPointRecord[]
  styles?: StyleRecord | null
  extendData?: unknown
  mode?: OverlayMode
  lock: boolean
  visible: boolean
  zLevel?: number
}

function dataListOf (chart: Nullable<EditorChart>): DataPoint[] {
  try {
    return (chart?.getDataList() as unknown as Array<{ timestamp: number }>)?.map(d => ({ timestamp: d.timestamp })) ?? []
  } catch {
    return []
  }
}

function serializePoint (p: DataPoint, dataList: readonly DataPoint[]): DrawingPointRecord {
  const rec: DrawingPointRecord = {}
  if (typeof p.value === 'number' && Number.isFinite(p.value)) {
    rec.value = p.value
  }
  if (typeof p.timestamp === 'number' && Number.isFinite(p.timestamp)) {
    rec.timestamp = p.timestamp
  } else if (typeof p.dataIndex === 'number' && Number.isFinite(p.dataIndex)) {
    rec.barsFromLast = p.dataIndex - (dataList.length - 1)
  }
  return rec
}

function restorePoint (rec: DrawingPointRecord, dataList: readonly DataPoint[]): DataPoint {
  const p: DataPoint = {}
  if (typeof rec.value === 'number') {
    p.value = rec.value
  }
  if (typeof rec.timestamp === 'number') {
    p.timestamp = rec.timestamp
  } else if (typeof rec.barsFromLast === 'number') {
    p.dataIndex = dataList.length - 1 + rec.barsFromLast
  }
  return p
}

// ---------------------------------------------------------------------------
// SC-091: host overlays that must never be deleted by a stray right-click.
// klinecharts removes ANY overlay whose onRightClick does not return true —
// lock included; `lock` only blocks dragging. This is additive: v1's
// getChart().createOverlay is completely unaffected (no global default is
// changed, and no built-in template is re-registered).
// ---------------------------------------------------------------------------

export interface HostOverlayOptions {
  /** Draggable (and not locked). @default false — immovable until opted in. */
  draggable?: boolean
  /** Fires once per gesture when the points actually changed (never on a no-op click while locked). */
  onChange?: (points: ReadonlyArray<Partial<DataPoint>>) => void
  onRemove?: (id: string) => void
}

/**
 * Create an overlay that survives a right-click, for a host's own layers
 * (SL/TP lines, AI-drawn levels, a draggable trade bracket). Keeps any
 * callbacks the host already put on `create`.
 */
export function addHostOverlay (
  chart: Pick<EditorChart, 'createOverlay' | 'getOverlayById'>,
  create: OverlayCreate,
  options: HostOverlayOptions = {}
): Nullable<string> {
  const draggable = options.draggable === true
  let lastPoints: unknown = deepClone(create.points ?? [])
  const prepared: OverlayCreate = {
    ...create,
    lock: draggable ? (create.lock ?? false) : true,
    onRightClick: chain(() => true, create.onRightClick),
    onPressedMoveEnd: chain(event => {
      const points = event.overlay.points
      if (options.onChange !== undefined && !sameJSON(points, lastPoints)) {
        lastPoints = deepClone(points)
        options.onChange(points as ReadonlyArray<Partial<DataPoint>>)
      }
      return false
    }, create.onPressedMoveEnd),
    onRemoved: chain(event => {
      options.onRemove?.(event.overlay.id)
      return false
    }, create.onRemoved)
  }
  const created = chart.createOverlay(prepared)
  const id = Array.isArray(created) ? created[0] : created
  return id ?? null
}

// ---------------------------------------------------------------------------

interface ClipboardEntry {
  name: string
  points: DataPoint[]
  styles: OverlayCreate['styles']
  extendData: unknown
  mode?: OverlayMode
  zLevel?: number
}

/** Arrow-key nudge steps (px on the value axis); Shift multiplies by BIG. */
const NUDGE_STEP_PX = 1
const NUDGE_STEP_PX_BIG = 10

export class DrawingEditor {
  private readonly _getChart: () => Nullable<EditorChart>
  private readonly _onChange: () => void
  private readonly _onHistoryChangeCb: () => void
  private readonly _onDrawingsChangeCb: (() => void) | undefined
  private readonly _onDrawingDefaultsChangeCb: () => void
  private readonly _userIds = new Set<string>()
  private readonly _history: History
  private _selectedId: string | null = null
  private _anchor: SelectionAnchor | null = null
  private _selectionKey = 0
  private _dataContext: string | null = null
  // Cursor feedback (SC-101): set from prepare()'s onMouseEnter/onMouseLeave/
  // onPressedMoveStart/onPressedMoveEnd. The component reads these (through
  // onChange, like the selection) and sets the cursor on the pane's own DOM
  // node — setting it anywhere else does nothing, because klinecharts sets
  // `style.cursor` inline on that exact node.
  private _hovering = false
  private _dragging = false
  private _menu: ContextMenuState | null = null
  private _rightClickHandled = false
  private _suppressRecording = false
  private _coalesceKey: string | null = null
  private _clipboard: ClipboardEntry | null = null
  private _pasteOffset = 0
  private readonly _toolDefaults = new Map<string, StyleRecord>()
  private readonly _bySymbol = new Map<string, DrawingRecord[]>()
  private readonly _moveStart = new Map<string, DataPoint[]>()
  private _drawingsChangeTimer: ReturnType<typeof setTimeout> | null = null

  constructor (options: DrawingEditorOptions) {
    this._getChart = options.getChart
    this._onChange = options.onChange ?? (() => {})
    this._onHistoryChangeCb = options.onHistoryChange ?? (() => {})
    this._onDrawingsChangeCb = options.onDrawingsChange
    this._onDrawingDefaultsChangeCb = options.onDrawingDefaultsChange ?? (() => {})
    this._history = new History({ cap: options.historyCap })
  }

  /** Pointer is over a (possibly locked) user drawing: show 'pointer', even though a locked one cannot be dragged. */
  get hoveringUserDrawing (): boolean {
    return this._hovering
  }

  /** A user drawing (never a locked one — dragging one is a no-op) is being dragged: show 'grabbing'. */
  get draggingUserDrawing (): boolean {
    return this._dragging
  }

  /** Safety net for a drag that ends without onPressedMoveEnd (e.g. released over host UI). No-op if not dragging. */
  clearDragHint (): void {
    if (this._dragging) {
      this._dragging = false
      this._emit()
    }
  }

  /** Increments every time a different drawing becomes selected (the toolbar re-places itself then). */
  get selectionKey (): number {
    return this._selectionKey
  }

  get selectedId (): string | null {
    return this._selectedId
  }

  get anchor (): SelectionAnchor | null {
    return this._anchor
  }

  /** The context menu to show (a right-clicked, finished drawing), or null. */
  get menu (): ContextMenuState | null {
    return this._menu
  }

  isUserDrawing (id: string | null | undefined): boolean {
    return typeof id === 'string' && this._userIds.has(id)
  }

  userDrawingIds (): string[] {
    return [...this._userIds]
  }

  /**
   * Turn a drawing-bar OverlayCreate into a user drawing: the 'drawing_tools'
   * group, visible, and this editor's callbacks (any callbacks already on the
   * object still run). Always returns a new object.
   */
  prepare (create: OverlayCreate): OverlayCreate {
    // klinecharts' own weak/strong magnet is bugged for a cursor below a
    // candle's low (see magnet.ts) and is not our engine's magnet's only
    // problem: a live crash was found on klinecharts 9.7.2 while a
    // weak_magnet-mode overlay was being drawn (an uncaught error from
    // klinecharts' own internal handling of that mode, not from anything the
    // engine's onDrawing hook below does — it never throws uncaught, only a
    // caught best-effort). So a drawing-bar overlay never actually reaches
    // klinecharts with mode weak_magnet/strong_magnet: the intended mode is
    // captured here and passed to applyMagnetSnap directly (below), and what
    // klinecharts itself sees is always 'normal', leaving its own magnet
    // permanently off for every user drawing. A host overlay created outside
    // prepare() (this method) is untouched and keeps klinecharts' own mode
    // handling exactly as before — this only changes drawing-bar tools.
    const intendedMode = create.mode ?? 'normal'
    return {
      ...create,
      groupId: DRAWING_GROUP_ID,
      visible: true,
      mode: 'normal' as OverlayMode,
      onDrawStart: chain(event => {
        this._userIds.add(event.overlay.id)
        // A drawing created already complete (its points supplied up front —
        // a host's, this editor's own restore()/clone()/paste(), or a test)
        // never fires onDrawEnd: that only fires when placement clicks bring
        // an IN-PROGRESS drawing to completion. Record it here instead.
        if (isComplete(event.overlay)) {
          this._recordCreate(event.overlay.id)
        }
        return false
      }, create.onDrawStart),
      onDrawEnd: chain(event => {
        this.select(event.overlay.id, anchorOf(event))
        this._recordCreate(event.overlay.id)
        return false
      }, create.onDrawEnd),
      onClick: chain(event => {
        if (isComplete(event.overlay)) {
          this.select(event.overlay.id, anchorOf(event))
        }
        return false
      }, create.onClick),
      onSelected: chain(event => {
        if (isComplete(event.overlay)) {
          this.select(event.overlay.id, anchorOf(event))
        }
        return false
      }, create.onSelected),
      onDeselected: chain(event => {
        // Ignore a stale deselect for an overlay that is no longer the selected one.
        if (this._selectedId !== null && event.overlay.id === this._selectedId) {
          this._setSelection(null, null)
        }
        return false
      }, create.onDeselected),
      onRemoved: chain(event => {
        const id = event.overlay.id
        // A drawing still being placed (Any Waves, or any tool cancelled by
        // right-click / Escape) was never "created" from the undo stack's
        // point of view: bringing it back would restore a half-drawn ghost.
        if (!this._suppressRecording && this._userIds.has(id) && isComplete(event.overlay)) {
          this._pushRemoveHistory([{ id, record: this._captureRecord(event.overlay) }])
        }
        this._userIds.delete(id)
        // Same ordering as _removeTrackedById: clear the menu before
        // _setSelection's own _emit(), so a removal that reaches here by any
        // other path (klinecharts' own onRemoved, not just this editor's
        // remove()) still notifies the UI with menu:null in that one emit.
        const hadMenu = this._menu?.id === id
        if (hadMenu) {
          this._menu = null
        }
        if (this._selectedId === id) {
          this._setSelection(null, null)
        } else if (hadMenu) {
          this._emit()
        }
        this._scheduleDrawingsChange()
        return false
      }, create.onRemoved),
      // klinecharts removes an overlay on right-click unless this returns true.
      // A drawing still being placed returns false, so a right-click still
      // cancels it (the only way to cancel a half-placed multi-point tool);
      // a finished one — locked or not — opens this editor's context menu
      // instead of being deleted (SC-090).
      onRightClick: chain(event => {
        if (!isComplete(event.overlay)) {
          return false
        }
        const anchor = anchorOf(event)
        this.select(event.overlay.id, anchor)
        this._openMenu(event.overlay.id, anchor)
        return true
      }, create.onRightClick),
      // Cursor feedback (SC-101). Every hook returns false so klinecharts' own
      // handling (point handles, the drag itself) still runs.
      onMouseEnter: chain(event => {
        if (this._userIds.has(event.overlay.id) && !this._dragging) {
          this._hovering = true
          this._emit()
        }
        return false
      }, create.onMouseEnter),
      onMouseLeave: chain(event => {
        if (this._userIds.has(event.overlay.id) && !this._dragging) {
          this._hovering = false
          this._emit()
        }
        return false
      }, create.onMouseLeave),
      onPressedMoveStart: chain(event => {
        if (this._userIds.has(event.overlay.id) && !event.overlay.lock) {
          this._dragging = true
          this._emit()
        }
        if (!this._suppressRecording) {
          this._moveStart.set(event.overlay.id, deepClone(event.overlay.points) as DataPoint[])
        }
        return false
      }, create.onPressedMoveStart),
      onPressedMoveEnd: chain(event => {
        if (this._userIds.has(event.overlay.id)) {
          this._dragging = false
          this._hovering = true
          this._emit()
        }
        const id = event.overlay.id
        const before = this._moveStart.get(id)
        this._moveStart.delete(id)
        if (!this._suppressRecording && before !== undefined) {
          const after = deepClone(event.overlay.points) as DataPoint[]
          if (!sameJSON(before, after)) {
            this._pushMoveHistory(id, before, after, 'move')
          }
        }
        return false
      }, create.onPressedMoveEnd),
      // The engine's own magnet snap (SC-103): skipped entirely unless
      // intendedMode is weak_magnet/strong_magnet, and — unlike an early
      // return inside applyMagnetSnap itself — the guard is here, before ever
      // touching event.overlay. Spreading it (`{...event.overlay}`) to inject
      // intendedMode was tried first and enumerates every one of its own
      // properties, including points; on klinecharts 9.7.2 that crashed with
      // an uncaught "reading 'x'" while a freehand brush stroke (mode
      // 'normal', so nothing to snap) was being dragged — reading the
      // in-progress overlay's own properties more than klinecharts itself
      // does mid-drag hit a transient state it does not expect. A brush
      // stroke, or any other 'normal'-mode drawing, now never spreads
      // event.overlay at all, matching what this hook did before the mode
      // override below existed.
      onDrawing: chain(event => {
        if (intendedMode !== 'weak_magnet' && intendedMode !== 'strong_magnet') {
          return false
        }
        const chart = this._getChart()
        if (chart !== null) {
          const withMode = { ...event, overlay: { ...event.overlay, mode: intendedMode } }
          applyMagnetSnap(chart as unknown as MagnetChart, withMode as unknown as MagnetOverlayEvent, paneIdOf(chart, event.overlay))
        }
        return false
      }, create.onDrawing)
    }
  }

  /**
   * Like prepare(), but for a FRESH drawing only (the drawing bar, freehand):
   * applies this tool's remembered style (SC-119) when the caller did not
   * already give it one. Never used by clone()/paste()/restore(), which must
   * keep the original's exact styles.
   */
  prepareNew (create: OverlayCreate): OverlayCreate {
    if (create.styles !== undefined) {
      return this.prepare(create)
    }
    const remembered = this._toolDefaults.get(create.name)
    return this.prepare(remembered === undefined ? create : { ...create, styles: deepClone(remembered) as OverlayCreate['styles'] })
  }

  /** Record an id returned by createOverlay for a prepare()d overlay (onDrawStart normally already did). */
  track (id: unknown): void {
    const list = Array.isArray(id) ? id : [id]
    list.forEach(v => {
      if (typeof v === 'string' && v.length > 0) {
        this._userIds.add(v)
      }
    })
  }

  /** Select a user drawing. Anything else (host overlays, unknown ids, unfinished drawings) is ignored. */
  select (id: string, anchor: SelectionAnchor | null = null): void {
    if (!this._userIds.has(id)) {
      return
    }
    const overlay = this._getChart()?.getOverlayById(id)
    if (overlay === null || overlay === undefined || !isComplete(overlay)) {
      return
    }
    this._setSelection(id, anchor ?? this._anchor)
  }

  /** Close the editor. With `syncChart`, also clear klinecharts' own selection (its point handles). */
  deselect (syncChart = true): void {
    if (this._selectedId === null) {
      return
    }
    this._setSelection(null, null)
    if (syncChart) {
      clearChartSelection(this._getChart())
    }
  }

  /** Close the right-click context menu, if open. */
  closeMenu (): void {
    if (this._menu !== null) {
      this._menu = null
      this._emit()
    }
  }

  /**
   * ChartProComponent's DOM 'contextmenu' listener calls this to learn
   * whether the press that triggered it already opened a drawing's menu (via
   * onRightClick) — if so, it must not also open the chart's empty-space
   * menu. Always clears the flag, hit or not, so the next right-click starts fresh.
   */
  consumeRightClickHandled (): boolean {
    const handled = this._rightClickHandled
    this._rightClickHandled = false
    return handled
  }

  /**
   * Cancel the drawing currently being placed (Escape while arming/placing a
   * multi-point tool). klinecharts holds at most one; false when there is
   * none, or this klinecharts build cannot report it.
   */
  cancelInProgress (): boolean {
    const chart = this._getChart()
    if (chart === null) {
      return false
    }
    const id = progressOverlayId(chart)
    if (id === null) {
      return false
    }
    this._suppressed(() => { chart.removeOverlay({ id }) })
    return true
  }

  /**
   * Run `fn` with history recording suppressed: for a freehand stroke, whose
   * preview overlay is removed and recreated on every pointer move — without
   * this, each of those (an ordinary complete creation, as far as onDrawStart
   * can tell) would otherwise push its own undo entry. Call
   * recordFreehandStroke(id) once, outside this, when the stroke is done.
   */
  runSuppressed<T> (fn: () => T): T {
    return this._suppressed(fn)
  }

  /** Record one undo entry for a just-finished freehand stroke (its id, after runSuppressed() was used for every intermediate step). */
  recordFreehandStroke (id: string): void {
    this._recordCreate(id)
  }

  /** A complete hold gesture uses the same selection, ownership and one-create history as rail drawings. */
  createGestureDrawing (create: OverlayCreate, paneId: string): string | null {
    const chart = this._getChart()
    if (chart === null) return null
    const id = this._suppressed(() => this._finishCreated(chart.createOverlay(this.prepareNew(create), paneId), chart, paneId, null))
    if (id !== null) this._recordCreate(id)
    return id
  }

  /** Tab's alternate reading is an ordinary undoable replacement, with the drawing id retained. */
  replaceGestureDrawing (id: string, create: OverlayCreate, paneId: string): boolean {
    const chart = this._getChart()
    const previous = chart?.getOverlayById(id) ?? null
    if (chart === null || previous === null || !this.isUserDrawing(id) || previous.lock || !previous.visible) return false
    const before = this._captureRecord(previous)
    const replaced = this._suppressed(() => {
      this._removeTrackedById(id)
      const next = this._finishCreated(chart.createOverlay(this.prepareNew({ ...create, id }), paneId), chart, paneId, null)
      if (next === null) this._restoreRecord(before, id)
      return next
    })
    const overlay = replaced === null ? null : chart.getOverlayById(replaced)
    if (overlay === null) return false
    const after = this._captureRecord(overlay)
    const apply = (record: DrawingRecord): void => {
      this._suppressed(() => { this._removeTrackedById(id); this._restoreRecord(record, id) })
      this.select(id)
    }
    this._history.push({ undo: () => { apply(before) }, redo: () => { apply(after) } })
    this._coalesceKey = null
    this._onHistoryChangeCb()
    this._scheduleDrawingsChange()
    return true
  }

  /** Scribble erasing is a single undo action; hidden, locked and host overlays are excluded at the mutation boundary. */
  removeGestureDrawings (ids: readonly string[]): number {
    const chart = this._getChart()
    if (chart === null) return 0
    const items: Array<{ id: string, record: DrawingRecord }> = []
    for (const id of new Set(ids)) {
      const overlay = chart.getOverlayById(id)
      if (!this.isUserDrawing(id) || overlay === null || overlay.lock || !overlay.visible) continue
      items.push({ id, record: this._captureRecord(overlay) })
    }
    this._suppressed(() => { items.forEach(({ id }) => { this._removeTrackedById(id) }) })
    this._pushRemoveHistory(items)
    return items.length
  }

  /**
   * What the drawings are plotted against (the symbol's ticker). When it
   * changes, this symbol's drawings are saved (in memory, for this editor's
   * lifetime) and cleared — a drawing keeps the old symbol's prices, so it
   * would otherwise sit far off the new price scale (SC-120). Call
   * restoreForSymbol(key) once the new symbol's history has actually loaded.
   * The first call only records the key.
   */
  setDataContext (key: string): void {
    const previous = this._dataContext
    this._dataContext = key
    if (previous === null || previous === key) {
      return
    }
    this._bySymbol.set(previous, this.serialize())
    this._removeAllInternal()
    // The stack's entries name ids that belonged to the old symbol's
    // drawings; keeping them would let an undo resurrect a BTC-priced
    // drawing while looking at ETH.
    this._history.clear()
    this._coalesceKey = null
    this._onHistoryChangeCb()
  }

  /**
   * Restore `key`'s saved drawings — call once the chart actually has that
   * symbol's data loaded (future-area points are re-anchored against it).
   * A no-op if a newer setDataContext has since superseded `key`, or nothing
   * was saved for it (a symbol seen for the first time).
   */
  restoreForSymbol (key: string): void {
    if (key !== this._dataContext) {
      return
    }
    const records = this._bySymbol.get(key)
    if (records === undefined || records.length === 0) {
      return
    }
    this._suppressed(() => { records.forEach(record => { this._restoreRecord(record) }) })
    this._scheduleDrawingsChange()
  }

  /** The selected drawing's live state for the toolbar, or null when nothing (valid) is selected. */
  snapshot (): DrawingSnapshot | null {
    const chart = this._getChart()
    const overlay = this._selected()
    if (chart === null || overlay === null) {
      return null
    }
    const profile = profileFor(overlay.name)
    const defaults = this._defaults(overlay.name)
    const stroke = readStrokeState(overlay.styles as StyleRecord | null, defaults, profile)
    const defaultColor = typeof defaults?.line?.color === 'string' ? defaults.line.color : stroke.color
    return {
      id: overlay.id,
      name: overlay.name,
      locked: overlay.lock === true,
      controls: editorControlsFor(overlay.name),
      lineColor: stroke.color,
      lineWidth: stroke.width,
      lineStyle: stroke.style,
      textColor: readTextColor(overlay.styles as StyleRecord | null, defaults, profile),
      defaultColor,
      canReorder: typeof (overlay as { zLevel?: unknown }).zLevel === 'number' || canReorderInPane(chart)
    }
  }

  applyStyle (change: StyleChange): void {
    const chart = this._getChart()
    const overlay = this._selected()
    if (chart === null || overlay === null) {
      return
    }
    const before = deepClone(overlay.styles ?? null) as StyleRecord | null
    const styles = applyStyleChange(overlay.styles as StyleRecord | null, this._defaults(overlay.name), profileFor(overlay.name), change)
    const id = overlay.id
    chart.overrideOverlay({ id, styles } as unknown as Partial<OverlayCreate>)
    if (!this._suppressRecording) {
      this._toolDefaults.set(overlay.name, deepClone(styles) as StyleRecord)
      this._onDrawingDefaultsChangeCb()
    }
    this._recordCoalesced(`style:${id}:${change.kind}`,
      s => { this._getChart()?.overrideOverlay({ id, styles: s } as unknown as Partial<OverlayCreate>) },
      before, styles)
    this._emit()
  }

  toggleLock (): void {
    const overlay = this._selected()
    if (overlay === null) {
      return
    }
    this.setDrawingLocked(overlay.id, overlay.lock !== true)
  }

  /** Remove the selected drawing (Delete key / trash button). */
  remove (): void {
    const overlay = this._selected()
    if (overlay === null) {
      return
    }
    const id = overlay.id
    const record = this._captureRecord(overlay)
    this._removeTrackedById(id)
    this._pushRemoveHistory([{ id, record }])
  }

  /** Hide the selected drawing (visible:false) and close the editor. The drawing bar's show-all brings it back. */
  hide (): void {
    const overlay = this._selected()
    if (overlay === null) {
      return
    }
    this.setDrawingVisible(overlay.id, false)
    this.deselect(true)
  }

  /**
   * Select a just-finished user drawing that klinecharts itself never
   * selected — a freehand stroke, whose onDrawEnd/onSelected never fire
   * because it is built with overrideOverlay, not click placement (SC-009).
   * Makes klinecharts show its handles (as a click would) and opens the
   * toolbar; `editor.select(id)` alone would leave the toolbar stuck open on
   * the next empty click, because klinecharts never fires onDeselected for a
   * selection it did not make itself.
   */
  selectPlaced (id: string, paneId: string): void {
    const chart = this._getChart()
    if (chart === null || !this._userIds.has(id)) {
      return
    }
    const overlay = chart.getOverlayById(id)
    if (overlay === null || !isComplete(overlay)) {
      return
    }
    // Sync klinecharts' own selection (its point handles; an empty click
    // afterwards then fires onDeselected instead of leaving the toolbar
    // stuck). Best-effort: on a klinecharts without the private store this
    // does nothing, and the toolbar below still opens.
    selectInChart(chart, overlay, paneId)
    this._setSelection(id, this._anchor)
  }

  /** Copy the selected drawing, offset a little, and select the copy. Returns the new id. */
  clone (): string | null {
    const chart = this._getChart()
    const overlay = this._selected()
    if (chart === null || overlay === null) {
      return null
    }
    // A drawing finished with fewer points than its tool's step count (Any
    // Waves, or any tool ended early by a double-click) comes back from
    // createOverlay "still being drawn". klinecharts holds one such drawing;
    // if it already has one (a host's, say), the copy would replace and orphan it.
    if (overlay.points.length < overlay.totalStep - 1 && drawingInProgress(chart)) {
      return null
    }
    const paneId = paneIdOf(chart, overlay)
    const points = shiftPoints(overlay.points as DataPoint[], this._cloneShift(chart, overlay, paneId))
    const zLevel = (overlay as { zLevel?: unknown }).zLevel
    const create = this.prepare({
      name: overlay.name,
      points,
      styles: deepClone(overlay.styles ?? undefined) as OverlayCreate['styles'],
      extendData: deepClone(overlay.extendData),
      mode: overlay.mode,
      lock: false,
      ...(typeof zLevel === 'number' ? { zLevel } : {})
    } as OverlayCreate)
    return this._finishCreated(chart.createOverlay(create, paneId), chart, paneId, overlay.id)
  }

  /** Remember the selected drawing for paste() (in memory; cleared on dispose()). */
  copy (): boolean {
    const overlay = this._selected()
    if (overlay === null) {
      return false
    }
    const zLevel = (overlay as { zLevel?: unknown }).zLevel
    this._clipboard = {
      name: overlay.name,
      points: deepClone(overlay.points) as DataPoint[],
      styles: deepClone(overlay.styles ?? undefined) as OverlayCreate['styles'],
      extendData: deepClone(overlay.extendData),
      mode: overlay.mode,
      ...(typeof zLevel === 'number' ? { zLevel } : {})
    }
    this._pasteOffset = 0
    return true
  }

  /** Create a new drawing from the last copy(), offset a little more each time, and select it. */
  paste (): string | null {
    const chart = this._getChart()
    const clip = this._clipboard
    if (chart === null || clip === null) {
      return null
    }
    // Unlike clone(), there is no live source overlay here to read totalStep
    // from, so this cannot tell in advance whether the paste would come back
    // "still being drawn". Conservative and safe: never paste while
    // something (a host's drawing, say) is already in progress.
    if (drawingInProgress(chart)) {
      return null
    }
    this._pasteOffset += 1
    const paneId = CANDLE_PANE_ID
    let timeline: number[] = []
    try {
      timeline = chart.getDataList().map(d => d.timestamp)
    } catch { /* unknown: points keep their dataIndex */ }
    const shift: CloneShift = {
      bars: CLONE_OFFSET_BARS * this._pasteOffset,
      timeline,
      values: this._shiftedValues(chart, clip.points, paneId, CLONE_OFFSET_PX * this._pasteOffset),
      value: fallbackValueShift(clip.points[0]?.value) * this._pasteOffset
    }
    const points = shiftPoints(clip.points, shift)
    const create = this.prepare({
      name: clip.name,
      points,
      styles: deepClone(clip.styles),
      extendData: deepClone(clip.extendData),
      mode: clip.mode,
      lock: false,
      ...(typeof clip.zLevel === 'number' ? { zLevel: clip.zLevel } : {})
    } as OverlayCreate)
    return this._finishCreated(chart.createOverlay(create, paneId), chart, paneId, this._selectedId)
  }

  /**
   * Nudge the selected (unlocked) drawing by keyboard: left/right move it one
   * bar (price unchanged); up/down move every point NUDGE_STEP_PX (×10 with
   * `big`, i.e. Shift) on the value axis. Repeated nudges with nothing else
   * happening in between merge into one undo step. Returns false when there
   * is nothing to nudge (none selected, or it is locked).
   */
  nudge (direction: 'left' | 'right' | 'up' | 'down', big = false): boolean {
    const chart = this._getChart()
    const overlay = this._selected()
    if (chart === null || overlay === null || overlay.lock === true) {
      return false
    }
    const id = overlay.id
    const before = deepClone(overlay.points) as DataPoint[]
    const paneId = paneIdOf(chart, overlay)
    let after: DataPoint[]
    if (direction === 'left' || direction === 'right') {
      let timeline: number[] = []
      try {
        timeline = chart.getDataList().map(d => d.timestamp)
      } catch { /* unknown */ }
      after = shiftPoints(before, { bars: direction === 'right' ? 1 : -1, timeline, value: 0 })
    } else {
      const deltaPx = (direction === 'down' ? 1 : -1) * (big ? NUDGE_STEP_PX_BIG : NUDGE_STEP_PX)
      const values = this._shiftedValues(chart, before, paneId, deltaPx)
      after = before.map((p, i) => (typeof values[i] === 'number' ? { ...p, value: values[i] } : p))
    }
    chart.overrideOverlay({ id, points: after } as unknown as Partial<OverlayCreate>)
    this._recordCoalesced(`nudge:${id}`,
      pts => { this._getChart()?.overrideOverlay({ id, points: pts } as unknown as Partial<OverlayCreate>) },
      before, after)
    this._emit()
    return true
  }

  bringToFront (): boolean {
    return this._reorder('front')
  }

  sendToBack (): boolean {
    return this._reorder('back')
  }

  // ---- id-based ops (the object tree, SC-151) --------------------------------

  /** Every tracked drawing, in z-order (back to front) — never a host overlay. */
  listDrawings (): Array<{ id: string, name: string, visible: boolean, locked: boolean }> {
    const chart = this._getChart()
    if (chart === null) {
      return []
    }
    return this.userDrawingIds()
      .map(id => chart.getOverlayById(id))
      .filter((o): o is Overlay => o !== null && o !== undefined)
      .sort((a, b) => {
        const za = (a as { zLevel?: unknown }).zLevel
        const zb = (b as { zLevel?: unknown }).zLevel
        return typeof za === 'number' && typeof zb === 'number' ? za - zb : 0
      })
      .map(o => ({ id: o.id, name: o.name, visible: o.visible !== false, locked: o.lock === true }))
  }

  setDrawingVisible (id: string, visible: boolean): void {
    if (!this.isUserDrawing(id)) {
      return
    }
    const chart = this._getChart()
    const overlay = chart?.getOverlayById(id) ?? null
    if (chart === null || overlay === null) {
      return
    }
    const before = overlay.visible !== false
    if (before === visible) {
      return
    }
    chart.overrideOverlay({ id, visible })
    this._pushFlagHistory(id, 'visible', before, visible, v => { this._getChart()?.overrideOverlay({ id, visible: v }) })
    if (!visible && this._selectedId === id) {
      this.deselect(true)
    } else {
      this._emit()
    }
  }

  setDrawingLocked (id: string, lock: boolean): void {
    if (!this.isUserDrawing(id)) {
      return
    }
    const chart = this._getChart()
    const overlay = chart?.getOverlayById(id) ?? null
    if (chart === null || overlay === null) {
      return
    }
    const before = overlay.lock === true
    if (before === lock) {
      return
    }
    chart.overrideOverlay({ id, lock })
    this._pushFlagHistory(id, 'lock', before, lock, v => { this._getChart()?.overrideOverlay({ id, lock: v }) })
    this._emit()
  }

  removeDrawing (id: string): void {
    if (!this.isUserDrawing(id)) {
      return
    }
    const chart = this._getChart()
    const overlay = chart?.getOverlayById(id) ?? null
    if (chart === null || overlay === null) {
      return
    }
    const record = this._captureRecord(overlay)
    this._removeTrackedById(id)
    this._pushRemoveHistory([{ id, record }])
  }

  // ---- per-tool style defaults (SC-119) ---------------------------------------

  /** The style this tool's next fresh drawing will use, or null (the theme/tool default). */
  getDrawingDefaults (name: string): StyleRecord | null {
    return this._toolDefaults.get(name) ?? null
  }

  /** Apply style changes to what this tool remembers, without touching any existing drawing. */
  setDrawingDefaults (name: string, changes: readonly StyleChange[]): void {
    const defaults = this._defaults(name)
    const profile = profileFor(name)
    let styles = this._toolDefaults.get(name) ?? null
    changes.forEach(change => { styles = applyStyleChange(styles, defaults, profile, change) })
    if (styles !== null) {
      this._toolDefaults.set(name, styles)
      this._onDrawingDefaultsChangeCb()
    }
  }

  /** Forget this tool's remembered style (its next drawing uses the theme default again). */
  clearDrawingDefaults (name: string): void {
    if (this._toolDefaults.delete(name)) {
      this._onDrawingDefaultsChangeCb()
    }
  }

  // ---- undo / redo (SC-092) ----------------------------------------------------

  canUndo (): boolean {
    return this._history.canUndo
  }

  canRedo (): boolean {
    return this._history.canRedo
  }

  undo (): boolean {
    this._coalesceKey = null
    const ok = this._suppressed(() => this._history.undo())
    if (ok) {
      this._onHistoryChangeCb()
      this._scheduleDrawingsChange()
      this._emit()
    }
    return ok
  }

  redo (): boolean {
    this._coalesceKey = null
    const ok = this._suppressed(() => this._history.redo())
    if (ok) {
      this._onHistoryChangeCb()
      this._scheduleDrawingsChange()
      this._emit()
    }
    return ok
  }

  // ---- persistence (SC-120) ----------------------------------------------------

  /** This symbol's drawings (default: the current one), as a JSON-safe snapshot. */
  getDrawings (key?: string): DrawingRecord[] {
    if (key === undefined || key === this._dataContext) {
      return this.serialize()
    }
    return this._bySymbol.get(key) ?? []
  }

  /** Replace this symbol's drawings (default: the current one) with `records`. Never itself undo-able (a bulk replace, not a gesture). */
  setDrawings (records: readonly DrawingRecord[], key?: string): void {
    if (key === undefined || key === this._dataContext) {
      this._removeAllInternal()
      this._suppressed(() => { records.forEach(record => { this._restoreRecord(record) }) })
      this._scheduleDrawingsChange()
    } else {
      this._bySymbol.set(key, [...records])
    }
  }

  /** Remove this symbol's drawings (default: the current one). */
  clearDrawings (key?: string): void {
    if (key === undefined || key === this._dataContext) {
      this._removeAllInternal()
      this._scheduleDrawingsChange()
    } else {
      this._bySymbol.delete(key)
    }
  }

  /** Every tracked drawing, as a JSON-safe snapshot (for getDrawings() / a host's own persistence). */
  serialize (): DrawingRecord[] {
    const chart = this._getChart()
    if (chart === null) {
      return []
    }
    return this.userDrawingIds()
      .map(id => chart.getOverlayById(id))
      .filter((o): o is Overlay => o !== null && o !== undefined)
      .map(o => this._captureRecord(o))
  }

  /** Recreate every record (added to whatever is already tracked; never itself undo-able). */
  restore (records: readonly DrawingRecord[]): void {
    this._suppressed(() => { records.forEach(record => { this._restoreRecord(record) }) })
    this._scheduleDrawingsChange()
  }

  // ---- drawing bar (whole-chart) actions ----------------------------------------

  /** Drawing bar: show or hide every user drawing (brings back drawings hidden one by one). */
  setAllVisible (visible: boolean): void {
    this._forEachUserDrawing(id => { this._getChart()?.overrideOverlay({ id, visible }) })
    if (!visible) {
      this.deselect(true)
    }
    this._scheduleDrawingsChange()
  }

  /** Drawing bar: lock or unlock every user drawing. */
  setAllLocked (lock: boolean): void {
    this._forEachUserDrawing(id => { this._getChart()?.overrideOverlay({ id, lock }) })
    this._emit()
    this._scheduleDrawingsChange()
  }

  /** Drawing bar: magnet mode for every user drawing. */
  setAllMode (mode: OverlayMode): void {
    this._forEachUserDrawing(id => { this._getChart()?.overrideOverlay({ id, mode }) })
  }

  /** Drawing bar: remove every user drawing (host overlays are left alone). One undo brings all of them back. */
  removeAll (): void {
    const chart = this._getChart()
    if (chart === null) {
      return
    }
    const items: Array<{ id: string, record: DrawingRecord }> = []
    this._forEachUserDrawing(id => {
      const overlay = chart.getOverlayById(id)
      if (overlay !== null) {
        items.push({ id, record: this._captureRecord(overlay) })
      }
    })
    this._removeAllInternal()
    this._pushRemoveHistory(items)
  }

  dispose (): void {
    if (this._drawingsChangeTimer !== null) {
      clearTimeout(this._drawingsChangeTimer)
      this._drawingsChangeTimer = null
    }
    this._userIds.clear()
    this._selectedId = null
    this._anchor = null
    this._dataContext = null
    this._hovering = false
    this._dragging = false
    this._menu = null
    this._clipboard = null
    this._toolDefaults.clear()
    this._bySymbol.clear()
    this._moveStart.clear()
    this._history.clear()
  }

  // ---------------------------------------------------------------------------

  private _emit (): void {
    this._onChange()
  }

  private _scheduleDrawingsChange (): void {
    if (this._onDrawingsChangeCb === undefined) {
      return
    }
    if (this._drawingsChangeTimer !== null) {
      clearTimeout(this._drawingsChangeTimer)
    }
    this._drawingsChangeTimer = setTimeout(() => {
      this._drawingsChangeTimer = null
      this._onDrawingsChangeCb?.()
    }, 150)
  }

  private _setSelection (id: string | null, anchor: SelectionAnchor | null): void {
    if (id !== this._selectedId) {
      this._selectionKey++
      this._coalesceKey = null
    }
    this._selectedId = id
    this._anchor = id === null ? null : anchor
    this._emit()
  }

  private _openMenu (id: string, anchor: SelectionAnchor | null): void {
    this._rightClickHandled = true
    this._menu = anchor === null ? null : { id, anchor }
    this._emit()
  }

  /** The selected overlay if it is a live user drawing; otherwise clears a stale selection. */
  private _selected (): Overlay | null {
    const id = this._selectedId
    if (id === null) {
      return null
    }
    const overlay = this._userIds.has(id) ? (this._getChart()?.getOverlayById(id) ?? null) : null
    if (overlay === null) {
      this._selectedId = null
      this._anchor = null
      return null
    }
    return overlay
  }

  /** What an overlay of this tool draws with before its own styles: the chart's overlay defaults, then the tool's accent styles. */
  private _defaults (name: string): StyleRecord | null {
    try {
      const chart = (this._getChart()?.getStyles()?.overlay as unknown as StyleRecord) ?? null
      return chart === null ? null : deepMerge<StyleRecord>(chart, accentStyles(name, drawingAccent(chart)))
    } catch {
      return null
    }
  }

  private _forEachUserDrawing (fn: (id: string) => void): void {
    const chart = this._getChart()
    if (chart === null) {
      return
    }
    ;[...this._userIds].forEach(id => {
      if (chart.getOverlayById(id) === null) {
        this._userIds.delete(id)
        return
      }
      fn(id)
    })
  }

  private _cloneShift (chart: EditorChart, overlay: Overlay, paneId: string): CloneShift {
    let timeline: number[] = []
    try {
      timeline = chart.getDataList().map(d => d.timestamp)
    } catch { /* unknown: points keep their dataIndex */ }
    return {
      bars: CLONE_OFFSET_BARS,
      timeline,
      values: this._shiftedValues(chart, overlay.points as DataPoint[], paneId, CLONE_OFFSET_PX),
      value: fallbackValueShift(overlay.points[0]?.value)
    }
  }

  /**
   * For each point, the value `deltaPx` away on the pane (positive = lower on
   * screen = lower price on a linear axis), measured at that point. A single
   * delta measured elsewhere on the pane would be wrong on a log axis, where
   * a pixel is worth more the higher the price.
   */
  private _shiftedValues (chart: EditorChart, points: readonly DataPoint[], paneId: string, deltaPx: number): Array<number | undefined> {
    try {
      const pixels = chart.convertToPixel(points.map(p => (typeof p.value === 'number' ? { value: p.value } : {})), { paneId })
      if (!Array.isArray(pixels) || pixels.length !== points.length) {
        return []
      }
      const shifted = chart.convertFromPixel(pixels.map(px => (typeof px?.y === 'number' && Number.isFinite(px.y) ? { y: px.y + deltaPx } : {})), { paneId })
      if (!Array.isArray(shifted) || shifted.length !== points.length) {
        return []
      }
      return shifted.map(v => (typeof v?.value === 'number' && Number.isFinite(v.value) ? v.value : undefined))
    } catch {
      return []
    }
  }

  private _reorder (direction: 'front' | 'back'): boolean {
    const chart = this._getChart()
    const overlay = this._selected()
    if (chart === null || overlay === null) {
      return false
    }
    const id = overlay.id
    if (typeof (overlay as { zLevel?: unknown }).zLevel === 'number') {
      // klinecharts >= 9.x with zLevel: public API, sorted per pane.
      const before = (overlay as { zLevel: number }).zLevel
      const levels = this.userDrawingIds()
        .filter(otherId => otherId !== id)
        .map(otherId => (chart.getOverlayById(otherId) as { zLevel?: unknown } | null)?.zLevel)
        .filter((l): l is number => typeof l === 'number')
      const after = nextZLevel(direction, levels)
      chart.overrideOverlay({ id, zLevel: after } as unknown as Partial<OverlayCreate>)
      if (!this._suppressRecording) {
        this._history.push({
          undo: () => { this._suppressed(() => { this._getChart()?.overrideOverlay({ id, zLevel: before } as unknown as Partial<OverlayCreate>) }); this._onHistoryChangeCb() },
          redo: () => { this._suppressed(() => { this._getChart()?.overrideOverlay({ id, zLevel: after } as unknown as Partial<OverlayCreate>) }); this._onHistoryChangeCb() }
        })
        this._coalesceKey = null
        this._onHistoryChangeCb()
      }
      this._emit()
      return true
    }
    // klinecharts 9.1.1: reorder the pane's instance list, then force a repaint
    // by re-sending the same styles as a fresh object. No public order to
    // snapshot, so — unlike the zLevel path — this is not undo-able there.
    if (!reorderInPane(chart, paneIdOf(chart, overlay), id, direction)) {
      return false
    }
    chart.overrideOverlay({ id, styles: deepClone(overlay.styles ?? {}) } as unknown as Partial<OverlayCreate>)
    this._emit()
    return true
  }

  private _suppressed<T> (fn: () => T): T {
    const prev = this._suppressRecording
    this._suppressRecording = true
    try {
      return fn()
    } finally {
      this._suppressRecording = prev
    }
  }

  /** Remove `id` (if tracked), clearing selection/menu for it. Never records history itself. */
  private _removeTrackedById (id: string): void {
    const chart = this._getChart()
    if (chart === null) {
      return
    }
    const wasSelected = this._selectedId === id
    const hadMenu = this._menu?.id === id
    // Clear the menu BEFORE _setSelection's own _emit() below, so that emit
    // (the only one this method is guaranteed to make) already reflects
    // menu:null. Closing the menu's own onClose (DrawingContextMenu's act())
    // runs closeMenu() right after this — a no-op once _menu is already
    // null — so this was previously the only chance to notify the UI: a
    // right-click menu's own Delete cleared this._menu correctly but never
    // told ChartProComponent, leaving the (now stale) menu on screen for a
    // removed drawing.
    if (hadMenu) {
      this._menu = null
    }
    if (wasSelected) {
      this._setSelection(null, null)
    } else if (hadMenu) {
      this._emit()
    }
    this._suppressed(() => { chart.removeOverlay({ id }) })
    this._userIds.delete(id)
    if (wasSelected) {
      clearChartSelection(chart)
    }
  }

  private _removeAllInternal (): void {
    const chart = this._getChart()
    if (chart === null) {
      return
    }
    // Same ordering as _removeTrackedById above: clear the menu before
    // _setSelection's own _emit(), so remove-all's single notification
    // already reflects menu:null instead of leaving a stale one on screen.
    this._menu = null
    this._setSelection(null, null)
    this._suppressed(() => { this._forEachUserDrawing(id => { chart.removeOverlay({ id }) }) })
    this._userIds.clear()
    clearChartSelection(chart)
  }

  private _captureRecord (overlay: Overlay): DrawingRecord {
    const chart = this._getChart()
    const dataList = dataListOf(chart)
    const zLevel = (overlay as { zLevel?: unknown }).zLevel
    return {
      v: 1,
      name: overlay.name,
      paneId: chart === null ? CANDLE_PANE_ID : paneIdOf(chart, overlay),
      points: (overlay.points as DataPoint[]).map(p => serializePoint(p, dataList)),
      styles: deepClone(overlay.styles ?? undefined) as StyleRecord | null,
      extendData: deepClone(overlay.extendData),
      mode: overlay.mode,
      lock: overlay.lock === true,
      visible: overlay.visible !== false,
      ...(typeof zLevel === 'number' ? { zLevel } : {})
    }
  }

  /** Recreate a record, optionally under a specific id (undo/redo keep the original id alive for later entries). Never records history itself. */
  private _restoreRecord (record: DrawingRecord, id?: string): string | null {
    const chart = this._getChart()
    if (chart === null) {
      return null
    }
    const dataList = dataListOf(chart)
    const points = record.points.map(p => restorePoint(p, dataList))
    const create = this.prepare({
      ...(id !== undefined ? { id } : {}),
      name: record.name,
      points,
      styles: deepClone(record.styles ?? undefined) as OverlayCreate['styles'],
      extendData: deepClone(record.extendData),
      mode: record.mode,
      lock: record.lock,
      visible: record.visible,
      ...(typeof record.zLevel === 'number' ? { zLevel: record.zLevel } : {})
    } as OverlayCreate)
    const created = chart.createOverlay(create, record.paneId)
    const newId = Array.isArray(created) ? created[0] : created
    if (typeof newId !== 'string') {
      return null
    }
    this.track(newId)
    const restored = chart.getOverlayById(newId)
    if (restored !== null && !isComplete(restored) && !completeDrawing(chart, restored)) {
      this._userIds.delete(newId)
      chart.removeOverlay({ id: newId })
      return null
    }
    // prepare() always forces a fresh drawing visible (the drawing bar's own
    // contract, and its own test); a restored one must keep its saved
    // visibility, hidden included, so a second write puts that back.
    if (!record.visible) {
      chart.overrideOverlay({ id: newId, visible: false })
    }
    return newId
  }

  /**
   * Finish creating from clone()/paste(): a drawing left "being drawn" (fewer
   * points than its tool's step count — Any Waves, or any tool ended early)
   * is completed the way klinecharts' own double-click does; if that is not
   * possible on this klinecharts, no copy is made rather than leaving a
   * half-drawn one behind. `fallbackId`, when given, is what klinecharts'
   * selection (handles) falls back to if the copy cannot be selected.
   */
  private _finishCreated (created: unknown, chart: EditorChart, paneId: string, fallbackId: string | null): string | null {
    const newId = Array.isArray(created) ? created[0] : created
    if (typeof newId !== 'string') {
      return null
    }
    this.track(newId)
    const copy = chart.getOverlayById(newId)
    if (copy !== null && !isComplete(copy)) {
      // Was incomplete when created, so onDrawStart's own "already complete"
      // check (below) did not record it, and forceComplete()/
      // progressInstanceComplete() fire no event of their own: this is the
      // only place that can record it.
      if (!completeDrawing(chart, copy)) {
        this._userIds.delete(newId)
        chart.removeOverlay({ id: newId })
        return null
      }
      this._recordCreate(newId)
    }
    if (copy !== null && isComplete(copy)) {
      this._setSelection(newId, this._anchor)
      if (!selectInChart(chart, copy, paneId) && fallbackId !== null) {
        this._setSelection(fallbackId, this._anchor)
      }
    }
    return newId
  }

  private _recordCreate (id: string): void {
    this._scheduleDrawingsChange()
    if (this._suppressRecording) {
      return
    }
    const chart = this._getChart()
    const overlay = chart?.getOverlayById(id) ?? null
    if (chart === null || overlay === null || !isComplete(overlay)) {
      return
    }
    const record = this._captureRecord(overlay)
    this._history.push({
      undo: () => { this._suppressed(() => { this._removeTrackedById(id) }); this._onHistoryChangeCb() },
      redo: () => {
        this._suppressed(() => { this._restoreRecord(record, id) })
        this.select(id, this._anchor)
        this._onHistoryChangeCb()
      }
    })
    this._coalesceKey = null
    this._onHistoryChangeCb()
  }

  private _pushRemoveHistory (items: ReadonlyArray<{ id: string, record: DrawingRecord }>): void {
    this._scheduleDrawingsChange()
    if (this._suppressRecording || items.length === 0) {
      return
    }
    this._history.push({
      undo: () => {
        this._suppressed(() => { items.forEach(({ id, record }) => { this._restoreRecord(record, id) }) })
        this._onHistoryChangeCb()
      },
      redo: () => {
        this._suppressed(() => { items.forEach(({ id }) => { this._removeTrackedById(id) }) })
        this._onHistoryChangeCb()
      }
    })
    this._coalesceKey = null
    this._onHistoryChangeCb()
  }

  private _pushMoveHistory (id: string, before: DataPoint[], after: DataPoint[], coalesceTag: string): void {
    this._recordCoalesced(`${coalesceTag}:${id}`,
      pts => { this._getChart()?.overrideOverlay({ id, points: pts } as unknown as Partial<OverlayCreate>) },
      before, after)
    this._scheduleDrawingsChange()
  }

  private _pushFlagHistory (id: string, field: 'lock' | 'visible', before: boolean, after: boolean, apply: (v: boolean) => void): void {
    this._scheduleDrawingsChange()
    if (this._suppressRecording) {
      return
    }
    this._history.push({
      undo: () => { this._suppressed(() => { apply(before) }); this._onHistoryChangeCb() },
      redo: () => { this._suppressed(() => { apply(after) }); this._onHistoryChangeCb() }
    })
    this._coalesceKey = null
    this._onHistoryChangeCb()
  }

  /**
   * Push a new history entry for `after`, or — if the last thing that
   * happened was another coalesced change with the same key (nothing else
   * ran in between) — just move that same entry's redo target to `after`,
   * merging a drag gesture's/nudge burst's many steps into one undo step.
   * `before` is only used for a fresh entry: the gesture's ORIGINAL value.
   */
  private _recordCoalesced<T> (key: string, apply: (v: T) => void, before: T, after: T): void {
    this._scheduleDrawingsChange()
    if (this._suppressRecording) {
      return
    }
    const top = this._history.top()
    if (this._coalesceKey === key && top !== null) {
      top.redo = () => { this._suppressed(() => { apply(after) }); this._onHistoryChangeCb() }
      this._onHistoryChangeCb()
      return
    }
    this._history.push({
      undo: () => { this._suppressed(() => { apply(before) }); this._onHistoryChangeCb() },
      redo: () => { this._suppressed(() => { apply(after) }); this._onHistoryChangeCb() }
    })
    this._coalesceKey = key
    this._onHistoryChangeCb()
  }
}
