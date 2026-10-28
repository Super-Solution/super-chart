import { describe, it, expect } from 'vitest'

import {
  clampPosition, defaultToolbarPosition, boundsOfPoints, inflateRect, unionRect, overlapArea,
  rectsIntersect, distanceToSegment, isNearPolyline, isInRect, clipToRect, segmentHitsRect,
  popoverLeft, strokeHitTolerance, MIN_HIT_TOLERANCE
} from './geometry'
import { drawnLines } from './extent'

const BOUNDS = { x: 52, y: 0, width: 800, height: 500 }
const SIZE = { width: 300, height: 36 }

describe('clampPosition', () => {
  it('keeps the toolbar inside the chart', () => {
    expect(clampPosition({ x: -100, y: -100 }, SIZE, BOUNDS)).toEqual({ x: 52, y: 0 })
    expect(clampPosition({ x: 5000, y: 5000 }, SIZE, BOUNDS)).toEqual({ x: 52 + 800 - 300, y: 500 - 36 })
    expect(clampPosition({ x: 200.4, y: 100.6 }, SIZE, BOUNDS)).toEqual({ x: 200, y: 101 })
  })

  it('pins to the top-left when the toolbar is larger than the chart', () => {
    expect(clampPosition({ x: 400, y: 400 }, { width: 1000, height: 600 }, BOUNDS)).toEqual({ x: 52, y: 0 })
  })

  it('treats non-finite input as the top-left', () => {
    expect(clampPosition({ x: NaN, y: Infinity }, SIZE, BOUNDS)).toEqual({ x: 52, y: 0 })
  })
})

describe('defaultToolbarPosition', () => {
  it('goes to the top-centre when nothing is in the way', () => {
    expect(defaultToolbarPosition(BOUNDS, SIZE, null)).toEqual({ x: 52 + 250, y: 8 })
  })

  it('keeps the legend row free when asked', () => {
    expect(defaultToolbarPosition(BOUNDS, SIZE, null, { topInset: 28 })).toEqual({ x: 52 + 250, y: 36 })
    expect(defaultToolbarPosition(BOUNDS, SIZE, null, { margin: 0 })).toEqual({ x: 52 + 250, y: 0 })
  })

  it('moves away from a drawing under the top-centre spot', () => {
    const avoid = { x: 380, y: 0, width: 60, height: 60 } // under the centre, not the corners
    const pos = defaultToolbarPosition(BOUNDS, SIZE, avoid)
    expect(overlapArea({ ...pos, ...SIZE }, avoid)).toBe(0)
    expect(pos.y).toBe(8) // a top corner is still free
  })

  it('drops to the bottom when the whole top band is covered', () => {
    const avoid = { x: 0, y: 0, width: 900, height: 120 }
    const pos = defaultToolbarPosition(BOUNDS, SIZE, avoid)
    expect(pos.y).toBeGreaterThan(120)
    expect(pos.y + SIZE.height).toBeLessThanOrEqual(BOUNDS.y + BOUNDS.height)
  })

  it('picks the least-covering spot when every spot overlaps', () => {
    const avoid = { x: 0, y: 0, width: 900, height: 500 }
    const pos = defaultToolbarPosition(BOUNDS, SIZE, avoid)
    expect(clampPosition(pos, SIZE, BOUNDS)).toEqual(pos)
  })

  it('does not open over a horizontal line that runs across the top, though its click point is to the side', () => {
    // horizontalStraightLine placed at x=100, 50 px below the chart's top
    const pane = { x: 0, y: 0, width: 800, height: 500 }
    const clicked = inflateRect({ x: 100, y: 50, width: 0, height: 0 }, 32)
    const lines = drawnLines('horizontalStraightLine', [{ x: 100, y: 50 }], pane)
    // the points alone allow the top-centre spot (y 36..72), which sits on the line
    expect(defaultToolbarPosition(pane, SIZE, clicked, { topInset: 28 }).y).toBe(36)
    const pos = defaultToolbarPosition(pane, SIZE, clicked, { topInset: 28, avoidLines: lines })
    expect(pos.y).toBeGreaterThan(50 + 8)
    expect(lines.some(l => segmentHitsRect(l, inflateRect({ ...pos, ...SIZE }, 8)))).toBe(false)
  })

  it('treats a crossing line as covering the whole toolbar when every spot is crossed', () => {
    const pane = { x: 0, y: 0, width: 800, height: 500 }
    const lines = [
      ...drawnLines('horizontalStraightLine', [{ x: 1, y: 50 }], pane),
      ...drawnLines('horizontalStraightLine', [{ x: 1, y: 440 }], pane)
    ]
    const pos = defaultToolbarPosition(pane, SIZE, { x: 0, y: 0, width: 10, height: 10 }, { avoidLines: lines })
    expect(clampPosition(pos, SIZE, pane)).toEqual(pos)
  })
})

describe('clipToRect', () => {
  const R = { x: 0, y: 0, width: 100, height: 50 }

  it('clips a whole line, a ray and a segment', () => {
    expect(clipToRect({ x: 10, y: 10 }, { x: 11, y: 10 }, R, -Infinity, Infinity)).toEqual([{ x: 0, y: 10 }, { x: 100, y: 10 }])
    expect(clipToRect({ x: 10, y: 10 }, { x: 11, y: 10 }, R, 0, Infinity)).toEqual([{ x: 10, y: 10 }, { x: 100, y: 10 }])
    expect(clipToRect({ x: 10, y: 10 }, { x: 20, y: 20 }, R)).toEqual([{ x: 10, y: 10 }, { x: 20, y: 20 }])
    expect(clipToRect({ x: 0, y: 0 }, { x: 10, y: 10 }, R, -Infinity, Infinity)).toEqual([{ x: 0, y: 0 }, { x: 50, y: 50 }])
  })

  it('returns null when nothing of it is inside', () => {
    expect(clipToRect({ x: 10, y: 60 }, { x: 11, y: 60 }, R, -Infinity, Infinity)).toBeNull()
    // a ray pointing away from the rect
    expect(clipToRect({ x: 150, y: 10 }, { x: 160, y: 10 }, R, 0, Infinity)).toBeNull()
    // a line through one point has no direction
    expect(clipToRect({ x: 10, y: 10 }, { x: 10, y: 10 }, R, -Infinity, Infinity)).toBeNull()
  })

  it('tests a segment against a rect', () => {
    expect(segmentHitsRect([{ x: -10, y: 25 }, { x: 110, y: 25 }], R)).toBe(true)
    expect(segmentHitsRect([{ x: -10, y: -10 }, { x: -5, y: 60 }], R)).toBe(false)
  })
})

describe('drawnLines', () => {
  const PANE = { x: 0, y: 0, width: 800, height: 500 }

  it('runs horizontal and vertical lines across the pane, rays to its edge', () => {
    expect(drawnLines('horizontalStraightLine', [{ x: 100, y: 50 }], PANE)).toEqual([[{ x: 0, y: 50 }, { x: 800, y: 50 }]])
    expect(drawnLines('priceLine', [{ x: 100, y: 50 }], PANE)).toEqual([[{ x: 100, y: 50 }, { x: 800, y: 50 }]])
    expect(drawnLines('horizontalRayLine', [{ x: 100, y: 50 }, { x: 50, y: 50 }], PANE)).toEqual([[{ x: 100, y: 50 }, { x: 0, y: 50 }]])
    expect(drawnLines('verticalStraightLine', [{ x: 100, y: 50 }], PANE)).toEqual([[{ x: 100, y: 0 }, { x: 100, y: 500 }]])
    expect(drawnLines('verticalRayLine', [{ x: 100, y: 50 }, { x: 100, y: 10 }], PANE)).toEqual([[{ x: 100, y: 50 }, { x: 100, y: 0 }]])
  })

  it('extends straight lines and rays through their points', () => {
    expect(drawnLines('straightLine', [{ x: 100, y: 100 }, { x: 200, y: 150 }], PANE)).toEqual([[{ x: 0, y: 50 }, { x: 800, y: 450 }]])
    expect(drawnLines('rayLine', [{ x: 100, y: 100 }, { x: 200, y: 150 }], PANE)).toEqual([[{ x: 100, y: 100 }, { x: 800, y: 450 }]])
  })

  it('draws the channel lines (the price channel adds the mirrored one)', () => {
    const pts = [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 150, y: 150 }]
    expect(drawnLines('parallelStraightLine', pts, PANE).map(s => s[0].y)).toEqual([100, 150])
    expect(drawnLines('priceChannelLine', pts, PANE).map(s => s[0].y)).toEqual([100, 150, 50])
  })

  it('covers every Fibonacci level and time zone', () => {
    expect(drawnLines('fibonacciLine', [{ x: 10, y: 100 }, { x: 20, y: 200 }], PANE)).toHaveLength(7)
    expect(drawnLines('fibonacciTimeZone', [{ x: 10, y: 100 }, { x: 20, y: 100 }], PANE).map(s => s[0].x))
      .toEqual([10, 20, 30, 40, 60, 90, 140, 220, 350])
  })

  it('runs pitchfork prongs off the pane', () => {
    const lines = drawnLines('pitchfork', [{ x: 100, y: 250 }, { x: 200, y: 200 }, { x: 200, y: 300 }], PANE)
    expect(lines).toHaveLength(3)
    lines.forEach(l => { expect(l[1].x).toBe(800) })
  })

  it('draws schiff and modifiedSchiff with their own median, not a copy of Andrews\' (SC-177)', () => {
    const points: Array<{ x: number, y: number }> = [{ x: 100, y: 250 }, { x: 200, y: 200 }, { x: 200, y: 300 }]
    const andrews = drawnLines('pitchfork', points, PANE)
    const schiff = drawnLines('schiff', points, PANE)
    const modified = drawnLines('modifiedSchiff', points, PANE)
    expect(schiff).toHaveLength(3)
    expect(modified).toHaveLength(3)
    // lines[0] is the median, cast from [origin, p1, p2].forEach(...) in that
    // order. Before the fix, schiff's median start (lines[0][0]) equaled
    // Andrews' own handle (p0): both drew from x=100. Now it starts on its
    // own origin.
    expect(schiff[0][0]).not.toEqual(andrews[0][0])
    expect(schiff[0][0]).toEqual({ x: 100, y: 225 }) // p0.x, halfway from p0.y (250) to p1.y (200)
    expect(modified[0][0]).toEqual({ x: 150, y: 225 }) // full midpoint of p0 and p1
  })

  it('leaves fibonacciSegment alone at its default levels (all within [0, 1], already inside the two-point bounds)', () => {
    expect(drawnLines('fibonacciSegment', [{ x: 10, y: 100 }, { x: 20, y: 200 }], PANE)).toEqual([])
  })

  it('fibonacciExtension\'s own new default (161.8% and beyond) already needs avoid-lines with no extendData at all', () => {
    // Its default changed under SC-179 from [0, 1] to TradingView's
    // trend-based set, so even the unconfigured tool now draws past 100%.
    const lines = drawnLines('fibonacciExtension', [{ x: 10, y: 100 }, { x: 20, y: 200 }, { x: 30, y: 150 }], PANE)
    expect(lines.length).toBeGreaterThan(0)
  })

  it('adds a bounded segment for a fibonacciSegment/fibonacciExtension level outside [0, 1] (SC-179)', () => {
    const seg = drawnLines('fibonacciSegment', [{ x: 10, y: 100 }, { x: 20, y: 200 }], PANE, { levels: [0, 1, 1.618] })
    expect(seg).toHaveLength(1) // only the 1.618 level falls outside [0, 1]
    expect(seg[0][0].x).toBe(10)
    expect(seg[0][1].x).toBe(20)
    // y = p1.y + (p0.y - p1.y) * level = 200 + (100 - 200) * 1.618
    expect(seg[0][0].y).toBeCloseTo(200 + (100 - 200) * 1.618, 6)

    const ext = drawnLines('fibonacciExtension', [{ x: 10, y: 100 }, { x: 20, y: 200 }, { x: 30, y: 150 }], PANE, { levels: [0, 1, -0.618] })
    expect(ext).toHaveLength(1)
    expect(ext[0][0].x).toBe(20)
    expect(ext[0][1].x).toBe(30)
  })

  it('adds nothing for tools that stay within their points, or when points are missing', () => {
    expect(drawnLines('segment', [{ x: 1, y: 1 }, { x: 2, y: 2 }], PANE)).toEqual([])
    expect(drawnLines('rect', [{ x: 1, y: 1 }, { x: 2, y: 2 }], PANE)).toEqual([])
    expect(drawnLines('straightLine', [{ x: 1, y: 1 }], PANE)).toEqual([])
    expect(drawnLines('horizontalStraightLine', [{ x: NaN, y: 1 }], PANE)).toEqual([])
  })
})

describe('popoverLeft', () => {
  const CHART = { x: 0, width: 800 }

  it('opens under the anchor when it fits', () => {
    expect(popoverLeft({ left: 100, right: 128 }, 204, CHART)).toBe(100)
    expect(popoverLeft({ left: 400, right: 428 }, 140, CHART, 'end')).toBe(288)
  })

  it('moves left just enough to stay inside the chart\'s right edge', () => {
    // a Pin's toolbar parked in the top-right corner: its colour button at 663..691
    expect(popoverLeft({ left: 663, right: 691 }, 204, CHART)).toBe(800 - 204)
  })

  it('never goes past the left edge (the left edge wins when it cannot fit)', () => {
    expect(popoverLeft({ left: 30, right: 58 }, 150, CHART, 'end')).toBe(0)
    expect(popoverLeft({ left: 30, right: 58 }, 900, CHART)).toBe(0)
  })
})

describe('strokeHitTolerance', () => {
  it('covers the visible stroke, never less than the thin-line tolerance', () => {
    expect(strokeHitTolerance(1)).toBe(MIN_HIT_TOLERANCE)
    expect(strokeHitTolerance(4)).toBe(MIN_HIT_TOLERANCE)
    expect(strokeHitTolerance(12)).toBe(7)
    expect(strokeHitTolerance(undefined)).toBe(MIN_HIT_TOLERANCE)
    expect(strokeHitTolerance(NaN)).toBe(MIN_HIT_TOLERANCE)
  })

  it('lets a click 6 px off a 12 px highlighter band\'s centre hit it', () => {
    const band = [{ x: 0, y: 100 }, { x: 200, y: 100 }]
    expect(isNearPolyline({ x: 50, y: 106 }, band, strokeHitTolerance(12))).toBe(true)
    expect(isNearPolyline({ x: 50, y: 106 }, band, MIN_HIT_TOLERANCE)).toBe(false)
  })
})

describe('rect helpers', () => {
  it('bounds finite points only', () => {
    expect(boundsOfPoints([{ x: 10, y: 20 }, { x: 30, y: 5 }, { x: NaN, y: 1 }, {}])).toEqual({ x: 10, y: 5, width: 20, height: 15 })
    expect(boundsOfPoints([])).toBeNull()
  })

  it('inflates, unions and intersects', () => {
    expect(inflateRect({ x: 10, y: 10, width: 0, height: 0 }, 5)).toEqual({ x: 5, y: 5, width: 10, height: 10 })
    expect(unionRect({ x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: -5, width: 5, height: 5 })).toEqual({ x: 0, y: -5, width: 25, height: 15 })
    expect(rectsIntersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 5, height: 5 })).toBe(false)
    expect(rectsIntersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 9, y: 9, width: 5, height: 5 })).toBe(true)
  })

  it('tests points in a rect with negative size', () => {
    expect(isInRect({ x: 5, y: 5 }, { x: 10, y: 10, width: -10, height: -10 })).toBe(true)
    expect(isInRect({ x: 11, y: 5 }, { x: 0, y: 0, width: 10, height: 10 })).toBe(false)
  })
})

describe('bounded hit test', () => {
  it('measures distance to a segment, not to its infinite line', () => {
    expect(distanceToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(3)
    // collinear but beyond the end: klinecharts 9.1.1 would count this as "on the line"
    expect(distanceToSegment({ x: 50, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(40)
    expect(distanceToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(5)
  })

  it('hits any segment of a polyline within tolerance', () => {
    const path = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }]
    expect(isNearPolyline({ x: 15, y: 6 }, path, 2)).toBe(true)
    expect(isNearPolyline({ x: 40, y: -20 }, path, 2)).toBe(false)
    expect(isNearPolyline({ x: 1, y: 1 }, [{ x: 0, y: 0 }], 2)).toBe(true)
    expect(isNearPolyline({ x: 1, y: 1 }, [], 2)).toBe(false)
  })
})
