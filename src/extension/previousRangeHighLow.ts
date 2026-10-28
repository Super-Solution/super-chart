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

// Previous day/week high-low (SC-NEXT #6). Groups bars into calendar days or
// ISO-ish (Monday-start) weeks IN A GIVEN TIME ZONE (Intl does the zone/DST
// work; this module does no offset arithmetic of its own), then reports the
// high/low of whichever period is immediately before the period the last bar
// falls in — "previous", not "current". Pure and unit-tested; SC_PDHL
// (src/indicators/SC_PDHL.ts) turns the result into axis-spanning lines via
// the same levelSegments/drawLevels helper the RSI/Stoch reference levels use
// (src/indicators/levels.ts).
//
// Part of SUPer-Chart (Apache-2.0).

export interface Bar { timestamp: number, high: number, low: number }

const dayFormatterCache = new Map<string, Intl.DateTimeFormat>()

function dayFormatter (tz: string): Intl.DateTimeFormat {
  const hit = dayFormatterCache.get(tz)
  if (hit !== undefined) return hit
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
  dayFormatterCache.set(tz, fmt)
  return fmt
}

/** The calendar date (YYYY-MM-DD) `timestamp` falls on in `tz`. en-CA formats exactly that shape. Falls back to UTC for a zone Intl does not recognise. */
export function dateKeyInTz (timestamp: number, tz: string): string {
  try {
    return dayFormatter(tz).format(new Date(timestamp))
  } catch {
    return dayFormatter('UTC').format(new Date(timestamp))
  }
}

/** Monday-start week key (the Monday's own date key) for `timestamp` in `tz`. */
export function weekKeyInTz (timestamp: number, tz: string): string {
  const dateKey = dateKeyInTz(timestamp, tz)
  // Reconstruct that calendar date as a UTC noon instant (clear of any DST
  // edge at midnight) purely to ask "which weekday is this", not to do zone
  // math — the weekday of a calendar date is zone-independent once you have
  // the Y/M/D triple.
  const [y, m, d] = dateKey.split('-').map(Number)
  const noonUtc = Date.UTC(y, m - 1, d, 12)
  const weekday = new Date(noonUtc).getUTCDay() // 0=Sunday..6=Saturday
  const daysSinceMonday = (weekday + 6) % 7
  const mondayUtc = noonUtc - daysSinceMonday * 86_400_000
  return dayFormatter('UTC').format(new Date(mondayUtc))
}

export type RangePeriod = 'day' | 'week'

export interface PreviousRangeResult {
  high: number
  low: number
  /** The period key (a date string) this high/low covers, for display/debugging. */
  key: string
  fromIndex: number
  toIndex: number
}

/**
 * The high/low of the period immediately before the one the LAST bar in
 * `bars` falls in (ascending, as klinecharts requires). Null when there is
 * no earlier period at all (e.g. the whole list is one day old).
 */
export function previousRangeHighLow (bars: readonly Bar[], period: RangePeriod, tz: string): PreviousRangeResult | null {
  if (bars.length === 0) return null
  const keyOf = period === 'day' ? dateKeyInTz : weekKeyInTz
  const lastKey = keyOf(bars[bars.length - 1].timestamp, tz)
  // Walk back from the end to find the most recent bar NOT in the last period,
  // then collect every bar sharing THAT bar's key.
  let i = bars.length - 1
  while (i >= 0 && keyOf(bars[i].timestamp, tz) === lastKey) i--
  if (i < 0) return null // the whole list is a single (the "current") period
  const previousKey = keyOf(bars[i].timestamp, tz)
  const toIndex = i
  while (i >= 0 && keyOf(bars[i].timestamp, tz) === previousKey) i--
  const fromIndex = i + 1
  let high = -Infinity, low = Infinity
  for (let j = fromIndex; j <= toIndex; j++) {
    if (bars[j].high > high) high = bars[j].high
    if (bars[j].low < low) low = bars[j].low
  }
  return { high, low, key: previousKey, fromIndex, toIndex }
}
