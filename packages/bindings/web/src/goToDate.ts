// SPDX-License-Identifier: GPL-3.0-or-later

/** A date typed as `2026-03-01`, `2026/3/1`, `2026-03-01 14:30` or `2026-03-01T14:30`, read as wall-clock time in `timeZone`; null for anything else or an impossible date. */
export function parseDateQuery (query: string, timeZone = 'UTC'): number | null {
  const match = /^\s*(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T]+(\d{1,2}):(\d{2}))?\s*$/.exec(query)
  if (match === null) return null
  const [year, month, day, hour, minute] = [match[1], match[2], match[3], match[4] ?? '0', match[5] ?? '0'].map(Number) as [number, number, number, number, number]
  const wall = Date.UTC(year, month - 1, day, hour, minute)
  const check = new Date(wall)
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day || hour > 23 || minute > 59) return null
  // Two passes settle the offset across a daylight-saving change.
  let timestamp = wall - offsetAt(timeZone, wall)
  timestamp = wall - offsetAt(timeZone, timestamp)
  return Number.isFinite(timestamp) ? timestamp : null
}

/** The wall-clock date of a timestamp in `timeZone`, in the form `parseDateQuery` reads back. */
export function formatDateQuery (timestamp: number, timeZone = 'UTC'): string {
  const parts = partsAt(timeZone, timestamp)
  const two = (value: number): string => String(value).padStart(2, '0')
  return `${parts.year}-${two(parts.month)}-${two(parts.day)} ${two(parts.hour)}:${two(parts.minute)}`
}

function partsAt (timeZone: string, timestamp: number): { year: number, month: number, day: number, hour: number, minute: number } {
  let format: Intl.DateTimeFormat
  try { format = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }) } catch { format = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }) }
  const value: Record<string, number> = {}
  for (const part of format.formatToParts(timestamp)) if (part.type !== 'literal') value[part.type] = Number(part.value)
  return { year: value.year ?? 1970, month: value.month ?? 1, day: value.day ?? 1, hour: value.hour ?? 0, minute: value.minute ?? 0 }
}

function offsetAt (timeZone: string, timestamp: number): number {
  const p = partsAt(timeZone, timestamp)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(timestamp / 60_000) * 60_000
}
