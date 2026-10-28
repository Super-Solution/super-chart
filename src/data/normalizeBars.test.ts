import { describe, expect, it } from 'vitest'

import { decideUnit, hasIssues, normalizeBar, normalizeBars, olderThan } from './normalizeBars'

const T0 = 1_790_000_000_000
const H = 3_600_000
const bar = (i: number, extra: Record<string, unknown> = {}): any => ({ timestamp: T0 + i * H, open: 10 + i, high: 12 + i, low: 9 + i, close: 11 + i, volume: 100 + i, ...extra })
const ts = (list: Array<{ timestamp: number }>): number[] => list.map(b => (b.timestamp - T0) / H)

describe('normalizeBars', () => {
  it('fast path: well-formed input comes back as the same array, unchanged', () => {
    const input = [bar(0), bar(1), bar(2)]
    const out = normalizeBars(input)
    expect(out.bars).toBe(input)
    expect(out.unit).toBe(1)
    expect(hasIssues(out.issues)).toBe(false)
  })

  it('bars without volume (missing or null) pass through unchanged, on the fast path', () => {
    const input = [bar(0, { volume: undefined }), bar(1, { volume: null }), bar(2)]
    delete input[0].volume
    const out = normalizeBars(input)
    expect(out.bars).toBe(input)
    expect('volume' in out.bars[0]).toBe(false)
    expect(out.bars[1].volume).toBeNull()
  })

  it('descending input is sorted ascending', () => {
    const out = normalizeBars([bar(2), bar(1), bar(0)])
    expect(ts(out.bars)).toEqual([0, 1, 2])
    expect(out.issues.unsorted).toBe(true)
  })

  it('duplicate timestamps: the last one wins, including after a sort', () => {
    const out = normalizeBars([bar(0), bar(1, { close: 1 }), bar(1, { close: 2 }), bar(2)])
    expect(ts(out.bars)).toEqual([0, 1, 2])
    expect(out.bars[1].close).toBe(2)
    expect(out.issues.duplicates).toBe(1)
    const shuffled = normalizeBars([bar(1, { close: 1 }), bar(0), bar(1, { close: 2 })])
    expect(shuffled.bars.map(b => b.close)).toEqual([11, 2])
  })

  it('seconds are converted to milliseconds for the whole batch', () => {
    const secs = [bar(0), bar(1)].map(b => ({ ...b, timestamp: b.timestamp / 1000 }))
    const out = normalizeBars(secs)
    expect(out.unit).toBe(1000)
    expect(out.issues.seconds).toBe(true)
    expect(out.bars.map(b => b.timestamp)).toEqual([T0, T0 + H])
  })

  it('a seconds history followed by a seconds tick: the tick is scaled with the unit the history decided', () => {
    const history = normalizeBars([bar(0), bar(1)].map(b => ({ ...b, timestamp: b.timestamp / 1000 })))
    const tick = normalizeBars([{ ...bar(2), timestamp: (T0 + 2 * H) / 1000 }], history.unit)
    expect(tick.bars[0].timestamp).toBe(T0 + 2 * H)
    // Deciding again from the tick alone would agree here; an explicit ms unit must not rescale.
    expect(normalizeBars([bar(3)], 1).bars[0].timestamp).toBe(T0 + 3 * H)
  })

  it('NaN in high, low or close drops that bar only', () => {
    const out = normalizeBars([bar(0), bar(1, { high: NaN }), bar(2, { low: NaN }), bar(3, { close: NaN }), bar(4)])
    expect(ts(out.bars)).toEqual([0, 4])
    expect(out.issues.dropped).toBe(3)
  })

  it('numeric strings (as Binance sends) are converted; empty strings and null are not numbers', () => {
    const out = normalizeBars([
      { timestamp: String(T0), open: '1.5', high: '2', low: '1', close: '1.75', volume: '10' },
      { timestamp: T0 + H, open: '', high: 2, low: 1, close: 1 },
      { timestamp: T0 + 2 * H, open: null, high: 2, low: 1, close: 1 }
    ])
    expect(out.bars).toEqual([{ timestamp: T0, open: 1.5, high: 2, low: 1, close: 1.75, volume: 10 }])
    expect(out.issues.coerced).toBe(true)
    expect(out.issues.dropped).toBe(2)
  })

  it('a non-finite volume becomes undefined; the bar stays', () => {
    const out = normalizeBars([bar(0, { volume: NaN }), bar(1, { volume: 'x' })])
    expect(out.bars.length).toBe(2)
    expect(out.bars[0].volume).toBeUndefined()
    expect(out.bars[1].volume).toBeUndefined()
  })

  it('extra fields are kept', () => {
    const out = normalizeBars([bar(1), bar(0, { note: 'x' })])
    expect((out.bars[0] as any).note).toBe('x')
  })

  it('a fully invalid page normalizes to [] (so the caller ends paging instead of looping)', () => {
    const out = normalizeBars([{ timestamp: 'x' }, null, 3, { open: 1 }])
    expect(out.bars).toEqual([])
    expect(out.issues.dropped).toBe(4)
  })

  it('not an array: [] and flagged', () => {
    for (const bad of [undefined, null, {}, 'bars']) {
      const out = normalizeBars(bad)
      expect(out.bars).toEqual([])
      expect(out.issues.notArray).toBe(true)
    }
  })

  it('an empty list is clean', () => {
    const input: unknown[] = []
    expect(normalizeBars(input).bars).toBe(input)
  })
})

describe('decideUnit / normalizeBar / olderThan', () => {
  it('decideUnit reads the largest timestamp', () => {
    expect(decideUnit([bar(0)])).toBe(1)
    expect(decideUnit([{ timestamp: 1_700_000_000 }])).toBe(1000)
    expect(decideUnit([])).toBeUndefined()
    expect(decideUnit('x')).toBeUndefined()
  })

  it('normalizeBar returns null for a bar it cannot draw', () => {
    expect(normalizeBar({ timestamp: T0, open: 1, high: 1, low: 1 }, 1)).toBeNull()
    expect(normalizeBar({ ...bar(0), timestamp: 1_790_000_000 }, 1000)?.timestamp).toBe(T0)
  })

  it('olderThan keeps only bars strictly before the first loaded bar', () => {
    const page = [bar(0), bar(1), bar(2), bar(3)]
    expect(ts(olderThan(page, T0 + 2 * H))).toEqual([0, 1])
    expect(olderThan(page, T0)).toEqual([])
    expect(ts(olderThan(page, undefined))).toEqual([0, 1, 2, 3])
  })
})
