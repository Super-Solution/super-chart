import { describe, expect, it } from 'vitest'

import { clampViewport, panViewport, zoomViewport } from './viewport'

const valid = (v: { i0: number, i1: number }, n: number): boolean =>
  Number.isInteger(v.i0) && Number.isInteger(v.i1) && v.i0 >= 0 && v.i1 <= n - 1 && v.i0 <= v.i1

// A gesture over a zero-width plot yields NaN fractions; the window must stay a valid window.
describe('viewport helpers with non-finite input', () => {
  const start = { i0: 10, i1: 50 }
  it('zoom ignores a NaN anchor', () => {
    expect(zoomViewport(start, 200, 2, Number.NaN)).toEqual(clampViewport(start, 200))
  })
  it('clamp replaces a NaN edge with the default window', () => {
    for (const bad of [{ i0: Number.NaN, i1: 5 }, { i0: 5, i1: Number.NaN }]) expect(valid(clampViewport(bad, 200), 200)).toBe(true)
  })
  it('pan and infinite edges stay valid', () => {
    expect(valid(panViewport(start, 200, Number.POSITIVE_INFINITY), 200)).toBe(true)
    expect(valid(clampViewport({ i0: Number.NEGATIVE_INFINITY, i1: Number.POSITIVE_INFINITY }, 200), 200)).toBe(true)
  })
})
