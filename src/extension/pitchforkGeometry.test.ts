import { describe, expect, it } from 'vitest'

import { pitchforkDirection, pitchforkFigures, pitchforkOrigin, pitchforkProngs, type Pt } from './pitchforkGeometry'

const p0: Pt = { x: 0, y: 0 }
const p1: Pt = { x: 10, y: 20 }
const p2: Pt = { x: 30, y: -10 }
const mid: Pt = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }

/** Asserts non-null, then narrows — avoids `!` (this repo warns on it). */
function must<T> (v: T | null): T {
  expect(v).not.toBeNull()
  return v as T
}

describe('pitchforkOrigin (SC-177)', () => {
  it('pitchfork (Andrews): the handle itself', () => {
    expect(pitchforkOrigin('pitchfork', p0, p1, p2)).toEqual({ x: 0, y: 0 })
  })

  it('schiff: the handle\'s time, halfway in price toward the first prong', () => {
    expect(pitchforkOrigin('schiff', p0, p1, p2)).toEqual({ x: p0.x, y: (p0.y + p1.y) / 2 })
  })

  it('modifiedSchiff: the full midpoint of the handle and the first prong', () => {
    expect(pitchforkOrigin('modifiedSchiff', p0, p1, p2)).toEqual({ x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 })
  })

  it('schiff and modifiedSchiff differ from Andrews\' median whenever p0 != p1 (the bug this fixes)', () => {
    const andrews = pitchforkOrigin('pitchfork', p0, p1, p2)
    const schiff = pitchforkOrigin('schiff', p0, p1, p2)
    const modified = pitchforkOrigin('modifiedSchiff', p0, p1, p2)
    expect(schiff).not.toEqual(andrews)
    expect(modified).not.toEqual(andrews)
  })
})

describe('pitchforkDirection', () => {
  it('points from the origin to the p1/p2 midpoint', () => {
    expect(pitchforkDirection(p0, p1, p2)).toEqual({ x: mid.x - p0.x, y: mid.y - p0.y })
  })

  it('is null when the origin already is the p1/p2 midpoint (degenerate)', () => {
    expect(pitchforkDirection(mid, p1, p2)).toBeNull()
  })

  it('schiff\'s direction is not collinear with Andrews\' (the exact SC-177 regression)', () => {
    // Before the fix, schiff's origin was ((p0+mid)/2, (p0+mid)/2): dir =
    // (mid-p0)/2, exactly Andrews' own direction scaled — collinear (cross
    // product 0). The corrected origin breaks that collinearity whenever the
    // handle and the first prong have different y (a non-degenerate fork).
    const andrewsDir = must(pitchforkDirection(p0, p1, p2))
    const schiffOrigin = pitchforkOrigin('schiff', p0, p1, p2)
    const schiffDir = must(pitchforkDirection(schiffOrigin, p1, p2))
    const cross = andrewsDir.x * schiffDir.y - andrewsDir.y * schiffDir.x
    expect(Math.abs(cross)).toBeGreaterThan(1e-6)
  })
})

describe('pitchforkProngs', () => {
  it('returns 4 segments: the near p1-p2 segment, the median, and two parallel prongs', () => {
    const lines = must(pitchforkProngs('pitchfork', p0, p1, p2, 1000))
    expect(lines).toHaveLength(4)
    expect(lines[0]).toEqual([p1, p2])
    expect(lines[1][0]).toEqual(p0)
    expect(lines[2][0]).toEqual(p1)
    expect(lines[3][0]).toEqual(p2)
    // every extended line is parallel to the median (same direction, up to scale)
    const dir = must(pitchforkDirection(p0, p1, p2))
    const dirOf = (line: readonly [Pt, Pt]): Pt => ({ x: line[1].x - line[0].x, y: line[1].y - line[0].y })
    lines.slice(1).forEach(line => {
      const d = dirOf(line)
      expect(d.x * dir.y - d.y * dir.x).toBeCloseTo(0, 6)
    })
  })

  it('reaches roughly `reach` px from each start point', () => {
    const lines = must(pitchforkProngs('pitchfork', p0, p1, p2, 500))
    const [origin, ext] = lines[1]
    expect(Math.hypot(ext.x - origin.x, ext.y - origin.y)).toBeCloseTo(500, 3)
  })

  it('null when the origin degenerates onto the p1/p2 midpoint', () => {
    expect(pitchforkProngs('pitchfork', mid, p1, p2, 100)).toBeNull()
  })
})

describe('pitchforkFigures (the OverlayTemplate shape)', () => {
  it('draws nothing with fewer than 2 points', () => {
    expect(pitchforkFigures('pitchfork', [], 800, 600)).toEqual([])
    expect(pitchforkFigures('pitchfork', [p0], 800, 600)).toEqual([])
  })

  it('draws a plain line while the third prong is still being placed', () => {
    const figs = pitchforkFigures('pitchfork', [p0, p1], 800, 600)
    expect(figs).toEqual([{ type: 'line', attrs: { coordinates: [p0, p1] } }])
  })

  it('draws the multi-line figure plus a hit path once finished', () => {
    const figs = pitchforkFigures('pitchfork', [p0, p1, p2], 800, 600)
    expect(figs).toHaveLength(2)
    expect(figs[0].type).toBe('line')
    expect(Array.isArray(figs[0].attrs)).toBe(true)
    expect((figs[0].attrs as unknown[]).length).toBe(4)
  })

  it('schiff and pitchfork draw different figures for the same points (the regression this closes)', () => {
    const andrews = pitchforkFigures('pitchfork', [p0, p1, p2], 800, 600)
    const schiff = pitchforkFigures('schiff', [p0, p1, p2], 800, 600)
    expect(JSON.stringify(schiff[0].attrs)).not.toBe(JSON.stringify(andrews[0].attrs))
  })
})
