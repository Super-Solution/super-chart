// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import type { MarkGroup } from '@supersolutions/super-chart-core'
import { groupLabel, markSpecs } from './datafeedMarks'

const group = (index: number, marks: Array<{ id: string, label: string, tone?: 'bull' | 'bear', color?: string }>): MarkGroup => ({ index, time: 1_000 * (index + 1), marks: marks.map(m => ({ ...m, time: 1_000 * (index + 1) })) })

describe('markSpecs', () => {
  const bars = [{ high: 10 }, { high: 12 }, { high: Number.NaN }]
  it('draws one annotation marker per bar, on the bar high, keyed by the bar time', () => {
    const specs = markSpecs([group(0, [{ id: 'a', label: 'E', tone: 'bull' }]), group(1, [{ id: 'b', label: 'D' }, { id: 'c', label: 'S' }])], bars)
    expect(specs).toEqual([
      { key: 'mark:1000', kind: 'marker', anchors: [{ time: 1000, price: 10 }], text: 'E', tone: 'bull' },
      { key: 'mark:2000', kind: 'marker', anchors: [{ time: 2000, price: 12 }], text: 'D · S', tone: 'neutral' }
    ])
  })
  it('shows marks that disagree on tone as neutral, and keeps a colour they all share', () => {
    const [mixed] = markSpecs([group(0, [{ id: 'a', label: 'E', tone: 'bull' }, { id: 'b', label: 'N', tone: 'bear' }])], bars)
    expect(mixed.tone).toBe('neutral')
    const [shared] = markSpecs([group(0, [{ id: 'a', label: 'E', color: '#f80' }, { id: 'b', label: 'N', color: '#f80' }])], bars)
    expect(shared.color).toBe('#f80')
    const [split] = markSpecs([group(0, [{ id: 'a', label: 'E', color: '#f80' }, { id: 'b', label: 'N' }])], bars)
    expect(split.color).toBeUndefined()
  })
  it('skips a bar with no finite high rather than inventing a price', () => {
    expect(markSpecs([group(2, [{ id: 'a', label: 'E' }]), group(7, [{ id: 'b', label: 'E' }])], bars)).toEqual([])
  })
})

describe('groupLabel', () => {
  it('names up to three marks and counts the rest', () => {
    const marks = ['A', 'B', 'C', 'D', 'E'].map(label => ({ id: label, label }))
    expect(groupLabel(group(0, marks.slice(0, 3)))).toBe('A · B · C')
    expect(groupLabel(group(0, marks))).toBe('A · B · C +2')
  })
})
