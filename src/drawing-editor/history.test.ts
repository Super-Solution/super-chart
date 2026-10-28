import { describe, expect, it, vi } from 'vitest'

import { History } from './history'

function spyEntry (): { undo: ReturnType<typeof vi.fn>, redo: ReturnType<typeof vi.fn> } {
  return { undo: vi.fn(), redo: vi.fn() }
}

describe('History', () => {
  it('starts with nothing to undo or redo', () => {
    const h = new History()
    expect(h.canUndo).toBe(false)
    expect(h.canRedo).toBe(false)
    expect(h.undo()).toBe(false)
    expect(h.redo()).toBe(false)
  })

  it('undo calls the entry\'s undo; redo calls its redo', () => {
    const h = new History()
    const a = spyEntry()
    h.push(a)
    expect(h.canUndo).toBe(true)
    expect(h.canRedo).toBe(false)
    expect(h.undo()).toBe(true)
    expect(a.undo).toHaveBeenCalledTimes(1)
    expect(h.canUndo).toBe(false)
    expect(h.canRedo).toBe(true)
    expect(h.redo()).toBe(true)
    expect(a.redo).toHaveBeenCalledTimes(1)
    expect(h.canRedo).toBe(false)
  })

  it('undoes and redoes multiple entries in order (LIFO for undo, FIFO for redo)', () => {
    const h = new History()
    const a = spyEntry(); const b = spyEntry(); const c = spyEntry()
    h.push(a); h.push(b); h.push(c)
    h.undo(); h.undo()
    expect(c.undo).toHaveBeenCalledTimes(1)
    expect(b.undo).toHaveBeenCalledTimes(1)
    expect(a.undo).not.toHaveBeenCalled()
    h.redo()
    expect(b.redo).toHaveBeenCalledTimes(1)
    expect(c.redo).not.toHaveBeenCalled()
  })

  it('a new push after an undo drops the redo tail', () => {
    const h = new History()
    const a = spyEntry(); const b = spyEntry(); const c = spyEntry()
    h.push(a); h.push(b)
    h.undo() // b undone (1 call so far), redo available
    h.push(c)
    expect(h.canRedo).toBe(false)
    h.undo()
    expect(c.undo).toHaveBeenCalledTimes(1)
    expect(b.undo).toHaveBeenCalledTimes(1) // still just the one call from before push(c); b was dropped, never touched again
  })

  it('caps at the configured size, dropping the oldest entry', () => {
    const h = new History({ cap: 2 })
    const a = spyEntry(); const b = spyEntry(); const c = spyEntry()
    h.push(a); h.push(b); h.push(c)
    expect(h.size).toBe(2)
    h.undo(); h.undo()
    expect(h.canUndo).toBe(false) // a is gone: only b and c were kept
    expect(b.undo).toHaveBeenCalledTimes(1)
    expect(c.undo).toHaveBeenCalledTimes(1)
    expect(a.undo).not.toHaveBeenCalled()
  })

  it('top() returns the most recent entry only while nothing has undone/redone/cleared since', () => {
    const h = new History()
    const a = spyEntry()
    expect(h.top()).toBeNull()
    h.push(a)
    expect(h.top()).toBe(a)
    const b = spyEntry()
    h.push(b)
    expect(h.top()).toBe(b)
    h.undo()
    expect(h.top()).toBeNull() // cursor no longer at the end
    h.redo()
    expect(h.top()).toBe(b)
  })

  it('clear() drops every entry and disables undo/redo', () => {
    const h = new History()
    h.push(spyEntry())
    h.push(spyEntry())
    h.clear()
    expect(h.size).toBe(0)
    expect(h.canUndo).toBe(false)
    expect(h.canRedo).toBe(false)
  })
})
