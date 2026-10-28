import { describe, expect, it } from 'vitest'

import { canonicalTz, localTz, pickerKeyOf, resolveTz, timezoneHint } from './resolveTz'

describe('SC-033: resolveTz', () => {
  it("'local', undefined and '' all resolve to the viewer's own zone", () => {
    expect(resolveTz('local')).toBe(localTz())
    expect(resolveTz(undefined)).toBe(localTz())
    expect(resolveTz('')).toBe(localTz())
  })

  it('an id the picker lists comes back unchanged', () => {
    expect(resolveTz('Asia/Tokyo')).toBe('Asia/Tokyo')
    expect(resolveTz('Etc/UTC')).toBe('Etc/UTC')
  })

  it('aliases Intl canonicalises to a picker zone resolve to that zone\'s own key', () => {
    // Intl.DateTimeFormat resolves 'UTC' to 'UTC', which is not itself a
    // picker key, but the picker lists the same zone as 'Etc/UTC'.
    expect(resolveTz('UTC')).toBe('Etc/UTC')
    expect(resolveTz('utc')).toBe('Etc/UTC')
    expect(resolveTz('GMT')).toBe('Etc/UTC')
  })

  it('an id Intl accepts but the picker does not list resolves to its own canonical id', () => {
    expect(resolveTz('America/New_York')).toBe('America/New_York')
  })

  it('anything Intl rejects resolves to null', () => {
    expect(resolveTz('UTC+8')).toBeNull()
    expect(resolveTz('Mars/Olympus')).toBeNull()
    expect(resolveTz(42)).toBeNull()
    expect(resolveTz({})).toBeNull()
  })

  it('is case- and whitespace-insensitive for a valid id', () => {
    expect(resolveTz('  Asia/Tokyo  ')).toBe('Asia/Tokyo')
  })
})

describe('SC-033: canonicalTz', () => {
  it('a valid zone returns its canonical id', () => {
    expect(canonicalTz('UTC')).toBe('UTC')
    expect(canonicalTz('Asia/Tokyo')).toBe('Asia/Tokyo')
  })

  it('an invalid zone returns null, not a throw', () => {
    expect(canonicalTz('Not/AZone')).toBeNull()
  })

  it('caches: repeated calls for the same id are consistent', () => {
    expect(canonicalTz('Asia/Shanghai')).toBe(canonicalTz('Asia/Shanghai'))
  })
})

describe('SC-033: pickerKeyOf', () => {
  it('a picker zone returns itself', () => {
    expect(pickerKeyOf('Asia/Shanghai')).toBe('Asia/Shanghai')
  })

  it('a non-picker alias of a picker zone returns that zone\'s key', () => {
    expect(pickerKeyOf('UTC')).toBe('Etc/UTC')
  })

  it('a zone the picker does not list returns undefined', () => {
    expect(pickerKeyOf('America/New_York')).toBeUndefined()
  })
})

describe('SC-033: timezoneHint', () => {
  it('a fixed UTC offset suggests the Etc/GMT id with the sign inverted', () => {
    expect(timezoneHint('UTC+8')).toContain('Etc/GMT-8')
    expect(timezoneHint('UTC-5')).toContain('Etc/GMT+5')
  })

  it('anything else gives the generic hint', () => {
    expect(timezoneHint('Mars/Olympus')).toMatch(/IANA time zone id/)
  })
})
