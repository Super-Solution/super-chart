import { describe, expect, it } from 'vitest'
import { levelsFor, levelSegments, drawLevels, INDICATOR_LEVELS } from './levels'

describe('levelsFor', () => {
  it('RSI/Stoch/StochRSI/MFI use 70-30 or 80-20; %B uses 0-1; anything else has none', () => {
    expect(levelsFor('SC_RSI').map(l => l.value)).toEqual([70, 30])
    expect(levelsFor('SC_STOCH').map(l => l.value)).toEqual([80, 20])
    expect(levelsFor('SC_STOCHRSI').map(l => l.value)).toEqual([80, 20])
    expect(levelsFor('SC_MFI').map(l => l.value)).toEqual([80, 20])
    expect(levelsFor('SC_BBP').map(l => l.value)).toEqual([1, 0])
    expect(levelsFor('SC_ATR')).toEqual([])
    expect(levelsFor('unknown')).toEqual([])
  })
})

describe('levelSegments', () => {
  it('maps each level to a horizontal segment at its pixel y, spanning [x0, x1]', () => {
    const segs = levelSegments(INDICATOR_LEVELS.SC_RSI, v => 100 - v, 0, 200)
    expect(segs).toEqual([
      { value: 70, label: '70', y: 30, x0: 0, x1: 200 },
      { value: 30, label: '30', y: 70, x0: 0, x1: 200 }
    ])
  })
})

describe('drawLevels', () => {
  it('strokes one horizontal line per level and returns false (draw the series on top)', () => {
    const calls: Array<{ op: string, args: unknown[] }> = []
    const ctx = {
      save () { calls.push({ op: 'save', args: [] }) },
      restore () { calls.push({ op: 'restore', args: [] }) },
      beginPath () { calls.push({ op: 'beginPath', args: [] }) },
      moveTo (...a: unknown[]) { calls.push({ op: 'moveTo', args: a }) },
      lineTo (...a: unknown[]) { calls.push({ op: 'lineTo', args: a }) },
      stroke () { calls.push({ op: 'stroke', args: [] }) },
      strokeStyle: '',
      lineWidth: 0,
      setLineDash (...a: unknown[]) { calls.push({ op: 'setLineDash', args: a }) }
    } as unknown as CanvasRenderingContext2D
    const result = drawLevels({ ctx, bounding: { width: 300 }, yAxis: { convertToPixel: v => 300 - v * 3 } }, INDICATOR_LEVELS.SC_RSI, '#000')
    expect(result).toBe(false)
    const strokes = calls.filter(c => c.op === 'stroke')
    expect(strokes.length).toBe(2)
    const moves = calls.filter(c => c.op === 'moveTo')
    expect(moves[0].args).toEqual([0, 300 - 70 * 3])
    expect(moves[1].args).toEqual([0, 300 - 30 * 3])
  })

  it('does nothing for a template with no levels', () => {
    let touched = false
    const ctx = { save () { touched = true } } as unknown as CanvasRenderingContext2D
    const result = drawLevels({ ctx, bounding: { width: 100 }, yAxis: { convertToPixel: v => v } }, [], '#000')
    expect(result).toBe(false)
    expect(touched).toBe(false)
  })
})
