// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { DrawingStore } from './drawings'

const bounds = { left: 0, top: 0, right: 400, bottom: 300 }
const project = (timestamp: number, price: number): { x: number, y: number } => ({ x: timestamp, y: 300 - price })
const stroke = Array.from({ length: 60 }, (_, i) => ({ timestamp: 10 + i * 5, price: 100 + Math.sin(i / 4) * 30 }))

describe('selected freehand strokes', () => {
  it('have no per-point handles: a stroke is one gesture, not a shape with corners', () => {
    const store = new DrawingStore()
    store.add({ id: 'b', type: 'brush', anchors: stroke })
    store.add({ id: 'h', type: 'highlighter', anchors: stroke })
    for (const geometry of store.geometry(project, bounds, { bars: [] })) {
      expect(geometry.handles).toEqual([])
      expect(geometry.primitives.some(primitive => primitive.kind === 'stroke')).toBe(true)
    }
  })

  it('still give ordinary shapes a handle on each anchor', () => {
    const store = new DrawingStore()
    store.add({ id: 's', type: 'segment', anchors: [{ timestamp: 20, price: 50 }, { timestamp: 120, price: 90 }] })
    const [geometry] = store.geometry(project, bounds, { bars: [] })
    expect(geometry.handles.map(handle => handle.anchorIndex)).toEqual([0, 1])
  })

  it('can still be picked up by the body of the stroke', () => {
    const store = new DrawingStore()
    store.add({ id: 'b', type: 'brush', anchors: stroke })
    const geometries = store.geometry(project, bounds, { bars: [] })
    const onStroke = project(stroke[20].timestamp, stroke[20].price)
    expect(store.hitTest(onStroke, project, bounds, 6, { bars: [] })).toMatchObject({ id: 'b', anchorIndex: null })
    expect(geometries).toHaveLength(1)
  })
})
