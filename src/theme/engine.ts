/**
 * What the Pro engine puts at the bottom of its style stack, and how it reads
 * the host's CSS custom properties for the canvas.
 *
 * Part of SUPer-Chart (Apache-2.0).
 */

import type { CandleType, DeepPartial, Styles } from 'klinecharts'

import { areaStyles, canvasFontStyles, canvasTheme, klinechartsThemeStyles, legendIconStyles } from '../chart-theme'
import { formatColor, parseColor } from '../drawing-editor/color'
import { hidesNativeCandle, isCustomSeriesKind } from '../charttypes/customSeriesOverlay'
import {
  ACCENT, CANVAS_FONT, CANVAS_FROM_CHROME, CHROME_TOKENS, CHROME_TOKEN_VARS, ICON_FONT_FAMILY, LEGACY_ICON_WASH
} from './tokens'
import type { CanvasPalette, ChromeTokens, ThemeName } from './tokens'

type StylesLayer = DeepPartial<Styles>

/**
 * klinecharts' candle type for a top-bar chart type. 'line' and 'line_markers'
 * both draw as the area type with no fill (SC-NEXT's Line-with-Markers adds
 * per-point circles as an overlay on top, src/charttypes/customSeriesOverlay.ts,
 * since CandleAreaPointStyle is only a single last-price dot). The other
 * custom-series kinds (Heikin Ashi, Volume Bars, Columns, High-Low, Step
 * Line, HLC Area, Baseline) keep the real candle type — so the y-axis keeps
 * auto-scaling on the true high/low, never a close-only range — with the
 * candle itself hidden (see hiddenCandleStyles below) while the overlay
 * draws the actual shape, Heikin Ashi's own candle bodies included (computed
 * at paint time from src/data/heikinAshi.ts's toHeikinAshi, never written
 * back into the engine's own dataset — see customSeriesOverlay.ts's file
 * comment for why).
 */
export function candleType (chartType: string): string {
  if (chartType === 'line' || chartType === 'area' || chartType === 'line_markers') return 'area'
  if (isCustomSeriesKind(chartType) && hidesNativeCandle(chartType)) return 'candle_solid'
  return chartType
}

const TRANSPARENT = 'rgba(0,0,0,0)'

/** Every candle colour set to transparent: the real candle keeps computing the axis range but paints nothing, so the custom-series overlay is the only thing visible. */
function hiddenCandleStyles (): StylesLayer {
  const bar = {
    upColor: TRANSPARENT,
    downColor: TRANSPARENT,
    noChangeColor: TRANSPARENT,
    upBorderColor: TRANSPARENT,
    downBorderColor: TRANSPARENT,
    noChangeBorderColor: TRANSPARENT,
    upWickColor: TRANSPARENT,
    downWickColor: TRANSPARENT,
    noChangeWickColor: TRANSPARENT
  }
  return { candle: { bar, priceMark: { last: { line: { show: false } } } } }
}

/**
 * The chart type's styles: its candle type, the area fill that tells 'line'
 * from 'area'/'line_markers', the ripple off (it must travel with the switch
 * to the area type), and — for the custom-series kinds that hide the native
 * candle (every one except 'line_markers') — fully transparent candle
 * colours. No other colours: the theme layers set those, so a chart-type
 * switch keeps a host's area/candle colours for every type this layer does
 * not touch.
 */
export function chartTypeStyles (chartType: string, accent: string): StylesLayer {
  const type = candleType(chartType) as CandleType
  const isAreaLike = chartType === 'line' || chartType === 'line_markers'
  const backgroundColor = areaStyles(isAreaLike, accent).candle?.area?.backgroundColor
  const base: StylesLayer = { candle: { type, area: { backgroundColor, point: { animation: false } } } }
  if (isCustomSeriesKind(chartType) && hidesNativeCandle(chartType)) {
    const hidden = hiddenCandleStyles()
    return { candle: { ...base.candle, ...hidden.candle, bar: hidden.candle?.bar } }
  }
  return base
}

export interface EngineContext {
  theme: ThemeName
  chartType: string
  /** `canvasTheme` option; false keeps klinecharts' built-in colours. */
  canvasTheme: boolean
  /** Palette entries taken from the host's CSS (see canvasTokens). */
  tokens: Partial<CanvasPalette>
}

/** The accent the canvas uses: the host's primary token, else ACCENT. */
export function accentOf (ctx: EngineContext): string {
  return ctx.tokens.accent ?? ACCENT
}

/**
 * The engine layers applied on every theme change, lowest first: klinecharts'
 * own light/dark colours, then the canvas theme (or, with canvasTheme off,
 * the legend icons as they always were), then the line/area colours.
 */
export function themeLayers (ctx: EngineContext): StylesLayer[] {
  const dark = ctx.theme === 'dark'
  const legacyIcons: StylesLayer = { indicator: { tooltip: { icons: legendIconStyles(dark ? '#929AA5' : '#76808F', LEGACY_ICON_WASH) } } }
  return [
    klinechartsThemeStyles(ctx.theme),
    ctx.canvasTheme ? canvasTheme(ctx.theme, ctx.tokens) : legacyIcons,
    areaStyles(ctx.chartType === 'line', accentOf(ctx))
  ]
}

/** The engine layers at init: the canvas font first, the theme layers, then the chart type. */
export function initLayers (ctx: EngineContext, font: string): StylesLayer[] {
  return [canvasFontStyles(font), ...themeLayers(ctx), chartTypeStyles(ctx.chartType, accentOf(ctx))]
}

// ---- Reading the host's tokens --------------------------------------------

// Painted when a custom property is unset (var() fallback), so "unset" is
// told apart from "set to the inherited colour".
const UNSET = 'rgba(1, 2, 3, 0.04)'

function sameColour (a: string | null, b: string | null): boolean {
  const ca = parseColor(a)
  const cb = parseColor(b)
  if (ca === null || cb === null) {
    return false
  }
  return Math.abs(ca.r - cb.r) <= 1 && Math.abs(ca.g - cb.g) <= 1 && Math.abs(ca.b - cb.b) <= 1 && Math.abs(ca.a - cb.a) <= 0.01
}

/**
 * A computed colour in a form canvas and klinecharts read ('#RRGGBB' or
 * 'rgba(…)'), whatever the host wrote (var() chains, color-mix(), oklch()).
 * Null when the browser cannot paint it.
 */
function canvasColour (value: string, doc: Document): string | null {
  const parsed = parseColor(value)
  if (parsed !== null) {
    return formatColor(parsed)
  }
  // Other forms (color(srgb …), oklch(…)): let the browser convert to sRGB.
  const canvas = doc.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (ctx === null) {
    return null
  }
  ctx.fillStyle = '#010203'
  ctx.fillStyle = value
  const first = String(ctx.fillStyle)
  ctx.fillStyle = '#040506'
  ctx.fillStyle = value
  if (String(ctx.fillStyle) !== first) {
    return null // not a colour: fillStyle kept the previous value
  }
  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
  return formatColor({ r, g, b, a: a / 255 })
}

/**
 * The chrome's colour custom properties as resolved on `root` (the
 * .klinecharts-pro element), normalised for canvas. Missing entries: unset,
 * unparseable, or no DOM. Uses a hidden probe element, so every host syntax
 * resolves the way the chrome's own CSS sees it.
 */
export function resolveChromeTokens (root: Element | null | undefined): Partial<ChromeTokens> {
  const doc = root?.ownerDocument
  const view = doc?.defaultView
  if (root === null || root === undefined || doc === undefined || view === null || view === undefined) {
    return {}
  }
  const probe = doc.createElement('span')
  probe.setAttribute('aria-hidden', 'true')
  probe.style.display = 'none'
  root.appendChild(probe)
  const out: Partial<ChromeTokens> = {}
  try {
    for (const key of Object.keys(CHROME_TOKEN_VARS) as Array<keyof ChromeTokens>) {
      probe.style.color = `var(${CHROME_TOKEN_VARS[key]}, ${UNSET})`
      const computed = view.getComputedStyle(probe).color
      if (computed === '' || sameColour(computed, UNSET)) {
        continue
      }
      const colour = canvasColour(computed, doc)
      if (colour !== null) {
        out[key] = colour
      }
    }
  } finally {
    probe.remove()
  }
  return out
}

/**
 * The canvas palette entries a host changed through the chrome tokens. A
 * token left at the engine's default keeps the canvas default (which may
 * differ, e.g. darker axis text in light mode); one the host set is followed.
 */
export function canvasTokens (theme: ThemeName, resolved: Partial<ChromeTokens>): Partial<CanvasPalette> {
  const out: Partial<CanvasPalette> = {}
  for (const [chrome, canvas] of CANVAS_FROM_CHROME) {
    const value = resolved[chrome]
    if (value !== undefined && !sameColour(value, CHROME_TOKENS[theme][chrome])) {
      for (const key of canvas) {
        out[key] = value
      }
    }
  }
  return out
}

/** The canvas font: the option, else the --sc-font-numeric custom property, else CANVAS_FONT. */
export function resolveCanvasFont (root: Element | null | undefined, option?: string): string {
  if (option !== undefined && option.trim() !== '') {
    return option.trim()
  }
  const view = root?.ownerDocument?.defaultView
  const token = root !== null && root !== undefined && view !== null && view !== undefined
    ? view.getComputedStyle(root).getPropertyValue('--sc-font-numeric').trim()
    : ''
  return token !== '' ? token : CANVAS_FONT
}

/**
 * Resolves once the given font families (and the icon font) have loaded, so
 * the canvas can be redrawn: canvas text does not repaint when a font
 * arrives, and the legend icons draw as empty boxes until the icon font has.
 * Never rejects; resolves at once without the Font Loading API.
 */
export async function fontsLoaded (doc: Document | undefined, families: string[]): Promise<void> {
  const fonts = doc?.fonts
  if (fonts === undefined || typeof fonts.load !== 'function') {
    return
  }
  await Promise.all([...families, `"${ICON_FONT_FAMILY}"`].map(async family => await fonts.load(`12px ${family}`).catch(() => [])))
}
