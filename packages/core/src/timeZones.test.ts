import { describe, expect, it } from 'vitest'
import { COMMON_TIME_ZONES, checkTimeZone, formatUtcOffset, listTimeZones, timeZoneChoices } from './timeZones'

describe('time zones', () => {
  it('accepts IANA names and UTC, and says why it refuses anything else', () => {
    for (const id of ['UTC', 'Asia/Taipei', 'America/New_York', 'Asia/Calcutta']) expect(checkTimeZone(id)).toEqual({ ok: true, id })
    expect(checkTimeZone('Mars/Olympus')).toMatchObject({ ok: false, code: 'time_zone_unknown' })
    for (const bad of ['', '  ', 7, null, undefined, {}]) expect(checkTimeZone(bad)).toMatchObject({ ok: false, code: 'time_zone_type' })
  })

  it('lists UTC and the runtime zones once, and every common zone is real', () => {
    const all = listTimeZones()
    expect(all[0]).toBe('UTC')
    expect(new Set(all).size).toBe(all.length)
    expect(all).toContain('Asia/Taipei')
    for (const id of COMMON_TIME_ZONES) expect(checkTimeZone(id).ok).toBe(true)
  })

  it('formats offsets at the moment asked, daylight saving and half hours included', () => {
    expect(formatUtcOffset('UTC', 0)).toBe('+00:00')
    expect(formatUtcOffset('Asia/Taipei', 0)).toBe('+08:00')
    expect(formatUtcOffset('Asia/Kolkata', 0)).toBe('+05:30')
    expect(formatUtcOffset('America/New_York', Date.UTC(2026, 0, 15))).toBe('-05:00')
    expect(formatUtcOffset('America/New_York', Date.UTC(2026, 6, 15))).toBe('-04:00')
  })

  it('puts the device and common zones first, then the rest alphabetically, with no repeats', () => {
    const choices = timeZoneChoices({ at: Date.UTC(2026, 0, 15), local: 'Europe/Paris', extra: ['Asia/Calcutta', 'Not/AZone'] })
    expect(choices.slice(0, 3).map(choice => choice.id)).toEqual(['UTC', 'Europe/Paris', 'America/New_York'])
    const ids = choices.map(choice => choice.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('Asia/Calcutta')
    expect(ids).not.toContain('Not/AZone')
    const rest = choices.filter(choice => choice.group === 'all').map(choice => choice.id)
    expect(rest).toEqual([...rest].sort())
    expect(choices.find(choice => choice.id === 'America/New_York')?.offset).toBe('-05:00')
  })
})
