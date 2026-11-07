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

// Pure helpers for the symbol search modal's keyboard navigation (SC-106)
// and its recent-symbols list (SC-111). Kept separate from index.tsx so the
// decisions are unit-testable without Solid or a DOM.
//
// Part of SUPer-Chart (Apache-2.0).

/** ArrowDown/ArrowUp over a list of `length` rows, wrapping; -1 (none active) moves to the first/last. */
export function moveActiveIndex (current: number, delta: number, length: number): number {
  if (length <= 0) {
    return -1
  }
  if (current < 0) {
    return delta >= 0 ? 0 : length - 1
  }
  return ((current + delta) % length + length) % length
}

/** Clamped into range, or -1 for an empty list. */
export function clampActiveIndex (index: number, length: number): number {
  if (length <= 0) {
    return -1
  }
  return Math.max(0, Math.min(length - 1, index))
}

export interface EnterGateParams {
  isComposing: boolean
  /** The list currently on screen came from this query. */
  shownQuery: string
  /** The query the input holds right now (may be ahead of `shownQuery` during a debounce). */
  currentQuery: string
  /** A fetch for `currentQuery` is in flight (or about to be, post-debounce). */
  loading: boolean
  activeIndex: number
  resultCount: number
}

export type EnterDecision =
  | { action: 'ignore' } // IME composition: never ours.
  | { action: 'wait' } // the shown list is stale (query changed, or still loading): wait for the fresh result.
  | { action: 'none' } // nothing to select.
  | { action: 'select', index: number }

/**
 * What Enter should do, given the guard the SC-106 fix calls for: never pick
 * from a list that does not match what is currently typed (a fast typist
 * pressing Enter inside the debounce window must not get the old, unfiltered
 * top row), and never while composing an IME candidate.
 */
export function decideEnter (p: EnterGateParams): EnterDecision {
  if (p.isComposing) {
    return { action: 'ignore' }
  }
  if (p.loading || p.shownQuery !== p.currentQuery) {
    return { action: 'wait' }
  }
  if (p.resultCount === 0) {
    return { action: 'none' }
  }
  return { action: 'select', index: clampActiveIndex(p.activeIndex, p.resultCount) }
}

// ---- recents (SC-111) -------------------------------------------------------

export interface RecentsConfig {
  /** @default 8 */
  max?: number
  persistKey?: string
  /** An initial in-memory list (e.g. a host-managed array via ChartProOptions.symbolSearch.recent) — used only when there is no `persistKey` (or before it has ever been written to). */
  seed?: readonly string[]
}

function parseTickerArray (raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
}

export interface RecentsStore {
  list: () => string[]
  /** Moves `ticker` to the front, de-duplicated, capped at `max`. */
  push: (ticker: string) => void
}

/**
 * In-memory (and, with a `persistKey`, `localStorage`-backed) MRU of
 * tickers. Nothing is written to storage without a `persistKey` — this is
 * the difference between "remember the last symbol for this session" (safe
 * for a demo datafeed that returns no symbols) and "remember it across
 * reloads" (only when the host explicitly asks, so demo/tradfi splits are
 * never mixed by an engine-owned key).
 */
export function createRecentsStore (config: RecentsConfig, storage?: Pick<Storage, 'getItem' | 'setItem'>): RecentsStore {
  const max = config.max ?? 8
  if (!Number.isSafeInteger(max) || max < 0 || max > 100) throw new RangeError('Recent-symbol limit must be from 0 to 100')
  const key = config.persistKey !== undefined ? `sc-recent-symbols:${config.persistKey}` : null
  const read = (): string[] => {
    if (key === null || storage === undefined) {
      return parseTickerArray(config.seed ?? [])
    }
    try {
      const raw = storage.getItem(key)
      return raw === null || raw.length > 65536 ? parseTickerArray(config.seed ?? []) : parseTickerArray(JSON.parse(raw))
    } catch {
      return parseTickerArray(config.seed ?? [])
    }
  }
  let mem = [...new Set(read().filter(value => value.length <= 4096))].slice(0, max)
  return {
    list: () => mem.slice(),
    push: (ticker: string) => {
      mem = [ticker, ...mem.filter(t => t !== ticker)].slice(0, max)
      if (key !== null && storage !== undefined) {
        try { storage.setItem(key, JSON.stringify(mem)) } catch { /* quota / disabled storage: in-memory still works. */ }
      }
    }
  }
}

/**
 * The "Recent" group to show above the search results: the stored MRU list,
 * filtered to tickers the current (empty-query) result actually contains —
 * so a demo market that returns [] shows nothing, and a symbol the datafeed
 * stopped offering (a market the host removed) never lingers.
 */
export function visibleRecents<T> (recentTickers: readonly string[], allSymbols: readonly T[], tickerOf: (s: T) => string, limit = 5): T[] {
  const byTicker = new Map(allSymbols.map(s => [tickerOf(s), s]))
  const out: T[] = []
  for (const ticker of recentTickers) {
    const match = byTicker.get(ticker)
    if (match !== undefined) {
      out.push(match)
      if (out.length >= limit) {
        break
      }
    }
  }
  return out
}
