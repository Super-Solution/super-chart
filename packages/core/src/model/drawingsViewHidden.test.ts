import { describe, expect, it } from 'vitest'
import { DrawingStore } from './drawings'

const project = (timestamp: number, price: number): { x: number, y: number } => ({ x: timestamp / 1e9, y: 100 - price })
const bounds = { left: 0, top: 0, right: 2000, bottom: 200 }

describe('DrawingStore view hidden', () => {
  it('hides, un-selects and un-hits every drawing without touching the document or history', () => {
    const s = new DrawingStore()
    const d = s.add({ id: 'h', type: 'horizontal', anchors: [{ timestamp: 1_000_000_000_000, price: 50 }] })
    s.select(d.id)
    const json = s.exportJson()
    expect(s.geometry(project, bounds).length).toBe(1)
    expect(s.setViewHidden(true)).toBe(true)
    expect(s.setViewHidden(true)).toBe(false)
    expect(s.geometry(project, bounds)).toEqual([])
    expect(s.getSnapshot().viewHidden).toBe(true)
    expect(s.getSnapshot().selectedId).toBeNull()
    expect(s.select(d.id)).toBe(false)
    expect(s.exportJson()).toBe(json)
    s.setViewHidden(false)
    expect(s.geometry(project, bounds).length).toBe(1)
  })
})
