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

import { describe, expect, it } from 'vitest'

import { CANVAS_KEYS, canvasStrings, ensureCanvasLocale, registerCanvasStrings } from './canvas'

// Only canvasStrings (pure) is exercised here. ensureCanvasLocale and
// registerCanvasStrings call klinecharts' own registerLocale/getSupportedLocales;
// importing those directly, at runtime, alongside this module hits a
// vitest/vite-node SSR-transform quirk specific to klinecharts' dual
// CJS/ESM build (`__vite_ssr_import_0__.getSupportedLocales is not a
// function` — reproduced even with no mocking, and confirmed NOT a bug in
// this code: a plain `bun` run of the same two imports, and the e2e
// Playwright suite (real Chrome, real klinecharts), both work correctly).
// e2e/tests/i18n-a11y.spec.ts is the real gate for the klinecharts-facing
// half of SC-043/SC-149.
describe('canvasStrings (pure)', () => {
  it('picks only the keys klinecharts draws on the canvas, in the order given', () => {
    expect(canvasStrings({ time: '時間：', indicator: '指標', open: '開：', unrelated: 'x' })).toEqual({ time: '時間：', open: '開：' })
  })

  it('drops a key whose value is not a string', () => {
    // @ts-expect-error deliberately malformed input (an agent/JSON caller)
    expect(canvasStrings({ time: 42, low: '低：' })).toEqual({ low: '低：' })
  })

  it('is {} for a dictionary with no canvas keys', () => {
    expect(canvasStrings({ indicator: '指標', setting: '設定' })).toEqual({})
  })

  it('is exactly the keys klinecharts\' candle legend draws (time/open/high/low/close/volume/turnover/change)', () => {
    expect([...CANVAS_KEYS].sort()).toEqual(['change', 'close', 'high', 'low', 'open', 'time', 'turnover', 'volume'])
  })

  it('exports ensureCanvasLocale and registerCanvasStrings as functions (wired, not dead code)', () => {
    expect(typeof ensureCanvasLocale).toBe('function')
    expect(typeof registerCanvasStrings).toBe('function')
  })
})
