import type { RealtimeSeries, CandleMode, RealtimeSeriesChange } from './realtimeSeries'
import type { MarketBar } from './types'
import { MIN_BARS, clampViewport, defaultViewport, panViewport, viewportSpan, zoomViewport } from './viewport'
import type { Viewport } from './viewport'
import { nearestBarIndex } from './series'

export interface RealtimeViewSnapshot {
  readonly version: number
  readonly viewport: Readonly<Viewport>
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

  constructor (private readonly _series: RealtimeSeries, options: { count?: number, mode?: CandleMode } = {}) {
    this._count = this._validCount(options.count ?? 160)
    this._mode = options.mode ?? 'raw'
    this._length = _series.getDataList().length
    this._viewport = defaultViewport(this._length, this._count)
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
    const next = clampViewport(viewport, this._length)
    if (!this._following && next.i0 === this._viewport.i0 && next.i1 === this._viewport.i1) return
    this._following = false
    this._viewport = next
    this._count = viewportSpan(next)
    this._publish()
  }

  pan (bars: number): void {
    if (!Number.isFinite(bars) || bars === 0) return
    this.setViewport(panViewport(this._viewport, this._length, bars))
  }

  zoom (factor: number, anchor = 0.5): void {
    if (!Number.isFinite(factor) || factor <= 0 || !Number.isFinite(anchor)) return
    this.setViewport(zoomViewport(this._viewport, this._length, factor, anchor))
  }

  followLatest (count = this._count): void {
    if (this._disposed) return
    const size = this._validCount(count)
    const next = defaultViewport(this._length, size)
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
    const start = index - Math.round(Math.max(0, Math.min(1, anchor)) * (span - 1))
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
    return Math.max(MIN_BARS, Math.floor(count))
  }

  private _changed (change: RealtimeSeriesChange): void {
    const oldLength = this._length
    this._length = change.length
    if (change.kind === 'reset') this._following = true
    if (this._following) {
      this._viewport = defaultViewport(this._length, this._count)
    } else if (change.kind === 'prepend') {
      const added = this._length - oldLength
      this._viewport = clampViewport({ i0: this._viewport.i0 + added, i1: this._viewport.i1 + added }, this._length)
    } else {
      this._viewport = clampViewport(this._viewport, this._length)
    }
    // An offscreen replacement cannot affect earlier candles or indicator values.
    // Appends still notify because the range rail and total length changed.
    if (change.kind === 'tail' && oldLength === this._length && change.from > this._viewport.i1 &&
        this._snapshot.hasMore === this._series.hasMore) return
    this._publish()
  }

  private _read (): RealtimeViewSnapshot {
    const data = this._series.snapshot(this._viewport.i0, this._viewport.i1 + 1, this._mode)
    return Object.freeze({
      ...data,
      bars: Object.freeze(data.bars.map(bar => Object.freeze(bar))),
      ma20: Object.freeze(data.ma20),
      ema21: Object.freeze(data.ema21),
      viewport: Object.freeze({ ...this._viewport }),
      length: this._length,
      hasMore: this._series.hasMore,
      following: this._following,
      mode: this._mode
    })
  }

  private _publish (): void {
    this._snapshot = this._read()
    for (const listener of [...this._listeners]) listener()
  }
}
