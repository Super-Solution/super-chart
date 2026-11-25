// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { MARK_LIMITS, marksWindow, placeMarks, validateMarks } from './marks'

const range = { from: 1_000, to: 9_000 }
const mark = (id: string, time: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ id, time, label: 'E', ...extra })

describe('validateMarks', () => {
  it('keeps a good mark and copies only the fields it knows', () => {
    const { marks, rejected } = validateMarks([mark('a', 2_000, { text: 'Q3 beat', tone: 'bull', category: 'earnings', extra: 'dropped' })], range)
    expect(rejected).toEqual([])
    expect(marks).toEqual([{ id: 'a', time: 2_000, label: 'E', text: 'Q3 beat', tone: 'bull', category: 'earnings' }])
    expect(Object.isFrozen(marks[0])).toBe(true)
  })
  it('reports each bad mark by a stable code and keeps the rest', () => {
    const { marks, rejected } = validateMarks([
      mark('ok', 2_000), null, 'x', mark('', 2_000), mark('t', Number.NaN), mark('l', 2_000, { label: '' }), mark('l2', 2_000, { label: 'x'.repeat(25) }),
      mark('x', 2_000, { text: 5 }), mark('tone', 2_000, { tone: 'red' }), mark('c', 2_000, { color: '  ' }), mark('cat', 2_000, { category: 3 }),
      mark('ok', 3_000), mark('early', 999), mark('late', 9_000), mark('nl', 2_000, { label: 'a\nb' })
    ], range)
    expect(marks.map(m => m.id)).toEqual(['ok'])
    expect(rejected.map(r => r.code)).toEqual(['bad_mark', 'bad_mark', 'bad_id', 'bad_time', 'bad_label', 'bad_label', 'bad_text', 'bad_tone', 'bad_color', 'bad_category', 'duplicate_id', 'out_of_range', 'out_of_range', 'bad_label'])
  })
  it('treats the range as from-inclusive and to-exclusive', () => {
    const { marks, rejected } = validateMarks([mark('a', 1_000), mark('b', 8_999), mark('c', 9_000)], range)
    expect(marks.map(m => m.id)).toEqual(['a', 'b'])
    expect(rejected).toEqual([{ id: 'c', code: 'out_of_range' }])
  })
  it('refuses a response that is not an array, once', () => {
    expect(validateMarks({ marks: [] }, range)).toEqual({ marks: [], rejected: [{ id: '', code: 'bad_response' }] })
    expect(validateMarks(undefined, range).rejected).toEqual([{ id: '', code: 'bad_response' }])
  })
  it('stops at 1000 marks in one answer', () => {
    const many = Array.from({ length: MARK_LIMITS.perAnswer + 5 }, (_, i) => mark(`m${i}`, 2_000))
    const { marks, rejected } = validateMarks(many, range)
    expect(marks).toHaveLength(MARK_LIMITS.perAnswer)
    expect(rejected.map(r => r.code)).toEqual(Array(5).fill('too_many'))
  })
  it('does not let a long id through to the annotation layer', () => {
    const { marks, rejected } = validateMarks([mark('x'.repeat(129), 2_000)], range)
    expect(marks).toEqual([])
    expect(rejected[0].code).toBe('bad_id')
    expect(rejected[0].id).toHaveLength(MARK_LIMITS.idLength)
  })
})

describe('placeMarks', () => {
  const times = [1_000, 2_000, 3_000, 4_000]
  const at = (id: string, time: number) => ({ id, time, label: id })
  it('puts a mark on the bar that contains it: the latest open at or before its time', () => {
    const { groups, rejected } = placeMarks([at('a', 2_000), at('b', 2_999), at('c', 3_000), at('d', 1_000)], times)
    expect(rejected).toEqual([])
    expect(groups.map(g => [g.index, g.time, g.marks.map(m => m.id)])).toEqual([[0, 1_000, ['d']], [1, 2_000, ['a', 'b']], [2, 3_000, ['c']]])
  })
  it('allows the newest bar one bar-length, and no more, past its open', () => {
    const { groups, rejected } = placeMarks([at('in', 4_999), at('out', 5_000), at('before', 999)], times)
    expect(groups.map(g => g.marks.map(m => m.id))).toEqual([['in']])
    expect(rejected).toEqual([{ id: 'out', code: 'no_bar' }, { id: 'before', code: 'no_bar' }])
  })
  it('keeps the first ten on a bar and reports the eleventh', () => {
    const crowd = Array.from({ length: 12 }, (_, i) => at(`m${i}`, 2_500))
    const { groups, rejected } = placeMarks(crowd, times)
    expect(groups[0].marks.map(m => m.id)).toEqual(crowd.slice(0, 10).map(m => m.id))
    expect(rejected).toEqual([{ id: 'm10', code: 'too_many_on_bar' }, { id: 'm11', code: 'too_many_on_bar' }])
  })
  it('places on a single bar chart and none on an empty one', () => {
    expect(placeMarks([at('a', 5_000)], [1_000]).groups).toHaveLength(1)
    expect(placeMarks([at('a', 5_000)], []).rejected).toEqual([{ id: 'a', code: 'no_bar' }])
  })
})

describe('marksWindow', () => {
  it('is the view and one view-width either side', () => {
    expect(marksWindow(1_000, 2_000)).toEqual({ from: 0, to: 3_000 })
  })
  it('is null for a view that is empty, reversed or not finite', () => {
    expect(marksWindow(1_000, 1_000)).toBeNull()
    expect(marksWindow(2_000, 1_000)).toBeNull()
    expect(marksWindow(Number.NaN, 1_000)).toBeNull()
  })
})
