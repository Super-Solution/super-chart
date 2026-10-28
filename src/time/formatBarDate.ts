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

// klinecharts asks the chart's customApi.formatDate for a label in the
// chart's *display* timezone. That is right for intraday bars, but a daily
// (or larger) bar is a session, not an instant: TradingView and every
// exchange read a daily bar's date in the market's own zone, not the
// viewer's. A UTC-aligned bar (Binance's 00:00Z, US equities' 13:30Z) reads
// the same date in every zone, so this only shows up for a feed whose bars
// open at midnight elsewhere (OKX's UTC+8 daily bars), or once the viewer's
// own zone is west of UTC and the *display* zone is used for day+ bars too.
//
// formatBarDate is the whole body of that customApi.formatDate: day, week,
// month and year bars format in the symbol's timezone (SymbolInfo.timezone,
// default 'UTC'); minute and hour bars keep the chart's display timezone
// unchanged. It also passes through the boundary formats ('YYYY', 'YYYY-MM',
// 'MM-DD') klinecharts asks minute charts for at a day/month/year boundary,
// instead of always answering with a bare time — without a date there, an
// intraday chart never shows which day a tick belongs to.
//
// This module never imports a runtime value from 'klinecharts' (only `type`
// imports elsewhere in this package do): the package has no "exports" field
// and its "main" (a UMD shim) resolves to an empty module under plain Node
// resolution (confirmed against 9.8.12; vitest's node environment hits this
// too), so a value import here would silently break every unit test while
// still working in the Vite-bundled browser build — the trap the root
// CLAUDE.md warns about. FormatDateType's three cases and klinecharts'
// formatDate (a template filled from Intl.DateTimeFormat#formatToParts) are
// small enough to give our own names to and reimplement, byte-for-byte
// equivalent, so this stays plain, portable and safe to unit test.

import type { Timespan } from '../types'

/** klinecharts' FormatDateType, renamed so this module needs no runtime import from it. */
export type BarDateRequestType = 'xAxis' | 'crosshair' | 'tooltip'

const DTF_OPTIONS: Intl.DateTimeFormatOptions = {
  hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
}

/** klinecharts' utils.formatDate: fills a 'YYYY-MM-DD HH:mm' style template from formatToParts. */
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

// utils.formatDate splits the exact 'MM/DD/YYYY, HH:mm:ss'-shaped string this
// produces; a different locale or option set would garble every label.
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
  dtfCache.set(tz, dtf)
  return dtf
}

/** A day, week, month or year bar reads its timestamp as a session date, not an instant. */
function isDayOrLarger (timespan: Timespan): boolean {
  return timespan === 'day' || timespan === 'week' || timespan === 'month' || timespan === 'year'
}

export interface FormatBarDateParams {
  /** The chart's display-timezone formatter, exactly as klinecharts passes it in. */
  displayDtf: Intl.DateTimeFormat
  /** SymbolInfo.timezone; undefined (and anything Intl rejects) is read as 'UTC'. */
  symbolTimezone: string | undefined
  timespan: Timespan
  timestamp: number
  /** klinecharts' requested pattern, e.g. 'HH:mm', 'YYYY-MM', 'MM-DD'. */
  format: string
  type: BarDateRequestType
}

/**
 * The whole body of ChartPro's customApi.formatDate. Day-and-larger bars are
 * read in `symbolTimezone` (default UTC); minute and hour bars keep
 * `displayDtf` unchanged, and a minute chart's boundary-format requests
 * ('YYYY' / 'YYYY-MM' / 'MM-DD') are answered instead of forced to 'HH:mm'.
 */
export function formatBarDate (p: FormatBarDateParams): string {
  const dtf = isDayOrLarger(p.timespan) ? dtfFor(p.symbolTimezone ?? 'UTC') : p.displayDtf
  switch (p.timespan) {
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
