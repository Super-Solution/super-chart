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

// The public surface for custom intervals (SC-112): `parsePeriod`/`periodKey`
// already existed as internal helpers (src/data/keys.ts, used by ChartPro's
// own setPeriod shorthand) — re-exported here as documented API — plus the
// capability gate the type-to-change interval box uses. setPeriod() itself
// was already unrestricted (any Period reaches the datafeed); what a raw '3m'
// keystroke must NOT do by default is drive the UI to a period the host's own
// data pipeline was never told about, so the gate defaults closed and the
// host opts in per SC-112's corrected fix.
//
// Part of SUPer-Chart (Apache-2.0).

import type { Datafeed, Period } from '../types'

import { parsePeriod, periodKey, samePeriod } from '../data/keys'

export { parsePeriod, periodKey }

export type CustomPeriodsOption = boolean | ((period: Pick<Period, 'multiplier' | 'timespan'>) => boolean)

export interface PeriodGateContext {
  /** The configured period list: always allowed, whatever `customPeriods` says. */
  periods: readonly Period[]
  customPeriods?: CustomPeriodsOption
  datafeed?: Pick<Datafeed, 'resolvePeriod'>
}

/**
 * Whether the type-to-change interval box (and a future custom-interval
 * dropdown) may use `parsed`. An entry of the configured `periods` is always
 * allowed. Beyond that, only when the host opts in: `customPeriods: true`,
 * a `customPeriods` predicate that returns true for it, or a
 * `datafeed.resolvePeriod` the host has implemented. Off by default, so a
 * period the host's own data pipeline does not know about never silently
 * reaches it.
 */
export function periodAllowed (parsed: Pick<Period, 'multiplier' | 'timespan'>, ctx: PeriodGateContext): boolean {
  if (ctx.periods.some(p => samePeriod(p, parsed))) {
    return true
  }
  if (typeof ctx.customPeriods === 'function') {
    return ctx.customPeriods(parsed)
  }
  if (ctx.customPeriods === true) {
    return true
  }
  return typeof ctx.datafeed?.resolvePeriod === 'function'
}

export type TypedPeriodResult =
  | { kind: 'ok', period: Period }
  | { kind: 'unsupported' }
  | { kind: 'unreadable' }

/**
 * Parse and gate typed interval text (e.g. from the type-to-change box) in
 * one step. `'unreadable'` when it does not parse as a period at all (see
 * `parsePeriod`); `'unsupported'` when it parses but the gate refuses it —
 * the caller shows "Unsupported interval" and never reaches the datafeed.
 */
export function resolveTypedPeriod (input: string, ctx: PeriodGateContext): TypedPeriodResult {
  const parsed = parsePeriod(input)
  if (parsed === null) {
    return { kind: 'unreadable' }
  }
  if (!periodAllowed(parsed, ctx)) {
    return { kind: 'unsupported' }
  }
  const configured = ctx.periods.find(p => samePeriod(p, parsed))
  if (configured !== undefined) {
    return { kind: 'ok', period: configured }
  }
  const resolved = ctx.datafeed?.resolvePeriod?.(parsed)
  return { kind: 'ok', period: resolved ?? { ...parsed, text: input.trim() } }
}
