// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * A data port that sits between a loader (or any feed) and a chart and can show the feed as a price-driven style
 * (Renko, line break, range bars, Kagi) without the chart or the loader knowing.
 *
 * The loader keeps working with the real bars: `getDataList()` and `getLastTimestamp()` answer from the raw history.
 * The chart receives the derived bars. With no style set every call passes straight through, so a chart that never
 * uses a style behaves exactly as before.
 *
 * Live ticks do not reset the chart. The derived series is recomputed from the raw history and only the part that
 * changed is sent: new marks are appended, and the forming mark at the end is replaced, so the viewport stays where
 * the user left it.
 *
 * Limits, on purpose:
 * - The style is computed from the history that is loaded. While a style is on, the port reports "no older history"
 *   to the chart (older marks depend on every bar before them, so a page of older bars would change all marks and
 *   throw the view away). Switching back to no style reports the loader's real value again.
 * - When no size is given, the average true range of the loaded bars is measured once, when the style is set or
 *   new history is loaded, and then kept. It does not drift with every tick.
 * - Replay needs the real bars: `truncateData` answers `false` while a style is on.
 */
import type { ChartDataPort } from './chartPort'
import type { MarketBar } from './types'
import { deriveBars, averageTrueRange, type DerivedStyle, type DerivedStyleOptions } from './derivedSeries'

export interface DerivedSeriesPort extends ChartDataPort {
  /** Show the feed as `style`; `null` goes back to the real bars. Resets the chart's view to the latest bar. */
  setStyle: (style: DerivedStyle | null, options?: DerivedStyleOptions) => void
  getStyle: () => { style: DerivedStyle, size: number | null, lines: number } | null
}

function sameBar (a: MarketBar, b: MarketBar): boolean {
  return a.timestamp === b.timestamp && a.open === b.open && a.high === b.high && a.low === b.low && a.close === b.close && a.volume === b.volume
}

export function createDerivedSeriesPort (target: ChartDataPort): DerivedSeriesPort {
  let style: DerivedStyle | null = null
  let options: DerivedStyleOptions = {}
  let size: number | null = null
  /** The real bars; kept only while a style is on (otherwise the chart holds them). */
  let raw: MarketBar[] = []
  let rawMore = false
  let shown: MarketBar[] = []

  const resolve = (): DerivedStyleOptions => ({ ...options, size: options.size ?? size ?? undefined })
  const measure = (): void => { size = options.size ?? (raw.length === 0 ? null : averageTrueRange(raw)) }
  const derive = (): MarketBar[] => {
    if (style === null || raw.length === 0) return []
    return deriveBars(style, raw, resolve())
  }
  const reset = (): void => {
    shown = derive()
    target.applyNewData(shown, false)
  }

  const applyTail = (): void => {
    const next = derive()
    let p = 0
    const common = Math.min(shown.length, next.length)
    while (p < common && sameBar(shown[p], next[p])) p++
    if (p === shown.length && p === next.length) return
    if (p === shown.length) {
      target.updateDataBatch !== undefined ? target.updateDataBatch(next.slice(p)) : next.slice(p).forEach(bar => { target.updateData(bar) })
      shown = next
      return
    }
    const last = shown[shown.length - 1]
    // Only the last mark changed in place: a plain update replaces it (same timestamp).
    if (p === shown.length - 1 && next.length > p && next[p].timestamp === shown[p].timestamp) {
      const tail = next.slice(p)
      target.updateDataBatch !== undefined ? target.updateDataBatch(tail) : tail.forEach(bar => { target.updateData(bar) })
      shown = next
      return
    }
    if (p > 0 && target.truncateData !== undefined && target.truncateData(p, shown.length, last.timestamp)) {
      const tail = next.slice(p)
      if (tail.length > 0) target.updateDataBatch !== undefined ? target.updateDataBatch(tail) : tail.forEach(bar => { target.updateData(bar) })
      shown = next
      return
    }
    shown = next
    target.applyNewData(shown, false)
  }

  const rawTail = (bars: readonly MarketBar[]): void => {
    for (const bar of bars) {
      const last = raw[raw.length - 1]
      if (last !== undefined && bar.timestamp < last.timestamp) continue
      if (last !== undefined && bar.timestamp === last.timestamp) raw[raw.length - 1] = { ...bar }
      else raw.push({ ...bar })
    }
  }

  const applyNewData = (bars: MarketBar[], more?: boolean): void => {
    rawMore = more ?? false
    if (style === null) { target.applyNewData(bars, more); return }
    raw = bars.map(bar => ({ ...bar })); measure(); reset()
  }
  const updateDataBatch = (bars: MarketBar[], more?: boolean): void => {
    if (more !== undefined) rawMore = more
    if (style === null) {
      if (target.updateDataBatch !== undefined) target.updateDataBatch(bars, more)
      else bars.forEach(bar => { target.updateData(bar) })
      return
    }
    rawTail(bars); applyTail()
  }

  return {
    setStyle (next, nextOptions = {}) {
      if (next === null) {
        const wasOn = style !== null
        style = null; options = {}; size = null; shown = []
        // Back to the real bars: the chart gets them again (its view resets to the latest bar).
        if (wasOn) { const bars = raw; raw = []; target.applyNewData(bars, rawMore) }
        return
      }
      if (style === null) raw = target.getDataList().map(bar => ({ ...bar }))
      style = next; options = { ...nextOptions }
      measure(); reset()
    },
    getStyle: () => style === null ? null : { style, size, lines: options.lines ?? 3 },

    applyNewData,
    applyNormalizedData: (bars, more) => {
      if (style === null) { rawMore = more ?? false; (target.applyNormalizedData ?? target.applyNewData)(bars, more); return }
      applyNewData(bars, more)
    },
    applyMoreData: (bars, more) => {
      rawMore = more ?? false
      if (style === null) { target.applyMoreData(bars, more); return }
      const first = raw[0]?.timestamp ?? Infinity
      const older = bars.filter(bar => bar.timestamp < first).map(bar => ({ ...bar }))
      // A page that was already on its way when the style was switched on: the marks all change, so start over.
      if (older.length > 0) { raw = older.concat(raw); measure(); reset() }
    },
    updateData: bar => { updateDataBatch([bar]) },
    updateDataBatch,
    truncateData: (length, expectedLength, expectedLastTimestamp) => {
      if (style !== null) return false
      return target.truncateData?.(length, expectedLength, expectedLastTimestamp) ?? false
    },
    getDataList: () => style === null ? target.getDataList() : raw,
    getLastTimestamp: () => style === null ? target.getLastTimestamp?.() : raw[raw.length - 1]?.timestamp,
    cancelHistoryLoad: () => { target.cancelHistoryLoad?.() },
    loadMore: callback => {
      target.loadMore?.(timestamp => { callback(style === null ? timestamp : raw[0]?.timestamp ?? timestamp) })
    },
    setLoadDataCallback: callback => { target.setLoadDataCallback?.(callback) }
  }
}
