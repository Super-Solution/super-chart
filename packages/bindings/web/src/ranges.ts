// SPDX-License-Identifier: GPL-3.0-or-later

/** The quick ranges of the footer: how far back the visible window reaches from the latest bar. */
export const WORKSPACE_RANGES = ['1D', '5D', '1M', '3M', '6M', 'YTD', '1Y', '5Y', 'all'] as const
export type WorkspaceRange = typeof WORKSPACE_RANGES[number]

/** Whether this is one of the named ranges, for hosts and the command palette that take it as text. */
export function isWorkspaceRange (value: unknown): value is WorkspaceRange {
  return typeof value === 'string' && (WORKSPACE_RANGES as readonly string[]).includes(value)
}

const DAY = 86_400_000

/**
 * The timestamp a range starts at, counted back from `last` (the latest bar), or null for `all`.
 * Calendar months and years are counted in calendar terms, so `1M` from 31 March starts on 28 February, not on a
 * fixed number of days. Dates are read in UTC; a daily bar sits at the session's own timestamp, and a few hours
 * either way do not change which bars a month contains.
 */
export function rangeStart (range: WorkspaceRange, last: number): number | null {
  if (!Number.isFinite(last)) return null
  const d = new Date(last)
  const back = (months: number): number => {
    const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - months, 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()))
    const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
    target.setUTCDate(Math.min(d.getUTCDate(), lastDay))
    return target.getTime()
  }
  switch (range) {
    case '1D': return last - DAY
    case '5D': return last - 5 * DAY
    case '1M': return back(1)
    case '3M': return back(3)
    case '6M': return back(6)
    case 'YTD': return Date.UTC(d.getUTCFullYear(), 0, 1)
    case '1Y': return back(12)
    case '5Y': return back(60)
    case 'all': return null
  }
}

/** Index of the first bar at or after `start`; the bars are in time order. */
export function firstBarFrom (bars: ReadonlyArray<{ readonly timestamp: number }>, start: number): number {
  let lo = 0, hi = bars.length
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (bars[mid].timestamp < start) lo = mid + 1; else hi = mid }
  return lo
}
