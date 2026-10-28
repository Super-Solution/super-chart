import { describe, expect, it } from 'vitest'

import { canvasTokens, chartTypeStyles, initLayers, themeLayers } from './engine'
import { StyleStack, pickPaths, splitChartType } from './styleStack'
import { CANVAS_FONT, CHROME_TOKENS } from './tokens'

const at = (obj: unknown, path: string): unknown => path.split('.').reduce<any>((o, k) => o?.[k], obj)

describe('StyleStack', () => {
  it('composes engine, host, host-per-theme and user layers in that order', () => {
    const stack = new StyleStack({ grid: { horizontal: { color: 'host' } }, separator: { color: 'host' } }, { light: { grid: { horizontal: { color: 'host-light' } } } })
    const engine = [{ grid: { horizontal: { color: 'engine', style: 'solid' } }, xAxis: { tickText: { color: 'engine' } } }] as any
    stack.addUser({ separator: { color: 'user' } } as any)
    const light = stack.compose('light', engine)
    const dark = stack.compose('dark', engine)
    expect(at(light, 'grid.horizontal')).toEqual({ color: 'host-light', style: 'solid' })
    expect(at(dark, 'grid.horizontal')).toEqual({ color: 'host', style: 'solid' })
    expect(at(light, 'separator.color')).toBe('user')
    expect(at(light, 'xAxis.tickText.color')).toBe('engine')
  })

  it('accumulates host styles, for all themes and per theme', () => {
    const stack = new StyleStack()
    stack.addHost({ grid: { horizontal: { color: 'a' } } } as any)
    stack.addHost({ grid: { vertical: { color: 'b' } } } as any)
    stack.addHost({ separator: { color: 'c' } } as any, 'dark')
    expect(stack.host('light')).toEqual({ grid: { horizontal: { color: 'a' }, vertical: { color: 'b' } } })
    expect(stack.host('dark')).toEqual({ grid: { horizontal: { color: 'a' }, vertical: { color: 'b' } }, separator: { color: 'c' } })
  })

  it('never keeps candle.type in any layer (the chart type has its own owner)', () => {
    const stack = new StyleStack({ candle: { type: 'ohlc', bar: { upColor: 'host' } } } as any, { dark: { candle: { type: 'area' } } as any })
    stack.addUser({ candle: { type: 'area', priceMark: { last: { show: false } } } } as any)
    stack.addHost({ candle: { type: 'candle_stroke' } } as any)
    expect(stack.compose('dark', [])).toEqual({ candle: { bar: { upColor: 'host' }, priceMark: { last: { show: false } } } })
  })

  it('splits a known candle.type off a layer, drops an unknown one', () => {
    expect(splitChartType({ candle: { type: 'area', bar: { upColor: 'x' } } } as any)).toEqual({ styles: { candle: { bar: { upColor: 'x' } } }, chartType: 'area' })
    expect(splitChartType({ candle: { type: 'nope' }, grid: { show: false } } as any)).toEqual({ styles: { grid: { show: false } } })
    expect(splitChartType({ grid: { show: false } })).toEqual({ styles: { grid: { show: false } } })
    expect(splitChartType(undefined)).toEqual({ styles: {} })
  })

  it('picks only the paths a layer sets; arrays and colours are leaves', () => {
    const source = { candle: { area: { lineColor: 'a', backgroundColor: [{ offset: 0, color: 'x' }], point: { color: 'p' } } }, grid: { show: false } }
    expect(pickPaths(source, { candle: { area: { backgroundColor: [], point: { animation: false } } } }))
      .toEqual({ candle: { area: { backgroundColor: [{ offset: 0, color: 'x' }] } } })
    expect(pickPaths(source, { xAxis: { show: true } })).toEqual({})
  })

  it('over(): a change keeps the layers above it on top, for the keys it sets', () => {
    const stack = new StyleStack({ candle: { area: { lineColor: 'host' } } } as any, { dark: { grid: { horizontal: { color: 'dark-host' } } } as any })
    stack.addUser({ grid: { show: false } } as any)
    // A chart-type switch (engine) keeps the host's area colour; unrelated keys are not added.
    expect(stack.over('dark', { candle: { type: 'area', area: { lineColor: 'engine', point: { animation: false } } } } as any, 'engine'))
      .toEqual({ candle: { type: 'area', area: { lineColor: 'host', point: { animation: false } } } })
    // pro.setStyles (host): per-theme and Settings values win now, as they will after setTheme.
    expect(stack.over('dark', { grid: { show: true, horizontal: { color: 'blue' }, vertical: { color: 'v' } } } as any, 'host'))
      .toEqual({ grid: { show: false, horizontal: { color: 'dark-host' }, vertical: { color: 'v' } } })
    expect(stack.over('light', { grid: { horizontal: { color: 'blue' } } } as any, 'host')).toEqual({ grid: { horizontal: { color: 'blue' } } })
    // pro.setStyles(s, { theme }): only Settings is above it.
    expect(stack.over('dark', { grid: { show: true, horizontal: { color: 'mine' } } } as any, 'theme'))
      .toEqual({ grid: { show: false, horizontal: { color: 'mine' } } })
  })

  it('setHost(): applies now only on the current theme, and hands back a host candle.type', () => {
    const stack = new StyleStack()
    expect(stack.setHost({ candle: { type: 'ohlc', bar: { upColor: 'u' } } } as any, undefined, 'dark'))
      .toEqual({ apply: { candle: { bar: { upColor: 'u' } } }, chartType: 'ohlc' })
    expect(stack.setHost({ candle: { type: 'ohlc' } } as any, undefined, 'dark')).toEqual({ chartType: 'ohlc' })
    expect(stack.setHost({ grid: { show: false } }, 'light', 'dark')).toEqual({})
    expect(stack.setHost({ candle: { type: 'area' }, grid: { show: true } } as any, 'dark', 'dark')).toEqual({ apply: { grid: { show: true } } })
    expect(stack.compose('light', [])).toEqual({ candle: { bar: { upColor: 'u' } }, grid: { show: false } })
  })
})

describe('engine layers', () => {
  const ctx = { theme: 'dark' as const, chartType: 'line', canvasTheme: true, tokens: {} }

  it('init puts the canvas font first and the chart type last', () => {
    const layers = initLayers(ctx, CANVAS_FONT)
    expect(at(layers[0], 'yAxis.tickText.family')).toBe(CANVAS_FONT)
    expect(at(layers[layers.length - 1], 'candle.type')).toBe('area')
  })

  it('a theme change carries no font and no chart type', () => {
    const flat = JSON.stringify(themeLayers(ctx))
    expect(flat).not.toMatch(/"family"|"textFamily"|"type"/)
  })

  it('canvasTheme off keeps the old legend icons (in the renamed icon font)', () => {
    const [, icons] = themeLayers({ ...ctx, canvasTheme: false })
    expect(at(icons, 'indicator.tooltip.icons.0')).toMatchObject({ color: '#929AA5', activeBackgroundColor: 'rgba(22, 119, 255, 0.15)', fontFamily: 'klinecharts-pro-icons' })
    expect(at(icons, 'grid')).toBeUndefined()
  })

  it('chart types map to klinecharts candle types, line and area both to area', () => {
    expect(['candle_solid', 'candle_up_stroke', 'ohlc', 'line', 'area'].map(t => at(chartTypeStyles(t, '#2962FF'), 'candle.type')))
      .toEqual(['candle_solid', 'candle_up_stroke', 'ohlc', 'area', 'area'])
    expect(at(chartTypeStyles('candle_solid', '#2962FF'), 'candle.area.point.animation')).toBe(false)
  })

  it('a chart-type switch carries the fill that tells line from area, and no colours', () => {
    expect(chartTypeStyles('area', '#2962FF')).toEqual({
      candle: {
        type: 'area',
        area: { backgroundColor: [{ offset: 0, color: 'rgba(41, 98, 255, 0.01)' }, { offset: 1, color: 'rgba(41, 98, 255, 0.2)' }], point: { animation: false } }
      }
    })
    expect(at(chartTypeStyles('line', '#2962FF'), 'candle.area.backgroundColor.1.color')).toBe('rgba(41, 98, 255, 0)')
  })
})

describe('canvasTokens', () => {
  it('ignores tokens left at the engine default and follows the ones a host changed', () => {
    const defaults = { ...CHROME_TOKENS.light }
    expect(canvasTokens('light', defaults)).toEqual({})
    // The same values in the computed forms the browser reports.
    expect(canvasTokens('light', { textSecond: 'rgb(107, 116, 131)', hover: 'rgba(53, 53, 57, 0.1)' })).toEqual({})
    expect(canvasTokens('light', { textSecond: '#5B6170', border: 'rgba(16, 19, 26, 0.09)', primary: '#1414B0' }))
      .toEqual({ textSecond: '#5B6170', grid: 'rgba(16, 19, 26, 0.09)', accent: '#1414B0' })
  })
})
