import type { RealtimeSeries, CandleMode, RealtimeSeriesChange } from './realtimeSeries'
import type { MarketBar } from './types'
import { resolveViewportLimits, clampViewport, defaultViewport, panViewport, viewportSpan, zoomViewport, type Viewport, type ViewportLimits } from './viewport'
import { nearestBarIndex } from './series'
import { clampContinuousViewport, zoomContinuousViewport } from './continuousViewport'

interface NavigationState { viewport: Viewport, count: number, following: boolean }

export interface RealtimeViewSnapshot {
  readonly version: number
  readonly viewport: Readonly<Viewport>
  /** First sampled candle index for an opt-in fractional viewport. */
  readonly dataStart?: number
  readonly length: number
  readonly hasMore: boolean
  readonly following: boolean
  readonly mode: CandleMode
  readonly bars: ReadonlyArray<Readonly<MarketBar>>
  /** Indicators always use raw prices, including in Heikin Ashi display mode. */
  readonly ma20: ReadonlyArray<number | null>
  readonly ema21: ReadonlyArray<number | null>
}

/**
 * A cached external-store snapshot for renderer-owned views, with no React or DOM.
 * Create with the host chart lifetime, and dispose alongside the loader on unmount.
 * Gestures call pan/zoom; the host still owns event handling and pixel conversion.
 */
export class RealtimeView {
  private _viewport: Viewport
  private _length: number
  private _following = true
  private _count: number
  private _mode: CandleMode
  private _snapshot: RealtimeViewSnapshot
  private _disposed = false
  private readonly _unsubscribe: () => void
  private readonly _listeners = new Set<() => void>()
  private readonly _continuous: boolean
  private _limits: Readonly<Required<ViewportLimits>>
  private readonly _openingCount: number
  private readonly _historyLimit: number
  private readonly _past: NavigationState[] = []
  private readonly _future: NavigationState[] = []
  private _navigationStart: NavigationState | null = null

  constructor (private readonly _series: RealtimeSeries, options: { count?: number, mode?: CandleMode, continuous?: boolean, limits?: ViewportLimits, navigationHistory?: number } = {}) {
    const historyLimit = options.navigationHistory ?? 32
    if (!Number.isSafeInteger(historyLimit) || historyLimit < 0 || historyLimit > 100) throw new RangeError('Navigation history must be an integer from 0 to 100')
    this._historyLimit = historyLimit
    this._continuous = options.continuous === true
    this._limits = Object.freeze(resolveViewportLimits(options.limits))
    this._count = this._validCount(options.count ?? 160)
    this._openingCount = this._count
    this._mode = options.mode ?? 'raw'
    this._length = _series.getDataList().length
    this._viewport = this._default(this._count)
    this._snapshot = this._read()
    this._unsubscribe = _series.subscribe(change => { this._changed(change) })
  }

  /** Stable function and object identity until the visible state changes. */
  readonly getSnapshot = (): RealtimeViewSnapshot => this._snapshot

  readonly subscribe = (listener: () => void): (() => void) => {
    if (this._disposed) return () => {}
    this._listeners.add(listener)
    return () => { this._listeners.delete(listener) }
  }

  getLimits (): Readonly<Required<ViewportLimits>> { return this._limits }

  /** Apply host zoom bounds without discarding a pinned viewport or its follow state. */
  setLimits (limits: ViewportLimits): void {
    if (this._disposed) return
    const next = resolveViewportLimits(limits)
    if (next.minBars === this._limits.minBars && next.maxBars === this._limits.maxBars && next.rightPaddingBars === this._limits.rightPaddingBars) return
    this._limits = Object.freeze(next)
    this._count = this._validCount(this._count)
    this._viewport = this._following ? this._default(this._count) : this._clamp(this._viewport)
    if (this._navigationStart !== null) this._navigationStart = this._navigationState()
    this._publish()
  }

  setViewport (viewport: Viewport): void {
    if (this._disposed || this._length === 0 || !Number.isFinite(viewport.i0) || !Number.isFinite(viewport.i1)) return
    const next = this._clamp(viewport)
    if (!this._following && next.i0 === this._viewport.i0 && next.i1 === this._viewport.i1) return
    const before = this._navigationStart === null ? this._navigationState() : null
    this._following = false
    this._viewport = next
    this._count = viewportSpan(next)
    if (before !== null) this._recordNavigation(before)
    this._publish()
  }

  pan (bars: number): void {
    if (!Number.isFinite(bars) || bars === 0) return
    this.setViewport(this._continuous ? { i0: this._viewport.i0 + bars, i1: this._viewport.i1 + bars } : panViewport(this._viewport, this._length, bars, this._limits))
  }

  zoom (factor: number, anchor = 0.5): void {
    if (!Number.isFinite(factor) || factor <= 0 || !Number.isFinite(anchor)) return
    this.setViewport((this._continuous ? zoomContinuousViewport : zoomViewport)(this._viewport, this._length, factor, anchor, this._limits))
  }

  followLatest (count = this._count): void {
    if (this._disposed) return
    const size = this._validCount(count)
    const next = this._default(size)
    if (this._following && size === this._count && next.i0 === this._viewport.i0 && next.i1 === this._viewport.i1) return
    const before = this._navigationStart === null ? this._navigationState() : null
    this._count = size
    this._following = true
    this._viewport = next
    if (before !== null) this._recordNavigation(before)
    this._publish()
  }

  /** Return to the host's opening density and follow the newest real candle. */
  resetViewport (): void { this.followLatest(this._openingCount) }

  /** Coalesce one drag/wheel/axis gesture into a single bounded history entry. */
  beginNavigation (): void {
    if (!this._disposed && this._navigationStart === null) this._navigationStart = this._navigationState()
  }

  endNavigation (): void {
    const before = this._navigationStart
    this._navigationStart = null
    if (!this._disposed && before !== null && this._recordNavigation(before)) this._publish(false, true)
  }

  getNavigationHistory (): Readonly<{ canUndo: boolean, canRedo: boolean, limit: number }> {
    return { canUndo: this._past.length > 0, canRedo: this._future.length > 0, limit: this._historyLimit }
  }

  clearNavigationHistory (): void {
    if (this._disposed) return
    const changed = this._past.length > 0 || this._future.length > 0
    this._past.length = 0; this._future.length = 0; this._navigationStart = null
    if (changed) this._publish(false, true)
  }

  undoNavigation (): boolean {
    if (this._disposed) return false
    this.endNavigation()
    const state = this._past.pop()
    if (state === undefined) return false
    this._future.push(this._navigationState())
    this._restoreNavigation(state)
    return true
  }

  redoNavigation (): boolean {
    if (this._disposed) return false
    this.endNavigation()
    const state = this._future.pop()
    if (state === undefined) return false
    this._past.push(this._navigationState())
    this._restoreNavigation(state)
    return true
  }

  setMode (mode: CandleMode): void {
    if (this._disposed || mode === this._mode) return
    this._mode = mode
    this._publish()
  }

  /** Jump to the nearest loaded candle. Does not fetch history outside the loaded range. */
  seek (timestamp: number, anchor = 0.5): boolean {
    if (this._disposed || !Number.isFinite(anchor)) return false
    const index = nearestBarIndex(this._series.getDataList(), timestamp)
    if (index === null) return false
    const span = viewportSpan(this._viewport)
    const offset = Math.max(0, Math.min(1, anchor)) * (span - 1)
    const start = index - (this._continuous ? offset : Math.round(offset))
    this.setViewport({ i0: start, i1: start + span - 1 })
    return true
  }

  requestMore (): void { if (!this._disposed) this._series.requestMore() }

  dispose (): void {
    if (this._disposed) return
    this._disposed = true
    this._unsubscribe()
    this._listeners.clear()
    this._past.length = 0; this._future.length = 0; this._navigationStart = null
  }

  private _navigationState (): NavigationState {
    return { viewport: { ...this._viewport }, count: this._count, following: this._following }
  }

  private _recordNavigation (before: NavigationState): boolean {
    if (this._historyLimit === 0 || (before.following === this._following && (this._following
      ? before.count === this._count
      : before.viewport.i0 === this._viewport.i0 && before.viewport.i1 === this._viewport.i1))) return false
    this._past.push(before)
    if (this._past.length > this._historyLimit) this._past.shift()
    this._future.length = 0
    return true
  }

  private _restoreNavigation (state: NavigationState): void {
    this._following = state.following
    this._count = this._validCount(state.count)
    this._viewport = this._following ? this._default(this._count) : this._clamp(state.viewport)
    if (!this._following) this._count = viewportSpan(this._viewport)
    this._publish()
  }

  private _validCount (count: number): number {
    if (!Number.isFinite(count) || count < 1) throw new RangeError('View count must be a positive finite number')
    return Math.max(this._limits.minBars, Math.min(this._limits.maxBars, this._continuous ? count : Math.floor(count)))
  }

  private _clamp (viewport: Viewport): Viewport {
    return (this._continuous ? clampContinuousViewport : clampViewport)(viewport, this._length, this._limits)
  }

  private _default (count: number): Viewport {
    const extent = Math.min(Number.MAX_SAFE_INTEGER, this._length + this._limits.rightPaddingBars)
    return this._continuous ? this._clamp({ i0: Math.max(0, extent - count), i1: Math.max(0, extent - 1) }) : defaultViewport(this._length, count, this._limits)
  }

  private _changed (change: RealtimeSeriesChange): void {
    const oldLength = this._length
    this._length = change.length
    if (change.kind === 'reset' || change.kind === 'truncate') {
      this._past.length = 0; this._future.length = 0; this._navigationStart = null
      if (change.kind === 'reset') this._following = true
    } else if (change.kind === 'prepend') {
      const added = this._length - oldLength
      for (const state of [...this._past, ...this._future, ...(this._navigationStart === null ? [] : [this._navigationStart])]) {
        state.viewport = { i0: state.viewport.i0 + added, i1: state.viewport.i1 + added }
      }
    }
    if (this._following) {
      this._viewport = this._default(this._count)
    } else if (change.kind === 'prepend') {
      const added = this._length - oldLength
      this._viewport = this._clamp({ i0: this._viewport.i0 + added, i1: this._viewport.i1 + added })
    } else {
      this._viewport = this._clamp(this._viewport)
    }
    // An offscreen replacement cannot affect earlier candles or indicator values.
    // Appends still notify because the range rail and total length changed.
    const lastSample = this._continuous ? Math.ceil(this._viewport.i1) : this._viewport.i1
    if (change.kind === 'tail' && oldLength === this._length && change.from > lastSample &&
        this._snapshot.hasMore === this._series.hasMore) return
    const visibleUnchanged = (change.kind === 'availability' ||
      (change.kind === 'tail' && change.from > lastSample)) &&
      this._snapshot.viewport.i0 === this._viewport.i0 && this._snapshot.viewport.i1 === this._viewport.i1
    this._publish(visibleUnchanged, change.kind === 'availability' || (change.kind === 'tail' && oldLength === this._length && change.from === oldLength - 1))
  }

  private _read (previousViewport?: Readonly<Viewport>): RealtimeViewSnapshot {
    const from = this._continuous ? Math.floor(this._viewport.i0) : this._viewport.i0
    const to = Math.min(this._length - 1, this._continuous ? Math.ceil(this._viewport.i1) : this._viewport.i1)
    const previous = this._snapshot
    // Subpixel movement within the same sampled candles changes projection only.
    // Keep immutable data arrays until the series, mode or integral range changes.
    const reuse = this._continuous && previous !== undefined && previous.version === this._series.version &&
      previous.mode === this._mode && previous.dataStart === from && Math.min(previous.length - 1, Math.ceil(previous.viewport.i1)) === to
    const data = reuse ? previous : this._series.snapshot(from, to + 1, this._mode)
    return Object.freeze({
      ...data,
      ...(this._continuous ? { dataStart: from } : {}),
      bars: reuse ? previous.bars : Object.freeze(data.bars.map(bar => Object.freeze(bar))),
      ma20: Object.freeze(data.ma20),
      ema21: Object.freeze(data.ema21),
      viewport: previousViewport !== undefined && previousViewport.i0 === this._viewport.i0 && previousViewport.i1 === this._viewport.i1
        ? previousViewport : Object.freeze({ ...this._viewport }),
      length: this._length,
      hasMore: this._series.hasMore,
      following: this._following,
      mode: this._mode
    })
  }

  private _publish (visibleUnchanged = false, stableViewport = false): void {
    this._snapshot = visibleUnchanged
      ? Object.freeze({ ...this._snapshot, version: this._series.version, length: this._length, hasMore: this._series.hasMore })
      : this._read(stableViewport && this._continuous ? this._snapshot.viewport : undefined)
    for (const listener of [...this._listeners]) listener()
  }
}
