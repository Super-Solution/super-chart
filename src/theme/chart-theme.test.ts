import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import { pathToFileURL } from 'node:url'

import type * as Klinecharts from 'klinecharts'
import { describe, expect, it } from 'vitest'

import { areaStyles, canvasFontStyles, canvasTheme, chartStyles, klinechartsThemeStyles, legendIconStyles } from '../chart-theme'
import { ACCENT, CANVAS_FONT, CANVAS_MONO, CANVAS_PALETTE, ICON_FONT_FAMILY, INK } from './tokens'
import { contrast } from './wcag'

/** The 12 canvas text-family paths of klinecharts 9 (icons excluded). */
const FAMILY_PATHS = [
  'candle.priceMark.high.textFamily',
  'candle.priceMark.low.textFamily',
  'candle.priceMark.last.text.family',
  'candle.tooltip.text.family',
  'indicator.lastValueMark.text.family',
  'indicator.tooltip.text.family',
  'xAxis.tickText.family',
  'yAxis.tickText.family',
  'crosshair.horizontal.text.family',
  'crosshair.vertical.text.family',
  'overlay.text.family',
  'overlay.rectText.family'
]

// klinecharts' ES build (plain Node resolves its UMD file, which exports nothing).
const require = createRequire(import.meta.url)
const KC_ESM = join(dirname(require.resolve('klinecharts')), 'index.esm.js')
const klinecharts: typeof Klinecharts = await import(pathToFileURL(KC_ESM).href)

const at = (obj: unknown, path: string): unknown => path.split('.').reduce<any>((o, k) => o?.[k], obj)

/** Every leaf path of a plain-object tree (arrays are leaves). */
function leaves (obj: unknown, prefix = ''): string[] {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return [prefix]
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) => leaves(v, prefix === '' ? k : `${prefix}.${k}`))
}

describe('canvasFontStyles', () => {
  it('sets all 12 text families and nothing else', () => {
    const s = canvasFontStyles('"X", sans-serif')
    expect(FAMILY_PATHS.map(p => at(s, p))).toEqual(FAMILY_PATHS.map(() => '"X", sans-serif'))
    expect(leaves(s).sort()).toEqual([...FAMILY_PATHS].sort())
  })

  it('defaults to a stack that ends in a generic family and starts with Helvetica Neue', () => {
    expect(at(canvasFontStyles(), 'yAxis.tickText.family')).toBe(CANVAS_FONT)
    expect(CANVAS_FONT.startsWith('"Helvetica Neue"')).toBe(true)
    expect(CANVAS_FONT.trim().endsWith('sans-serif')).toBe(true)
    expect(CANVAS_FONT).not.toMatch(/system-ui|-apple-system/)
  })
})

describe('chartStyles (the lite theme)', () => {
  for (const dark of [false, true]) {
    const theme = dark ? 'dark' : 'light'
    const s = chartStyles(klinecharts, dark)

    it(`${theme}: every text path uses one family, one size and one weight`, () => {
      expect(FAMILY_PATHS.map(p => at(s, p))).toEqual(FAMILY_PATHS.map(() => CANVAS_MONO))
      const sizes = ['candle.priceMark.last.text.size', 'candle.tooltip.text.size', 'indicator.lastValueMark.text.size',
        'indicator.tooltip.text.size', 'xAxis.tickText.size', 'yAxis.tickText.size', 'crosshair.horizontal.text.size',
        'crosshair.vertical.text.size', 'overlay.text.size', 'candle.priceMark.high.textSize', 'candle.priceMark.low.textSize']
      expect(sizes.map(p => at(s, p))).toEqual(sizes.map(() => 11))
      const weights = ['candle.priceMark.last.text.weight', 'xAxis.tickText.weight', 'yAxis.tickText.weight',
        'crosshair.horizontal.text.weight', 'crosshair.vertical.text.weight']
      expect(weights.map(p => at(s, p))).toEqual(weights.map(() => 'normal'))
    })

    it(`${theme}: the crosshair and last-price tags share one shape`, () => {
      const shape = (p: string): unknown[] => ['paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom', 'borderRadius'].map(k => at(s, `${p}.${k}`))
      expect(shape('crosshair.horizontal.text')).toEqual([5, 5, 3, 3, 3])
      expect(shape('candle.priceMark.last.text')).toEqual([5, 5, 3, 3, 3])
      expect(shape('indicator.lastValueMark.text')).toEqual([5, 5, 3, 3, 3])
    })

    it(`${theme}: candles use one colour per direction on body, border and wick`, () => {
      const bar = at(s, 'candle.bar') as Record<string, string>
      expect(Object.keys(bar).sort()).toEqual(['downBorderColor', 'downColor', 'downWickColor', 'noChangeBorderColor',
        'noChangeColor', 'noChangeWickColor', 'upBorderColor', 'upColor', 'upWickColor'])
      expect(new Set([bar.upColor, bar.upBorderColor, bar.upWickColor])).toEqual(new Set(['#26a69a']))
      expect(new Set([bar.downColor, bar.downBorderColor, bar.downWickColor])).toEqual(new Set(['#ef5350']))
      expect(new Set([bar.noChangeColor, bar.noChangeBorderColor, bar.noChangeWickColor]).size).toBe(1)
    })

    it(`${theme}: indicator bars are whole elements in the candle colours, translucent`, () => {
      const [bars] = at(s, 'indicator.bars') as Array<Record<string, unknown>>
      expect(bars).toEqual({ style: 'fill', borderStyle: 'solid', borderSize: 1, borderDashedValue: [2, 2], upColor: 'rgba(38, 166, 154, 0.65)', downColor: 'rgba(239, 83, 80, 0.65)', noChangeColor: at(s, 'candle.bar.noChangeColor') })
      expect(at(s, 'indicator.circles')).toEqual([bars])
      expect(at(s, 'indicator.ohlc.upColor')).toBe('rgba(38, 166, 154, 0.65)')
    })

    it(`${theme}: the last-price tag text is dark ink, >= 4.5:1 on every direction`, () => {
      expect(at(s, 'candle.priceMark.last.text.color')).toBe(INK)
      for (const key of ['upColor', 'downColor', 'noChangeColor']) {
        expect(contrast(INK, at(s, `candle.priceMark.last.${key}`) as string), key).toBeGreaterThanOrEqual(4.5)
      }
    })

    it(`${theme}: grid and axis lines are translucent neutrals`, () => {
      const channel = dark ? '255, 255, 255' : '0, 0, 0'
      expect(at(s, 'grid.horizontal.color')).toBe(`rgba(${channel}, 0.06)`)
      expect(at(s, 'yAxis.axisLine.color')).toBe(`rgba(${channel}, 0.12)`)
    })

    it(`${theme}: still hides the high/low marks and follows the crosshair (its documented behaviour)`, () => {
      expect(at(s, 'candle.priceMark.high.show')).toBe(false)
      expect(at(s, 'candle.tooltip.showRule')).toBe('follow_cross')
      expect(at(s, 'overlay.line')).toBeUndefined()
    })
  }
})

describe('canvasTheme (the Pro engine theme)', () => {
  it('matches the snapshot for both themes', () => {
    expect(canvasTheme('light')).toMatchSnapshot('light')
    expect(canvasTheme('dark')).toMatchSnapshot('dark')
  })

  for (const theme of ['light', 'dark'] as const) {
    const s = canvasTheme(theme)

    it(`${theme}: is paint only (no behaviour, no chart type, no text family)`, () => {
      const keys = leaves(s).map(p => p.split('.').pop())
      for (const behaviour of ['show', 'showRule', 'showType', 'type', 'family', 'textFamily', 'size', 'animation']) {
        expect(keys, behaviour).not.toContain(behaviour)
      }
      const icons = at(s, 'indicator.tooltip.icons') as Array<Record<string, unknown>>
      expect(icons.map(i => i.fontFamily)).toEqual([ICON_FONT_FAMILY, ICON_FONT_FAMILY, ICON_FONT_FAMILY, ICON_FONT_FAMILY])
    })

    it(`${theme}: covers every colour key of klinecharts' own ${theme} styles`, () => {
      const mine = new Set(leaves(s))
      expect(leaves(klinechartsThemeStyles(theme)).filter(p => !mine.has(p))).toEqual([])
    })

    it(`${theme}: grid is solid and candle wicks and borders equal the bodies`, () => {
      expect(at(s, 'grid.horizontal.style')).toBe('solid')
      expect(at(s, 'grid.vertical.style')).toBe('solid')
      expect(at(s, 'candle.bar.upWickColor')).toBe(at(s, 'candle.bar.upColor'))
      expect(at(s, 'candle.bar.downBorderColor')).toBe(at(s, 'candle.bar.downColor'))
      expect(at(s, 'candle.bar.upColor')).toBe('#089981')
      expect(at(s, 'candle.bar.downColor')).toBe('#F23645')
    })

    it(`${theme}: drawings default to the accent`, () => {
      expect(at(s, 'overlay.line.color')).toBe(ACCENT)
      expect(at(s, 'overlay.polygon.color')).toBe(ACCENT)
      expect(at(s, 'overlay.text.backgroundColor')).toBe(ACCENT)
      expect(at(s, 'overlay.point.color')).toBe(ACCENT)
    })

    it(`${theme}: legend icons take the legend text colour and the neutral hover wash`, () => {
      const icons = at(s, 'indicator.tooltip.icons') as Array<Record<string, unknown>>
      expect(icons.map(i => i.id)).toEqual(['visible', 'invisible', 'setting', 'close'])
      expect(new Set(icons.map(i => i.color))).toEqual(new Set([at(s, 'indicator.tooltip.text.color')]))
      expect(new Set(icons.map(i => i.activeBackgroundColor))).toEqual(new Set([CANVAS_PALETTE[theme].hover]))
      expect(String(icons[0].activeBackgroundColor)).not.toMatch(/22, 119, 255/)
    })
  }

  it('takes palette overrides (host tokens)', () => {
    const s = canvasTheme('dark', { grid: 'rgba(255, 255, 255, 0.09)', textSecond: 'rgb(162, 165, 176)', accent: '#A0A8FF', hover: 'rgb(41, 43, 49)' })
    expect(at(s, 'grid.horizontal.color')).toBe('rgba(255, 255, 255, 0.09)')
    expect(at(s, 'yAxis.tickText.color')).toBe('rgb(162, 165, 176)')
    expect((at(s, 'indicator.tooltip.icons') as any[])[2]).toMatchObject({ color: 'rgb(162, 165, 176)', activeBackgroundColor: 'rgb(41, 43, 49)' })
    expect(at(s, 'overlay.line.color')).toBe('#A0A8FF')
    expect(at(s, 'overlay.rect.color')).toBe('rgba(160, 168, 255, 0.25)')
  })
})

describe('legendIconStyles', () => {
  it('builds all four icons in the renamed icon font', () => {
    const icons = legendIconStyles('#123456', 'rgba(0, 0, 0, 0.1)')
    expect(icons.map(i => [i.id, i.icon, i.fontFamily, i.color, i.activeColor])).toEqual([
      ['visible', '', ICON_FONT_FAMILY, '#123456', '#123456'],
      ['invisible', '', ICON_FONT_FAMILY, '#123456', '#123456'],
      ['setting', '', ICON_FONT_FAMILY, '#123456', '#123456'],
      ['close', '', ICON_FONT_FAMILY, '#123456', '#123456']
    ])
  })
})

describe('areaStyles', () => {
  it('draws line, fill and point in one accent, with the ripple animation off', () => {
    const area = at(areaStyles(false, '#2962FF'), 'candle.area') as Record<string, any>
    expect(area.lineColor).toBe('#2962FF')
    expect(area.backgroundColor).toEqual([{ offset: 0, color: 'rgba(41, 98, 255, 0.01)' }, { offset: 1, color: 'rgba(41, 98, 255, 0.2)' }])
    expect(area.point).toEqual({ color: '#2962FF', rippleColor: 'rgba(41, 98, 255, 0.3)', animation: false })
    const line = at(areaStyles(true, 'rgb(20, 20, 176)'), 'candle.area') as Record<string, any>
    expect(line.backgroundColor.map((g: { color: string }) => g.color)).toEqual(['rgba(20, 20, 176, 0)', 'rgba(20, 20, 176, 0)'])
    expect(line.point.animation).toBe(false)
  })
})

describe('klinechartsThemeStyles', () => {
  // The copy must equal the tables klinecharts registers as 'light' and 'dark',
  // or the `canvasTheme: false` look would drift from setStyles(theme).
  const source = readFileSync(KC_ESM, 'utf8')
  for (const theme of ['light', 'dark'] as const) {
    it(`equals klinecharts' registered '${theme}' styles`, () => {
      const table = new RegExp(`\\nvar ${theme} = (\\{[\\s\\S]*?\\n\\});`).exec(source)
      expect(table, `klinecharts source has a '${theme}' table`).not.toBeNull()
      // eslint-disable-next-line no-new-func, @typescript-eslint/no-implied-eval
      const upstream = new Function(`return ${table?.[1] ?? 'null'}`)()
      const norm = (o: unknown): unknown => JSON.parse(JSON.stringify(o).replace(/\s+/g, '').toLowerCase())
      expect(norm(klinechartsThemeStyles(theme))).toEqual(norm(upstream))
    })
  }
})
