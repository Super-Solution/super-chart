import { describe, expect, it } from 'vitest'

import { positionLong, positionShort } from '../extension/position'
import { dateRange, priceDateRange, priceRange } from '../extension/measure'
import { forecast } from '../extension/tvTools5'
import { accentStyles } from '../extension/accent'
import { canvasTheme } from '../chart-theme'
import { compileChromeCss, resolveVars, themeVars } from './compiledCss'
import { CANVAS_PALETTE } from './tokens'
import { contrast } from './wcag'

// WCAG contrast of the canvas palette (SC-048): text at least 4.5:1, candle
// bodies at least 3:1 against the background. Grid, axis lines and separators
// are decorative and exempt.

describe('canvas palette contrast', () => {
  for (const theme of ['light', 'dark'] as const) {
    const p = CANVAS_PALETTE[theme]
    const table: Array<[string, string, string, number]> = [
      ['axis/legend text on the background', p.textSecond, p.background, 4.5],
      ['up candle on the background', p.up, p.background, 3],
      ['down candle on the background', p.down, p.background, 3],
      ['no-change candle on the background', p.noChange, p.background, 3],
      ['last-price tag text on an up tag', p.tagInk, p.up, 4.5],
      ['last-price tag text on a down tag', p.tagInk, p.down, 4.5],
      ['last-price tag text on a no-change tag', p.tagInk, p.noChange, 4.5],
      ['crosshair tag text (white) on its fill', '#FFFFFF', p.crosshairTag, 4.5],
      ['drawing label text (white) on the accent', '#FFFFFF', p.accent, 4.5]
    ]
    for (const [what, fg, bg, min] of table) {
      it(`${theme}: ${what} >= ${min}:1`, () => {
        expect(contrast(fg, bg, p.background)).toBeGreaterThanOrEqual(min)
      })
    }
  }
})

// The measure/position/forecast badges draw their text on coloured fills;
// white on the green/red badges was 2.7-4.0:1.
describe('drawing badge contrast', () => {
  const figures = (template: any, values: number[], accent?: string): any[] => template.createPointFigures({
    overlay: { points: values.map((value, i) => ({ value, dataIndex: 10 + i * 5 })), styles: template.styles ?? {} },
    coordinates: values.map((_, i) => ({ x: 100 + i * 40, y: 200 - i * 30 })),
    precision: { price: 2, volume: 0 },
    bounding: { width: 800, height: 400, left: 0, top: 0, right: 0, bottom: 0 },
    defaultStyles: accent === undefined ? undefined : { line: { color: accent } }
  })
  const labels: Array<[string, any[]]> = [
    ['priceRange up', figures(priceRange, [100, 110])],
    ['priceRange down', figures(priceRange, [110, 100])],
    ['dateRange', figures(dateRange, [100, 110])],
    ['priceDateRange up', figures(priceDateRange, [100, 110])],
    ['priceDateRange down', figures(priceDateRange, [110, 100])],
    ['positionLong', figures(positionLong, [100, 110, 95])],
    ['positionShort', figures(positionShort, [100, 90, 105])],
    ['forecast up', figures(forecast, [100, 110])],
    ['forecast down', figures(forecast, [110, 100])],
    // The accent labels on a host accent (SupWallet's light and dark primary).
    ['priceRange on #1414B0', figures(priceRange, [100, 110], '#1414B0')],
    ['dateRange on #A0A8FF', figures(dateRange, [100, 110], '#A0A8FF')]
  ]
  for (const [name, figs] of labels) {
    for (const theme of ['light', 'dark'] as const) {
      it(`${theme}: ${name} badge text >= 4.5:1`, () => {
        const texts = figs.filter(f => f.type === 'text' && f.styles?.backgroundColor !== undefined)
        expect(texts.length).toBeGreaterThan(0)
        for (const t of texts) {
          expect(contrast(t.styles.color, t.styles.backgroundColor, CANVAS_PALETTE[theme].background), t.attrs.text).toBeGreaterThanOrEqual(4.5)
        }
      })
    }
  }

  for (const accent of ['#2962FF', '#1414B0', '#A0A8FF']) {
    it(`note box and drawing-default label text on the accent ${accent} >= 4.5:1`, () => {
      const box = accentStyles('note', accent).text as Record<string, string>
      expect(box.backgroundColor).toBe(accent)
      expect(contrast(box.color, box.backgroundColor)).toBeGreaterThanOrEqual(4.5)
      const text = (canvasTheme('dark', { accent }) as any).overlay.text
      expect(contrast(text.color, text.backgroundColor)).toBeGreaterThanOrEqual(4.5)
    })
  }
})

// The chrome's tokens as compiled (SC-054), resolved the way the browser does
// on the .klinecharts-pro element: text >= 4.5:1, controls >= 3:1 (WCAG 1.4.3,
// 1.4.11). Also under SupWallet's vibe-studio mapping of the eight public
// tokens (tokens.css values), since the derived tokens must follow a host.
const VIBE: Record<'light' | 'dark', Record<string, string>> = {
  light: {
    '--klinecharts-pro-primary-color': '#1414B0',
    '--klinecharts-pro-hover-background-color': '#EDEEF3',
    '--klinecharts-pro-background-color': '#FFFFFF',
    '--klinecharts-pro-popover-background-color': '#FFFFFF',
    '--klinecharts-pro-text-color': '#10131A',
    '--klinecharts-pro-text-second-color': '#5B6170',
    '--klinecharts-pro-border-color': 'rgba(16, 19, 26, 0.09)',
    '--klinecharts-pro-selected-color': 'rgba(31, 31, 230, 0.07)'
  },
  dark: {
    '--klinecharts-pro-primary-color': '#A0A8FF',
    '--klinecharts-pro-hover-background-color': '#292B31',
    '--klinecharts-pro-background-color': '#191A1E',
    '--klinecharts-pro-popover-background-color': '#191A1E',
    '--klinecharts-pro-text-color': '#F4F5F8',
    '--klinecharts-pro-text-second-color': '#A2A5B0',
    '--klinecharts-pro-border-color': 'rgba(255, 255, 255, 0.09)',
    '--klinecharts-pro-selected-color': 'rgba(102, 117, 255, 0.14)'
  }
}

describe('chrome token contrast', async () => {
  const compiled = themeVars(await compileChromeCss())
  for (const host of ['defaults', 'SupWallet vibe-studio'] as const) {
    for (const theme of ['light', 'dark'] as const) {
      const vars = host === 'defaults' ? compiled[theme] : { ...compiled[theme], ...VIBE[theme] }
      const v = (name: string): string => resolveVars(`var(--klinecharts-pro-${name})`, vars)
      const bg = v('background-color')
      const pop = v('popover-background-color')
      const table: Array<[string, string, string, string, number]> = [
        ['text on the background', v('text-color'), bg, bg, 4.5],
        ['text on a popover', v('text-color'), pop, pop, 4.5],
        ['secondary text on the background', v('text-second-color'), bg, bg, 4.5],
        ['secondary text on a popover', v('text-second-color'), pop, pop, 4.5],
        ['selected-item text on the selected wash (bar)', v('primary-text-color'), v('selected-color'), bg, 4.5],
        ['selected-item text on the selected wash (menu)', v('primary-text-color'), v('selected-color'), pop, 4.5],
        ['selected-item text on a hovered row', v('primary-text-color'), v('hover-background-color'), pop, 4.5],
        ['accent controls (switch on, checkbox) on a popover', v('primary-color'), pop, pop, 3],
        ['control borders on a popover', v('control-border-color'), pop, pop, 3],
        ['control borders on the background', v('control-border-color'), bg, bg, 3],
        ['an off switch thumb on a popover', v('text-second-color'), pop, pop, 3]
      ]
      if (host === 'defaults') {
        table.push(['a confirm button label (white) on the accent', '#FFFFFF', v('primary-color'), pop, 4.5])
      }
      for (const [what, fg, bgColour, base, min] of table) {
        it(`${host}, ${theme}: ${what} >= ${min}:1`, () => {
          expect(contrast(fg, bgColour, base)).toBeGreaterThanOrEqual(min)
        })
      }
    }
  }

  // SC-056: in dark, floating surfaces sit on near-identical colours; their
  // border must show (the old #292929 on #1c1c1f was 1.17:1).
  for (const host of ['defaults', 'SupWallet vibe-studio'] as const) {
    it(`${host}, dark: a floating surface's border >= 1.3:1 on its fill`, () => {
      const vars = host === 'defaults' ? compiled.dark : { ...compiled.dark, ...VIBE.dark }
      const v = (name: string): string => resolveVars(`var(--klinecharts-pro-${name})`, vars)
      const pop = v('popover-background-color')
      expect(contrast(v('popover-border-color'), pop, pop)).toBeGreaterThanOrEqual(1.3)
    })
  }

  it('hover and selected washes differ in both themes', () => {
    for (const theme of ['light', 'dark'] as const) {
      const v = (name: string): string => resolveVars(`var(--klinecharts-pro-${name})`, compiled[theme])
      expect(v('hover-background-color')).not.toBe(v('selected-color'))
    }
  })
})
