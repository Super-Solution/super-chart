import { describe, expect, it } from 'vitest'

import * as core from './runtime'
import * as entry from '.'

const bars = Array.from({ length: 40 }, (_, i) => ({
  timestamp: i * 60_000, open: 100 + i, high: 101 + i, low: 99 + i, close: 100 + i + (i % 3), volume: 10
}))
const JS_SOURCE = 'return { meta: { title: "js" }, plots: [] }'

// Order matters: the JavaScript opt-in at the end changes this entry's state.
describe('./superscript entry', () => {
  it('runs SuperScript', () => {
    const result = entry.runScript('// @title T\nplot(sma(close, 5), title="SMA")', bars)
    expect(result.meta.title).toBe('T')
    expect(result.plots).toHaveLength(1)
    expect(result.plots[0].values[39]).toBeCloseTo(core.superlib.sma(bars.map(b => b.close), 5)[39] as number, 10)
  })

  it('does not run JavaScript by default: neither this entry nor the shared registry has it', () => {
    expect(core.getLanguage('javascript')).toBeUndefined()
    expect(core.listLanguages().map(l => l.id)).toEqual(['superscript'])
    expect(entry.getLanguage('javascript')).toBeUndefined()
    expect(entry.listLanguages().map(l => l.id)).toEqual(['superscript'])
    expect(() => entry.runScript(JS_SOURCE, bars, 'javascript')).toThrow(/not enabled/)
  })

  it('runs a language only after the host registers it through this entry', () => {
    entry.registerLanguage(entry.JavaScriptLanguage)
    expect(entry.listLanguages().map(l => l.id).sort()).toEqual(['javascript', 'superscript'])
    expect(entry.runScript(JS_SOURCE, bars, 'javascript').meta.title).toBe('js')
  })

  it('shares the registry with the browser entries', () => {
    const custom = { id: 'x-entry-test', name: 'X', compile: () => ({ meta: { title: 'x' }, run: () => ({ meta: { title: 'x' }, plots: [] }) }) }
    entry.registerLanguage(custom)
    expect(core.getLanguage('x-entry-test')).toBe(custom)
  })
})
