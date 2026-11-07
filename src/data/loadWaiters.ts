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

// SC-023: setSymbol/setPeriod are void in v1, so an agent (or a host) has no
// way to await a change before reading bars. LoadWaiterQueue is the part that
// turns "I just called setSymbol" into a Promise<LoadResult> that settles
// once, however many calls were coalesced into the load it started:
//
// - Calls in the same tick (setSymbol then setPeriod, or a change followed by
//   a change back to the original pair) share one outcome. 'unchanged' when
//   the net effect, compared to the pair before this batch, fetches nothing
//   new; otherwise the pair this batch settles on becomes "active".
// - A later batch that starts before the active one has landed resolves the
//   active batch's waiters 'superseded'.
// - Once the loader (src/data/loader.ts) reports the active pair's load has
//   settled (ready, empty or error), settle() resolves its waiters.
//
// This class is deliberately not the loader itself: it only reasons about
// *when a batch starts and settles*, driven by whatever already decides that
// (a Solid effect over the symbol/period signals, in production; a plain
// call in tests). It never calls the datafeed or touches klinecharts.

import type { Period, SymbolInfo } from '../core/feed'

export type LoadOutcome =
  | { status: 'loaded', symbol: SymbolInfo, period: Period, bars: number }
  | { status: 'unchanged', symbol: SymbolInfo, period: Period }
  | { status: 'superseded', by: { symbol: SymbolInfo, period: Period } }
  | { status: 'error', symbol: SymbolInfo, period: Period, message: string, timeout: boolean }
  | { status: 'disposed' }

interface Waiter {
  resolve: (outcome: LoadOutcome) => void
}

interface ActiveBatch {
  key: string
  symbol: SymbolInfo
  period: Period
  waiters: Waiter[]
}

export interface FinalPair {
  key: string
  symbol: SymbolInfo
  period: Period
}

export class LoadWaiterQueue {
  private _pending: Waiter[] = []
  private _scheduled = false
  private _batchBaseline: string | null = null
  private _active: ActiveBatch | null = null
  private _lastKey: string
  private _disposed = false
  private readonly _getFinal: () => FinalPair
  private readonly _queueMicrotask: (fn: () => void) => void

  /**
   * `initialKey` is the pair's key at construction (nothing to compare a
   * first batch against otherwise). `getFinal` reads the current symbol,
   * period and their key *after* this tick's signal writes have all
   * applied — a Solid accessor read with `untrack`, in production.
   */
  constructor (initialKey: string, getFinal: () => FinalPair, schedule: (fn: () => void) => void = fn => { queueMicrotask(fn) }) {
    this._lastKey = initialKey
    this._getFinal = getFinal
    this._queueMicrotask = schedule
  }

  /** Call once per setSymbol/setPeriod call, after its signal write. */
  async wait (): Promise<LoadOutcome> {
    return await new Promise(resolve => {
      if (this._disposed) {
        resolve({ status: 'disposed' })
        return
      }
      if (this._pending.length === 0) {
        this._batchBaseline = this._lastKey
      }
      this._pending.push({ resolve })
      if (!this._scheduled) {
        this._scheduled = true
        this._queueMicrotask(() => { this._scheduled = false; this._flush() })
      }
    })
  }

  private _flush (): void {
    if (this._pending.length === 0) {
      return
    }
    const batch = this._pending
    this._pending = []
    const final = this._getFinal()
    const baseline = this._batchBaseline ?? final.key
    this._lastKey = final.key
    if (final.key === baseline) {
      for (const w of batch) {
        w.resolve({ status: 'unchanged', symbol: final.symbol, period: final.period })
      }
      return
    }
    if (this._active !== null) {
      const by = { symbol: final.symbol, period: final.period }
      for (const w of this._active.waiters) {
        w.resolve({ status: 'superseded', by })
      }
    }
    this._active = { key: final.key, symbol: final.symbol, period: final.period, waiters: batch }
  }

  /**
   * The loader reported that `shownKey`'s pair settled: resolve the active
   * batch's waiters if it is the one waiting on that pair. A settle for any
   * other key (a load this queue never started waiting on, or one already
   * superseded) is ignored.
   */
  settle (shownKey: string, outcome: Extract<LoadOutcome, { status: 'loaded' | 'error' }>): void {
    if (this._active === null || this._active.key !== shownKey) {
      return
    }
    const waiters = this._active.waiters
    this._active = null
    for (const w of waiters) {
      w.resolve(outcome)
    }
  }

  /** Settle everything still waiting with 'disposed'; later wait() calls resolve the same way. */
  dispose (): void {
    this._disposed = true
    const pending = this._pending
    this._pending = []
    for (const w of pending) {
      w.resolve({ status: 'disposed' })
    }
    const active = this._active
    this._active = null
    if (active !== null) {
      for (const w of active.waiters) {
        w.resolve({ status: 'disposed' })
      }
    }
  }
}
