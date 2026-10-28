import { describe, it, expect } from 'vitest'
import { preferAxisRay, snapHorizontalWick } from './context'
import { recognizeStroke } from './recognizer'
import { scribbleHitsDrawing } from './hitTest'

describe('chart context recognition', () => {
  it('promotes a ray only for a line reaching the right price axis', () => {
    const candidates = recognizeStroke([{ x: 20, y: 100 }, { x: 150, y: 20 }]).candidates
    expect(preferAxisRay(candidates, { x: 150, y: 20 }, 160)[0].kind).toBe('ray')
    expect(preferAxisRay(candidates, { x: 130, y: 20 }, 160)[0].kind).toBe('trend')
    const arrow = recognizeStroke([{ x: 20, y: 100 }, { x: 150, y: 20 }, { x: 130, y: 22 }]).candidates
    expect(preferAxisRay(arrow, { x: 150, y: 20 }, 160)[0].kind).toBe('arrow')
    expect(candidates[0].kind).toBe('trend')
  })
  it('snaps a nearby horizontal anchor to the closest candle wick, not a distant price', () => {
    const anchor = { x: 50, y: 50 }
    expect(snapHorizontalWick(anchor, [{ x: 52, y: 58 }, { x: 52, y: 47 }])).toEqual({ x: 50, y: 47 })
    expect(snapHorizontalWick(anchor, [{ x: 80, y: 51 }, { x: 50, y: 80 }])).toBe(anchor)
    expect(snapHorizontalWick(anchor, [{ x: NaN, y: 50 }])).toBe(anchor)
  })
})

describe('scribble touches actual drawing geometry', () => {
  const pane = { x: 0, y: 0, width: 200, height: 200 }
  const scratch = [{ x: 70, y: 70 }, { x: 100, y: 100 }, { x: 70, y: 100 }, { x: 100, y: 70 }, { x: 70, y: 90 }]
  it('hits a crossing line and full-pane horizontal but not a remote segment', () => {
    expect(scribbleHitsDrawing(scratch, 'segment', [{ x: 50, y: 85 }, { x: 120, y: 85 }], pane)).toBe(true)
    expect(scribbleHitsDrawing(scratch, 'horizontalStraightLine', [{ x: 2, y: 85 }], pane)).toBe(true)
    expect(scribbleHitsDrawing(scratch, 'segment', [{ x: 0, y: 0 }, { x: 30, y: 30 }], pane)).toBe(false)
  })
  it('does not erase a box/ellipse just because a scratch is inside its bounding box', () => {
    const box = [{ x: 20, y: 20 }, { x: 170, y: 170 }]
    expect(scribbleHitsDrawing(scratch, 'rect', box, pane)).toBe(false)
    expect(scribbleHitsDrawing(scratch, 'ellipse', box, pane)).toBe(false)
  })
  it('does not invent a line between circle anchors or unknown area tool points', () => {
    const fakeChord = [{ x: 50, y: 85 }, { x: 120, y: 85 }]
    expect(scribbleHitsDrawing(scratch, 'circle', fakeChord, pane)).toBe(false)
    expect(scribbleHitsDrawing(scratch, 'triangle', fakeChord, pane)).toBe(false)
    expect(scribbleHitsDrawing(scratch, 'image', fakeChord, pane)).toBe(false)
  })
})
