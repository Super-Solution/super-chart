// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Super Chart design tokens: the one source for the canvas, drawings, the
 * agent layer, the workspace chrome and the chat card.
 *
 * Values are the Super Chart design system (a sub-brand of Super Solution
 * Lab), light and dark. Hosts override single canvas colours through
 * EngineRenderOptions, and restyle the workspace chrome through the --sc-*
 * custom properties on its root element.
 *
 * Contrast, as the design system states it: text pairs hold 4.5:1 on their
 * surface in both themes; candle outlines and fills, indicator lines,
 * control borders and the focus ring hold 3:1 on `surface`; `onMarket`
 * holds at least 4.9:1 on the up, down and flat fills.
 */

import type { EngineRenderTheme } from '@supersolutions/super-chart-core'

/** A canvas colour set; the `-colorblind` sets share their base theme's surfaces and swap the market colours. */
export type ThemeName = EngineRenderTheme

export interface SuperChartColors {
  /** Page background around the chart. */
  ground: string
  /** The chart canvas, cards, toolbars and inputs. */
  surface: string
  /** Wells, chips, the hover state of toolbar buttons. */
  surfaceSunken: string
  /** Hairlines: the grid, pane separators, dividers. */
  line: string
  /** Control borders, the crosshair, axis lines (3:1 on surface). */
  lineStrong: string
  /** Primary text, the line series, crosshair tag fill. */
  ink: string
  /** The colour a new drawing takes until its own style says otherwise (3:1 on `surface`). A drawing's style, then the chart's `color` option, win over it. */
  drawing: string
  /** Axis labels, captions, legend names, the fourth indicator line. */
  inkMuted: string
  /** The assistant's marks and the one primary action. Fill and stroke only. */
  violet: string
  /** Violet text, the active toolbar item, the focus ring. */
  violetStrong: string
  /** The active interval or tool, the assistant's label chips. */
  violetTint: string
  onViolet: string
  /** Interface states, text and icons only; never market data. */
  success: string
  danger: string
  /** Market data: a bar that closed above (up), below (down) or at (flat) its open. */
  up: string
  /** `bear` tone. */
  down: string
  flat: string
  /** Price text on an up, down or flat fill. */
  onMarket: string
  /** Volume and histogram bars. */
  upBar: string
  downBar: string
  /** Translucent bands: bull, bear and accent zones. */
  upZone: string
  downZone: string
  violetZone: string
  /** Area fill under an ink line; hover wash. */
  inkWash: string
  /** Indicator lines by slot within a pane; a fourth line takes inkMuted, dashed. */
  indicator: readonly [string, string, string]
}

const BASE_COLORS: Readonly<Record<'light' | 'dark', Readonly<SuperChartColors>>> = Object.freeze({
  light: Object.freeze({
    ground: '#fafafa',
    surface: '#ffffff',
    surfaceSunken: '#f2f2f4',
    line: '#e4e4e7',
    lineStrong: '#8a8a94',
    ink: '#111113',
    drawing: '#2962ff',
    inkMuted: '#5f5f68',
    violet: '#6c4af2',
    violetStrong: '#5a38e0',
    violetTint: '#eeeaff',
    onViolet: '#ffffff',
    success: '#12805c',
    danger: '#c2362b',
    up: '#12805c',
    down: '#c2362b',
    flat: '#5f5f68',
    onMarket: '#ffffff',
    upBar: 'rgba(18, 128, 92, 0.42)',
    downBar: 'rgba(194, 54, 43, 0.42)',
    upZone: 'rgba(18, 128, 92, 0.10)',
    downZone: 'rgba(194, 54, 43, 0.10)',
    violetZone: 'rgba(108, 74, 242, 0.10)',
    inkWash: 'rgba(17, 17, 19, 0.06)',
    indicator: Object.freeze(['#2a78d6', '#a87400', '#c9407a'] as const)
  }),
  dark: Object.freeze({
    ground: '#0e0e10',
    surface: '#17171a',
    surfaceSunken: '#1d1d21',
    line: '#2a2a30',
    lineStrong: '#6b6b75',
    ink: '#f4f4f5',
    drawing: '#4d86ff',
    inkMuted: '#a1a1aa',
    violet: '#a28cff',
    violetStrong: '#b9a8ff',
    violetTint: '#2a2150',
    onViolet: '#111113',
    success: '#4fd1a1',
    danger: '#ff7b72',
    up: '#4fd1a1',
    down: '#ff7b72',
    flat: '#a1a1aa',
    onMarket: '#111113',
    upBar: 'rgba(79, 209, 161, 0.38)',
    downBar: 'rgba(255, 123, 114, 0.38)',
    upZone: 'rgba(79, 209, 161, 0.12)',
    downZone: 'rgba(255, 123, 114, 0.12)',
    violetZone: 'rgba(162, 140, 255, 0.14)',
    inkWash: 'rgba(244, 244, 245, 0.08)',
    indicator: Object.freeze(['#3987e5', '#c98500', '#d55181'] as const)
  })
})

/**
 * Colour-vision-safe market colours: Okabe-Ito blue for up and orange for down, so a bar is never told
 * apart by red against green alone. Interface states (`success`, `danger`) keep their meaning. The
 * indicator slots leave blue and orange free for the candles. `onMarket` stays above 4.5:1 on both fills.
 */
const COLORBLIND_COLORS: Readonly<Record<'light' | 'dark', Readonly<SuperChartColors>>> = Object.freeze({
  light: Object.freeze({
    ...BASE_COLORS.light,
    drawing: BASE_COLORS.light.ink,
    up: '#0072b2',
    down: '#b34700',
    upBar: 'rgba(0, 114, 178, 0.42)',
    downBar: 'rgba(179, 71, 0, 0.42)',
    upZone: 'rgba(0, 114, 178, 0.10)',
    downZone: 'rgba(179, 71, 0, 0.10)',
    indicator: Object.freeze(['#a8447f', '#7a6a00', '#007a5a'] as const)
  }),
  dark: Object.freeze({
    ...BASE_COLORS.dark,
    drawing: BASE_COLORS.dark.ink,
    up: '#56b4e9',
    down: '#e69f00',
    upBar: 'rgba(86, 180, 233, 0.38)',
    downBar: 'rgba(230, 159, 0, 0.38)',
    upZone: 'rgba(86, 180, 233, 0.12)',
    downZone: 'rgba(230, 159, 0, 0.12)',
    indicator: Object.freeze(['#cc79a7', '#f0e442', '#2fc59d'] as const)
  })
})

export const SUPER_CHART_COLORS: Readonly<Record<ThemeName, Readonly<SuperChartColors>>> = Object.freeze({
  light: BASE_COLORS.light,
  dark: BASE_COLORS.dark,
  'light-colorblind': COLORBLIND_COLORS.light,
  'dark-colorblind': COLORBLIND_COLORS.dark
})

/** Interface text. The library downloads no fonts; without Inter the system face is used. */
export const FONT_SANS = '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans TC", sans-serif'
/**
 * Every number the canvas writes. A canvas has no font-variant-numeric, so the
 * face itself must have tabular figures: JetBrains Mono, then system monospace.
 */
export const FONT_MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace'
/** Canvas prices, times and readouts. */
export const CANVAS_FONT = `500 11px ${FONT_MONO}`
/** Canvas words: pane titles, agent chips, drawing labels. */
export const CANVAS_LABEL_FONT = `500 11px ${FONT_SANS}`

/** Unknown or missing values fall back to dark, the engine's long-standing default. */
export function themeName (value: unknown): ThemeName {
  return value === 'light' || value === 'light-colorblind' || value === 'dark-colorblind' ? value : 'dark'
}

/** The surface a colour set sits on, for code that only cares about light against dark. */
export function baseTheme (value: unknown): 'light' | 'dark' {
  return value === 'light' || value === 'light-colorblind' ? 'light' : 'dark'
}

export function colors (theme: unknown): Readonly<SuperChartColors> {
  return SUPER_CHART_COLORS[themeName(theme)]
}

/** A colour at an alpha, when it is #rrggbb; anything else is returned as given. */
export function withAlpha (color: string, alpha: number): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(color)
  if (hex === null) return color
  const n = parseInt(hex[1], 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}
