// SPDX-License-Identifier: GPL-3.0-or-later
// Day-and-larger bars describe a market session, so their date uses the
// symbol's timezone (default UTC). Intraday bars use the viewer's display
// timezone. Minute-axis boundary patterns preserve day/month/year context.
// This portable formatter is shared by the owned renderer and date checks.

import type { Timespan } from './feed'

/** The context requesting a financial date label. */
export type BarDateRequestType = 'xAxis' | 'crosshair' | 'tooltip'

const DTF_OPTIONS: Intl.DateTimeFormatOptions = {
  hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
}

/** Fill a date/time template from timezone-aware calendar parts. */
function formatDate (dtf: Intl.DateTimeFormat, timestamp: number, format: string): string {
  const parts: Record<string, string> = {}
  for (const { type, value } of dtf.formatToParts(new Date(timestamp))) {
    switch (type) {
      case 'year': parts.YYYY = value; break
      case 'month': parts.MM = value; break
      case 'day': parts.DD = value; break
      case 'hour': parts.HH = value === '24' ? '00' : value; break
      case 'minute': parts.mm = value; break
      case 'second': parts.ss = value; break
    }
  }
  return format.replace(/YYYY|MM|DD|HH|mm|ss/g, key => parts[key] ?? key)
}

const UTC_DTF = new Intl.DateTimeFormat('en', { ...DTF_OPTIONS, timeZone: 'UTC' })

const dtfCache = new Map<string, Intl.DateTimeFormat>()

/**
 * A formatter for `tz`, built once and reused (formatBarDate runs on every
 * tick of every frame). Falls back to UTC for a zone Intl does not accept,
 * so a bad SymbolInfo.timezone cannot throw inside the render loop.
 */
function dtfFor (tz: string): Intl.DateTimeFormat {
  const cached = dtfCache.get(tz)
  if (cached !== undefined) {
    return cached
  }
  let dtf: Intl.DateTimeFormat
  try {
    dtf = new Intl.DateTimeFormat('en', { ...DTF_OPTIONS, timeZone: tz })
  } catch {
    dtf = UTC_DTF
  }
  if (dtfCache.size >= 8) dtfCache.delete(dtfCache.keys().next().value as string)
  dtfCache.set(tz, dtf)
  return dtf
}

/** A day, week, month or year bar reads its timestamp as a session date, not an instant. */
function isDayOrLarger (timespan: Timespan): boolean {
  return timespan === 'day' || timespan === 'week' || timespan === 'month' || timespan === 'year'
}

export interface FormatBarDateParams {
  /** The viewer's display-timezone formatter. */
  displayDtf: Intl.DateTimeFormat
  /** SymbolInfo.timezone; undefined (and anything Intl rejects) is read as 'UTC'. */
  symbolTimezone: string | undefined
  timespan: Timespan
  timestamp: number
  /** Requested axis pattern, e.g. 'HH:mm', 'YYYY-MM', 'MM-DD'. */
  format: string
  type: BarDateRequestType
}

/**
 * Day-and-larger bars are
 * read in `symbolTimezone` (default UTC); minute and hour bars keep
 * `displayDtf` unchanged, and a minute chart's boundary-format requests
 * ('YYYY' / 'YYYY-MM' / 'MM-DD') are answered instead of forced to 'HH:mm'.
 */
export function formatBarDate (p: FormatBarDateParams): string {
  const dtf = isDayOrLarger(p.timespan) ? dtfFor(p.symbolTimezone ?? 'UTC') : p.displayDtf
  switch (p.timespan) {
    case 'second': {
      if (p.type === 'xAxis') {
        return formatDate(dtf, p.timestamp, p.format === 'YYYY' || p.format === 'YYYY-MM' || p.format === 'MM-DD' ? p.format : 'HH:mm:ss')
      }
      return formatDate(dtf, p.timestamp, 'YYYY-MM-DD HH:mm:ss')
    }
    case 'minute': {
      if (p.type === 'xAxis') {
        if (p.format === 'YYYY' || p.format === 'YYYY-MM' || p.format === 'MM-DD') {
          return formatDate(dtf, p.timestamp, p.format)
        }
        return formatDate(dtf, p.timestamp, 'HH:mm')
      }
      return formatDate(dtf, p.timestamp, 'YYYY-MM-DD HH:mm')
    }
    case 'hour': {
      if (p.type === 'xAxis') {
        return formatDate(dtf, p.timestamp, 'MM-DD HH:mm')
      }
      return formatDate(dtf, p.timestamp, 'YYYY-MM-DD HH:mm')
    }
    case 'day':
    case 'week':
      return formatDate(dtf, p.timestamp, 'YYYY-MM-DD')
    case 'month': {
      if (p.type === 'xAxis') {
        return formatDate(dtf, p.timestamp, 'YYYY-MM')
      }
      return formatDate(dtf, p.timestamp, 'YYYY-MM-DD')
    }
    case 'year': {
      if (p.type === 'xAxis') {
        return formatDate(dtf, p.timestamp, 'YYYY')
      }
      return formatDate(dtf, p.timestamp, 'YYYY-MM-DD')
    }
    default:
      return formatDate(dtf, p.timestamp, 'YYYY-MM-DD HH:mm')
  }
}
