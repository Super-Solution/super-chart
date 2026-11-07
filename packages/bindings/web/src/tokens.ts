/**
 * Design tokens shared by the canvas (klinecharts styles) and the chrome (CSS).
 *
 * The chrome's defaults are less variables in src/base.less, because the
 * stylesheet cannot import TypeScript. src/theme/tokens.test.ts compiles the
 * stylesheet and checks that its custom properties equal CHROME_TOKENS, so
 * this file stays the one source: change a value here and in base.less
 * together, or the test fails.
 *
 * Hosts theme the chart through the chrome's custom properties
 * (--klinecharts-pro-primary-color and friends, set on the .klinecharts-pro
 * element). The canvas follows the ones a host overrides; see canvasTheme().
 */

/** The accent: drawings, the line/area series, focus and selection. TradingView's blue. */
export const ACCENT = '#2962FF'
const ACCENT_RGB = '41, 98, 255'

/** The accent at an alpha, as 'rgba(41, 98, 255, a)'. */
export function accentAlpha (alpha: number): string {
  return `rgba(${ACCENT_RGB}, ${alpha})`
}

/**
 * Canvas text (axes, legends, tags, drawing labels). Helvetica Neue first so
 * macOS renders as before; Segoe UI, Roboto and Arial all have tabular digits
 * by default, and the generic family last means no platform falls back to a
 * serif (klinecharts' own default is 'Helvetica Neue' alone, which draws in
 * Times New Roman on Windows and Linux). Not system-ui: SF Pro's digits are
 * proportional, and canvas has no font-variant-numeric.
 */
export const CANVAS_FONT = '"Helvetica Neue", "Segoe UI", Roboto, Arial, "Noto Sans", sans-serif'

/** Monospaced numerals: the lite theme (chartStyles) uses this on every text path. */
export const CANVAS_MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace"

/**
 * The icon font the chrome CSS defines (src/iconfonts/style.css) and the
 * canvas legend icons draw with. Exported so a host that overrides
 * indicator.tooltip.icons can draw the same glyphs.
 */
export const ICON_FONT_FAMILY = 'klinecharts-pro-icons'

/** The legend icons' hover wash in the `canvasTheme: false` look (klinecharts' old blue). */
export const LEGACY_ICON_WASH = 'rgba(22, 119, 255, 0.15)'

/** Dark ink for text on bright fills (the last-price tag, measure badges). */
export const INK = '#131722'

/** The chrome's colour custom properties, by theme (src/base.less, src/index.less). */
export interface ChromeTokens {
  /** --klinecharts-pro-primary-color */
  primary: string
  /** --klinecharts-pro-hover-background-color */
  hover: string
  /** --klinecharts-pro-background-color */
  background: string
  /** --klinecharts-pro-popover-background-color */
  popover: string
  /** --klinecharts-pro-text-color */
  text: string
  /** --klinecharts-pro-text-second-color */
  textSecond: string
  /** --klinecharts-pro-border-color */
  border: string
  /** --klinecharts-pro-selected-color */
  selected: string
}

export type ThemeName = 'light' | 'dark'

/** The custom property behind each chrome token. */
export const CHROME_TOKEN_VARS: Readonly<Record<keyof ChromeTokens, string>> = {
  primary: '--klinecharts-pro-primary-color',
  hover: '--klinecharts-pro-hover-background-color',
  background: '--klinecharts-pro-background-color',
  popover: '--klinecharts-pro-popover-background-color',
  text: '--klinecharts-pro-text-color',
  textSecond: '--klinecharts-pro-text-second-color',
  border: '--klinecharts-pro-border-color',
  selected: '--klinecharts-pro-selected-color'
}

/** The chrome's defaults. Hover is a neutral wash, never the accent (hover must not look selected). */
export const CHROME_TOKENS: Readonly<Record<ThemeName, Readonly<ChromeTokens>>> = {
  light: {
    primary: ACCENT,
    hover: 'rgba(53, 53, 57, 0.1)',
    background: '#FFFFFF',
    popover: '#FFFFFF',
    text: '#051441',
    // 4.72:1 on white (the old #76808F was 4.0:1).
    textSecond: '#6B7483',
    border: '#EBEDF1',
    selected: 'rgba(41, 98, 255, 0.15)'
  },
  dark: {
    primary: ACCENT,
    hover: 'rgba(163, 164, 213, 0.1)',
    background: '#151517',
    popover: '#1C1C1F',
    text: '#F8F8F8',
    textSecond: '#929AA5',
    border: '#292929',
    selected: 'rgba(41, 98, 255, 0.15)'
  }
}

/**
 * The canvas palette, by theme: what canvasTheme() paints when the host has
 * not overridden the matching chrome token. Text is at least 4.5:1 on the
 * theme background, candle bodies at least 3:1, and INK at least 4.5:1 on the
 * up, down and no-change fills (src/theme/contrast.test.ts).
 */
export interface CanvasPalette {
  /** Candles, the last-price line and tag. TradingView's current colours. */
  up: string
  down: string
  noChange: string
  /** Indicator bars and circles (VOL, MACD): the candle colours, translucent. */
  upBar: string
  downBar: string
  noChangeBar: string
  /** Axis ticks, legends, legend icons, crosshair lines, high/low marks. */
  textSecond: string
  /** Grid, axis lines, pane separators (decorative). */
  grid: string
  /** Crosshair tag fill (white text). */
  crosshairTag: string
  /** Text on the last-price tag. */
  tagInk: string
  /** Legend icon hover wash. */
  hover: string
  /** Drawings and the line/area series. */
  accent: string
  /** The 'rect' candle tooltip. */
  tooltipRect: string
  tooltipRectBorder: string
  /** What the canvas sits on (for contrast checks; the canvas itself is transparent). */
  background: string
}

// Literals, not references to CHROME_TOKENS: module-level objects built from
// calls or property reads are kept by bundlers even when unused (chartStyles
// alone from ./lite has a size budget). tokens.test.ts checks they agree.
export const CANVAS_PALETTE: Readonly<Record<ThemeName, Readonly<CanvasPalette>>> = {
  light: {
    up: '#089981',
    down: '#F23645',
    noChange: '#8A8F9C',
    upBar: 'rgba(8, 153, 129, 0.65)',
    downBar: 'rgba(242, 54, 69, 0.65)',
    noChangeBar: 'rgba(138, 143, 156, 0.65)',
    textSecond: '#5B6270',
    grid: '#EBEDF1',
    crosshairTag: '#686D76',
    tagInk: INK,
    hover: 'rgba(53, 53, 57, 0.1)',
    accent: ACCENT,
    tooltipRect: '#FEFEFE',
    tooltipRectBorder: '#F2F3F5',
    background: '#FFFFFF'
  },
  dark: {
    up: '#089981',
    down: '#F23645',
    noChange: '#8A8F9C',
    upBar: 'rgba(8, 153, 129, 0.65)',
    downBar: 'rgba(242, 54, 69, 0.65)',
    noChangeBar: 'rgba(138, 143, 156, 0.65)',
    textSecond: '#929AA5',
    grid: '#292929',
    crosshairTag: '#373A40',
    tagInk: INK,
    hover: 'rgba(163, 164, 213, 0.1)',
    accent: ACCENT,
    tooltipRect: 'rgba(10, 10, 10, 0.6)',
    tooltipRectBorder: 'rgba(10, 10, 10, 0.6)',
    background: '#151517'
  }
}

/**
 * Which canvas roles follow which chrome token when a host overrides it.
 * A host that sets --klinecharts-pro-border-color gets that colour on the grid
 * too; one that leaves it alone gets the canvas default.
 */
export const CANVAS_FROM_CHROME: ReadonlyArray<[keyof ChromeTokens, Array<keyof CanvasPalette>]> = [
  ['primary', ['accent']],
  ['hover', ['hover']],
  ['textSecond', ['textSecond']],
  ['border', ['grid']],
  ['background', ['background']]
]
