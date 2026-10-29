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

// When is a setSymbol / setPeriod a change? The chart stores whatever the host
// sends, but only refetches when the data it asks the datafeed for would
// differ: a fully identical re-send (Broker re-sends on every render) is a
// no-op, a new display name or precision updates the chrome without a
// refetch, and a new priceCurrency or market (SupWallet switches markets
// that way, same ticker) still refetches.

import type { Period, SymbolInfo } from './feed'

/**
 * SymbolInfo fields that only change how the symbol is displayed: never what
 * is fetched. `timezone` only changes how a day-or-larger bar's date is read
 * (src/time/formatBarDate.ts); the datafeed is asked for the same bars either
 * way, so changing it alone must not refetch or reset the chart's scroll.
 */
const DISPLAY_ONLY: ReadonlySet<string> = new Set(['name', 'shortName', 'logo', 'pricePrecision', 'volumePrecision', 'timezone'])

/** Every field equal (Object.is): nothing to update. */
export function sameSymbol (a: SymbolInfo | undefined, b: SymbolInfo | undefined): boolean {
  if (a === b) {
    return true
  }
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) {
    return false
  }
  const ra = a as unknown as Record<string, unknown>
  const rb = b as unknown as Record<string, unknown>
  const keys = new Set([...Object.keys(ra), ...Object.keys(rb)])
  for (const key of keys) {
    if (!Object.is(ra[key], rb[key])) {
      return false
    }
  }
  return true
}

/** What identifies the symbol's data: every field except the display-only ones. */
export function symbolKey (symbol: SymbolInfo | undefined): string {
  if (typeof symbol !== 'object' || symbol === null) {
    return String(symbol)
  }
  const entries = Object.entries(symbol as unknown as Record<string, unknown>)
    .filter(([key, value]) => !DISPLAY_ONLY.has(key) && value !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return JSON.stringify(entries)
}

/** A period's identity: multiplier and timespan (never its display text). */
export function periodKey (period: Pick<Period, 'multiplier' | 'timespan'> | undefined): string {
  return period === undefined || period === null ? '' : `${period.multiplier}:${period.timespan}`
}

/** Same multiplier and timespan. */
export function samePeriod (a: Pick<Period, 'multiplier' | 'timespan'> | undefined, b: Pick<Period, 'multiplier' | 'timespan'> | undefined): boolean {
  return a !== undefined && b !== undefined && a !== null && b !== null && a.multiplier === b.multiplier && a.timespan === b.timespan
}

/** 60 minutes and 1 hour are the same period (TradingView's "60" is one hour). */
function canonicalKey (period: Pick<Period, 'multiplier' | 'timespan'>): string {
  if (period.timespan === 'minute' && period.multiplier % 60 === 0) {
    return `${period.multiplier / 60}:hour`
  }
  if (period.timespan === 'second' && period.multiplier % 60 === 0) {
    return `${period.multiplier / 60}:minute`
  }
  return periodKey(period)
}

const UNITS: Readonly<Record<string, string>> = {
  s: 'second',
  S: 'second',
  m: 'minute',
  h: 'hour',
  H: 'hour',
  d: 'day',
  D: 'day',
  w: 'week',
  W: 'week',
  M: 'month',
  y: 'year',
  Y: 'year'
}

/**
 * A period from shorthand. Case-sensitive where it matters: '1m' is one
 * minute and '1M' one month; h/H, d/D, w/W and y/Y are the same. Also takes
 * TradingView resolutions: a bare number of minutes ('60' and '240' are 1 and
 * 4 hours), '1D', 'W', 'M', '1S'. Null when it cannot be read.
 */
export function parsePeriod (input: string): Pick<Period, 'multiplier' | 'timespan'> | null {
  const text = String(input).trim()
  if (/^\d+$/.test(text)) {
    const minutes = Number(text)
    if (!(minutes > 0)) {
      return null
    }
    return minutes % 60 === 0 ? { multiplier: minutes / 60, timespan: 'hour' } : { multiplier: minutes, timespan: 'minute' }
  }
  const match = /^(\d*)\s*([sSmhHdDwWMyY])$/.exec(text)
  if (match === null) {
    return null
  }
  const multiplier = match[1] === '' ? 1 : Number(match[1])
  if (!(multiplier > 0)) {
    return null
  }
  return { multiplier, timespan: UNITS[match[2]] }
}

/**
 * What setPeriod stores for `input`: a Period object as given; a string mapped
 * onto the configured period with the same multiplier and timespan (so '4h'
 * selects the top bar's 4H), or a new period labelled with the string. Null
 * (with a warning) for a string that cannot be read.
 */
export function resolvePeriod (input: Period | string, periods: readonly Period[]): Period | null {
  if (typeof input !== 'string') {
    return input
  }
  const parsed = parsePeriod(input)
  if (parsed === null) {
    console.warn(`[super-chart] cannot read the period ${JSON.stringify(input)}; expected e.g. '1m', '4H', 'D', '1W', '1M' or a TradingView resolution such as '240'. Ignored.`)
    return null
  }
  const key = canonicalKey(parsed)
  return periods.find(p => canonicalKey(p) === key) ?? { ...parsed, text: input.trim() }
}
