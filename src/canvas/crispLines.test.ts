import { describe, expect, it, vi } from 'vitest'

import {
  IDENTITY_TRANSFORM, axisAlignedOrientation, drawCrispLine, isAxisAlignedTransform, snapCoordinate
} from './crispLines'
import type { CrispCtx, Transform2D } from './crispLines'

describe('axisAlignedOrientation', () => {
  it('a vertical 2-point segment', () => {
    expect(axisAlignedOrientation([{ x: 10, y: 0 }, { x: 10, y: 20 }])).toBe('vertical')
  })
  it('a horizontal 2-point segment', () => {
    expect(axisAlignedOrientation([{ x: 0, y: 10 }, { x: 20, y: 10 }])).toBe('horizontal')
  })
  it('null for a diagonal, a point, or a polyline', () => {
    expect(axisAlignedOrientation([{ x: 0, y: 0 }, { x: 5, y: 5 }])).toBeNull()
    expect(axisAlignedOrientation([{ x: 5, y: 5 }, { x: 5, y: 5 }])).toBeNull()
    expect(axisAlignedOrientation([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }])).toBeNull()
  })
})

describe('isAxisAlignedTransform', () => {
  it('true with no rotation/skew, whatever the scale', () => {
    expect(isAxisAlignedTransform({ a: 1.25, b: 0, c: 0, d: 1.25, e: 0, f: 0 })).toBe(true)
  })
  it('false with rotation or skew', () => {
    expect(isAxisAlignedTransform({ a: 1, b: 0.1, c: 0, d: 1, e: 0, f: 0 })).toBe(false)
    expect(isAxisAlignedTransform({ a: 1, b: 0, c: 0.1, d: 1, e: 0, f: 0 })).toBe(false)
  })
})

describe('snapCoordinate', () => {
  it('DPR 1: a 1px line centres on a half pixel', () => {
    expect(snapCoordinate(10, 1, 0, 1)).toEqual({ center: 10.5, width: 1 })
  })
  it('DPR 2 (Retina): a 1px logical line is a crisp 2-device-px line centred on a whole pixel', () => {
    expect(snapCoordinate(10, 2, 0, 1)).toEqual({ center: 20, width: 2 })
  })
  it('DPR 1.25: rounds the width to the nearest device pixel and stays centred', () => {
    // size(1) * scale(1.25) = 1.25 -> rounds to 1 device px (odd -> half pixel).
    expect(snapCoordinate(8, 1.25, 0, 1)).toEqual({ center: 10.5, width: 1 })
  })
  it('DPR 1.5: rounds to 2 device px (even -> whole pixel)', () => {
    // size(1) * scale(1.5) = 1.5 -> rounds to 2.
    expect(snapCoordinate(8, 1.5, 0, 1)).toEqual({ center: 12, width: 2 })
  })
  it('never rounds width to 0 for a hairline at a tiny scale', () => {
    expect(snapCoordinate(0, 0.01, 0, 1).width).toBe(1)
  })
})

function fakeCtx (): CrispCtx & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    save: () => { calls.push('save') },
    restore: () => { calls.push('restore') },
    setTransform: (...a: unknown[]) => { calls.push(`setTransform(${a.join(',')})`) },
    beginPath: () => { calls.push('beginPath') },
    closePath: () => { calls.push('closePath') },
    moveTo: (x: number, y: number) => { calls.push(`moveTo(${x},${y})`) },
    lineTo: (x: number, y: number) => { calls.push(`lineTo(${x},${y})`) },
    stroke: () => { calls.push('stroke') },
    setLineDash: (v: number[]) => { calls.push(`setLineDash(${JSON.stringify(v)})`) },
    lineWidth: 0,
    strokeStyle: ''
  } as unknown as CrispCtx & { calls: string[] }
}

describe('drawCrispLine', () => {
  it('snaps a vertical grid line at DPR 1.25 and never calls the fallback', () => {
    const ctx = fakeCtx()
    const fallback = vi.fn()
    const t: Transform2D = { a: 1.25, b: 0, c: 0, d: 1.25, e: 0, f: 0 }
    drawCrispLine(ctx, { coordinates: [{ x: 8, y: 0 }, { x: 8, y: 100 }] }, { size: 1, color: '#fff' }, t, fallback)
    expect(fallback).not.toHaveBeenCalled()
    expect(ctx.lineWidth).toBe(1)
    expect(ctx.calls).toContain('moveTo(10.5,0)')
    expect(ctx.calls).toContain('lineTo(10.5,125)')
  })

  it('passes a diagonal or multi-point line to the fallback unchanged', () => {
    const ctx = fakeCtx()
    const fallback = vi.fn()
    const diagonal = { coordinates: [{ x: 0, y: 0 }, { x: 5, y: 5 }] }
    drawCrispLine(ctx, diagonal, { size: 1 }, IDENTITY_TRANSFORM, fallback)
    expect(fallback).toHaveBeenCalledTimes(1)
    expect(fallback.mock.calls[0][1]).toEqual([diagonal])
    expect(ctx.calls).toEqual([]) // never touched: no snapped segment in this call
  })

  it('does not snap when the transform has rotation/skew (falls back instead)', () => {
    const ctx = fakeCtx()
    const fallback = vi.fn()
    const rotated: Transform2D = { a: 1, b: 0.2, c: -0.2, d: 1, e: 0, f: 0 }
    const vertical = { coordinates: [{ x: 8, y: 0 }, { x: 8, y: 100 }] }
    drawCrispLine(ctx, vertical, { size: 1 }, rotated, fallback)
    expect(fallback).toHaveBeenCalledTimes(1)
    expect(fallback.mock.calls[0][1]).toEqual([vertical])
  })

  it('splits a mixed array: axis-aligned segments are snapped, the rest go to the fallback', () => {
    const ctx = fakeCtx()
    const fallback = vi.fn()
    const straight = { coordinates: [{ x: 8, y: 0 }, { x: 8, y: 100 }] }
    const diagonal = { coordinates: [{ x: 0, y: 0 }, { x: 5, y: 5 }] }
    drawCrispLine(ctx, [straight, diagonal], { size: 1 }, IDENTITY_TRANSFORM, fallback)
    expect(fallback).toHaveBeenCalledWith(ctx, [diagonal], { size: 1 })
    expect(ctx.calls.some(c => c.startsWith('moveTo'))).toBe(true)
  })

  it('is byte-identical at DPR 1 and DPR 2 (no width/centre change): a 1px line stays 1 device px, a Retina 1px line stays 2', () => {
    const ctx1 = fakeCtx()
    drawCrispLine(ctx1, { coordinates: [{ x: 8, y: 0 }, { x: 8, y: 100 }] }, { size: 1 }, { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, vi.fn())
    expect(ctx1.lineWidth).toBe(1)
    const ctx2 = fakeCtx()
    drawCrispLine(ctx2, { coordinates: [{ x: 8, y: 0 }, { x: 8, y: 100 }] }, { size: 1 }, { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 }, vi.fn())
    expect(ctx2.lineWidth).toBe(2)
  })

  it('dashed styles scale the dash pattern with the transform', () => {
    const ctx = fakeCtx()
    drawCrispLine(ctx, { coordinates: [{ x: 8, y: 0 }, { x: 8, y: 100 }] }, { size: 1, style: 'dashed', dashedValue: [4, 3] }, { a: 1, b: 0, c: 0, d: 2, e: 0, f: 0 }, vi.fn())
    expect(ctx.calls).toContain('setLineDash([8,6])')
  })
})
