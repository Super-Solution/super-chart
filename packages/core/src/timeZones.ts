// SPDX-License-Identifier: GPL-3.0-or-later
// IANA time zones from Intl alone: no zone database is shipped. DOM-free.

import { zoneOffset } from './timeAxis'

/** The zones a trader reaches for first, shown above the full list. Each is a real IANA id. */
export const COMMON_TIME_ZONES: readonly string[] = Object.freeze([
  'UTC', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Dubai', 'Asia/Kolkata',
  'Asia/Singapore', 'Asia/Hong_Kong', 'Asia/Shanghai', 'Asia/Taipei', 'Asia/Tokyo', 'Asia/Seoul', 'Australia/Sydney'
])

/** Why a value is not a usable zone. Stable: agents and hosts may branch on it. */
export type TimeZoneIssueCode = 'time_zone_type' | 'time_zone_unknown'
export type TimeZoneCheck = { ok: true, id: string } | { ok: false, code: TimeZoneIssueCode, hint: string }

/** Whether `value` is an IANA zone this runtime accepts (`UTC` and aliases such as `Asia/Calcutta` included). */
export function checkTimeZone (value: unknown): TimeZoneCheck {
  if (typeof value !== 'string' || value.trim() === '') return { ok: false, code: 'time_zone_type', hint: 'A time zone is a nonempty IANA name such as "Asia/Taipei" or "UTC".' }
  try {
    void new Intl.DateTimeFormat('en', { timeZone: value }).format(0)
  } catch {
    return { ok: false, code: 'time_zone_unknown', hint: `"${value}" is not an IANA time zone this runtime knows; use a name from listTimeZones(), for example "America/New_York".` }
  }
  return { ok: true, id: value }
}

let listed: readonly string[] | null = null
/** Every zone the runtime reports (`Intl.supportedValuesOf`), with `UTC` first; the common list alone where Intl cannot enumerate. */
export function listTimeZones (): readonly string[] {
  if (listed !== null) return listed
  let all: string[] = []
  try { all = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone') ?? [] } catch { /* an older runtime */ }
  const names = new Set<string>(['UTC'])
  for (const id of all.length > 0 ? all : COMMON_TIME_ZONES) names.add(id)
  listed = Object.freeze([...names])
  return listed
}

/** The zone of this device, or `UTC` where the runtime cannot say. */
export function localTimeZone (): string {
  try { return new Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { return 'UTC' }
}

/** `+08:00`, `-04:00`, `+05:30`: the zone's offset from UTC at `at`, for a menu label. `UTC` is `+00:00`. */
export function formatUtcOffset (timeZone: string, at: number): string {
  const minutes = Math.round(zoneOffset(timeZone, at) / 60000), abs = Math.abs(minutes)
  return `${minutes < 0 ? '-' : '+'}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`
}

export interface TimeZoneChoice {
  id: string
  /** Offset from UTC at the moment asked, `+08:00`. */
  offset: string
  group: 'common' | 'all'
}

/**
 * The zones for a picker: this device's zone and the common ones first, then every other zone alphabetically, then
 * `extra` ids the host uses that Intl does not list (an alias such as `Asia/Calcutta`). Offsets are read at `at`
 * (default now), so daylight saving shows as it is today.
 */
export function timeZoneChoices (options: { at?: number, extra?: readonly string[], local?: string } = {}): TimeZoneChoice[] {
  const at = options.at ?? Date.now(), local = options.local ?? localTimeZone()
  const first = [...new Set(['UTC', local, ...COMMON_TIME_ZONES])]
  const seen = new Set(first)
  const rest = [...listTimeZones(), ...(options.extra ?? [])].filter(id => { if (seen.has(id) || !checkTimeZone(id).ok) return false; seen.add(id); return true })
  rest.sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
  return [
    ...first.filter(id => checkTimeZone(id).ok).map(id => ({ id, offset: formatUtcOffset(id, at), group: 'common' as const })),
    ...rest.map(id => ({ id, offset: formatUtcOffset(id, at), group: 'all' as const }))
  ]
}
