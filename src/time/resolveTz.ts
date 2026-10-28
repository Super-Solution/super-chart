/**
 * Time zone ids: what setTimezone accepts and what the chart stores.
 *
 * klinecharts takes any IANA id and silently keeps its previous zone for one
 * it cannot use, and the timezone picker's labels are keyed by exact strings
 * ('Etc/UTC', 'Asia/Ashkhabad') that Intl canonicalises differently ('UTC',
 * 'Asia/Ashgabat'). resolveTz turns anything Intl accepts into the id the
 * picker uses when it lists that zone (so labels and the picker stay in step),
 * and anything else into null.
 *
 * Part of SUPer-Chart (Apache-2.0).
 */

/** The zones the timezone picker lists (src/widget/timezone-modal/data.ts). */
export const PICKER_ZONES = [
  'Etc/UTC', 'Pacific/Honolulu', 'America/Juneau', 'America/Los_Angeles', 'America/Chicago', 'America/Toronto',
  'America/Sao_Paulo', 'Europe/London', 'Europe/Berlin', 'Asia/Bahrain', 'Asia/Dubai', 'Asia/Ashkhabad',
  'Asia/Almaty', 'Asia/Bangkok', 'Asia/Shanghai', 'Asia/Tokyo', 'Australia/Sydney', 'Pacific/Norfolk'
] as const

const canonicalCache = new Map<string, string | null>()

/** Intl's canonical id for `tz`, or null when Intl does not know it. */
export function canonicalTz (tz: string): string | null {
  const hit = canonicalCache.get(tz)
  if (hit !== undefined) {
    return hit
  }
  let out: string | null
  try {
    out = new Intl.DateTimeFormat('en', { timeZone: tz }).resolvedOptions().timeZone
  } catch {
    out = null
  }
  canonicalCache.set(tz, out)
  return out
}

/** The viewer's own zone (what 'local' means). */
export function localTz (): string {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC'
  } catch {
    return 'UTC'
  }
}

/**
 * The picker's key for a zone Intl considers the same one ('UTC', 'utc',
 * 'Etc/UTC' and 'GMT' all give 'Etc/UTC'), or undefined when the picker does
 * not list it.
 */
export function pickerKeyOf (tz: string): string | undefined {
  if ((PICKER_ZONES as readonly string[]).includes(tz)) {
    return tz
  }
  const canonical = canonicalTz(tz)
  if (canonical === null) {
    return undefined
  }
  return PICKER_ZONES.find(z => canonicalTz(z) === canonical)
}

/**
 * The zone id to store for `input`: 'local' (or empty) is the viewer's zone;
 * an id Intl accepts, in any case or alias, becomes the picker's key for that
 * zone or else Intl's canonical id. Null for anything Intl rejects ('UTC+8',
 * 'Mars/Olympus'): the caller keeps its current zone.
 */
export function resolveTz (input: unknown): string | null {
  if (input === undefined || input === null || input === '' || input === 'local') {
    return localTz()
  }
  if (typeof input !== 'string') {
    return null
  }
  const canonical = canonicalTz(input.trim())
  if (canonical === null) {
    return null
  }
  return pickerKeyOf(canonical) ?? canonical
}

/** A fix for a zone Intl rejects: 'UTC+8' -> 'Etc/GMT-8' (POSIX signs are inverted). */
export function timezoneHint (input: unknown): string {
  const offset = typeof input === 'string' ? /^(?:UTC|GMT)\s*([+-])\s*(\d{1,2})(?::?00)?$/i.exec(input.trim()) : null
  if (offset !== null) {
    const hours = Number(offset[2])
    if (hours > 0 && hours <= 14) {
      return `Use an IANA id: a fixed UTC${offset[1]}${hours} is 'Etc/GMT${offset[1] === '+' ? '-' : '+'}${hours}' (or a city such as 'Asia/Taipei'), or 'local'.`
    }
  }
  return "Use an IANA time zone id such as 'Asia/Taipei' or 'America/New_York', or 'local' for the viewer's zone."
}
