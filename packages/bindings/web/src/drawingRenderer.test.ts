// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { traceSmooth } from './drawingRenderer'

function recorder (): { calls: string[], ctx: Parameters<typeof traceSmooth>[0] } {
  const calls: string[] = []
  return {
    calls,
    ctx: {
      moveTo: (x: number, y: number) => { calls.push(`M${x},${y}`) },
      lineTo: (x: number, y: number) => { calls.push(`L${x},${y}`) },
      quadraticCurveTo: (cx: number, cy: number, x: number, y: number) => { calls.push(`Q${cx},${cy},${x},${y}`) }
    }
  }
}

describe('traceSmooth', () => {
  it('draws nothing for no points and a straight line for two', () => {
    const empty = recorder(); traceSmooth(empty.ctx, []); expect(empty.calls).toEqual([])
    const two = recorder(); traceSmooth(two.ctx, [{ x: 0, y: 0 }, { x: 10, y: 4 }]); expect(two.calls).toEqual(['M0,0', 'L10,4'])
  })

  it('curves through the midpoints of consecutive samples, using the samples as control points, and ends on the last sample', () => {
    const { calls, ctx } = recorder()
    traceSmooth(ctx, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 10 }])
    expect(calls).toEqual(['M0,0', 'Q10,0,10,5', 'Q10,10,15,10', 'L20,10'])
  })

  it('never leaves the box of its input, so a stroke cannot overshoot the hand', () => {
    const points = Array.from({ length: 40 }, (_, i) => ({ x: i * 3, y: Math.sin(i / 3) * 20 }))
    const { calls, ctx } = recorder(); traceSmooth(ctx, points)
    for (const call of calls) for (const [x, y] of [call.slice(1).split(',').map(Number)].map(v => [v[v.length - 2], v[v.length - 1]])) {
      expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(39 * 3)
      expect(Math.abs(y)).toBeLessThanOrEqual(20)
    }
  })
})
