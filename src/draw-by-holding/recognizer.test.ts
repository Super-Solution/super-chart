import { describe, expect, it } from 'vitest'
import { recognizeStroke, type Point } from './recognizer'

function stroke(vertices: readonly Point[], noise = 0): Point[] {
  const points: Point[] = []
  for (let i = 1; i < vertices.length; i++) {
    const a = vertices[i - 1], b = vertices[i]
    const count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 4))
    for (let j = 0; j < count; j++) {
      const t = j / count, n = Math.sin(points.length * 1.7) * noise
      points.push({ x: a.x + (b.x - a.x) * t + n, y: a.y + (b.y - a.y) * t - n })
    }
  }
  const last = vertices[vertices.length - 1]
  if (last !== undefined) points.push({ ...last })
  return points
}

function ellipse(rx: number, ry: number, noise = 0): Point[] {
  return Array.from({ length: 97 }, (_, i) => {
    const angle = i * Math.PI * 2 / 96, n = Math.sin(i * 2.3) * noise
    return { x: 180 + (rx + n) * Math.cos(angle), y: 140 + (ry + n) * Math.sin(angle) }
  })
}

describe('recognizeStroke', () => {
  it('fits a noisy diagonal and retains distinct ray, arrow, fib and path alternatives', () => {
    const result = recognizeStroke(stroke([{ x: 20, y: 180 }, { x: 180, y: 60 }], 0.8))
    expect(result.candidates.map(c => c.kind)).toEqual(['trend', 'ray', 'arrow', 'fibonacci', 'path'])
    expect(result.candidates.map(c => c.tool)).toEqual(['segment', 'rayLine', 'arrow', 'fibonacciLine', 'brush'])
    expect(result.candidates[0].points).toEqual([{ x: 20, y: 180 }, { x: 180, y: 60 }])
    expect(result.scribble).toBe(false)
  })

  it('snaps a near-horizontal stroke to a single averaged price anchor', () => {
    const result = recognizeStroke(stroke([{ x: 30, y: 90 }, { x: 210, y: 97 }], 0.5))
    expect(result.candidates[0]).toMatchObject({ kind: 'horizontal', tool: 'horizontalStraightLine' })
    expect(result.candidates[0].points).toHaveLength(1)
    expect(result.candidates[0].points[0].y).toBeCloseTo(93.5, 0)
  })

  it('snaps a near-vertical stroke to a single averaged time anchor', () => {
    const result = recognizeStroke(stroke([{ x: 100, y: 200 }, { x: 105, y: 30 }], 0.5))
    expect(result.candidates[0]).toMatchObject({ kind: 'vertical', tool: 'verticalStraightLine' })
    expect(result.candidates[0].points).toHaveLength(1)
    expect(result.candidates[0].points[0].x).toBeCloseTo(102.5, 0)
  })

  it('recognizes a noisy closed rectangle using its corners, rather than an ellipse', () => {
    const result = recognizeStroke(stroke([
      { x: 20, y: 30 }, { x: 180, y: 30 }, { x: 180, y: 130 },
      { x: 20, y: 130 }, { x: 21, y: 31 }
    ], 1))
    expect(result.candidates[0]).toMatchObject({ kind: 'rectangle', tool: 'rect' })
    expect(result.candidates[0].points).toHaveLength(2)
    expect(Math.abs(result.candidates[0].points[0].x - 20)).toBeLessThan(2)
    expect(Math.abs(result.candidates[0].points[1].y - 130)).toBeLessThan(2)
    expect(result.scribble).toBe(false)
  })

  it.each([[90, 50], [55, 55], [110, 24]])('recognizes a noisy ellipse with radii %s/%s', (rx, ry) => {
    const result = recognizeStroke(ellipse(rx, ry, 1.2))
    expect(result.candidates[0]).toMatchObject({ kind: 'ellipse', tool: 'ellipse' })
    expect(result.candidates.some(c => c.kind === 'rectangle')).toBe(false)
    expect(result.scribble).toBe(false)
  })

  it('does not close an open arc into a filled shape', () => {
    const result = recognizeStroke(ellipse(70, 45).slice(0, 65))
    expect(result.candidates[0].kind).toBe('path')
    expect(result.candidates.some(c => c.kind === 'ellipse' || c.kind === 'rectangle')).toBe(false)
  })

  it('recognizes an arrow shaft with two head wings and uses the tip as its endpoint', () => {
    const result = recognizeStroke(stroke([
      { x: 30, y: 150 }, { x: 170, y: 50 }, { x: 143, y: 51 },
      { x: 170, y: 50 }, { x: 164, y: 77 }
    ], 0.4))
    expect(result.candidates[0]).toMatchObject({ kind: 'arrow', tool: 'arrow' })
    expect(result.candidates[0].points[1].x).toBeCloseTo(170, 0)
    expect(result.candidates[0].points[1].y).toBeCloseTo(50, 0)
    expect(result.scribble).toBe(false)
  })

  it('recognizes the canonical shaft with a single short backward hook', () => {
    const hooked = recognizeStroke(stroke([{ x: 30, y: 90 }, { x: 170, y: 90 }, { x: 140, y: 65 }]))
    expect(hooked.candidates[0]).toMatchObject({ kind: 'arrow', tool: 'arrow', points: [{ x: 30, y: 90 }, { x: 170, y: 90 }] })
    expect(hooked.candidates.some(c => c.kind === 'path')).toBe(true)
    expect(hooked.scribble).toBe(false)
  })

  it('keeps a perpendicular corner or retraced shaft as a path', () => {
    for (const tail of [{ x: 170, y: 65 }, { x: 140, y: 90 }, { x: 90, y: 40 }]) {
      const result = recognizeStroke(stroke([{ x: 30, y: 90 }, { x: 170, y: 90 }, tail]))
      expect(result.candidates[0].kind).toBe('path')
      expect(result.candidates.some(c => c.kind === 'arrow')).toBe(false)
    }
  })

  it('recognizes the canonical three sides from swing to swing as Fibonacci', () => {
    const vertices = [{ x: 30, y: 140 }, { x: 30, y: 30 }, { x: 170, y: 30 }, { x: 170, y: 140 }]
    const result = recognizeStroke(stroke(vertices))
    expect(result.candidates[0]).toMatchObject({ kind: 'fibonacci', tool: 'fibonacciLine', points: [{ x: 30, y: 140 }, { x: 170, y: 30 }] })
    expect(result.candidates.map(c => c.kind)).toEqual(['fibonacci', 'trend', 'path'])
    expect(result.scribble).toBe(false)
  })

  it('orients noisy three-sided Fibonacci bounds from the first swing direction', () => {
    const result = recognizeStroke(stroke([{ x: 180, y: 30 }, { x: 180, y: 145 }, { x: 30, y: 145 }, { x: 30, y: 30 }], 0.5))
    const candidate = result.candidates[0]
    expect(candidate.kind).toBe('fibonacci')
    expect(candidate.points[0].x).toBeGreaterThan(candidate.points[1].x)
    expect(candidate.points[0].y).toBeLessThan(candidate.points[1].y)
    expect(Math.abs(candidate.points[0].y - candidate.points[1].y)).toBeGreaterThan(110)
  })

  it('recognizes a rising retracement zigzag without treating it as deletion', () => {
    const vertices = [
      { x: 20, y: 180 }, { x: 50, y: 120 }, { x: 75, y: 150 },
      { x: 110, y: 85 }, { x: 135, y: 110 }, { x: 180, y: 30 }
    ]
    const result = recognizeStroke(stroke(vertices, 0.4))
    expect(result.candidates[0]).toMatchObject({ kind: 'fibonacci', tool: 'fibonacciLine', points: [vertices[0], vertices[5]] })
    expect(result.candidates.some(c => c.kind === 'trend')).toBe(true)
    expect(result.scribble).toBe(false)
  })

  it('recognizes a descending staircase as Fibonacci', () => {
    const result = recognizeStroke(stroke([
      { x: 20, y: 30 }, { x: 65, y: 30 }, { x: 65, y: 70 },
      { x: 105, y: 70 }, { x: 105, y: 115 }, { x: 155, y: 115 }, { x: 155, y: 160 }
    ], 0.5))
    expect(result.candidates[0].kind).toBe('fibonacci')
    expect(result.scribble).toBe(false)
  })

  it('preserves a curved open path and its endpoints in a simplified brush fallback', () => {
    const input = Array.from({ length: 301 }, (_, i) => ({ x: i, y: 70 + Math.sin(i / 60) * 45 }))
    const result = recognizeStroke(input)
    expect(result.candidates[0]).toMatchObject({ kind: 'path', tool: 'brush' })
    const path = result.candidates[0].points
    expect(path.length).toBeLessThan(40)
    expect(path[0]).toEqual(input[0])
    expect(path[path.length - 1]).toEqual(input[input.length - 1])
    expect(result.scribble).toBe(false)
  })

  it('flags many compact back-and-forth scratch passes', () => {
    const input = stroke(Array.from({ length: 11 }, (_, i) => ({ x: i % 2 === 0 ? 30 : 150, y: 40 + i * 3 })))
    expect(recognizeStroke(input).scribble).toBe(true)
  })

  it('flags a dense crossing scratch gesture', () => {
    const result = recognizeStroke(stroke([
      { x: 20, y: 20 }, { x: 140, y: 110 }, { x: 20, y: 110 }, { x: 140, y: 20 },
      { x: 20, y: 55 }, { x: 140, y: 80 }, { x: 20, y: 80 }, { x: 140, y: 55 },
      { x: 20, y: 35 }, { x: 140, y: 100 }, { x: 40, y: 45 }
    ]))
    expect(result.scribble).toBe(true)
  })

  it('keeps a single crossing, a normal zigzag and a star out of the delete gesture', () => {
    const bow = stroke([{ x: 20, y: 20 }, { x: 120, y: 120 }, { x: 20, y: 120 }, { x: 120, y: 20 }])
    const wave = stroke(Array.from({ length: 11 }, (_, i) => ({ x: i * 30, y: i % 2 === 0 ? 40 : 100 })))
    const starVertices = Array.from({ length: 6 }, (_, i) => {
      const angle = (i * 4 / 5 - 0.5) * Math.PI
      return { x: 100 + 70 * Math.cos(angle), y: 100 + 70 * Math.sin(angle) }
    })
    for (const input of [bow, wave, stroke(starVertices)]) expect(recognizeStroke(input).scribble).toBe(false)
  })

  it('returns no drawing for empty, stationary or tiny pointer movements', () => {
    for (const input of [[], [{ x: 1, y: 2 }], Array(20).fill({ x: 1, y: 2 }), stroke([{ x: 1, y: 2 }, { x: 5, y: 4 }])]) {
      expect(recognizeStroke(input)).toEqual({ candidates: [], scribble: false })
    }
  })

  it('discards non-finite and implausible coordinates and never deletes from a malformed stroke', () => {
    expect(recognizeStroke([{ x: NaN, y: 5 }, { x: 3, y: Infinity }, { x: 1e100, y: 0 }])).toEqual({ candidates: [], scribble: false })
    const input = stroke(Array.from({ length: 11 }, (_, i) => ({ x: i % 2 === 0 ? 30 : 150, y: 40 + i * 3 })))
    input.splice(5, 0, { x: NaN, y: 0 })
    const result = recognizeStroke(input)
    expect(result.scribble).toBe(false)
    expect(result.candidates.flatMap(c => c.points).every(p => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)
  })

  it('bounds dense paths, keeps endpoints, is deterministic, and does not mutate input', () => {
    const input = Array.from({ length: 20000 }, (_, i) => Object.freeze({ x: i / 20, y: 100 + 35 * Math.sin(i / 12) }))
    Object.freeze(input)
    const first = recognizeStroke(input), second = recognizeStroke(input)
    expect(first).toEqual(second)
    const path = first.candidates.find(c => c.kind === 'path')
    expect(path).toBeDefined()
    expect(path?.points.length).toBeLessThanOrEqual(128)
    expect(path?.points[0]).toEqual(input[0])
    expect(path?.points[path.points.length - 1]).toEqual(input[input.length - 1])
    expect(first.scribble).toBe(false)
  })
})
