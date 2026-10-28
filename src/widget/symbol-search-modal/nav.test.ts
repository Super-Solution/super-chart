import { describe, expect, it } from 'vitest'

import { clampActiveIndex, createRecentsStore, decideEnter, moveActiveIndex, visibleRecents } from './nav'

describe('moveActiveIndex', () => {
  it('wraps at both ends', () => {
    expect(moveActiveIndex(2, 1, 3)).toBe(0)
    expect(moveActiveIndex(0, -1, 3)).toBe(2)
  })
  it('with nothing active, ArrowDown selects the first and ArrowUp the last', () => {
    expect(moveActiveIndex(-1, 1, 3)).toBe(0)
    expect(moveActiveIndex(-1, -1, 3)).toBe(2)
  })
  it('an empty list has no active row', () => {
    expect(moveActiveIndex(0, 1, 0)).toBe(-1)
  })
})

describe('clampActiveIndex', () => {
  it('clamps into range; -1 for an empty list', () => {
    expect(clampActiveIndex(5, 3)).toBe(2)
    expect(clampActiveIndex(-5, 3)).toBe(0)
    expect(clampActiveIndex(0, 0)).toBe(-1)
  })
})

describe('decideEnter', () => {
  const base = { isComposing: false, shownQuery: 'sol', currentQuery: 'sol', loading: false, activeIndex: 0, resultCount: 3 }

  it('selects the active (clamped) row when the list matches what is typed', () => {
    expect(decideEnter(base)).toEqual({ action: 'select', index: 0 })
    expect(decideEnter({ ...base, activeIndex: 99 })).toEqual({ action: 'select', index: 2 })
  })

  it('ignores Enter during IME composition', () => {
    expect(decideEnter({ ...base, isComposing: true })).toEqual({ action: 'ignore' })
  })

  it('waits when the shown list is for a different (stale) query — the fast-typist case', () => {
    expect(decideEnter({ ...base, shownQuery: 'so', currentQuery: 'sol' })).toEqual({ action: 'wait' })
  })

  it('waits while a fetch for the current query is in flight', () => {
    expect(decideEnter({ ...base, loading: true })).toEqual({ action: 'wait' })
  })

  it('does nothing with an empty result list', () => {
    expect(decideEnter({ ...base, resultCount: 0 })).toEqual({ action: 'none' })
  })
})

describe('createRecentsStore', () => {
  it('in memory (no persistKey): starts empty, MRU order, capped at max', () => {
    const store = createRecentsStore({ max: 2 })
    expect(store.list()).toEqual([])
    store.push('BTC')
    store.push('ETH')
    store.push('BTC') // moves back to the front, no duplicate
    expect(store.list()).toEqual(['BTC', 'ETH'])
    store.push('SOL')
    expect(store.list()).toEqual(['SOL', 'BTC']) // capped at 2, ETH dropped
  })

  it('writes nothing to storage without a persistKey', () => {
    const setItem = (): never => { throw new Error('must not be called') }
    const store = createRecentsStore({}, { getItem: () => null, setItem })
    expect(() => { store.push('BTC') }).not.toThrow()
  })

  it('with a persistKey: reads on creation and persists on push', () => {
    const written: Record<string, string> = {}
    const storage = {
      getItem: (k: string) => written[k] ?? null,
      setItem: (k: string, v: string) => { written[k] = v }
    }
    const a = createRecentsStore({ persistKey: 'main' }, storage)
    a.push('BTC')
    expect(written['sc-recent-symbols:main']).toBe(JSON.stringify(['BTC']))
    const b = createRecentsStore({ persistKey: 'main' }, storage)
    expect(b.list()).toEqual(['BTC'])
  })

  it('two different persistKeys never see each other\'s recents', () => {
    const written: Record<string, string> = {}
    const storage = { getItem: (k: string) => written[k] ?? null, setItem: (k: string, v: string) => { written[k] = v } }
    createRecentsStore({ persistKey: 'a' }, storage).push('BTC')
    expect(createRecentsStore({ persistKey: 'b' }, storage).list()).toEqual([])
  })

  it('seeds the in-memory list from a host-managed array when there is no persistKey', () => {
    const store = createRecentsStore({ seed: ['BTC', 'ETH'] })
    expect(store.list()).toEqual(['BTC', 'ETH'])
  })

  it('a broken storage (quota, disabled) degrades to in-memory instead of throwing', () => {
    const storage = { getItem: () => { throw new Error('nope') }, setItem: () => { throw new Error('nope') } }
    const store = createRecentsStore({ persistKey: 'x' }, storage)
    expect(() => { store.push('BTC') }).not.toThrow()
    expect(store.list()).toEqual(['BTC'])
  })
})

describe('visibleRecents', () => {
  const symbols = [{ ticker: 'BTC' }, { ticker: 'ETH' }]

  it('only recents the current result set actually contains', () => {
    expect(visibleRecents(['SOL', 'BTC'], symbols, s => s.ticker)).toEqual([{ ticker: 'BTC' }])
  })

  it('a demo market returning [] shows nothing, whatever is stored', () => {
    expect(visibleRecents(['BTC', 'ETH'], [], s => (s as { ticker: string }).ticker)).toEqual([])
  })

  it('caps at the limit', () => {
    expect(visibleRecents(['BTC', 'ETH'], symbols, s => s.ticker, 1)).toEqual([{ ticker: 'BTC' }])
  })
})
