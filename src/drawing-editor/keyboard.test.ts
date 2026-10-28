import { describe, it, expect } from 'vitest'

import { editorKeyAction, chartHotkeyAction } from './keyboard'
import type { KeyContext, HotkeyContext } from './keyboard'

const base: KeyContext = {
  key: 'Delete',
  modifier: false,
  composing: false,
  targetTag: 'div',
  targetEditable: false,
  targetIsDocument: false,
  targetInsideChart: true,
  lastPressInChart: true
}

describe('editorKeyAction', () => {
  it('deletes on Delete and Backspace, deselects on Escape', () => {
    expect(editorKeyAction(base)).toBe('delete')
    expect(editorKeyAction({ ...base, key: 'Backspace' })).toBe('delete')
    expect(editorKeyAction({ ...base, key: 'Escape' })).toBe('deselect')
    expect(editorKeyAction({ ...base, key: 'a' })).toBeNull()
  })

  it('works when nothing is focused and the chart was pressed last', () => {
    expect(editorKeyAction({ ...base, targetTag: 'body', targetIsDocument: true, targetInsideChart: false })).toBe('delete')
  })

  it('ignores unfocused keys after a press elsewhere (host UI, another chart)', () => {
    expect(editorKeyAction({ ...base, targetTag: 'body', targetIsDocument: true, targetInsideChart: false, lastPressInChart: false })).toBeNull()
    // focus inside the chart still counts
    expect(editorKeyAction({ ...base, lastPressInChart: false })).toBe('delete')
  })

  it('ignores keys typed into inputs, textareas, selects and contenteditable', () => {
    expect(editorKeyAction({ ...base, targetTag: 'input' })).toBeNull()
    expect(editorKeyAction({ ...base, targetTag: 'textarea' })).toBeNull()
    expect(editorKeyAction({ ...base, targetTag: 'select' })).toBeNull()
    expect(editorKeyAction({ ...base, targetEditable: true })).toBeNull()
    // even inside the chart (e.g. the toolbar's own hex field)
    expect(editorKeyAction({ ...base, key: 'Backspace', targetTag: 'input', targetInsideChart: true })).toBeNull()
  })

  it('lets Escape through from a slider or checkbox (the opacity slider\'s popover must close), but never Delete', () => {
    const slider: KeyContext = { ...base, targetTag: 'input', targetInputType: 'range' }
    expect(editorKeyAction({ ...slider, key: 'Escape' })).toBe('deselect')
    expect(editorKeyAction({ ...slider, key: 'Delete' })).toBeNull()
    expect(editorKeyAction({ ...slider, key: 'Backspace' })).toBeNull()
    expect(editorKeyAction({ ...base, targetTag: 'input', targetInputType: 'checkbox', key: 'Escape' })).toBe('deselect')
    // text entry still keeps every key, Escape included (the hex field handles its own)
    expect(editorKeyAction({ ...base, targetTag: 'input', targetInputType: 'text', key: 'Escape' })).toBeNull()
    expect(editorKeyAction({ ...base, targetTag: 'input', targetInputType: 'search', key: 'Escape' })).toBeNull()
    expect(editorKeyAction({ ...base, targetTag: 'input', key: 'Escape' })).toBeNull()
    // a host's slider outside the chart is still host UI
    expect(editorKeyAction({ ...slider, key: 'Escape', targetInsideChart: false })).toBeNull()
  })

  it('ignores keys aimed at host UI outside the chart', () => {
    expect(editorKeyAction({ ...base, targetTag: 'button', targetInsideChart: false })).toBeNull()
    expect(editorKeyAction({ ...base, key: 'Escape', targetTag: 'div', targetInsideChart: false })).toBeNull()
  })

  it('leaves modified keys and IME composition alone', () => {
    expect(editorKeyAction({ ...base, key: 'Backspace', modifier: true })).toBeNull()
    expect(editorKeyAction({ ...base, composing: true })).toBeNull()
  })
})

const hk: HotkeyContext = { code: 'KeyH', altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, repeat: false, composing: false, isTextEntry: false }

describe('chartHotkeyAction', () => {
  it('Alt+H/J/V/T/F arm their tool', () => {
    expect(chartHotkeyAction(hk)).toBe('horizontalStraightLine')
    expect(chartHotkeyAction({ ...hk, code: 'KeyJ' })).toBe('horizontalRayLine')
    expect(chartHotkeyAction({ ...hk, code: 'KeyV' })).toBe('verticalStraightLine')
    expect(chartHotkeyAction({ ...hk, code: 'KeyT' })).toBe('segment')
    expect(chartHotkeyAction({ ...hk, code: 'KeyF' })).toBe('fibonacciLine')
  })

  it('Alt+Shift+R arms rect; plain Alt+R does nothing', () => {
    expect(chartHotkeyAction({ ...hk, code: 'KeyR', shiftKey: true })).toBe('rect')
    expect(chartHotkeyAction({ ...hk, code: 'KeyR' })).toBeNull()
  })

  it('Shift held on the other keys does nothing (only Alt+Shift+R uses Shift)', () => {
    expect(chartHotkeyAction({ ...hk, shiftKey: true })).toBeNull()
  })

  it('an unmapped key is ignored', () => {
    expect(chartHotkeyAction({ ...hk, code: 'KeyQ' })).toBeNull()
  })

  it('requires Alt alone: excludes AltGr (ctrlKey+altKey on Windows) and Ctrl/Cmd+Alt host shortcuts', () => {
    expect(chartHotkeyAction({ ...hk, ctrlKey: true })).toBeNull()
    expect(chartHotkeyAction({ ...hk, metaKey: true })).toBeNull()
    expect(chartHotkeyAction({ ...hk, altKey: false })).toBeNull()
  })

  it('ignores a repeated (held-down) key, IME composition and typed text', () => {
    expect(chartHotkeyAction({ ...hk, repeat: true })).toBeNull()
    expect(chartHotkeyAction({ ...hk, composing: true })).toBeNull()
    expect(chartHotkeyAction({ ...hk, isTextEntry: true })).toBeNull()
  })
})
