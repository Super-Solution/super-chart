// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Colours the annotation layer paints with (level, zone and marker tones), by card theme. The chart canvas takes its
 * colours from `EngineRenderOptions` and the workspace chrome from the `--sc-*` custom properties
 * (see ./theme.ts); this file is only the annotation tones.
 */
export type ThemeName = 'light' | 'dark'

export interface CanvasPalette {
  /** `bull` tone. */
  up: string
  /** `bear` tone. */
  down: string
  /** `accent` tone. */
  accent: string
  /** The neutral tone, and axis-like text. */
  textSecond: string
}

export const CANVAS_PALETTE: Readonly<Record<ThemeName, Readonly<CanvasPalette>>> = {
  light: { up: '#089981', down: '#F23645', accent: '#2962FF', textSecond: '#5B6270' },
  dark: { up: '#089981', down: '#F23645', accent: '#2962FF', textSecond: '#929AA5' }
}
