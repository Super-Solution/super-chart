/** Bar-interval countdown. Exchange holidays/early closes require an explicit close timestamp. */
import type { Period } from '../feed'
import type { ReplayTimer } from './timedReplay'
export type CountdownPeriod = Pick<Period, 'multiplier' | 'timespan'>
const DATE_LIMIT = 8.64e15
const validTime = (value: number): boolean => Number.isFinite(value) && Math.abs(value) <= DATE_LIMIT
const formats = new Map<string, Intl.DateTimeFormat | null>()
function formatter (zone: string): Intl.DateTimeFormat | null {
  if (formats.has(zone)) return formats.get(zone)!
  let result: Intl.DateTimeFormat | null
  try { result = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }) } catch { result = null }
  if (formats.size >= 8) formats.delete(formats.keys().next().value as string)
  formats.set(zone, result); return result
}
/** Encode local calendar components as UTC solely for calendar arithmetic. */
function wallTime (format: Intl.DateTimeFormat, timestamp: number): number {
  const parts: Record<string, number> = {}
  for (const part of format.formatToParts(timestamp)) if (['year', 'month', 'day', 'hour', 'minute', 'second'].includes(part.type)) parts[part.type] = Number(part.value)
  const value = new Date(0)
  value.setUTCFullYear(parts.year, parts.month - 1, parts.day)
  value.setUTCHours(parts.hour, parts.minute, parts.second, new Date(timestamp).getUTCMilliseconds())
  return value.getTime()
}

/** Fixed intraday elapsed time; daily+ advances the market's local calendar, preserving open time. */
export function nextBarClose (openedAt: number, period: CountdownPeriod, symbolTimezone = 'UTC'): number | null {
  if (!validTime(openedAt) || !Number.isSafeInteger(period.multiplier) || period.multiplier <= 0) return null
  const spans: Record<string, number> = { second: 1000, minute: 60000, hour: 3600000 }
  const span = spans[period.timespan]
  if (span !== undefined) { const close = openedAt + period.multiplier * span; return validTime(close) && close > openedAt ? close : null }
  if (!['day', 'week', 'month', 'year'].includes(period.timespan)) return null
  const format = formatter(symbolTimezone)
  if (format === null) return null
  const target = new Date(wallTime(format, openedAt))
  switch (period.timespan) {
    case 'day': target.setUTCDate(target.getUTCDate() + period.multiplier); break
    case 'week': target.setUTCDate(target.getUTCDate() + 7 * period.multiplier); break
    case 'month': target.setUTCMonth(target.getUTCMonth() + period.multiplier); break
    case 'year': target.setUTCFullYear(target.getUTCFullYear() + period.multiplier); break
  }
  const wall = target.getTime()
  if (!validTime(wall)) return null
  // Check offsets on both sides of a possible DST transition. Ambiguous or
  // nonexistent session wall times are unavailable rather than invented.
  const candidates = new Set<number>()
  for (const sample of [openedAt, wall - 36 * 3600000, wall, wall + 36 * 3600000]) {
    if (!validTime(sample)) continue
    const offset = wallTime(format, sample) - sample, candidate = wall - offset
    if (validTime(candidate) && candidate > openedAt && wallTime(format, candidate) === wall) candidates.add(candidate)
  }
  return candidates.size === 1 ? candidates.values().next().value as number : null
}
export function barRemaining (openedAt: number, period: CountdownPeriod, now: number, symbolTimezone = 'UTC'): number | null {
  const close = nextBarClose(openedAt, period, symbolTimezone)
  return close === null || !validTime(now) || now < openedAt || now >= close ? null : close - now
}
export function formatCountdown (milliseconds: number): string {
  if (!Number.isFinite(milliseconds)) throw new RangeError('Countdown duration must be finite milliseconds')
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000)), pad = (value: number): string => String(value).padStart(2, '0')
  if (seconds >= 86400) return `${Math.floor(seconds / 86400)}d ${pad(Math.floor(seconds % 86400 / 3600))}h`
  if (seconds >= 3600) return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds % 3600 / 60))}:${pad(seconds % 60)}`
  return `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`
}
export interface CountdownContext {
  marketKey: string
  lastBar: { timestamp: number, open: number, close: number } | null
  period: CountdownPeriod
  symbolTimezone?: string
  replaying?: boolean
  enabled?: boolean
  /** Undefined derives a period boundary; null explicitly marks an unknown session close. */
  closeTimestamp?: number | null
}
export interface BarCountdownSnapshot {
  readonly marketKey: string
  readonly openedAt: number
  readonly closesAt: number
  readonly remainingMs: number
  readonly text: string
  readonly price: number
  readonly direction: 'up' | 'down' | 'flat'
}
export function getBarCountdown (context: CountdownContext | null, now: number): BarCountdownSnapshot | null {
  const bar = context?.lastBar
  if (context === null || context.enabled === false || context.replaying === true || bar == null || !validTime(now) || !validTime(bar.timestamp) ||
    !Number.isFinite(bar.open) || !Number.isFinite(bar.close) || now < bar.timestamp) return null
  const close = context.closeTimestamp === undefined ? nextBarClose(bar.timestamp, context.period, context.symbolTimezone) : context.closeTimestamp
  if (close === null || !validTime(close) || close <= now || close <= bar.timestamp) return null
  const remainingMs = close - now
  return Object.freeze({
    marketKey: context.marketKey,
    openedAt: bar.timestamp,
    closesAt: close,
    remainingMs,
    text: formatCountdown(remainingMs),
    price: bar.close,
    direction: bar.close > bar.open ? 'up' : bar.close < bar.open ? 'down' : 'flat'
  })
}
export interface BarCountdownOptions {
  getContext: () => CountdownContext | null
  onChange: (snapshot: BarCountdownSnapshot | null) => void
  now?: () => number
  timer?: ReplayTimer
  hidden?: () => boolean
}
export interface BarCountdown { refresh: () => void, getSnapshot: () => BarCountdownSnapshot | null, dispose: () => void }

/** Host refreshes on data, market, replay and visibility changes; no timer runs while unavailable. */
export function createBarCountdown (options: BarCountdownOptions): BarCountdown {
  const now = options.now ?? Date.now, timer = options.timer ?? {
    setTimeout: (callback: () => void, milliseconds: number) => setTimeout(callback, milliseconds),
    clearTimeout: (handle: unknown) => { clearTimeout(handle as ReturnType<typeof setTimeout>) }
  }
  let snapshot: BarCountdownSnapshot | null = null, handle: unknown, generation = 0, disposed = false
  const cancel = (): void => { generation++; if (handle !== undefined) { timer.clearTimeout(handle); handle = undefined } }
  const refresh = (): void => {
    if (disposed) return
    cancel()
    const epoch = generation, time = now(), next = options.hidden?.() === true ? null : getBarCountdown(options.getContext(), time)
    const changed = next?.marketKey !== snapshot?.marketKey || next?.openedAt !== snapshot?.openedAt || next?.closesAt !== snapshot?.closesAt ||
      next?.text !== snapshot?.text || next?.price !== snapshot?.price || next?.direction !== snapshot?.direction
    snapshot = next
    if (changed) options.onChange(snapshot)
    if (disposed || epoch !== generation || snapshot === null) return
    const delay = Math.max(1, Math.min(snapshot.remainingMs, 1000 - ((time % 1000 + 1000) % 1000)))
    handle = timer.setTimeout(() => { if (!disposed && epoch === generation) { handle = undefined; refresh() } }, delay)
  }
  refresh()
  return {
    refresh,
    getSnapshot: () => snapshot,
    dispose: () => { if (disposed) return; disposed = true; cancel(); const changed = snapshot !== null; snapshot = null; if (changed) options.onChange(null) }
  }
}
