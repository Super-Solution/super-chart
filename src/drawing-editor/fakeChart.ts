// Test double for the klinecharts Chart, modelling the 9.1.1 behaviour the
// drawing editor depends on: ids and default group ids, styles replaced by
// reference, override/remove filters (no filter = every overlay), the click
// selection callbacks (onClick, then onDeselected/onSelected when the id
// changes), right-click removal unless onRightClick returns true, per-template
// step counts (an overlay created with fewer than totalStep - 1 points is left
// "being drawn", as OverlayImp.setPoints does), where a point is drawn
// (timestampToDataIndex's nearest-bar search), value <-> pixel on a linear or
// log y-axis, and the private overlay store (getChartStore().getOverlayStore()).
// Used only by tests.

import type { OverlayCreate, OverlayEvent } from 'klinecharts'

type Callback = ((e: OverlayEvent) => boolean) | null | undefined

export interface FakeOverlay {
  id: string
  groupId: string
  name: string
  points: Array<{ dataIndex?: number, timestamp?: number, value?: number }>
  styles: Record<string, Record<string, unknown>> | null
  lock: boolean
  visible: boolean
  mode: string
  extendData: unknown
  currentStep: number
  totalStep: number
  zLevel?: number
  forceComplete?: () => void
  onDrawStart?: Callback
  onDrawEnd?: Callback
  onClick?: Callback
  onRightClick?: Callback
  onSelected?: Callback
  onDeselected?: Callback
  onRemoved?: Callback
  onPressedMoveStart?: Callback
  onPressedMoveEnd?: Callback
}

const CALLBACKS = [
  'onDrawStart', 'onDrawEnd', 'onClick', 'onRightClick', 'onSelected', 'onDeselected', 'onRemoved',
  'onPressedMoveStart', 'onPressedMoveEnd'
] as const

export const FAKE_DEFAULT_OVERLAY_STYLES = {
  line: { style: 'solid', smooth: false, color: '#1677FF', size: 1, dashedValue: [2, 2] },
  polygon: { style: 'fill', color: '#1677FF', borderColor: '#1677FF', borderSize: 1, borderStyle: 'solid', borderDashedValue: [2, 2] },
  circle: { style: 'fill', color: 'rgba(22, 119, 255, 0.25)', borderColor: '#1677FF', borderSize: 1, borderStyle: 'solid', borderDashedValue: [2, 2] },
  text: { color: '#1677FF', size: 12 }
}

/** Template styles shared by every instance, as klinecharts 9.1.1 does. */
export const RECT_TEMPLATE_STYLES = { polygon: { color: 'rgba(22, 119, 255, 0.15)' } }

/** totalStep of the templates the tests use (klinecharts / Super Chart values); anything else is 2. */
const TOTAL_STEPS: Record<string, number> = {
  rect: 3,
  threeWaves: 5,
  anyWaves: Number.MAX_SAFE_INTEGER
}

export const FAKE_BAR_MS = 60_000

/** A log y-axis spanning [min, max] over `height` px, as klinecharts' YAxisImp does for type 'log'. */
export interface FakeLogAxis {
  min: number
  max: number
  height: number
}

export interface FakeChartOptions {
  /** Model klinecharts >= 9.x with zLevel (and paneId on overlays). */
  withZLevel?: boolean
  /** Model a klinecharts without the private overlay store. */
  withoutStore?: boolean
  /** Model overlay instances without forceComplete. */
  withoutForceComplete?: boolean
  /** Number of loaded bars (timestamps 0, FAKE_BAR_MS, ...). Default 5. */
  bars?: number
  /** A log y-axis instead of the default linear one (value = 110 - y * 10 / 16). */
  logAxis?: FakeLogAxis
  /** Overlay defaults (getStyles().overlay) per figure type, e.g. a theme's accent. Default: klinecharts' own. */
  overlayDefaults?: Partial<typeof FAKE_DEFAULT_OVERLAY_STYLES>
  /** Model Super Chart's rect, whose template carries no styles (its fill comes from the accent). */
  rectWithoutTemplateStyles?: boolean
}

/**
 * klinecharts' binarySearchNearest over the data list, which is what
 * timestampToDataIndex returns (same code in 9.1.1 and 9.8.12). It answers
 * length - 2 for any timestamp past the last bar.
 */
export function klinechartsTimestampToDataIndex (timeline: readonly number[], timestamp: number): number {
  if (timeline.length === 0) return 0
  let left = 0
  let right = timeline.length - 1
  while (left !== right) {
    const midIndex = Math.floor((right + left) / 2)
    const mid = right - left
    if (timestamp === timeline[left]) return left
    if (timestamp === timeline[right]) return right
    if (timestamp === timeline[midIndex]) return midIndex
    if (timestamp > timeline[midIndex]) {
      left = midIndex
    } else {
      right = midIndex
    }
    if (mid <= 2) break
  }
  return left
}

export class FakeChart {
  private _seq = 0
  readonly panes = new Map<string, FakeOverlay[]>()
  progress: { paneId: string, overlay: FakeOverlay } | null = null
  click: { paneId: string, instance: FakeOverlay | null, figureType: number, figureIndex: number, attrsIndex: number } =
    { paneId: 'candle_pane', instance: null, figureType: 0, figureIndex: -1, attrsIndex: -1 }

  readonly calls: Array<{ method: string, arg: unknown }> = []

  constructor (private readonly options: FakeChartOptions = {}) {
    if (options.withoutStore === true) {
      // shadow the private API
      ;(this as unknown as { getChartStore: undefined }).getChartStore = undefined
    }
  }

  // ---- public Chart API subset ------------------------------------------------

  createOverlay (value: OverlayCreate, paneId = 'candle_pane'): string | null {
    this.calls.push({ method: 'createOverlay', arg: value })
    const id = value.id ?? `overlay_${++this._seq}`
    if (this.getOverlayById(id) !== null) {
      return null
    }
    value.id = id
    value.groupId = value.groupId ?? id
    const totalStep = TOTAL_STEPS[value.name] ?? 2
    const pointCount = value.points?.length ?? 0
    const complete = pointCount >= totalStep - 1
    const overlay: FakeOverlay = {
      id,
      groupId: value.groupId,
      name: value.name,
      points: (value.points ?? []) as FakeOverlay['points'],
      styles: (value.styles as FakeOverlay['styles']) ?? (value.name === 'rect' && this.options.rectWithoutTemplateStyles !== true ? RECT_TEMPLATE_STYLES : null),
      lock: value.lock ?? false,
      visible: value.visible ?? true,
      mode: value.mode ?? 'normal',
      extendData: value.extendData,
      currentStep: complete ? -1 : pointCount + 1,
      totalStep
    }
    if (this.options.withoutForceComplete !== true) {
      overlay.forceComplete = () => { overlay.currentStep = -1 }
    }
    if (this.options.withZLevel === true) {
      overlay.zLevel = (value as { zLevel?: number }).zLevel ?? 0
      ;(overlay as unknown as { paneId: string }).paneId = paneId
    }
    CALLBACKS.forEach(k => { if (value[k] !== undefined) overlay[k] = value[k] as Callback })
    if (complete) {
      this._pane(paneId).push(overlay)
      this._sort(paneId)
    } else {
      this.progress = { paneId, overlay }
    }
    overlay.onDrawStart?.({ overlay } as unknown as OverlayEvent)
    return id
  }

  getOverlayById (id: string): FakeOverlay | null {
    for (const list of this.panes.values()) {
      const found = list.find(o => o.id === id)
      if (found !== undefined) return found
    }
    return this.progress?.overlay.id === id ? this.progress.overlay : null
  }

  overrideOverlay (o: Partial<FakeOverlay>): void {
    this.calls.push({ method: 'overrideOverlay', arg: o })
    const targets = o.id !== undefined
      ? [this.getOverlayById(o.id)].filter((v): v is FakeOverlay => v !== null)
      : this.all().filter(i => (o.name !== undefined && i.name === o.name) || (o.groupId !== undefined && i.groupId === o.groupId) || (o.name === undefined && o.groupId === undefined))
    targets.forEach(t => {
      if (o.styles !== undefined) t.styles = o.styles // replaced by reference, like 9.1.1
      if (o.lock !== undefined) t.lock = o.lock
      if (o.visible !== undefined) t.visible = o.visible
      if (o.mode !== undefined) t.mode = o.mode
      if (o.points !== undefined) t.points = o.points
      if (this.options.withZLevel === true && typeof o.zLevel === 'number') {
        t.zLevel = o.zLevel
        this.panes.forEach((_, paneId) => this._sort(paneId))
      }
    })
  }

  removeOverlay (r?: string | { id?: string, groupId?: string, name?: string }): void {
    this.calls.push({ method: 'removeOverlay', arg: r })
    const remove = typeof r === 'string' ? { id: r } : r
    const match = (o: FakeOverlay): boolean => {
      if (remove === undefined) return true
      if (remove.id !== undefined) return o.id === remove.id
      if (remove.groupId !== undefined) return o.groupId === remove.groupId
      if (remove.name !== undefined) return o.name === remove.name
      return true
    }
    if (this.progress !== null && match(this.progress.overlay)) {
      const o = this.progress.overlay
      this.progress = null
      o.onRemoved?.({ overlay: o } as unknown as OverlayEvent)
    }
    this.panes.forEach((list, paneId) => {
      const keep: FakeOverlay[] = []
      list.forEach(o => {
        if (match(o)) {
          o.onRemoved?.({ overlay: o } as unknown as OverlayEvent)
        } else {
          keep.push(o)
        }
      })
      this.panes.set(paneId, keep)
    })
    // like klinecharts, the click info is NOT cleared
  }

  getStyles (): { overlay: typeof FAKE_DEFAULT_OVERLAY_STYLES } {
    return { overlay: { ...FAKE_DEFAULT_OVERLAY_STYLES, ...this.options.overlayDefaults } }
  }

  convertToPixel (points: Array<{ value?: number }>): Array<{ y?: number }> {
    this.calls.push({ method: 'convertToPixel', arg: points })
    return points.map(p => (typeof p.value === 'number' ? { y: this.valueToY(p.value) } : {}))
  }

  convertFromPixel (coords: Array<{ x?: number, y?: number }>): Array<{ value?: number }> {
    return coords.map(c => (typeof c.y === 'number' ? { value: this.yToValue(c.y) } : {}))
  }

  valueToY (value: number): number {
    const log = this.options.logAxis
    if (log === undefined) return (110 - value) * 1.6
    const span = Math.log10(log.max) - Math.log10(log.min)
    return (Math.log10(log.max) - Math.log10(value)) / span * log.height
  }

  yToValue (y: number): number {
    const log = this.options.logAxis
    if (log === undefined) return 110 - y * (10 / 16)
    const span = Math.log10(log.max) - Math.log10(log.min)
    return 10 ** (Math.log10(log.max) - y / log.height * span)
  }

  getDataList (): Array<{ timestamp: number }> {
    return Array.from({ length: this.options.bars ?? 5 }, (_, i) => ({ timestamp: i * FAKE_BAR_MS }))
  }

  /** The bar klinecharts draws a point at (OverlayView._drawOverlay: the timestamp wins over dataIndex). */
  drawnDataIndex (point: { dataIndex?: number, timestamp?: number }): number | undefined {
    if (point.timestamp !== undefined) {
      return klinechartsTimestampToDataIndex(this.getDataList().map(d => d.timestamp), point.timestamp)
    }
    return point.dataIndex
  }

  // ---- private store (getChartStore().getOverlayStore()) ----------------------

  getChartStore (): { getOverlayStore: () => unknown } {
    return {
      getOverlayStore: () => ({
        getClickInstanceInfo: () => this.click,
        setClickInstanceInfo: (info: FakeChart['click'], event: Record<string, unknown>) => { this._setClick(info, event) },
        getInstances: (paneId?: string) => (paneId === undefined ? this.all() : (this.panes.get(paneId) ?? [])),
        getProgressInstanceInfo: () => (this.progress === null ? null : { paneId: this.progress.paneId, instance: this.progress.overlay }),
        progressInstanceComplete: () => { this._progressComplete() }
      })
    }
  }

  // ---- user gestures -----------------------------------------------------------

  /** A click on an overlay figure. */
  clickOverlay (id: string, at = { pageX: 100, pageY: 200 }): void {
    const o = this.getOverlayById(id)
    if (o === null) throw new Error(`no overlay ${id}`)
    this._setClick({ paneId: this._paneOf(id), instance: o, figureType: 2, figureIndex: 0, attrsIndex: 0 }, at)
  }

  /** A click on empty chart space. */
  clickEmpty (): void {
    this._setClick({ paneId: 'candle_pane', instance: null, figureType: 0, figureIndex: -1, attrsIndex: -1 }, {})
  }

  /** The placement clicks of an in-progress drawing: the first selects it mid-drawing, the last completes it. */
  placeProgress (clicks: number): void {
    const p = this.progress
    if (p === null) throw new Error('nothing in progress')
    for (let i = 0; i < clicks; i++) {
      const o = p.overlay
      o.points.push({ dataIndex: i, value: i })
      if (o.points.length >= o.totalStep - 1) {
        o.currentStep = -1
        this.progress = null
        this._pane(p.paneId).push(o)
        o.onDrawEnd?.({ overlay: o, pageX: 1, pageY: 2 } as unknown as OverlayEvent)
      } else {
        o.currentStep = o.points.length + 1
      }
      this._setClick({ paneId: p.paneId, instance: o, figureType: 1, figureIndex: o.points.length - 1, attrsIndex: 0 }, { pageX: 1, pageY: 2 })
    }
  }

  /** A double-click while a drawing is in progress: klinecharts finishes it with the points it has. */
  doubleClick (): void {
    const p = this.progress
    if (p === null) throw new Error('nothing in progress')
    p.overlay.currentStep = -1
    this._progressComplete()
    p.overlay.onDrawEnd?.({ overlay: p.overlay, pageX: 1, pageY: 2 } as unknown as OverlayEvent)
  }

  rightClick (id: string, at = { pageX: 321, pageY: 123 }): void {
    const o = this.getOverlayById(id)
    if (o === null) throw new Error(`no overlay ${id}`)
    if (!(o.onRightClick?.({ overlay: o, ...at } as unknown as OverlayEvent) ?? false)) {
      this.removeOverlay({ id })
    }
  }

  /** A drag gesture: onPressedMoveStart, then the points change in place, then onPressedMoveEnd. */
  pressedMove (id: string, newPoints: FakeOverlay['points']): void {
    const o = this.getOverlayById(id)
    if (o === null) throw new Error(`no overlay ${id}`)
    o.onPressedMoveStart?.({ overlay: o } as unknown as OverlayEvent)
    o.points = newPoints
    o.onPressedMoveEnd?.({ overlay: o } as unknown as OverlayEvent)
  }

  all (): FakeOverlay[] {
    return [...this.panes.values()].flat()
  }

  private _setClick (info: FakeChart['click'], event: Record<string, unknown>): void {
    const prev = this.click.instance
    const next = info.instance
    if (next !== null && next.currentStep === -1) {
      next.onClick?.({ overlay: next, ...event } as unknown as OverlayEvent)
    }
    if (prev?.id !== next?.id || this.click.figureType !== info.figureType || this.click.figureIndex !== info.figureIndex) {
      this.click = info
      if (prev?.id !== next?.id) {
        prev?.onDeselected?.({ overlay: prev, ...event } as unknown as OverlayEvent)
        next?.onSelected?.({ overlay: next, ...event } as unknown as OverlayEvent)
      }
    }
  }

  private _progressComplete (): void {
    const p = this.progress
    if (p !== null && p.overlay.currentStep === -1) {
      this._pane(p.paneId).push(p.overlay)
      this._sort(p.paneId)
      this.progress = null
    }
  }

  private _pane (paneId: string): FakeOverlay[] {
    let list = this.panes.get(paneId)
    if (list === undefined) {
      list = []
      this.panes.set(paneId, list)
    }
    return list
  }

  private _paneOf (id: string): string {
    for (const [paneId, list] of this.panes) {
      if (list.some(o => o.id === id)) return paneId
    }
    return this.progress?.paneId ?? 'candle_pane'
  }

  private _sort (paneId: string): void {
    if (this.options.withZLevel === true) {
      this.panes.get(paneId)?.sort((a, b) => (a.zLevel ?? 0) - (b.zLevel ?? 0))
    }
  }
}
