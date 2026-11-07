// SPDX-License-Identifier: GPL-3.0-or-later
// Realtime ticks, applied at most once per frame. klinecharts recalculates
// every indicator and relays out every axis on each updateData, so a burst of
// 30 ticks in one frame costs 30 passes; the same burst coalesced is one (or
// two when a bar closes inside the frame). At today's consumer rates (one bar
// every 250 ms or slower) this changes nothing; it bounds the cost of feeds
// faster than the frame rate and of backlog bursts after a reconnect.

import type { MarketBar } from './types'

/** Timers the coalescer uses; injected in tests. */
export interface FrameScheduler {
  now: () => number
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (handle: unknown) => void
  /** Undefined where there is no requestAnimationFrame (then timeouts are used). */
  requestFrame?: (fn: () => void) => unknown
  cancelFrame?: (handle: unknown) => void
  /** True while the page is hidden: frames do not fire then, so timeouts are used. */
  hidden: () => boolean
}

export class TickCoalescer {
  private _pending: MarketBar[] = []
  private _frame: unknown = null
  private _timer: unknown = null
  private _lastFlush = -Infinity

  /**
   * @param apply called with the pending bars, oldest first, once per flush
   * @param throttleMs 0: once per frame. More: at most once per that many ms
   *   (adds up to that much latency).
   */
  constructor (
    private readonly _apply: (bars: MarketBar[]) => void,
    private readonly _sched: FrameScheduler,
    private readonly _throttleMs = 0
  ) {}

  /** The newest pending bar's timestamp, if any. */
  lastTs (): number | undefined {
    return this._pending[this._pending.length - 1]?.timestamp
  }

  get size (): number {
    return this._pending.length
  }

  /**
   * Queue a bar. The same timestamp as the newest pending bar replaces it; an
   * older one is dropped (klinecharts would ignore it too) and false returned.
   */
  push (bar: MarketBar): boolean {
    const last = this._pending[this._pending.length - 1]
    if (last !== undefined) {
      if (bar.timestamp < last.timestamp) {
        return false
      }
      if (bar.timestamp === last.timestamp) {
        this._pending[this._pending.length - 1] = bar
        return true
      }
    }
    this._pending.push(bar)
    this._schedule()
    return true
  }

  /** Apply what is pending now. */
  flush (): void {
    this._cancelHandles()
    if (this._pending.length === 0) {
      return
    }
    const bars = this._pending
    this._pending = []
    this._lastFlush = this._sched.now()
    this._apply(bars)
  }

  /** Drop what is pending without applying it. */
  cancel (): void {
    this._cancelHandles()
    this._pending = []
  }

  /**
   * The page was hidden or shown. A frame requested while visible never fires
   * once the page is hidden, so a pending flush moves to a timeout (and back).
   */
  visibilityChanged (): void {
    if (this._pending.length > 0) {
      this._cancelHandles()
      this._schedule()
    }
  }

  private _schedule (): void {
    if (this._frame !== null || this._timer !== null) {
      return
    }
    const s = this._sched
    if (this._throttleMs > 0) {
      const wait = Math.max(0, this._lastFlush + this._throttleMs - s.now())
      this._timer = s.setTimeout(() => { this._timer = null; this.flush() }, wait)
    } else if (!s.hidden() && s.requestFrame !== undefined) {
      this._frame = s.requestFrame(() => { this._frame = null; this.flush() })
    } else {
      this._timer = s.setTimeout(() => { this._timer = null; this.flush() }, 0)
    }
  }

  private _cancelHandles (): void {
    if (this._frame !== null) {
      this._sched.cancelFrame?.(this._frame)
      this._frame = null
    }
    if (this._timer !== null) {
      this._sched.clearTimeout(this._timer)
      this._timer = null
    }
  }
}
