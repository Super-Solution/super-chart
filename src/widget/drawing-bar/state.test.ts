/**
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at

 * http://www.apache.org/licenses/LICENSE-2.0

 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'solid-js'

import { createDrawingBarState, GROUP_DEFAULTS } from './state'

/** A minimal in-memory localStorage, since the vitest environment is plain Node. */
function makeMemoryStorage (): Storage {
  const map = new Map<string, string>()
  const storage: Storage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v) },
    removeItem: (k: string) => { map.delete(k) },
    clear: () => { map.clear() },
    key: (i: number) => [...map.keys()][i] ?? null,
    get length () { return map.size }
  }
  return storage
}

let originalWindow: unknown

beforeEach(() => {
  originalWindow = (globalThis as { window?: unknown }).window
  ;(globalThis as { window?: unknown }).window = { localStorage: makeMemoryStorage() }
})

afterEach(() => {
  (globalThis as { window?: unknown }).window = originalWindow
})

describe('createDrawingBarState', () => {
  it('defaults every group to its TradingView-convention tool, lock off, magnet weak, mode normal', () => {
    createRoot(dispose => {
      const state = createDrawingBarState(undefined)
      for (const [group, name] of Object.entries(GROUP_DEFAULTS)) {
        expect(state.tool(group as never)).toBe(name)
      }
      expect(state.lock()).toBe(false)
      expect(state.magnetKind()).toBe('weak_magnet')
      expect(state.mode()).toBe('normal')
      dispose()
    })
  })

  it('an unknown tool name in the `tools` option falls back to the group default (never throws)', () => {
    createRoot(dispose => {
      const state = createDrawingBarState({ tools: { singleLine: 'not-a-real-tool' } })
      expect(state.tool('singleLine')).toBe(GROUP_DEFAULTS.singleLine)
      dispose()
    })
  })

  it('setTool sanitizes too: setting an unknown name falls back to the default', () => {
    createRoot(dispose => {
      const state = createDrawingBarState({ persist: false })
      state.setTool('polygon', 'rect')
      expect(state.tool('polygon')).toBe('rect')
      state.setTool('polygon', 'nonsense')
      expect(state.tool('polygon')).toBe(GROUP_DEFAULTS.polygon)
      dispose()
    })
  })

  it('setMode also updates magnetKind when leaving normal, but not when returning to it', () => {
    createRoot(dispose => {
      const state = createDrawingBarState({ persist: false })
      state.setMode('strong_magnet')
      expect(state.mode()).toBe('strong_magnet')
      expect(state.magnetKind()).toBe('strong_magnet')
      state.setMode('normal')
      expect(state.mode()).toBe('normal')
      expect(state.magnetKind()).toBe('strong_magnet') // the rail still shows/arms "strong" next time
      dispose()
    })
  })

  it('persists tool / lock / magnet / mode across a reload (same storage key)', () => {
    createRoot(dispose => {
      const state = createDrawingBarState(undefined)
      state.setTool('singleLine', 'straightLine')
      state.setLock(true)
      state.setMode('strong_magnet')
      dispose()
    })
    createRoot(dispose => {
      const reloaded = createDrawingBarState(undefined)
      expect(reloaded.tool('singleLine')).toBe('straightLine')
      expect(reloaded.lock()).toBe(true)
      expect(reloaded.mode()).toBe('strong_magnet')
      expect(reloaded.magnetKind()).toBe('strong_magnet')
      dispose()
    })
  })

  it('persist: false never reads or writes storage', () => {
    const storage = (globalThis as unknown as { window: { localStorage: Storage } }).window.localStorage
    createRoot(dispose => {
      const state = createDrawingBarState({ persist: false })
      state.setTool('singleLine', 'straightLine')
      state.setLock(true)
      dispose()
    })
    expect(storage.length).toBe(0)
  })

  it('a custom storage key keeps two charts on the same page from clobbering each other', () => {
    createRoot(dispose => {
      const a = createDrawingBarState({ persist: { key: 'chart-a' } })
      const b = createDrawingBarState({ persist: { key: 'chart-b' } })
      a.setTool('singleLine', 'rayLine')
      b.setTool('singleLine', 'horizontalStraightLine')
      expect(a.tool('singleLine')).toBe('rayLine')
      expect(b.tool('singleLine')).toBe('horizontalStraightLine')
      dispose()
    })
  })

  it('a throwing localStorage does not break the rail (best-effort persistence)', () => {
    (globalThis as { window?: unknown }).window = {
      get localStorage (): never { throw new Error('blocked (private mode)') }
    }
    expect(() => {
      createRoot(dispose => {
        const state = createDrawingBarState(undefined)
        state.setTool('singleLine', 'rayLine')
        expect(state.tool('singleLine')).toBe('rayLine')
        dispose()
      })
    }).not.toThrow()
  })

  it('`tools` passed as an option wins over a stored value', () => {
    createRoot(dispose => {
      const state = createDrawingBarState(undefined)
      state.setTool('wave', 'abcd')
      dispose()
    })
    createRoot(dispose => {
      const state = createDrawingBarState({ tools: { wave: 'threeWaves' } })
      expect(state.tool('wave')).toBe('threeWaves')
      dispose()
    })
  })
})
