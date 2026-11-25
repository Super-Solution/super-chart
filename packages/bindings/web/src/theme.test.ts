import { describe, expect, it } from 'vitest'
import { AUTO_THEME, followColorScheme, prefersDark, registerWorkspaceTheme, resolveThemeName } from './theme'

/** A window whose colour scheme the test flips; counts live listeners so a leak shows. */
function fakeWindow (dark: boolean): { win: Pick<Window, 'matchMedia'>, flip: (dark: boolean) => void, listeners: () => number } {
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  let current = dark
  const win = {
    matchMedia: (query: string) => ({
      get matches () { return query === '(prefers-color-scheme: dark)' && current },
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener)
    })
  } as unknown as Pick<Window, 'matchMedia'>
  return { win, flip: next => { current = next; for (const listener of [...listeners]) listener({ matches: next } as MediaQueryListEvent) }, listeners: () => listeners.size }
}

describe('theme auto', () => {
  it('resolves auto from the system and leaves every other name alone', () => {
    expect(resolveThemeName(AUTO_THEME, fakeWindow(true).win)).toBe('dark')
    expect(resolveThemeName(AUTO_THEME, fakeWindow(false).win)).toBe('light')
    expect(resolveThemeName('light-colorblind', fakeWindow(true).win)).toBe('light-colorblind')
  })

  it('reads as dark, today\'s default, where there is no matchMedia', () => {
    expect(prefersDark({} as Pick<Window, 'matchMedia'>)).toBe(true)
    expect(followColorScheme({} as Pick<Window, 'matchMedia'>, () => { throw new Error('never') })()).toBeUndefined()
  })

  it('reports changes while listening and stops, with no listener left, once stopped', () => {
    const { win, flip, listeners } = fakeWindow(true)
    const seen: boolean[] = []
    const stop = followColorScheme(win, dark => seen.push(dark))
    flip(false); flip(true)
    expect(seen).toEqual([false, true])
    expect(listeners()).toBe(1)
    stop()
    expect(listeners()).toBe(0)
    flip(false)
    expect(seen).toEqual([false, true])
  })

  it('is a mode, so a host cannot register or extend it', () => {
    expect(() => registerWorkspaceTheme('auto', {})).toThrow(RangeError)
    expect(() => registerWorkspaceTheme('mine', { extends: 'auto' })).toThrow(/not the mode auto/)
  })
})
