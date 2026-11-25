// SPDX-License-Identifier: GPL-3.0-or-later
// Round-time ticks for a bar-index time axis. DOM-free: it needs only Intl, so the same ticks can be
// computed on a server or in a test. The renderer measures text and passes the spacing it needs.

import type { Timespan } from './feed'

/** How coarse a tick is: years, months and days are drawn emphasised, the rest are plain times. */
export type TimeTickLevel = 'year' | 'month' | 'day' | 'hour' | 'minute' | 'second'

export interface TimeTick {
  /** Index into the timestamps (and positions) the ticks were chosen from. */
  index: number
  level: TimeTickLevel
  label: string
}

export interface TimeTickOptions {
  /** The viewer's display IANA zone, read for intraday bars. Default UTC. */
  timeZone?: string
  /** SymbolInfo.timezone: day-and-larger bars are session dates in it. Default UTC. */
  symbolTimezone?: string
  /** Feed period. Day, week, month and year bars carry a date only, so they never get a time-of-day tick. */
  timespan?: Timespan
  /** BCP 47 tag for month and day names (for example `zh-TW`). Default `en`. */
  locale?: string
  /** Smallest distance in pixels between two tick positions; the caller derives it from its label width. */
  minSpacing: number
  /** Positions outside `[left, right]` are not candidates. Default: all of them. */
  left?: number
  right?: number
}

// Ranks order the boundaries a bar can start. Larger wins when two ticks compete for room.
const YEAR = 100
const MONTH = 90
// A bar that opens a new group of 15, 10, 5 or 2 days of the month outranks a plain new day, so a daily chart reads
// "Nov 16 Dec 16" rather than losing its days between the months.
const DAY_GROUPS: ReadonlyArray<readonly [number, number]> = [[15, 85], [10, 84], [5, 83], [2, 82]]
const DAY = 80
// Time of day crossings, seconds, with the rank of the tick they make.
const TIME_STEPS: ReadonlyArray<readonly [number, number]> = [
  [43200, 70], [21600, 69], [10800, 68], [3600, 67], [1800, 66], [900, 65], [300, 64], [60, 63], [30, 62], [15, 61], [10, 60], [5, 59], [1, 58]
]
const SURVIVAL = 0.85

function levelOf (rank: number): TimeTickLevel {
  return rank >= YEAR ? 'year' : rank >= MONTH ? 'month' : rank >= DAY ? 'day' : rank >= 67 ? 'hour' : rank >= 63 ? 'minute' : 'second'
}

const offsetCache = new Map<string, Map<number, number>>()
const OFFSET_BUCKET = 900000
const zoneFormats = new Map<string, Intl.DateTimeFormat | null>()
function zoneFormat (timeZone: string): Intl.DateTimeFormat | null {
  const known = zoneFormats.get(timeZone)
  if (known !== undefined) return known
  let format: Intl.DateTimeFormat | null = null
  try {
    format = new Intl.DateTimeFormat('en', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
  } catch { /* an unknown zone reads as UTC, like formatBarDate */ }
  if (zoneFormats.size >= 16) zoneFormats.delete(zoneFormats.keys().next().value as string)
  zoneFormats.set(timeZone, format)
  return format
}
/** Milliseconds the zone is ahead of UTC at `timestamp`, cached per quarter hour so panning does not re-ask Intl. */
export function zoneOffset (timeZone: string, timestamp: number): number {
  if (timeZone === 'UTC') return 0
  const format = zoneFormat(timeZone)
  if (format === null) return 0
  const bucket = Math.floor(timestamp / OFFSET_BUCKET)
  let cache = offsetCache.get(timeZone)
  if (cache === undefined) {
    if (offsetCache.size >= 16) offsetCache.delete(offsetCache.keys().next().value as string)
    cache = new Map(); offsetCache.set(timeZone, cache)
  } else {
    const hit = cache.get(bucket)
    if (hit !== undefined) return hit
  }
  const at = bucket * OFFSET_BUCKET
  const part: Record<string, number> = {}
  for (const { type, value } of format.formatToParts(at)) if (type !== 'literal') part[type] = Number(value)
  const offset = Date.UTC(part.year, part.month - 1, part.day, part.hour % 24, part.minute, part.second) - at
  if (cache.size >= 20000) cache.clear()
  cache.set(bucket, offset)
  return offset
}

const labelFormats = new Map<string, Intl.DateTimeFormat>()
function labelFormat (locale: string, kind: 'year' | 'month' | 'day'): Intl.DateTimeFormat {
  const key = `${locale}|${kind}`
  let format = labelFormats.get(key)
  if (format !== undefined) return format
  const options: Intl.DateTimeFormatOptions = kind === 'year' ? { year: 'numeric' } : kind === 'month' ? { month: 'short' } : { day: 'numeric' }
  try { format = new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }) } catch { format = new Intl.DateTimeFormat('en', { ...options, timeZone: 'UTC' }) }
  if (labelFormats.size >= 24) labelFormats.delete(labelFormats.keys().next().value as string)
  labelFormats.set(key, format)
  return format
}
const two = (value: number): string => value < 10 ? `0${value}` : String(value)

function dayOrLarger (timespan: Timespan | undefined): boolean {
  return timespan === 'day' || timespan === 'week' || timespan === 'month' || timespan === 'year'
}

interface Fields { year: number, month: number, day: number, second: number, localMs: number }
function fieldsAt (timestamp: number, timeZone: string, dateOnly: boolean): Fields {
  const localMs = timestamp + zoneOffset(timeZone, timestamp)
  const date = new Date(localMs)
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth(),
    day: date.getUTCDate(),
    localMs,
    second: dateOnly ? 0 : date.getUTCHours() * 3600 + date.getUTCMinutes() * 60 + date.getUTCSeconds()
  }
}

/** The largest boundary this bar starts, judged against the bar before it (or, for the first bar, against the clock). */
function rankOf (now: Fields, before: Fields | null, dateOnly: boolean): number {
  if (before === null) {
    if (now.day === 1 && now.second === 0) return now.month === 0 ? YEAR : MONTH
    if (now.second === 0) return DAY
    if (dateOnly) return 0
    for (const [step, rank] of TIME_STEPS) if (now.second % step === 0) return rank
    return 0
  }
  if (now.year !== before.year) return YEAR
  if (now.month !== before.month) return MONTH
  if (now.day !== before.day) {
    for (const [size, rank] of DAY_GROUPS) if (Math.floor((now.day - 1) / size) !== Math.floor((before.day - 1) / size)) return rank
    return DAY
  }
  if (!dateOnly) for (const [step, rank] of TIME_STEPS) if (Math.floor(now.second / step) !== Math.floor(before.second / step)) return rank
  return 0
}

/**
 * Pick round-time ticks for bars drawn at `positions` (pixels, ascending, same length as `timestamps`).
 *
 * Bars sit at equal steps, so a weekend or a closed session is not a gap on the axis. A tick is therefore a bar that
 * starts a boundary: the first bar of a year, month or day, or the first one past a round time of day (12h down to
 * 1s, in the zone the bars are read in). The ticks come from the coarsest boundaries first; each finer level is added
 * while at least 85% of its candidates fit `minSpacing` apart, so a short window gets minute ticks, a long one gets
 * months and years, and a width change moves between them. Higher boundaries keep their place when two collide.
 * Day-and-larger bars never produce time-of-day ticks.
 */
export function timeAxisTicks (timestamps: ArrayLike<number>, positions: ArrayLike<number>, options: TimeTickOptions): TimeTick[] {
  const count = Math.min(timestamps.length, positions.length)
  if (count === 0) return []
  const dateOnly = dayOrLarger(options.timespan)
  const zone = (dateOnly ? options.symbolTimezone : options.timeZone) ?? 'UTC'
  const left = options.left ?? -Infinity, right = options.right ?? Infinity
  const spacing = Math.max(1, options.minSpacing)
  const ranks = new Int16Array(count)
  const fields = new Array<Fields | undefined>(count)
  let before: Fields | null = null
  let first = -1, last = -1
  for (let i = 0; i < count; i++) {
    const timestamp = timestamps[i], x = positions[i]
    if (!Number.isFinite(timestamp) || Math.abs(timestamp) > 8.64e15 || !Number.isFinite(x)) { before = null; continue }
    const now = fieldsAt(timestamp, zone, dateOnly)
    const inside = x >= left && x <= right
    if (inside) {
      if (first < 0) first = i
      last = i
      // The bar before the window (off screen) supplies the neighbour to cross from; with none, the clock decides.
      ranks[i] = rankOf(now, before, dateOnly)
      fields[i] = now
    }
    before = now
  }
  if (first < 0) return []
  const distinct = [...new Set(Array.from(ranks.subarray(first, last + 1)).filter(rank => rank > 0))].sort((a, b) => b - a)
  if (distinct.length === 0) return []
  const width = Number.isFinite(right - left) ? right - left : positions[last] - positions[first]
  const capacity = Math.floor(Math.max(0, width) / spacing) + 1
  let chosen: number[] = []
  for (const level of distinct) {
    const candidates: number[] = []
    for (let i = first; i <= last; i++) if (ranks[i] >= level) candidates.push(i)
    if (chosen.length > 0 && candidates.length * SURVIVAL > capacity) break
    const placed = placeByRank(candidates, ranks, positions, spacing)
    if (chosen.length > 0 && placed.length < candidates.length * SURVIVAL) break
    chosen = placed
  }
  const formatLocale = options.locale ?? 'en'
  return chosen.sort((a, b) => a - b).map(index => {
    const now = fields[index] as Fields, rank = ranks[index], level = levelOf(rank)
    const label = level === 'year' || level === 'month' || level === 'day'
      ? labelFormat(formatLocale, level).format(now.localMs)
      : level === 'second' ? `${two(Math.floor(now.second / 3600))}:${two(Math.floor(now.second / 60) % 60)}:${two(now.second % 60)}` : `${two(Math.floor(now.second / 3600))}:${two(Math.floor(now.second / 60) % 60)}`
    return { index, level, label }
  })
}

/** Highest rank first, leftmost first among equals; a candidate is dropped when it lands within `spacing` of one kept. */
function placeByRank (candidates: readonly number[], ranks: Int16Array, positions: ArrayLike<number>, spacing: number): number[] {
  const order = [...candidates].sort((a, b) => ranks[b] - ranks[a] || a - b)
  const kept: number[] = []
  for (const index of order) {
    const x = positions[index]
    let free = true
    for (const other of kept) if (Math.abs(positions[other] - x) < spacing) { free = false; break }
    if (free) kept.push(index)
  }
  return kept
}
