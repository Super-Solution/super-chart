// SPDX-License-Identifier: GPL-3.0-or-later
// Event marks (earnings, dividends, splits, news) pulled from an optional `Datafeed.getMarks` for the range the view
// shows, drawn through the annotation layer as one marker per bar, with a tooltip and a list for the Objects menu.

import { marksWindow, placeMarks, validateMarks, type Datafeed, type DatafeedMark, type MarkGroup, type MarkRejectCode, type MarkRejection, type MarketBar, type Period, type SymbolInfo } from '@supersolutions/super-chart-core'
import type { EngineAnnotationSpec, EngineAnnotationTone, EngineAnnotations } from './annotations'

/** The annotation layer the marks live in. Other layers are never touched. */
export const MARKS_LAYER = 'datafeed:marks'

export interface WorkspaceMarksState {
  /** `unsupported` the feed has no getMarks; `hidden` the person turned them off; `idle` not asked yet; then `loading`, `ready`, `error`. */
  readonly status: 'unsupported' | 'hidden' | 'idle' | 'loading' | 'ready' | 'error'
  /** Marks placed on a bar, and the markers that draw them (one per bar). */
  readonly marks: number
  readonly markers: number
  /** Valid marks that fall where no bar is loaded (before the first bar, or past the newest): not an error, they appear when the bars do. */
  readonly unplaced: number
  /** Every mark left out of the last answer for a fault or a cap, by stable code (see `MarkRejectCode`), with the first twenty by id. */
  readonly rejected: { readonly total: number, readonly byCode: Readonly<Partial<Record<MarkRejectCode, number>>>, readonly first: readonly MarkRejection[] }
  readonly error: { readonly message: string } | null
  /** The `[from, to)` the last answer covered, ms; null before one. */
  readonly covered: { readonly from: number, readonly to: number } | null
}

export interface DatafeedMarksOptions {
  feed: Datafeed
  annotations: EngineAnnotations
  win: Window & typeof globalThis
  /** The element that holds the chart, for pointer events, and the stage that carries the tooltip. */
  host: HTMLElement
  stage: HTMLElement
  symbol: () => SymbolInfo
  period: () => Period
  /** The annotation scope (the symbol's stable key) and the symbol-plus-interval key; both change when the chart reloads. */
  scopeKey: () => string
  pairKey: () => string
  ready: () => boolean
  bars: () => readonly MarketBar[]
  /** The visible range as fractional bar indices, or null. */
  view: () => { i0: number, i1: number } | null
  /** A moment as text, in the chart's zone and language. */
  format: (time: number) => string
  /** Called after the marks or their state changed (to redraw the Objects list). */
  changed: () => void
}

const SETTLE_MS = 200
const REACH = Object.freeze({ mouse: 10, touch: 18 })
const FIRST_REJECTED = 20

/** How a group of marks reads on the chart: up to three labels, then how many more. */
export function groupLabel (group: MarkGroup): string {
  const shown = group.marks.slice(0, 3).map(mark => mark.label)
  return group.marks.length > 3 ? `${shown.join(' · ')} +${group.marks.length - 3}` : shown.join(' · ')
}

/**
 * The annotation markers for placed marks, one per bar, sitting on the bar's high. A bar whose marks agree on a tone or
 * colour keeps it; marks that disagree show the neutral tone. A bar with no finite high gets no marker.
 */
export function markSpecs (groups: readonly MarkGroup[], bars: ReadonlyArray<Pick<MarketBar, 'high'>>): EngineAnnotationSpec[] {
  const specs: EngineAnnotationSpec[] = []
  for (const group of groups) {
    const high = bars[group.index]?.high
    if (typeof high !== 'number' || !Number.isFinite(high)) continue
    const first = group.marks[0]
    const sameTone = group.marks.every(mark => mark.tone === first.tone), sameColor = group.marks.every(mark => mark.color === first.color)
    const tone: EngineAnnotationTone = sameTone ? first.tone ?? 'neutral' : 'neutral'
    specs.push({
      key: `mark:${group.time}`,
      kind: 'marker',
      anchors: [{ time: group.time, price: high }],
      text: groupLabel(group),
      tone,
      ...(sameColor && first.color !== undefined ? { color: first.color } : {})
    })
  }
  return specs
}

export class DatafeedMarks {
  private enabled = true
  private disposed = false
  private generation = 0
  private abort: AbortController | null = null
  private timer: number | null = null
  private tipTimer: number | null = null
  private appliedKey: string | null = null
  private signature = ''
  private covered: { from: number, to: number } | null = null
  /** The window being fetched now, so a tick or a nudge of the view does not restart a slow answer. */
  private pending: { from: number, to: number } | null = null
  private marks: readonly DatafeedMark[] = []
  private groups: readonly MarkGroup[] = []
  private byKey = new Map<string, MarkGroup>()
  private rejections: readonly MarkRejection[] = []
  private unplacedCount = 0
  private status: WorkspaceMarksState['status']
  private error: { message: string } | null = null
  private state: WorkspaceMarksState
  private readonly tip: HTMLElement
  private readonly controller = new AbortController()

  constructor (private readonly options: DatafeedMarksOptions) {
    this.status = typeof options.feed.getMarks === 'function' ? 'idle' : 'unsupported'
    this.state = this.snapshot()
    const doc = options.host.ownerDocument
    this.tip = doc.createElement('div')
    this.tip.className = 'sc-mark-tip'; this.tip.hidden = true; this.tip.setAttribute('aria-hidden', 'true')
    options.stage.append(this.tip)
    const on = (type: string, listener: (event: PointerEvent) => void): void => { options.host.addEventListener(type, event => { listener(event as PointerEvent) }, { passive: true, signal: this.controller.signal }) }
    on('pointermove', event => { if (event.pointerType === 'mouse' && event.buttons === 0) this.showNear(event, REACH.mouse, false) })
    on('pointerdown', event => { if (event.pointerType !== 'mouse') this.showNear(event, REACH.touch, true); else this.hideTip() })
    // A finger always leaves after it lifts; only the mouse leaving should close a tooltip a tap opened.
    on('pointerleave', event => { if (event.pointerType === 'mouse') this.hideTip() })
  }

  /** Whether the feed can supply marks at all. */
  get supported (): boolean { return this.status !== 'unsupported' }
  get visible (): boolean { return this.enabled }

  getState (): WorkspaceMarksState { return this.state }

  /** Every mark placed on a bar, oldest first. */
  list (): readonly DatafeedMark[] { return this.groups.flatMap(group => group.marks) }

  setEnabled (value: boolean): void {
    if (this.disposed || !this.supported || value === this.enabled) return
    this.enabled = value
    if (!value) { this.cancel(); this.clearLayer(); this.hideTip(); this.marks = []; this.groups = []; this.byKey.clear(); this.covered = null; this.appliedKey = null; this.publish('hidden') } else { this.publish('idle'); this.schedule(0) }
  }

  /** Asks the feed again for the view, even when the last answer still covers it. */
  refresh (): void {
    if (this.disposed || !this.supported || !this.enabled) return
    this.covered = null; this.schedule(0)
  }

  /** Runs when the symbol or interval may have changed: clears the old market's marks at once. */
  sync (): void {
    if (this.disposed || !this.supported) return
    const key = this.options.ready() ? `${this.options.scopeKey()}|${this.options.pairKey()}` : null
    if (key === this.appliedKey) return
    this.cancel(); this.clearLayer(); this.hideTip()
    this.marks = []; this.groups = []; this.byKey.clear(); this.rejections = []; this.unplacedCount = 0; this.covered = null; this.error = null
    this.appliedKey = key; this.signature = ''
    this.publish(this.enabled ? 'idle' : 'hidden')
  }

  /** After each chart frame: cheap unless the view left what was fetched or the bars changed. */
  frame (): void {
    if (this.disposed || !this.supported || !this.enabled) return
    this.sync()
    if (this.appliedKey === null) return
    const bars = this.options.bars(), n = bars.length
    const signature = `${n}|${bars[0]?.timestamp}|${bars[n - 1]?.timestamp}`
    const wanted = this.wanted(), have = this.pending ?? this.covered
    const outside = wanted !== null && (have === null || wanted.viewFrom < have.from || wanted.viewTo > have.to)
    if (!outside && signature === this.signature) return
    this.schedule(SETTLE_MS)
  }

  dispose (): void {
    if (this.disposed) return
    this.disposed = true; this.controller.abort(); this.cancel(); this.tip.remove()
    if (this.tipTimer !== null) this.options.win.clearTimeout(this.tipTimer)
  }

  private wanted (): { viewFrom: number, viewTo: number } | null {
    const view = this.options.view(), bars = this.options.bars(), n = bars.length
    if (view === null || n === 0 || !Number.isFinite(view.i0) || !Number.isFinite(view.i1)) return null
    const at = (index: number): number => bars[Math.max(0, Math.min(n - 1, index))].timestamp
    const step = n >= 2 ? bars[n - 1].timestamp - bars[n - 2].timestamp : 0
    const from = at(Math.floor(view.i0)), to = at(Math.ceil(view.i1)) + (Math.ceil(view.i1) >= n - 1 ? step : 0)
    return to > from ? { viewFrom: from, viewTo: to } : null
  }

  private schedule (delay: number): void {
    if (this.timer !== null) this.options.win.clearTimeout(this.timer)
    this.timer = this.options.win.setTimeout(() => { this.timer = null; this.run() }, delay)
  }

  private cancel (): void {
    this.generation++
    if (this.timer !== null) { this.options.win.clearTimeout(this.timer); this.timer = null }
    this.abort?.abort(); this.abort = null; this.pending = null
  }

  private run (): void {
    if (this.disposed || !this.enabled || !this.options.ready()) return
    this.sync()
    const bars = this.options.bars(), wanted = this.wanted()
    if (wanted === null || this.appliedKey === null) return
    const covers = this.covered !== null && wanted.viewFrom >= this.covered.from && wanted.viewTo <= this.covered.to
    if (covers) { this.apply(); return }
    const window = marksWindow(wanted.viewFrom, wanted.viewTo)
    const getMarks = this.options.feed.getMarks
    if (window === null || getMarks === undefined || bars.length === 0) return
    this.abort?.abort()
    const controller = new AbortController(), generation = ++this.generation
    this.abort = controller; this.pending = window
    this.publish('loading')
    const symbol = this.options.symbol(), period = this.options.period()
    Promise.resolve().then(async () => await getMarks.call(this.options.feed, symbol, period, window.from, window.to, { signal: controller.signal })).then(raw => {
      if (generation !== this.generation || this.disposed) return
      const checked = validateMarks(raw, window)
      this.marks = checked.marks; this.rejections = checked.rejected; this.covered = window; this.pending = null; this.error = null
      this.apply()
    }, (reason: unknown) => {
      if (generation !== this.generation || this.disposed || controller.signal.aborted) return
      // Not retried until the view leaves this window or refresh() is called: a failing server must not be hit on every frame.
      this.covered = window; this.pending = null
      this.error = { message: reason instanceof Error ? reason.message : String(reason) }
      this.publish('error')
    })
  }

  /** Places the marks on the bars as they are now and writes the annotation layer. */
  private apply (): void {
    const bars = this.options.bars(), n = bars.length
    this.signature = `${n}|${bars[0]?.timestamp}|${bars[n - 1]?.timestamp}`
    const placed = placeMarks(this.marks, bars.map(bar => bar.timestamp))
    const specs = markSpecs(placed.groups, bars)
    this.groups = placed.groups; this.byKey = new Map(placed.groups.map(group => [`mark:${group.time}`, group]))
    // The answer's own rejections stay; the cap on a bar is redone each time the bars change, and a mark with no bar is only counted.
    this.rejections = [...this.rejections.filter(item => item.code !== 'too_many_on_bar'), ...placed.rejected.filter(item => item.code === 'too_many_on_bar')]
    this.unplacedCount = placed.rejected.filter(item => item.code === 'no_bar').length
    try {
      const result = this.options.annotations.setAnnotations(MARKS_LAYER, specs, { symbol: this.options.scopeKey() })
      this.error = result.rejected.length === 0 ? null : { message: `The annotation layer refused ${result.rejected.length} marker(s): ${result.rejected[0].code}` }
    } catch (error) {
      this.error = { message: error instanceof Error ? error.message : String(error) }
    }
    this.publish(this.error === null ? 'ready' : 'error')
  }

  private clearLayer (): void {
    try { this.options.annotations.clearAnnotations(MARKS_LAYER) } catch { /* the chart is being disposed */ }
  }

  private snapshot (): WorkspaceMarksState {
    const byCode: Partial<Record<MarkRejectCode, number>> = {}
    for (const item of this.rejections) byCode[item.code] = (byCode[item.code] ?? 0) + 1
    return Object.freeze({
      status: this.status,
      marks: this.groups.reduce((sum, group) => sum + group.marks.length, 0),
      markers: this.groups.length,
      unplaced: this.unplacedCount,
      rejected: Object.freeze({
        total: this.rejections.length,
        byCode: Object.freeze(byCode),
        first: Object.freeze(this.rejections.slice(0, FIRST_REJECTED))
      }),
      error: this.error === null ? null : Object.freeze({ ...this.error }),
      covered: this.covered === null ? null : Object.freeze({ ...this.covered })
    })
  }

  private publish (status: WorkspaceMarksState['status']): void {
    this.status = status; this.state = this.snapshot()
    if (!this.disposed) this.options.changed()
  }

  // The tooltip is for the pointer. The same words are in the Objects list, which the keyboard and screen readers reach.
  private showNear (event: PointerEvent, reach: number, toggle: boolean): void {
    if (this.disposed || !this.enabled) return
    const rect = this.options.host.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top
    let best: { group: MarkGroup, x: number, y: number } | null = null, distance = reach
    for (const item of this.options.annotations.getSnapshot().annotations) {
      if (item.layer !== MARKS_LAYER || item.status !== 'visible' || item.point === undefined) continue
      const group = this.byKey.get(item.spec.key), d = Math.hypot(item.point.x - x, item.point.y - y)
      if (group !== undefined && d <= distance) { best = { group, x: item.point.x, y: item.point.y }; distance = d }
    }
    if (best === null) { this.hideTip(); return }
    if (toggle && !this.tip.hidden && this.tip.dataset.key === `mark:${best.group.time}`) { this.hideTip(); return }
    const doc = this.options.host.ownerDocument
    const rows = best.group.marks.map(mark => {
      const row = doc.createElement('div'); row.className = 'sc-mark-tip-row'
      const label = doc.createElement('strong'); label.textContent = mark.label
      row.append(label)
      if (mark.text !== undefined && mark.text !== '') row.append(` ${mark.text}`)
      return row
    })
    const head = doc.createElement('div'); head.className = 'sc-mark-tip-time'; head.textContent = this.options.format(best.group.time)
    this.tip.replaceChildren(head, ...rows)
    this.tip.dataset.key = `mark:${best.group.time}`; this.tip.hidden = false
    const stage = this.options.stage.getBoundingClientRect()
    const width = this.tip.offsetWidth, height = this.tip.offsetHeight
    const left = Math.max(4, Math.min(best.x + 12, stage.width - width - 4))
    const top = best.y + 16 + height > stage.height ? Math.max(4, best.y - height - 12) : best.y + 16
    this.tip.style.left = `${Math.round(left)}px`; this.tip.style.top = `${Math.round(top)}px`
    if (this.tipTimer !== null) this.options.win.clearTimeout(this.tipTimer)
    this.tipTimer = toggle ? this.options.win.setTimeout(() => { this.hideTip() }, 6000) : null
  }

  private hideTip (): void {
    if (this.tipTimer !== null) { this.options.win.clearTimeout(this.tipTimer); this.tipTimer = null }
    if (!this.tip.hidden) { this.tip.hidden = true; delete this.tip.dataset.key }
  }
}
