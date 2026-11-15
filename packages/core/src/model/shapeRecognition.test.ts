import { describe, expect, it } from 'vitest'
import { recognizeStroke, type ShapeCandidate } from './shapeRecognition'

type P = { x: number, y: number }
// Deterministic hand tremor so no test depends on a random number generator.
const wobble = (i: number, amount: number): number => Math.sin(i * 12.9898) * amount
function line (a: P, b: P, count = 40, amount = 0): P[] {
  return Array.from({ length: count }, (_, i) => { const t = i / (count - 1); return { x: a.x + (b.x - a.x) * t + wobble(i, amount), y: a.y + (b.y - a.y) * t + wobble(i + 7, amount) } })
}
function polygon (corners: P[], amount = 0, closeGap = 0): P[] {
  const out: P[] = []
  corners.forEach((corner, index) => {
    const next = corners[(index + 1) % corners.length]
    out.push(...line(corner, index === corners.length - 1 ? { x: next.x + closeGap, y: next.y + closeGap } : next, 24, amount).slice(0, -1))
  })
  out.push({ x: corners[0].x + closeGap, y: corners[0].y + closeGap })
  return out
}
function ellipse (cx: number, cy: number, rx: number, ry: number, amount = 0): P[] {
  return Array.from({ length: 80 }, (_, i) => { const a = i / 79 * Math.PI * 2 + 0.6; return { x: cx + Math.cos(a) * rx + wobble(i, amount), y: cy + Math.sin(a) * ry + wobble(i + 3, amount) } })
}
const best = (points: P[]): ShapeCandidate => {
  const result = recognizeStroke(points)
  if (result.kind !== 'shape') throw new Error(`expected a shape, got ${JSON.stringify(result.kind === 'none' ? result.reason : result.kind)}`)
  return result.candidates[0]
}

describe('recognizeStroke', () => {
  it('reads a slanted stroke as a trend line through its own end points', () => {
    const stroke = line({ x: 10, y: 200 }, { x: 260, y: 90 }, 40, 1.2)
    const shape = best(stroke)
    expect(shape.type).toBe('trend-line')
    expect(shape.points).toHaveLength(2)
    expect(shape.points[0]).toEqual(stroke[0])
    expect(shape.points[1]).toEqual(stroke[stroke.length - 1])
  })

  it('snaps a nearly flat or upright stroke onto its axis and keeps the first point', () => {
    const flat = best(line({ x: 20, y: 100 }, { x: 300, y: 104 }, 40, 0.6))
    expect(flat.type).toBe('horizontal-segment')
    expect(flat.points[1].y).toBe(flat.points[0].y)
    const upright = best(line({ x: 120, y: 30 }, { x: 124, y: 220 }, 40, 0.6))
    expect(upright.type).toBe('vertical-segment')
    expect(upright.points[1].x).toBe(upright.points[0].x)
  })

  it('offers the other line types as alternatives, best first', () => {
    const result = recognizeStroke(line({ x: 10, y: 200 }, { x: 260, y: 90 }))
    if (result.kind !== 'shape') throw new Error('expected a shape')
    expect(result.candidates.map(item => item.type)).toEqual(['trend-line', 'segment', 'ray', 'arrow'])
    for (let i = 1; i < result.candidates.length; i++) expect(result.candidates[i].score).toBeLessThanOrEqual(result.candidates[i - 1].score)
  })

  it('reads a closed four-sided stroke as a rectangle from corner to corner', () => {
    const shape = best(polygon([{ x: 40, y: 50 }, { x: 240, y: 50 }, { x: 240, y: 160 }, { x: 40, y: 160 }], 1.5, 4))
    expect(shape.type).toBe('rectangle')
    expect(shape.points[0].x).toBeCloseTo(40, -1)
    expect(shape.points[1].y).toBeCloseTo(160, -1)
  })

  it('reads a closed round stroke as an ellipse, and offers a circle when it is round', () => {
    const wide = best(ellipse(150, 100, 110, 50, 1))
    expect(wide.type).toBe('ellipse')
    const round = recognizeStroke(ellipse(150, 100, 70, 68, 1))
    if (round.kind !== 'shape') throw new Error('expected a shape')
    expect(round.candidates.slice(0, 2).map(item => item.type)).toEqual(['circle', 'ellipse'])
    const circle = round.candidates.find(item => item.type === 'circle')!
    expect(circle.points[0].x).toBeCloseTo(150, -1)
    expect(Math.abs(circle.points[1].x - circle.points[0].x)).toBeGreaterThan(55)
  })

  it('reads a closed stroke with three corners as a triangle', () => {
    const shape = best(polygon([{ x: 150, y: 40 }, { x: 260, y: 200 }, { x: 40, y: 200 }], 1.2, 3))
    expect(shape.type).toBe('triangle')
    expect(shape.points).toHaveLength(3)
  })

  it('recognizes a scrub as a scribble with the area it covers', () => {
    const scrub: P[] = []
    for (let pass = 0; pass < 6; pass++) scrub.push(...line({ x: pass % 2 === 0 ? 40 : 160, y: 80 + pass * 6 }, { x: pass % 2 === 0 ? 160 : 40, y: 84 + pass * 6 }, 12))
    const result = recognizeStroke(scrub)
    expect(result.kind).toBe('scribble')
    if (result.kind === 'scribble') {
      expect(result.bounds.left).toBeLessThanOrEqual(41)
      expect(result.bounds.right).toBeGreaterThanOrEqual(159)
    }
  })

  it('does not guess: taps, open curves and half-drawn boxes are not shapes', () => {
    expect(recognizeStroke([{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 6, y: 6 }])).toEqual({ kind: 'none', reason: 'too-short' })
    expect(recognizeStroke([])).toEqual({ kind: 'none', reason: 'too-short' })
    const arc = Array.from({ length: 50 }, (_, i) => ({ x: 100 + Math.cos(i / 49 * Math.PI * 1.1) * 80, y: 100 + Math.sin(i / 49 * Math.PI * 1.1) * 40 }))
    expect(recognizeStroke(arc).kind).toBe('none')
    const halfBox = recognizeStroke(line({ x: 40, y: 50 }, { x: 240, y: 50 }, 20).concat(line({ x: 240, y: 50 }, { x: 240, y: 160 }, 20)))
    expect(halfBox.kind === 'shape' ? halfBox.candidates.some(item => item.type === 'rectangle') : false).toBe(false)
  })

  it('ignores non-finite points and is stable for huge input', () => {
    const noisy: P[] = [{ x: NaN, y: 3 }, ...line({ x: 10, y: 10 }, { x: 300, y: 120 }, 5000), { x: Infinity, y: 4 }]
    const shape = best(noisy)
    expect(shape.type).toBe('trend-line')
    expect(Number.isFinite(shape.score)).toBe(true)
  })
})
