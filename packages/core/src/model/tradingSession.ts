// SPDX-License-Identifier: GPL-3.0-or-later
// Trading sessions: a weekly schedule in a zone is checked once (compileSession), then answers three questions with no
// DOM: what a moment is (regular, pre, post or closed), where the next change falls, and where a bar really closes.

import type { Period, SymbolSession } from '../feed'
import { zoneOffset } from '../timeAxis'
import { nextBarClose } from './barCountdown'

export const SESSION_LIMITS = Object.freeze({ segments: 32, dates: 2000, segmentText: 1024 })

/**
 * Why a schedule was refused. Stable: assert on these.
 * `bad_session` the value is not an object, or `regular` is missing. `bad_timezone` not an IANA zone this runtime knows.
 * `bad_segments` a schedule string that does not parse (the issue's `field` names it). `bad_date` a date that is not a
 * real `YYYY-MM-DD`, or an exception that is not an object. `too_many` more than 32 segments in a field or 2000 dates.
 */
export type SessionIssueCode = 'bad_session' | 'bad_timezone' | 'bad_segments' | 'bad_date' | 'too_many'
export interface SessionIssue { readonly field: string, readonly code: SessionIssueCode }

/** What a moment is. Bars outside every segment are `closed`. */
export type SessionKind = 'regular' | 'pre' | 'post' | 'closed'

interface Segment { readonly start: number, readonly end: number, readonly days: number }
interface Fields { readonly regular: readonly Segment[], readonly pre: readonly Segment[], readonly post: readonly Segment[] }

/** A checked schedule. Treat it as opaque and immutable; make one with `compileSession`. */
export interface TradingSession {
  readonly timezone: string
  readonly weekly: Fields
  /** Epoch-day numbers (days since 1970-01-01 in the session's zone) with no session. */
  readonly closed: ReadonlySet<number>
  readonly exceptions: ReadonlyMap<number, Partial<Fields>>
}

const MINUTE = 60_000, DAY = 86_400_000
const SEGMENT = /^(\d{4})-(\d{4})(?::([1-7]+))?$/
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const FIELDS = ['regular', 'pre', 'post'] as const

const zoneKnown = (timezone: string): boolean => {
  try { return new Intl.DateTimeFormat('en', { timeZone: timezone }).resolvedOptions().timeZone !== '' } catch { return false }
}

/** Minutes from `HHMM`, or null: hours 00-23 and minutes 00-59, plus `2400` where an end is read. */
function minutesOf (text: string, end: boolean): number | null {
  const hours = Number(text.slice(0, 2)), minutes = Number(text.slice(2))
  if (minutes > 59) return null
  if (hours === 24) return end && minutes === 0 ? 1440 : null
  return hours <= 23 ? hours * 60 + minutes : null
}

/** Parses one field. `weekly` allows the `:days` suffix; an exception does not. Returns null on any fault. */
function parseSegments (text: unknown, weekly: boolean, allowEmpty: boolean): Segment[] | 'too_many' | null {
  if (typeof text !== 'string' || text.length > SESSION_LIMITS.segmentText) return null
  if (text.trim() === '') return allowEmpty ? [] : null
  const parts = text.split(',')
  if (parts.length > SESSION_LIMITS.segments) return 'too_many'
  const segments: Segment[] = []
  for (const raw of parts) {
    const match = SEGMENT.exec(raw.trim())
    if (match === null || (!weekly && match[3] !== undefined)) return null
    const start = minutesOf(match[1], false), end = minutesOf(match[2], true)
    if (start === null || end === null || start === end) return null
    let days = 0
    for (const digit of match[3] ?? '12345') days |= 1 << (Number(digit) - 1)
    segments.push(Object.freeze({ start, end: end <= start ? end + 1440 : end, days: weekly ? days : 127 }))
  }
  return segments
}

/** The epoch-day number of a real `YYYY-MM-DD`, else null (`2026-02-30` is not a date). */
function dayNumber (text: unknown): number | null {
  if (typeof text !== 'string') return null
  const match = DATE.exec(text)
  if (match === null) return null
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3])
  const at = new Date(0); at.setUTCFullYear(year, month - 1, day); at.setUTCHours(0, 0, 0, 0)
  return at.getUTCFullYear() === year && at.getUTCMonth() === month - 1 && at.getUTCDate() === day ? Math.round(at.getTime() / DAY) : null
}

/**
 * Checks a `SymbolSession`. Valid input comes back as a frozen `TradingSession`; any fault returns `session: null` with
 * every fault listed, so one pass shows everything to fix. `fallbackTimezone` is the symbol's own zone (default UTC).
 */
export function compileSession (raw: unknown, fallbackTimezone = 'UTC'): { session: TradingSession | null, issues: readonly SessionIssue[] } {
  const issues: SessionIssue[] = []
  const fail = (field: string, code: SessionIssueCode): void => { issues.push(Object.freeze({ field, code })) }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { session: null, issues: Object.freeze([Object.freeze({ field: 'session', code: 'bad_session' as const })]) }
  const input = raw as Partial<Record<string, unknown>>
  const zone = input.timezone === undefined ? fallbackTimezone : input.timezone
  if (typeof zone !== 'string' || zone === '' || !zoneKnown(zone)) fail('timezone', 'bad_timezone')
  if (input.regular === undefined) fail('regular', 'bad_session')

  const weekly: { regular: Segment[], pre: Segment[], post: Segment[] } = { regular: [], pre: [], post: [] }
  for (const field of FIELDS) {
    if (input[field] === undefined) continue
    const parsed = parseSegments(input[field], true, false)
    if (parsed === null || parsed === 'too_many') fail(field, parsed === null ? 'bad_segments' : 'too_many')
    else weekly[field] = parsed
  }

  const closed = new Set<number>(), exceptions = new Map<number, Partial<Fields>>()
  let dates = 0
  if (input.closed !== undefined) {
    if (!Array.isArray(input.closed)) fail('closed', 'bad_date')
    else {
      for (const [index, date] of (input.closed as unknown[]).entries()) {
        if (++dates > SESSION_LIMITS.dates) { fail('closed', 'too_many'); break }
        const day = dayNumber(date)
        if (day === null) fail(`closed[${index}]`, 'bad_date'); else closed.add(day)
      }
    }
  }
  if (input.exceptions !== undefined) {
    const table = input.exceptions
    if (table === null || typeof table !== 'object' || Array.isArray(table)) fail('exceptions', 'bad_date')
    else {
      for (const [date, value] of Object.entries(table)) {
        if (++dates > SESSION_LIMITS.dates) { fail('exceptions', 'too_many'); break }
        const day = dayNumber(date)
        if (day === null || value === null || typeof value !== 'object' || Array.isArray(value)) { fail(`exceptions[${date.slice(0, 32)}]`, 'bad_date'); continue }
        const entry: { regular?: Segment[], pre?: Segment[], post?: Segment[] } = {}
        for (const field of FIELDS) {
          const text = (value as Partial<Record<string, unknown>>)[field]
          if (text === undefined) continue
          const parsed = parseSegments(text, false, true)
          if (parsed === null || parsed === 'too_many') fail(`exceptions[${date}].${field}`, parsed === null ? 'bad_segments' : 'too_many')
          else entry[field] = parsed
        }
        exceptions.set(day, entry)
      }
    }
  }
  if (issues.length > 0) return { session: null, issues: Object.freeze(issues) }
  return { session: Object.freeze({ timezone: zone as string, weekly: Object.freeze(weekly), closed, exceptions }), issues: Object.freeze([]) }
}

/** The `{ session }` of a symbol compiled with the symbol's own zone as the default; a symbol without one has none, with no issues. */
export function compileSymbolSession (symbol: { session?: SymbolSession, timezone?: string }): { session: TradingSession | null, issues: readonly SessionIssue[] } {
  return symbol.session === undefined ? { session: null, issues: Object.freeze([]) } : compileSession(symbol.session, symbol.timezone ?? 'UTC')
}

/** A wall-clock moment (read as UTC ms) in `zone`, as the real instant. At a daylight-saving jump the later reading wins. */
function wallToInstant (zone: string, wall: number): number {
  const first = zoneOffset(zone, wall)
  const guess = wall - first
  const second = zoneOffset(zone, guess)
  return second === first ? guess : wall - second
}

const PRIORITY: Record<SessionKind, number> = { regular: 3, pre: 2, post: 1, closed: 0 }
interface Span { readonly start: number, readonly end: number, readonly kind: SessionKind }
const spanCache = new WeakMap<TradingSession, Map<number, readonly Span[]>>()

/** The spans that start on one local day (they may end on the next). Cached per session and day. */
function spansStartingOn (session: TradingSession, day: number): readonly Span[] {
  let cache = spanCache.get(session)
  if (cache === undefined) { cache = new Map(); spanCache.set(session, cache) }
  const known = cache.get(day)
  if (known !== undefined) return known
  const spans: Span[] = []
  if (!session.closed.has(day)) {
    const iso = ((day % 7) + 7 + 3) % 7 // 0 Monday ... 6 Sunday: epoch day 0 was a Thursday
    const exception = session.exceptions.get(day)
    for (const kind of FIELDS) {
      for (const segment of exception?.[kind] ?? session.weekly[kind]) {
        if ((segment.days & (1 << iso)) === 0) continue
        spans.push(Object.freeze({ kind, start: wallToInstant(session.timezone, day * DAY + segment.start * MINUTE), end: wallToInstant(session.timezone, day * DAY + segment.end * MINUTE) }))
      }
    }
  }
  if (cache.size >= 20000) cache.clear()
  cache.set(day, Object.freeze(spans))
  return cache.get(day) as readonly Span[]
}

const localDay = (session: TradingSession, timestamp: number): number => Math.floor((timestamp + zoneOffset(session.timezone, timestamp)) / DAY)
const valid = (timestamp: number): boolean => Number.isFinite(timestamp) && Math.abs(timestamp) <= 8.64e15

/** What `timestamp` is. A non-finite or out-of-range time is `closed`. */
export function sessionKindAt (session: TradingSession, timestamp: number): SessionKind {
  if (!valid(timestamp)) return 'closed'
  const day = localDay(session, timestamp)
  let best: SessionKind = 'closed'
  for (let d = day - 1; d <= day; d++) {
    for (const span of spansStartingOn(session, d)) if (span.start <= timestamp && timestamp < span.end && PRIORITY[span.kind] > PRIORITY[best]) best = span.kind
  }
  return best
}

/** The first moment after `timestamp` at which `sessionKindAt` changes, looking at most three days ahead; null if none. */
export function sessionChangeAfter (session: TradingSession, timestamp: number): number | null {
  if (!valid(timestamp)) return null
  const kind = sessionKindAt(session, timestamp), day = localDay(session, timestamp)
  const edges: number[] = []
  for (let d = day - 1; d <= day + 3; d++) for (const span of spansStartingOn(session, d)) { if (span.start > timestamp) edges.push(span.start); if (span.end > timestamp) edges.push(span.end) }
  edges.sort((a, b) => a - b)
  for (const edge of edges) if (sessionKindAt(session, edge) !== kind) return edge
  return null
}

/** The end of the last regular session that ends in `(after, until]`, looking back at most 16 days; null if none. */
function lastRegularClose (session: TradingSession, after: number, until: number): number | null {
  const day = localDay(session, until)
  let best: number | null = null
  for (let d = day; d >= day - 16; d--) {
    for (const span of spansStartingOn(session, d)) if (span.kind === 'regular' && span.end <= until && span.end > after && (best === null || span.end > best)) best = span.end
    if (best !== null && d < day - 1) break
  }
  return best
}

/**
 * Where a bar that opened at `openedAt` really closes. An intraday bar ends at its period or at the end of the session
 * stretch it opened in (regular, pre or post), whichever comes first, as exchanges split bars at the session edge. A
 * bar of a day or more ends at the last regular close before the period's calendar end. `undefined` means the schedule
 * cannot say (the bar opened while closed, or the period is unknown): use the period estimate.
 */
export function sessionBarClose (session: TradingSession, openedAt: number, period: Pick<Period, 'multiplier' | 'timespan'>, symbolTimezone = 'UTC'): number | undefined {
  const estimate = nextBarClose(openedAt, period, symbolTimezone)
  if (estimate === null || !valid(openedAt)) return undefined
  if (period.timespan === 'second' || period.timespan === 'minute' || period.timespan === 'hour') {
    if (sessionKindAt(session, openedAt) === 'closed') return undefined
    const edge = sessionChangeAfter(session, openedAt)
    return edge !== null && edge < estimate ? edge : estimate
  }
  return lastRegularClose(session, openedAt, estimate) ?? undefined
}

/** The bar classes and day breaks `sessionLayout` returns: `kinds[i]` is 0 regular, 1 pre, 2 post, 3 closed. */
export interface SessionLayout { readonly kinds: Uint8Array, readonly breaks: Uint8Array }
const KIND_CODE: Record<SessionKind, number> = { regular: 0, pre: 1, post: 2, closed: 3 }

/**
 * For bars opening at `timestamps` (ascending): the class of each and whether it is the first bar of a new local date
 * (`breaks[i] === 1`; never the first bar given). Non-finite times are `closed` and start no day.
 */
export function sessionLayout (session: TradingSession, timestamps: ArrayLike<number>): SessionLayout {
  const count = timestamps.length, kinds = new Uint8Array(count), breaks = new Uint8Array(count)
  let previous = Number.NaN
  for (let i = 0; i < count; i++) {
    const timestamp = timestamps[i]
    if (!valid(timestamp)) { kinds[i] = 3; continue }
    kinds[i] = KIND_CODE[sessionKindAt(session, timestamp)]
    const day = localDay(session, timestamp)
    if (Number.isFinite(previous) && day !== previous) breaks[i] = 1
    previous = day
  }
  return { kinds, breaks }
}
