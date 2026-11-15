import type { ChartDataPort } from './chartPort'
import type { MarketBar } from './types'
import { toHeikinAshi } from './heikinAshi'

export type CandleMode = 'raw' | 'heikin-ashi'

export interface RealtimeSeriesChange {
  kind: 'reset' | 'prepend' | 'tail' | 'truncate' | 'availability'
  /** First potentially changed index, inclusive. */
  from: number
  length: number
  version: number
}

/**
 * Renderer-free sink for DataLoader. MA20 and EMA21 use the native first-close
 * EMA seed (not the Web SMA seed). Inputs must be normalized, ascending bars.
 * History changes rebuild; live updates only calculate the changed tail.
 */
export class RealtimeSeries implements ChartDataPort {
  private _bars: MarketBar[] = []
  private _ha: MarketBar[] | null = null
  private _ma: Array<number | null> = []
  private _ema: Array<number | null> = []
  private _sum = 0
  private _previous: number | null = null
  private _sumBeforeLast = 0
  private _emaBeforeLast: number | null = null
  private _version = 0
  private _more = false
  private _loadMore: ((timestamp: number | null) => void) | null = null
  private readonly _listeners = new Set<(change: RealtimeSeriesChange) => void>()
  private readonly _referenceIndicators: boolean

  /** Hosts with their own indicator registry can omit the native reference MA/EMA. */
  constructor (options: { referenceIndicators?: boolean } = {}) { this._referenceIndicators = options.referenceIndicators !== false }

  get version (): number { return this._version }
  get hasMore (): boolean { return this._more }

  /** Borrowed current data for the loader: do not mutate or retain as a snapshot. */
  getDataList (): MarketBar[] { return this._bars }
  getLastTimestamp (): number | undefined { return this._bars[this._bars.length - 1]?.timestamp }

  /** Copy only the visible range for React/native render state; end is exclusive. */
  snapshot (start = 0, end = this._bars.length, mode: CandleMode = 'raw'): {
    version: number
    bars: MarketBar[]
    ma20: Array<number | null>
    ema21: Array<number | null>
  } {
    let candles = this._bars
    if (mode === 'heikin-ashi') {
      if (this._ha === null) this._ha = toHeikinAshi(this._bars)
      candles = this._ha
    }
    return {
      version: this._version,
      bars: candles.slice(start, end).map(bar => ({ ...bar })),
      ma20: this._ma.slice(start, end),
      ema21: this._ema.slice(start, end)
    }
  }

  subscribe (listener: (change: RealtimeSeriesChange) => void): () => void {
    this._listeners.add(listener)
    return () => { this._listeners.delete(listener) }
  }

  loadMore (callback: (timestamp: number | null) => void): void { this._loadMore = callback }

  /** Host calls this when its own viewport reaches the oldest loaded bar. */
  requestMore (): void {
    if (this._more) this._loadMore?.(this._bars[0]?.timestamp ?? null)
  }

  applyNewData (bars: MarketBar[], more = false): void {
    this._bars = this._copyValidated(bars)
    this._more = more
    this._rebuild()
    this._emit('reset', 0)
  }

  /** Drop a replay suffix without cloning the prefix or retaining future prices. */
  truncateData (length: number, expectedLength: number, expectedLastTimestamp: number): boolean {
    if (!Number.isSafeInteger(length) || length < 1 || length > this._bars.length ||
        this._bars.length !== expectedLength || this.getLastTimestamp() !== expectedLastTimestamp) return false
    if (length === this._bars.length) return true
    this._bars.length = length
    if (this._referenceIndicators) this._rebuild()
    else if (this._ha !== null) this._ha.length = length
    this._emit('truncate', length)
    return true
  }

  applyMoreData (bars: MarketBar[], more = false): void {
    this._validate(bars)
    const first = this._bars[0]?.timestamp ?? Infinity
    const older = bars.filter(bar => bar.timestamp < first).map(bar => ({ ...bar }))
    const moreChanged = this._more !== more
    this._more = more
    if (older.length === 0) {
      if (moreChanged) this._emit('availability', this._bars.length)
      return
    }
    this._bars = older.concat(this._bars)
    this._rebuild()
    this._emit('prepend', 0)
  }

  updateData (bar: MarketBar): void { this.updateDataBatch([bar]) }

  /** One notification per batch. Old ticks are ignored; equal-tail ticks replace. */
  updateDataBatch (bars: MarketBar[], more?: boolean): void {
    // Validate the complete batch before changing state. Equal timestamps are valid.
    this._validate(bars, true)
    const moreChanged = more !== undefined && this._more !== more
    if (more !== undefined) this._more = more
    let from = this._bars.length
    let changed = false
    for (const bar of bars) {
      const index = this._bars.length - 1
      const last = this._bars[index]
      if (last !== undefined && bar.timestamp < last.timestamp) continue
      if (last !== undefined && bar.timestamp === last.timestamp) {
        this._bars[index] = { ...bar }
        this._sum = this._sumBeforeLast
        this._previous = this._emaBeforeLast
        this._calculate(index)
        from = Math.min(from, index)
      } else {
        this._bars.push({ ...bar })
        this._calculate(index + 1)
      }
      changed = true
    }
    if (changed) this._emit('tail', from)
    else if (moreChanged) this._emit('availability', this._bars.length)
  }

  /** Explicit history correction: use a complete reset, never an identity-based cache. */
  private _rebuild (): void {
    if (this._ha !== null) this._ha = []
    this._ma = []
    this._ema = []
    this._sum = 0
    this._previous = null
    this._sumBeforeLast = 0
    this._emaBeforeLast = null
    if (this._referenceIndicators || this._ha !== null) {
      for (let i = 0; i < this._bars.length; i++) this._calculate(i)
    }
  }

  private _calculate (i: number): void {
    if (this._referenceIndicators) {
      this._sumBeforeLast = this._sum
      this._emaBeforeLast = this._previous
      const close = this._bars[i].close
      this._sum += close
      if (i >= 20) this._sum -= this._bars[i - 20].close
      this._ma[i] = i >= 19 ? this._sum / 20 : null
      this._previous = this._previous === null ? close : close * (2 / 22) + this._previous * (1 - 2 / 22)
      this._ema[i] = i >= 20 ? this._previous : null
    }
    if (this._ha !== null) {
      const bar = this._bars[i]
      const prev = this._ha[i - 1]
      const close = (bar.open + bar.high + bar.low + bar.close) / 4
      const open = prev === undefined ? (bar.open + bar.close) / 2 : (prev.open + prev.close) / 2
      this._ha[i] = { ...bar, open, close, high: Math.max(bar.high, open, close), low: Math.min(bar.low, open, close) }
    }
  }

  /** Validate the owned copy before publishing it; caller mutation cannot change the series. */
  private _copyValidated (bars: readonly MarketBar[]): MarketBar[] {
    const owned: MarketBar[] = []
    let previous = -Infinity
    for (const input of bars) {
      const bar = { ...input }
      this._validateBar(bar, previous, false)
      owned.push(bar); previous = bar.timestamp
    }
    return owned
  }

  private _validateBar (bar: MarketBar, previous: number, equal: boolean): void {
    if (!Number.isFinite(bar.timestamp) || !Number.isFinite(bar.open) ||
        !Number.isFinite(bar.high) || !Number.isFinite(bar.low) || !Number.isFinite(bar.close) ||
        (equal ? bar.timestamp < previous : bar.timestamp <= previous)) {
      throw new RangeError('RealtimeSeries requires finite OHLC and ascending normalized timestamps')
    }
  }

  private _validate (bars: MarketBar[], equal = false): void {
    let previous = -Infinity
    for (const bar of bars) {
      this._validateBar(bar, previous, equal)
      previous = bar.timestamp
    }
  }

  private _emit (kind: RealtimeSeriesChange['kind'], from: number): void {
    const change = { kind, from, length: this._bars.length, version: ++this._version }
    for (const listener of [...this._listeners]) listener(change)
  }
}
