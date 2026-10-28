import { describe, expect, it } from 'vitest'

import { KEY_PRIORITY, createKeyDispatcher, isTextEntryTarget, keyBelongsToChart } from './keyDispatcher'

// A window just big enough for the dispatcher: it keeps the listeners so a
// test can play a key or a press through them, in the order a browser would.
class FakeNode {
  parent: FakeNode | null = null
  tagName = 'DIV'
  constructor (parent: FakeNode | null = null) { this.parent = parent }
  contains (other: unknown): boolean {
    for (let n = other as FakeNode | null; n !== null && n !== undefined; n = n.parent) {
      if (n === this) return true
    }
    return false
  }
}

function fakeWindow (): { win: Window, key: (init: { key?: string, isComposing?: boolean, target: unknown }) => { stopped: boolean, prevented: boolean }, press: (target: unknown) => void, listeners: () => number } {
  const windowListeners: Record<string, Array<(e: any) => void>> = {}
  const documentListeners: Record<string, Array<(e: any) => void>> = {}
  const body = new FakeNode()
  const documentElement = new FakeNode()
  const document = {
    body,
    documentElement,
    addEventListener: (type: string, fn: (e: any) => void) => { (documentListeners[type] ??= []).push(fn) },
    removeEventListener: (type: string, fn: (e: any) => void) => { documentListeners[type] = (documentListeners[type] ?? []).filter(f => f !== fn) }
  }
  const win = {
    Node: FakeNode,
    document,
    addEventListener: (type: string, fn: (e: any) => void) => { (windowListeners[type] ??= []).push(fn) },
    removeEventListener: (type: string, fn: (e: any) => void) => { windowListeners[type] = (windowListeners[type] ?? []).filter(f => f !== fn) }
  }
  return {
    win: win as unknown as Window,
    key: init => {
      const e = {
        key: 'Escape',
        isComposing: false,
        keyCode: 27,
        defaultPrevented: false,
        stopped: false,
        ...init,
        stopPropagation () { this.stopped = true },
        preventDefault () { this.defaultPrevented = true }
      }
      for (const fn of windowListeners.keydown ?? []) fn(e)
      return { stopped: e.stopped, prevented: e.defaultPrevented }
    },
    press: target => {
      for (const fn of documentListeners.pointerdown ?? []) fn({ target, composedPath: () => [target] })
    },
    listeners: () => (windowListeners.keydown ?? []).length + (documentListeners.pointerdown ?? []).length
  }
}

describe('keyBelongsToChart', () => {
  it('takes keys inside the chart, and page keys only after a press in the chart', () => {
    const base = { insideRoot: false, isDocument: false, lastPressInChart: false, composing: false }
    expect(keyBelongsToChart({ ...base, insideRoot: true })).toBe(true)
    expect(keyBelongsToChart({ ...base, isDocument: true, lastPressInChart: true })).toBe(true)
    expect(keyBelongsToChart({ ...base, isDocument: true })).toBe(false)
    // A focused host input next to the chart keeps its keys.
    expect(keyBelongsToChart({ ...base, lastPressInChart: true })).toBe(false)
    // An IME composition is never taken.
    expect(keyBelongsToChart({ ...base, insideRoot: true, composing: true })).toBe(false)
  })
})

describe('the chart key dispatcher', () => {
  const setup = (): { fake: ReturnType<typeof fakeWindow>, root: FakeNode, inside: FakeNode, outside: FakeNode, keys: ReturnType<typeof createKeyDispatcher>, log: string[] } => {
    const fake = fakeWindow()
    const root = new FakeNode()
    const inside = new FakeNode(new FakeNode(root))
    const outside = new FakeNode()
    const keys = createKeyDispatcher(() => root as unknown as HTMLElement, fake.win)
    return { fake, root, inside, outside, keys, log: [] }
  }

  it('offers a key to the highest priority first, the newest first among equals, and stops it once taken', () => {
    const { fake, inside, keys, log } = setup()
    keys.register(() => { log.push('chart'); return true }, KEY_PRIORITY.CHART)
    keys.register(() => { log.push('editor'); return false }, { priority: KEY_PRIORITY.EDITOR })
    keys.register(() => { log.push('menu'); return false }, { priority: KEY_PRIORITY.POPOVER })
    keys.register(() => { log.push('modal'); return false }, { priority: KEY_PRIORITY.MODAL })
    // A select's list opened inside the dialog: the newest layer goes first.
    keys.register(() => { log.push('list-in-modal'); return false }, { priority: KEY_PRIORITY.POPOVER })
    const r = fake.key({ target: inside })
    expect(log).toEqual(['list-in-modal', 'modal', 'menu', 'editor', 'chart'])
    expect(r.stopped).toBe(true)
  })

  it('leaves a key nobody took alone', () => {
    const { fake, inside, keys } = setup()
    keys.register(() => false)
    expect(fake.key({ target: inside })).toEqual({ stopped: false, prevented: false })
  })

  it('ignores keys that are not the chart\'s: another element focused, or the page before any press in the chart', () => {
    const { fake, outside, keys, inside, log } = setup()
    const doc = (fake.win as any).document
    keys.register(() => { log.push('taken'); return true })
    fake.key({ target: outside })
    fake.key({ target: doc.body })
    expect(log).toEqual([])
    fake.press(inside)
    expect(keys.lastPressInChart()).toBe(true)
    fake.key({ target: doc.body })
    expect(log).toEqual(['taken'])
    fake.press(outside)
    fake.key({ target: doc.body })
    expect(log).toEqual(['taken'])
    fake.key({ target: inside, isComposing: true })
    expect(log).toEqual(['taken'])
  })

  it('while suspended (a dialog is open), skips chart shortcuts but not the dialog\'s or a popover\'s handlers', () => {
    const { fake, inside, keys, log } = setup()
    keys.register(() => { log.push('delete-drawing'); return true }, { priority: KEY_PRIORITY.EDITOR })
    keys.register(() => { log.push('arm-tool'); return true }, KEY_PRIORITY.CHART)
    const release = keys.suspend()
    expect(keys.suspended()).toBe(true)
    fake.key({ target: inside, key: 'Backspace' })
    expect(log).toEqual([])
    const off = keys.register(e => { log.push(`modal:${e.key}`); return e.key === 'Escape' }, { priority: KEY_PRIORITY.MODAL })
    keys.register(() => { log.push('opt-in'); return false }, { priority: KEY_PRIORITY.CHART, whileSuspended: true })
    fake.key({ target: inside, key: 'Backspace' })
    expect(log).toEqual(['modal:Backspace', 'opt-in'])
    off()
    release()
    release()
    expect(keys.suspended()).toBe(false)
    fake.key({ target: inside, key: 'Backspace' })
    expect(log).toEqual(['modal:Backspace', 'opt-in', 'delete-drawing'])
  })

  it('counts suspensions: two dialogs, one closed, still suspended', () => {
    const { keys } = setup()
    const a = keys.suspend()
    const b = keys.suspend()
    a()
    expect(keys.suspended()).toBe(true)
    b()
    expect(keys.suspended()).toBe(false)
  })

  it('a handler can remove itself while the key is being dispatched', () => {
    const { fake, inside, keys, log } = setup()
    const off = keys.register(() => { log.push('once'); off(); return false }, KEY_PRIORITY.POPOVER)
    keys.register(() => { log.push('next'); return false })
    fake.key({ target: inside })
    fake.key({ target: inside })
    expect(log).toEqual(['once', 'next', 'next'])
  })

  it('dispose removes its listeners', () => {
    const { fake, keys } = setup()
    expect(fake.listeners()).toBe(2)
    keys.dispose()
    expect(fake.listeners()).toBe(0)
  })
})

describe('isTextEntryTarget', () => {
  it('is true for fields that take typed text only', () => {
    const el = (tagName: string, extra: Record<string, unknown> = {}): unknown => ({ tagName, isContentEditable: false, ...extra })
    expect(isTextEntryTarget(el('INPUT', { type: 'text' }) as EventTarget)).toBe(true)
    expect(isTextEntryTarget(el('INPUT', { type: 'number' }) as EventTarget)).toBe(true)
    expect(isTextEntryTarget(el('TEXTAREA') as EventTarget)).toBe(true)
    expect(isTextEntryTarget(el('DIV', { isContentEditable: true }) as EventTarget)).toBe(true)
    expect(isTextEntryTarget(el('INPUT', { type: 'range' }) as EventTarget)).toBe(false)
    expect(isTextEntryTarget(el('BUTTON') as EventTarget)).toBe(false)
    expect(isTextEntryTarget(null)).toBe(false)
  })
})
