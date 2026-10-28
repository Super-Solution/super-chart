import { describe, expect, it } from 'vitest'

import { compileChromeCss, themeVars } from './compiledCss'
import { ACCENT, CANVAS_PALETTE, CHROME_TOKENS, CHROME_TOKEN_VARS } from './tokens'
import type { ChromeTokens } from './tokens'
import { parse } from './wcag'

// One token source: the stylesheet's defaults (src/base.less) and the
// canvas's copy of them (CHROME_TOKENS) must agree, or the canvas would treat
// the engine's own default as a host override.

const same = (a: string, b: string): boolean => {
  const x = parse(a)
  const y = parse(b)
  return Math.abs(x.r - y.r) < 1 && Math.abs(x.g - y.g) < 1 && Math.abs(x.b - y.b) < 1 && Math.abs(x.a - y.a) < 0.005
}

describe('chrome tokens', async () => {
  const vars = themeVars(await compileChromeCss())

  for (const theme of ['light', 'dark'] as const) {
    it(`${theme}: the stylesheet's custom properties equal CHROME_TOKENS`, () => {
      const mismatches = (Object.keys(CHROME_TOKEN_VARS) as Array<keyof ChromeTokens>)
        .filter(key => !same(vars[theme][CHROME_TOKEN_VARS[key]], CHROME_TOKENS[theme][key]))
        .map(key => `${key}: css ${vars[theme][CHROME_TOKEN_VARS[key]]} vs tokens.ts ${CHROME_TOKENS[theme][key]}`)
      expect(mismatches).toEqual([])
    })

    it(`${theme}: the canvas palette's grid, hover and background are the chrome's`, () => {
      expect(same(CANVAS_PALETTE[theme].grid, CHROME_TOKENS[theme].border)).toBe(true)
      expect(same(CANVAS_PALETTE[theme].hover, CHROME_TOKENS[theme].hover)).toBe(true)
      expect(same(CANVAS_PALETTE[theme].background, CHROME_TOKENS[theme].background)).toBe(true)
      expect(CANVAS_PALETTE[theme].accent).toBe(ACCENT)
    })
  }

  it('hover and selected are different colours (hover must not look selected)', () => {
    for (const theme of ['light', 'dark'] as const) {
      expect(same(CHROME_TOKENS[theme].hover, CHROME_TOKENS[theme].selected)).toBe(false)
    }
  })
})
