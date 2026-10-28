/**
 * ChartError: what API v2 methods throw for input they cannot use, and what
 * v1 methods put in their result (with a console warning) instead of throwing.
 *
 * Every error names the field, what was received, what is allowed (computed
 * when the call is made, never a hard-coded copy of a registry) and, when one
 * is close, a hint such as "did you mean 'RSI'?". A caller that is a model
 * (an MCP tool, an agent) can correct itself from that alone.
 *
 * Part of SUPer-Chart (Apache-2.0).
 */

import type { Period } from '../types'
import { resolveTz, timezoneHint } from '../time/resolveTz'

export type ChartErrorCode =
  | 'UNKNOWN_INDICATOR'
  | 'UNKNOWN_DRAWING_TOOL'
  | 'INVALID_PERIOD'
  | 'INVALID_TIMEZONE'
  | 'INVALID_SYMBOL'
  | 'UNKNOWN_THEME'
  | 'UNKNOWN_LOCALE'
  | 'UNKNOWN_EVENT'
  | 'INVALID_ARGUMENT'
  | 'NOT_READY'
  | 'LOAD_FAILED'

export interface ChartErrorDetails {
  code: ChartErrorCode
  /** The argument or field at fault, e.g. 'period.timespan'. */
  field: string
  /** What the caller passed (as given). */
  received: unknown
  /** The values that would have been accepted, when they form a list. */
  allowed?: readonly string[]
  /** A nearby valid value or a fix, in words. */
  hint?: string
}

/** The JSON form of a ChartError (what an MCP tool returns). */
export interface ChartErrorJSON extends ChartErrorDetails {
  name: 'ChartError'
  message: string
}

export class ChartError extends Error {
  readonly code: ChartErrorCode
  readonly field: string
  readonly received: unknown
  readonly allowed?: readonly string[]
  readonly hint?: string

  constructor (details: ChartErrorDetails, message?: string) {
    super(message ?? defaultMessage(details))
    this.name = 'ChartError'
    this.code = details.code
    this.field = details.field
    this.received = details.received
    if (details.allowed !== undefined) this.allowed = details.allowed
    if (details.hint !== undefined) this.hint = details.hint
  }

  toJSON (): ChartErrorJSON {
    const out: ChartErrorJSON = { name: 'ChartError', message: this.message, code: this.code, field: this.field, received: jsonSafe(this.received) }
    if (this.allowed !== undefined) out.allowed = [...this.allowed]
    if (this.hint !== undefined) out.hint = this.hint
    return out
  }
}

/** True for a ChartError (also one from another copy of the package). */
export function isChartError (value: unknown): value is ChartError {
  return value instanceof ChartError || (value instanceof Error && value.name === 'ChartError' && typeof (value as { code?: unknown }).code === 'string')
}

function show (value: unknown): string {
  try {
    const s = JSON.stringify(value)
    return s === undefined ? String(value) : s
  } catch {
    return String(value)
  }
}

function jsonSafe (value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value) ?? 'null')
  } catch {
    return String(value)
  }
}

function defaultMessage (d: ChartErrorDetails): string {
  let text = `[super-chart] ${d.code}: ${d.field} ${show(d.received)} is not valid.`
  if (d.hint !== undefined) text += ` ${d.hint}`
  if (d.allowed !== undefined && d.allowed.length > 0) {
    const list = d.allowed.length > 40 ? [...d.allowed.slice(0, 40), `… (${d.allowed.length} in all)`] : d.allowed
    text += ` Allowed: ${list.join(', ')}.`
  }
  return text
}

// ---- near matches -----------------------------------------------------------

function editDistance (a: string, b: string): number {
  const prev = new Array<number>(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j]
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
      diag = up
    }
  }
  return prev[b.length]
}

/**
 * The allowed value closest to `received`: the same ignoring case, then the
 * singular of a plural ('hours' -> 'hour'), then the smallest edit distance
 * (at most a third of the length, and at most 2). Undefined when none is close.
 */
export function nearest (received: unknown, allowed: readonly string[]): string | undefined {
  if (typeof received !== 'string' || received.length === 0) {
    return undefined
  }
  const lower = received.toLowerCase()
  const byCase = allowed.find(a => a.toLowerCase() === lower)
  if (byCase !== undefined) return byCase
  const singular = lower.endsWith('s') ? lower.slice(0, -1) : lower
  const bySingular = allowed.find(a => a.toLowerCase() === singular)
  if (bySingular !== undefined) return bySingular
  let best: string | undefined
  let bestDistance = Infinity
  const limit = Math.min(2, Math.max(1, Math.floor(received.length / 3)))
  for (const a of allowed) {
    const d = editDistance(lower, a.toLowerCase())
    if (d < bestDistance) {
      bestDistance = d
      best = a
    }
  }
  return bestDistance <= limit ? best : undefined
}

function didYouMean (received: unknown, allowed: readonly string[]): string | undefined {
  const near = nearest(received, allowed)
  return near === undefined ? undefined : `Did you mean ${show(near)}?`
}

// ---- validators -------------------------------------------------------------
// Each returns the value to use, or throws a ChartError. v1 methods catch it,
// warn and keep their state; v2 methods let it through.

/** The period timespans the data loader can request (see src/data/requestRange.ts). */
export const TIMESPANS = ['second', 'minute', 'hour', 'day', 'week', 'month', 'year'] as const

/** The timespans a Period may use, for tool schemas. */
export function getSupportedTimespans (): string[] {
  return [...TIMESPANS]
}

/** A Period object with a known timespan and a positive whole multiplier. */
export function checkPeriodObject (period: unknown, field = 'period'): Period {
  if (typeof period !== 'object' || period === null) {
    throw new ChartError({ code: 'INVALID_PERIOD', field, received: period, hint: "Pass a Period such as { multiplier: 4, timespan: 'hour', text: '4H' }, or shorthand such as '4H'." })
  }
  const p = period as Partial<Period>
  if (!(TIMESPANS as readonly unknown[]).includes(p.timespan)) {
    throw new ChartError({ code: 'INVALID_PERIOD', field: `${field}.timespan`, received: p.timespan, allowed: TIMESPANS, hint: didYouMean(p.timespan, TIMESPANS) })
  }
  if (typeof p.multiplier !== 'number' || !Number.isInteger(p.multiplier) || p.multiplier <= 0) {
    throw new ChartError({ code: 'INVALID_PERIOD', field: `${field}.multiplier`, received: p.multiplier, hint: 'The multiplier is a positive whole number (1, 4, 15, ...).' })
  }
  return { ...(p as Period), text: typeof p.text === 'string' && p.text !== '' ? p.text : `${p.multiplier}${p.timespan}` }
}

/** A SymbolInfo with a non-empty ticker (the one field every datafeed needs). */
export function checkSymbol (symbol: unknown, field = 'symbol'): void {
  if (typeof symbol !== 'object' || symbol === null) {
    throw new ChartError({ code: 'INVALID_SYMBOL', field, received: symbol, hint: "Pass a SymbolInfo such as { ticker: 'BTC-USDT' }." })
  }
  const ticker = (symbol as { ticker?: unknown }).ticker
  if (typeof ticker !== 'string' || ticker.trim() === '') {
    throw new ChartError({ code: 'INVALID_SYMBOL', field: `${field}.ticker`, received: ticker, hint: 'The ticker is a non-empty string.' })
  }
}

/** One of `allowed` (exact), else UNKNOWN_* with a near match. */
export function checkOneOf<T extends string> (code: ChartErrorCode, field: string, received: unknown, allowed: readonly T[]): T {
  if ((allowed as readonly unknown[]).includes(received)) {
    return received as T
  }
  throw new ChartError({ code, field, received, allowed, hint: didYouMean(received, allowed) })
}

/**
 * An indicator name klinecharts knows (`supported` is its
 * getSupportedIndicators() at call time, plus any aliases the caller accepts).
 */
export function checkIndicatorName (name: unknown, supported: readonly string[]): string {
  return checkOneOf('UNKNOWN_INDICATOR', 'name', name, supported)
}

/** A drawing tool (overlay) name klinecharts knows (`supported`: getSupportedOverlays()). */
export function checkDrawingTool (name: unknown, supported: readonly string[]): string {
  return checkOneOf('UNKNOWN_DRAWING_TOOL', 'name', name, supported)
}

/** A finite number (a timestamp, a count). */
export function checkNumber (value: unknown, field: string, hint?: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ChartError({ code: 'INVALID_ARGUMENT', field, received: value, hint: hint ?? 'A finite number.' })
  }
  return value
}

/** A time zone Intl accepts (any case or alias), or 'local'; returns the id the chart stores. */
export function checkTimezone (input: unknown, field = 'timezone'): string {
  const tz = resolveTz(input)
  if (tz === null) {
    throw new ChartError({ code: 'INVALID_TIMEZONE', field, received: input, hint: timezoneHint(input) })
  }
  return tz
}
