import { describe, expect, it } from 'vitest'
import { formatDateQuery, parseDateQuery } from './goToDate'

describe('parseDateQuery', () => {
  it('reads wall-clock time in the given zone', () => {
    expect(parseDateQuery('2026-03-01', 'UTC')).toBe(Date.UTC(2026, 2, 1))
    expect(parseDateQuery('2026/3/1 14:30', 'Asia/Taipei')).toBe(Date.UTC(2026, 2, 1, 6, 30))
    expect(parseDateQuery('2026-07-01T09:00', 'America/New_York')).toBe(Date.UTC(2026, 6, 1, 13, 0))
  })
  it('refuses impossible or unrelated text', () => {
    for (const text of ['2026-02-30', '2026-13-01', '2026-03-01 24:00', 'btc', '', '2026']) expect(parseDateQuery(text)).toBeNull()
  })
  it('round-trips through formatDateQuery', () => {
    const at = Date.UTC(2026, 10, 27, 22, 19)
    expect(parseDateQuery(formatDateQuery(at, 'Asia/Taipei'), 'Asia/Taipei')).toBe(at)
  })
})
