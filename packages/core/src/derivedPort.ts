// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * A data port that sits between a loader (or any feed) and a chart and can show the feed as a price-driven style
 * (Renko, line break, range bars, Kagi) without the chart or the loader knowing.
 *
 * The loader keeps working with the real bars: `getDataList()` and `getLastTimestamp()` answer from the raw history.
 * The chart receives the derived bars. With no style set every call passes straight through, so a chart that never
 * uses a style behaves exactly as before.
 *
 * Live ticks do not reset the chart and do not start over. The port keeps the style's state machine and the state it had
 * before the last source bar; a tick that changes that bar (or adds a newer one) goes back to that state and feeds the
 * bar again, so a tick costs about the same on 5,000 bars as on 500,000. Only the part that changed is sent: new marks
 * are appended, and the forming mark at the end is replaced, so the viewport stays where the user left it. The chart
 * always holds exactly what deriving the whole history from scratch would give.
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
import {
  averageTrueRange, assertSourceBar, createDerivedBuilder, realiseMarks,
  type DerivedBuilder, type DerivedCheckpoint, type DerivedStyle, type DerivedStyleOptions
} from './derivedSeries'

export interface DerivedSeriesPort extends ChartDataPort {
  /** Show the feed as `style`; `null` goes back to the real bars. Resets the chart's view to the latest bar. */
  setStyle: (style: DerivedStyle | null, options?: DerivedStyleOptions) => void
  getStyle: () => { style: DerivedStyle, size: number | null, lines: number } | null
}

function sameBar (a: MarketBar, b: MarketBar): boolean {
  return a.timestamp === b.timestamp && a.open === b.open && a.high === b.high && a.low === b.low && a.close === b.close && a.volume === b.volume
}

/**
 * `onSizeChange` is called after the port has measured a new default size (new history was loaded while a style is on),
 * so a caller that draws from the size, like the point and figure boxes, can follow it.
 */
export function createDerivedSeriesPort (target: ChartDataPort, onSizeChange?: () => void): DerivedSeriesPort {
  let style: DerivedStyle | null = null
  let options: DerivedStyleOptions = {}
  let size: number | null = null
  /** The real bars; kept only while a style is on (otherwise the chart holds them). */
  let raw: MarketBar[] = []
  let rawMore = false
  /** What the chart holds: the derived marks of `raw`. */
  const shown: MarketBar[] = []
  /** The style's state after the whole of `raw`, and its state before the last bar of `raw` was fed. Null: rebuild first. */
  let builder: DerivedBuilder | null = null
  let before: DerivedCheckpoint | null = null

  const measure = (): void => {
    const previous = size
    size = options.size ?? (raw.length === 0 ? null : averageTrueRange(raw))
    if (size !== previous) onSizeChange?.()
  }

  /** Derive the whole history from scratch and give the chart all of it. */
  const reset = (): void => {
    builder = null; before = null
    shown.length = 0
    if (style !== null && raw.length > 0) {
      if (size === null) measure()
      const fresh = createDerivedBuilder(style, size ?? 1, options)
      let saved: DerivedCheckpoint | null = null
      for (let i = 0; i < raw.length; i++) {
        assertSourceBar(raw[i], i === 0 ? -Infinity : raw[i - 1].timestamp)
        if (i === raw.length - 1) saved = fresh.save()
        fresh.feed(raw[i], i)
      }
      realiseMarks(raw, fresh.snapshot(), 0, shown)
      builder = fresh; before = saved
    }
    target.applyNewData(shown, false)
  }

  const send = (bars: MarketBar[]): void => {
    if (bars.length === 0) return
    target.updateDataBatch !== undefined ? target.updateDataBatch(bars) : bars.forEach(bar => { target.updateData(bar) })
  }

  /** Tell the chart what changed between the old end of `shown` (`previous`, from index `from`) and the new one. */
  const publish = (previous: MarketBar[], from: number): void => {
    const next = shown.slice(from)
    const common = Math.min(previous.length, next.length)
    let p = 0
    while (p < common && sameBar(previous[p], next[p])) p++
    const oldLength = from + previous.length, at = from + p
    if (at === oldLength && at === shown.length) return
    if (at === oldLength) { send(shown.slice(at)); return }
    // Only the last mark changed in place: a plain update replaces it (same timestamp).
    if (at === oldLength - 1 && shown.length > at && shown[at].timestamp === previous[p].timestamp) { send(shown.slice(at)); return }
    if (at > 0 && target.truncateData !== undefined && target.truncateData(at, oldLength, previous[previous.length - 1].timestamp)) { send(shown.slice(at)); return }
    target.applyNewData(shown, false)
  }

  /** Merge newer bars into the raw history and bring `builder`, `shown` and the chart up to date without starting over. */
  const advance = (bars: readonly MarketBar[]): void => {
    if (builder === null || before === null || raw.length === 0) {
      // Nothing to resume from: take the bars in and derive everything once.
      for (const bar of bars) {
        const last = raw[raw.length - 1]
        if (last !== undefined && bar.timestamp < last.timestamp) continue
        const replacing = last !== undefined && bar.timestamp === last.timestamp
        // A bad bar is refused before it can enter the history, so one bad tick cannot spoil every later one.
        assertSourceBar(bar, last === undefined ? -Infinity : replacing ? (raw.length > 1 ? raw[raw.length - 2].timestamp : -Infinity) : last.timestamp)
        if (replacing) raw[raw.length - 1] = { ...bar }
        else raw.push({ ...bar })
      }
      if (size === null) measure()
      reset()
      return
    }
    const from = before.length
    let touched = false
    try {
      for (const bar of bars) {
        const last = raw[raw.length - 1]
        if (bar.timestamp < last.timestamp) continue
        const replacing = bar.timestamp === last.timestamp
        assertSourceBar(bar, replacing ? (raw.length > 1 ? raw[raw.length - 2].timestamp : -Infinity) : last.timestamp)
        if (replacing) { raw[raw.length - 1] = { ...bar }; builder.restore(before) } else { raw.push({ ...bar }); before = builder.save() }
        builder.feed(raw[raw.length - 1], raw.length - 1)
        touched = true
      }
    } catch (error) { builder = null; before = null; throw error }
    if (!touched) return
    // Marks before the old last bar's first mark cannot have changed; redo from there.
    const previous = shown.slice(from)
    shown.length = from
    try { realiseMarks(raw, builder.snapshot(), from, shown) } catch (error) { shown.length = from; shown.push(...previous); builder = null; before = null; throw error }
    publish(previous, from)
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
    advance(bars)
  }

  return {
    setStyle (next, nextOptions = {}) {
      if (next === null) {
        const wasOn = style !== null
        style = null; options = {}; size = null; shown.length = 0; builder = null; before = null
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
