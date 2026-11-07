import type { RealtimeSeries, CandleMode, RealtimeSeriesChange } from './realtimeSeries'
import type { MarketBar } from './types'
import { MIN_BARS, clampViewport, defaultViewport, panViewport, viewportSpan, zoomViewport, type Viewport } from './viewport'
import { nearestBarIndex } from './series'
import { clampContinuousViewport, zoomContinuousViewport } from './continuousViewport'

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

  constructor (private readonly _series: RealtimeSeries, options: { count?: number, mode?: CandleMode, continuous?: boolean } = {}) {
    this._continuous = options.continuous === true
    this._count = this._validCount(options.count ?? 160)
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

  setViewport (viewport: Viewport): void {
    if (this._disposed || this._length === 0 || !Number.isFinite(viewport.i0) || !Number.isFinite(viewport.i1)) return
    const next = this._clamp(viewport)
    if (!this._following && next.i0 === this._viewport.i0 && next.i1 === this._viewport.i1) return
    this._following = false
    this._viewport = next
    this._count = viewportSpan(next)
    this._publish()
  }

  pan (bars: number): void {
    if (!Number.isFinite(bars) || bars === 0) return
    this.setViewport(this._continuous ? { i0: this._viewport.i0 + bars, i1: this._viewport.i1 + bars } : panViewport(this._viewport, this._length, bars))
  }

  zoom (factor: number, anchor = 0.5): void {
    if (!Number.isFinite(factor) || factor <= 0 || !Number.isFinite(anchor)) return
    this.setViewport((this._continuous ? zoomContinuousViewport : zoomViewport)(this._viewport, this._length, factor, anchor))
  }

  followLatest (count = this._count): void {
    if (this._disposed) return
    const size = this._validCount(count)
    const next = this._default(size)
    if (this._following && size === this._count && next.i0 === this._viewport.i0 && next.i1 === this._viewport.i1) return
    this._count = size
    this._following = true
    this._viewport = next
    this._publish()
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
  }

  private _validCount (count: number): number {
    if (!Number.isFinite(count) || count < 1) throw new RangeError('View count must be a positive finite number')
    return Math.max(MIN_BARS, this._continuous ? count : Math.floor(count))
  }

  private _clamp (viewport: Viewport): Viewport {
    return (this._continuous ? clampContinuousViewport : clampViewport)(viewport, this._length)
  }

  private _default (count: number): Viewport {
    return this._continuous ? this._clamp({ i0: Math.max(0, this._length - count), i1: Math.max(0, this._length - 1) }) : defaultViewport(this._length, count)
  }

  private _changed (change: RealtimeSeriesChange): void {
    const oldLength = this._length
    this._length = change.length
    if (change.kind === 'reset') this._following = true
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
    const to = this._continuous ? Math.ceil(this._viewport.i1) : this._viewport.i1
    const data = this._series.snapshot(from, to + 1, this._mode)
    return Object.freeze({
      ...data,
      ...(this._continuous ? { dataStart: from } : {}),
      bars: Object.freeze(data.bars.map(bar => Object.freeze(bar))),
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
