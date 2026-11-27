import { describe, expect, it } from 'vitest'
import { compactNumber, legendRows, type LegendPalette } from './legend'
import type { EngineRenderFrame } from '@supersolutions/super-chart-core'

const palette: LegendPalette = { background: '#000', ink: '#fff', muted: '#888', up: '#0f0', down: '#f00', flat: '#999', font: '11px mono' }
const measure = (_font: string, text: string): number => text.length * 6
const bars = [
  { timestamp: 1, open: 10, high: 12, low: 9, close: 11, volume: 5 },
  { timestamp: 2, open: 11, high: 13, low: 10, close: 10.5, volume: 7 }
]
const frame = { snapshot: { bars }, previousClose: 9, model: { plottedSeries: [] } } as unknown as EngineRenderFrame
const text = (rows: ReturnType<typeof legendRows>): string[] => rows.map(row => row.map(span => span.text).join(' '))

describe('legend', () => {
  it('compacts volume to three significant figures', () => {
    expect(compactNumber(999)).toBe('999')
    expect(compactNumber(1234)).toBe('1.23K')
    expect(compactNumber(5_600_000)).toBe('5.6M')
    expect(compactNumber(2_340_000_000)).toBe('2.34B')
  })

  it('shows open, high, low, close and the change from the bar before', () => {
    const [row] = text(legendRows(frame, 1, { legendTitle: 'ALPHA · 1D' }, palette, 2, 900, measure))
    expect(row).toContain('ALPHA · 1D')
    expect(row).toContain('O 11.00 H 13.00 L 10.00 C 10.50')
    expect(row).toContain('−0.50 (−4.55%)')
  })

  it('measures the first bar against the close before the window', () => {
    const [row] = text(legendRows(frame, 0, {}, palette, 2, 900, measure))
    expect(row).toContain('+2.00 (+22.22%)')
  })

  it('colours by the bar direction, flat when open equals close', () => {
    const up = legendRows(frame, 0, {}, palette, 2, 900, measure)[0].find(span => span.text === '11.00')
    const down = legendRows(frame, 1, {}, palette, 2, 900, measure)[0].find(span => span.text === '10.50')
    expect(up?.color).toBe(palette.up)
    expect(down?.color).toBe(palette.down)
  })

  it('keeps only the close on a narrow chart and wraps the title onto its own row when it does not fit', () => {
    const narrow = text(legendRows(frame, 1, {}, palette, 2, 300, measure))
    expect(narrow[0]).toContain('C 10.50')
    expect(narrow[0]).not.toContain('H ')
    const wrapped = text(legendRows(frame, 1, { legendTitle: 'A long instrument name · 1D · EXCHANGE' }, palette, 2, 260, measure))
    expect(wrapped.length).toBe(2)
  })

  it('returns nothing for a position without a bar', () => {
    expect(legendRows(frame, 5, {}, palette, 2, 900, measure)).toEqual([])
  })
})
