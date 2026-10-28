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

// Request ranges and period arithmetic. Pure and in UTC: `from` is only a lower
// bound for the datafeed, and bar alignment belongs to the data source, not to
// the display time zone.

import type { Period } from '../types'

/** Fixed-length timespans, in ms. Month and year are calendar arithmetic. */
export const UNIT_MS: Readonly<Record<string, number>> = {
  second: 1e3,
  minute: 6e4,
  hour: 36e5,
  day: 864e5,
  week: 6048e5
}

const warned = new Set<string>()

function warnUnknown (timespan: string): void {
  if (warned.has(timespan)) {
    return
  }
  warned.add(timespan)
  console.warn(`[super-chart] unknown period timespan ${JSON.stringify(timespan)}; expected second, minute, hour, day, week, month or year.`)
}

/**
 * `ts` moved by `n` periods (negative: back). Month and year keep the day and
 * time of day in UTC, and a day past the end of a month rolls into the next
 * one (Jan 31 + 1 month is Mar 3 or 2), which is what a lower bound needs.
 * NaN for an unknown timespan.
 */
export function addPeriods (period: Pick<Period, 'multiplier' | 'timespan'>, ts: number, n: number): number {
  const count = n * period.multiplier
  const unit = UNIT_MS[period.timespan]
  if (unit !== undefined) {
    return ts + count * unit
  }
  if (period.timespan === 'month' || period.timespan === 'year') {
    const d = new Date(ts)
    const months = period.timespan === 'month' ? count : count * 12
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds())
  }
  return NaN
}

/**
 * The `[from, to]` to ask a datafeed for: `count` bars of `period` ending at
 * `to`. `to` is passed through unchanged (the engine sends the current time on
 * the first load, and the first loaded bar's timestamp, exclusive, when it
 * pages back). `from` is never negative, and `from <= to` always holds.
 *
 * Never throws: an unknown timespan logs one warning and asks for the empty
 * range `[to, to]` (asking from 0 would fetch a feed's whole history).
 */
export function requestRange (period: Pick<Period, 'multiplier' | 'timespan'>, to: number, count: number): [number, number] {
  let from: number
  if (period.timespan === 'month') {
    const d = new Date(to)
    from = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - count * period.multiplier, 1)
  } else if (period.timespan === 'year') {
    const d = new Date(to)
    from = Date.UTC(d.getUTCFullYear() - count * period.multiplier, 0, 1)
  } else if (UNIT_MS[period.timespan] !== undefined) {
    from = to - count * period.multiplier * UNIT_MS[period.timespan]
  } else {
    warnUnknown(String(period.timespan))
    from = to
  }
  if (!Number.isFinite(from)) {
    from = 0
  }
  return [Math.min(Math.max(0, from), to), to]
}
