import { describe, expect, it } from 'vitest'

import { SuperScriptLanguage, checkSuperScript, isSuperScriptError } from '.'

const bars = Array.from({ length: 30 }, (_, i) => ({ timestamp: i * 60_000, open: 100, high: 102, low: 98, close: 100 + (i % 5), volume: 1 }))

// A script is untrusted text (often model output): a hostile shape must be a
// diagnostic with a position, never a raw stack overflow.
describe('SuperScript structural limits', () => {
  const hostile: Array<[string, string]> = [
    ['nested brackets', `plot(${'('.repeat(5000)}close${')'.repeat(5000)})`],
    ['prefix operators', `plot(${'-'.repeat(5000)}close)`],
    ['nested calls', `plot(${'abs('.repeat(5000)}close${')'.repeat(5000)})`],
    ['nested ternaries', `plot(${'close ? 1 : '.repeat(5000)}0)`]
  ]
  for (const [name, source] of hostile) {
    it(`reports ${name} as a diagnostic`, () => {
      const found = checkSuperScript(source)
      expect(found.some(d => d.severity === 'error' && d.code === 'UNSUPPORTED' && /nested/.test(d.message))).toBe(true)
      try { SuperScriptLanguage.compile(source); throw new Error('compiled') } catch (e) {
        expect(isSuperScriptError(e)).toBe(true)
      }
    })
  }

  it('reports an operator chain longer than the stack as a diagnostic, not a RangeError', () => {
    const source = `plot(${'close + '.repeat(200_000)}close)`
    let thrown: unknown
    try { SuperScriptLanguage.compile(source).run(bars) } catch (e) { thrown = e }
    expect(isSuperScriptError(thrown)).toBe(true)
    expect(checkSuperScript(source).some(d => d.severity === 'error')).toBe(true)
  })

  it('still accepts ordinary nesting', () => {
    const source = `plot(${'('.repeat(100)}sma(close, 5)${')'.repeat(100)})`
    expect(checkSuperScript(source).filter(d => d.severity === 'error')).toEqual([])
    expect(SuperScriptLanguage.compile(source).run(bars).plots).toHaveLength(1)
  })
})
