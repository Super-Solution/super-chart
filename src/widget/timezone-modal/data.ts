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

// The timezone picker's zones and labels. Offsets are never stored: each
// label is worked out for a date from the zone id (Intl), so daylight saving
// and rule changes (Kazakhstan's single zone since 2024, Norfolk Island's
// +11) are always right. Part of SUPer-Chart (Apache-2.0).

import i18n from '../../i18n'

/** The picker's cities, in list order, with their i18n keys (the chart's zone keys since v1). */
export const CURATED_ZONES: ReadonlyArray<{ key: string, city: string }> = [
  { key: 'Pacific/Honolulu', city: 'honolulu' },
  { key: 'America/Juneau', city: 'juneau' },
  { key: 'America/Los_Angeles', city: 'los_angeles' },
  { key: 'America/Chicago', city: 'chicago' },
  { key: 'America/Toronto', city: 'toronto' },
  { key: 'America/Sao_Paulo', city: 'sao_paulo' },
  { key: 'Europe/London', city: 'london' },
  { key: 'Europe/Berlin', city: 'berlin' },
  { key: 'Asia/Bahrain', city: 'bahrain' },
  { key: 'Asia/Dubai', city: 'dubai' },
  { key: 'Asia/Ashkhabad', city: 'ashkhabad' },
  { key: 'Asia/Almaty', city: 'almaty' },
  { key: 'Asia/Bangkok', city: 'bangkok' },
  { key: 'Asia/Shanghai', city: 'shanghai' },
  { key: 'Asia/Tokyo', city: 'tokyo' },
  { key: 'Australia/Sydney', city: 'sydney' },
  { key: 'Pacific/Norfolk', city: 'norfolk' }
]

export const UTC_ZONE = 'Etc/UTC'

// Browsers list some zones under their old ids (Chrome: Asia/Calcutta,
// Asia/Katmandu, Asia/Saigon). The city a person looks for, and the current id.
const RENAMED: Readonly<Record<string, { city: string, id: string }>> = {
  'Asia/Calcutta': { city: 'Kolkata', id: 'Asia/Kolkata' },
  'Asia/Katmandu': { city: 'Kathmandu', id: 'Asia/Kathmandu' },
  'Asia/Saigon': { city: 'Ho Chi Minh City', id: 'Asia/Ho_Chi_Minh' },
  'Asia/Rangoon': { city: 'Yangon', id: 'Asia/Yangon' },
  'Europe/Kiev': { city: 'Kyiv', id: 'Europe/Kyiv' },
  'Asia/Ashkhabad': { city: 'Ashgabat', id: 'Asia/Ashgabat' },
  'Asia/Dacca': { city: 'Dhaka', id: 'Asia/Dhaka' },
  'Asia/Thimbu': { city: 'Thimphu', id: 'Asia/Thimphu' },
  'Asia/Ulan_Bator': { city: 'Ulaanbaatar', id: 'Asia/Ulaanbaatar' },
  'America/Godthab': { city: 'Nuuk', id: 'America/Nuuk' },
  'Atlantic/Faeroe': { city: 'Faroe', id: 'Atlantic/Faroe' },
  'Pacific/Truk': { city: 'Chuuk', id: 'Pacific/Chuuk' },
  'Pacific/Ponape': { city: 'Pohnpei', id: 'Pacific/Pohnpei' },
  'Pacific/Enderbury': { city: 'Kanton', id: 'Pacific/Kanton' }
}

const offsetFormats = new Map<string, Intl.DateTimeFormat | null>()
const canonicalIds = new Map<string, string | null>()

/** Intl's id for `zone` ('Etc/UTC' → 'UTC'), or null when Intl does not know it. */
export function canonicalZone (zone: string): string | null {
  let id = canonicalIds.get(zone)
  if (id === undefined) {
    try {
      id = new Intl.DateTimeFormat('en-US', { timeZone: zone }).resolvedOptions().timeZone
    } catch (e) {
      id = null
    }
    canonicalIds.set(zone, id)
  }
  return id
}

/** True when both ids name one zone. */
export function sameZone (a: string, b: string): boolean {
  if (a === b) {
    return true
  }
  const ca = canonicalZone(a)
  return ca !== null && ca === canonicalZone(b)
}

function isUtc (zone: string): boolean {
  return sameZone(zone, UTC_ZONE)
}

/** The viewer's own zone, as Intl reports it; 'Etc/UTC' if it cannot. */
export function localTimeZone (): string {
  try {
    const zone = new Intl.DateTimeFormat().resolvedOptions().timeZone
    return typeof zone === 'string' && zone !== '' ? zone : UTC_ZONE
  } catch (e) {
    return UTC_ZONE
  }
}

/** Minutes east of UTC in `zone` at `date` (Los Angeles in January: -480). */
export function offsetMinutes (zone: string, date: Date = new Date()): number {
  let format = offsetFormats.get(zone)
  if (format === undefined) {
    try {
      format = new Intl.DateTimeFormat('en-US', {
        timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric'
      })
    } catch (e) {
      format = null
    }
    offsetFormats.set(zone, format)
  }
  if (format === null) {
    return 0
  }
  const parts: Record<string, number> = {}
  for (const part of format.formatToParts(date)) {
    if (part.type !== 'literal') {
      parts[part.type] = Number(part.value)
    }
  }
  const wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute, parts.second)
  const instant = Math.floor(date.getTime() / 1000) * 1000
  return Math.round((wall - instant) / 60_000)
}

/** 'GMT', 'GMT+8', 'GMT-3:30'. */
export function formatOffset (minutes: number): string {
  if (minutes === 0) {
    return 'GMT'
  }
  const sign = minutes > 0 ? '+' : '-'
  const abs = Math.abs(minutes)
  const hours = Math.floor(abs / 60)
  const rest = abs % 60
  return `GMT${sign}${hours}${rest > 0 ? `:${String(rest).padStart(2, '0')}` : ''}`
}

/** The city a zone is named after, in `locale` for the picker's cities ('Asia/Kolkata' → 'Kolkata'). */
export function zoneCity (zone: string, locale: string): string {
  if (isUtc(zone)) {
    return i18n('utc', locale)
  }
  const curated = CURATED_ZONES.find(z => z.key === zone) ?? CURATED_ZONES.find(z => sameZone(z.key, zone))
  if (curated !== undefined) {
    return i18n(curated.city, locale)
  }
  const renamed = RENAMED[zone] ?? RENAMED[canonicalZone(zone) ?? '']
  if (renamed !== undefined) {
    return renamed.city
  }
  const last = zone.split('/').pop() ?? zone
  return last.replace(/_/g, ' ')
}

/**
 * A readable label for any zone at `date`: "Los Angeles · GMT-7", "UTC",
 * and "Local · Taipei · GMT+8" for the viewer's own zone.
 */
export function timezoneLabel (zone: string, locale: string, date: Date = new Date(), local: string = localTimeZone()): string {
  const base = isUtc(zone) ? i18n('utc', locale) : `${zoneCity(zone, locale)} · ${formatOffset(offsetMinutes(zone, date))}`
  return sameZone(zone, local) ? `${i18n('timezone_local', locale)} · ${base}` : base
}

/** v1 name: the label of `timezone` in `locale`, now. */
export function translateTimezone (timezone: string, locale: string): string {
  return timezoneLabel(timezone, locale)
}

export interface TimezoneOption {
  /** An IANA id Intl accepts: what the chart is given. Never a sentinel. */
  key: string
  name: string
  offset: string
  group: 'local' | 'utc' | 'city' | 'all'
}

/** Every zone the browser knows (Intl.supportedValuesOf), or [] without it. */
export function supportedZones (): string[] {
  const supportedValuesOf = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf
  if (typeof supportedValuesOf !== 'function') {
    return []
  }
  try {
    return supportedValuesOf('timeZone')
  } catch (e) {
    return []
  }
}

/**
 * The picker's list at `date`: the viewer's zone first, UTC, the picker's
 * cities, then every other zone the browser knows (A→Z). One entry per zone:
 * a city that is the viewer's zone only appears as Local.
 */
export function createTimezoneOptions (locale: string, date: Date = new Date(), local: string = localTimeZone(), all: readonly string[] = supportedZones()): TimezoneOption[] {
  const out: TimezoneOption[] = []
  const seen = new Set<string>()
  const add = (key: string, group: TimezoneOption['group']): void => {
    const id = canonicalZone(key)
    if (id === null || seen.has(id)) {
      return
    }
    seen.add(id)
    const utc = isUtc(key)
    out.push({
      key,
      name: group === 'local' ? `${i18n('timezone_local', locale)} · ${utc ? i18n('utc', locale) : zoneCity(key, locale)}` : zoneCity(key, locale),
      offset: formatOffset(offsetMinutes(key, date)),
      group
    })
  }
  add(local, 'local')
  add(UTC_ZONE, 'utc')
  CURATED_ZONES.forEach(z => { add(z.key, 'city') })
  const rest = all.filter(z => !z.startsWith('Etc/'))
    .map(z => ({ z, city: zoneCity(z, locale) }))
    .sort((a, b) => a.city.localeCompare(b.city))
  rest.forEach(({ z }) => { add(z, 'all') })
  return out
}

const genericNames = new Map<string, string>()

function genericName (zone: string, locale: string): string {
  const cacheKey = `${locale}|${zone}`
  let name = genericNames.get(cacheKey)
  if (name === undefined) {
    try {
      const part = new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: 'longGeneric' })
        .formatToParts(new Date()).find(p => p.type === 'timeZoneName')
      name = part?.value ?? ''
    } catch (e) {
      name = ''
    }
    genericNames.set(cacheKey, name)
  }
  return name
}

/**
 * Whether `option` matches a search: its id (old or current), city, offset
 * ("GMT+5:30", "+5:30") or the zone's name in the chart's locale ("Pacific
 * Time", "太平洋時間").
 */
export function matchesTimezone (option: TimezoneOption, query: string, locale: string): boolean {
  const q = query.trim().toLowerCase()
  if (q === '') {
    return true
  }
  const renamed = RENAMED[option.key] ?? RENAMED[canonicalZone(option.key) ?? '']
  const haystack = [
    option.key, option.key.replace(/_/g, ' '), option.name, option.offset,
    renamed?.id ?? '', renamed?.city ?? '', genericName(option.key, locale)
  ].join('\n').toLowerCase()
  return haystack.includes(q)
}
