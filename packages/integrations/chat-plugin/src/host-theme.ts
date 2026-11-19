// SPDX-License-Identifier: GPL-3.0-or-later
import type { HostTheme, ThemeToken } from '@supersolutions/super-protocol'

const CHROME: ReadonlyArray<[`--sc-${string}`, ThemeToken]> = [
  ['--sc-background', 'background'], ['--sc-toolbar-background', 'background'], ['--sc-panel-background', 'surface'],
  ['--sc-control-background', 'surface'], ['--sc-hover-background', 'surface-raised'], ['--sc-active-background', 'surface-raised'],
  ['--sc-text', 'text'], ['--sc-muted', 'text-muted'], ['--sc-hover-border', 'text-muted'],
  ['--sc-border', 'border'], ['--sc-control-border', 'border'], ['--sc-panel-border', 'border'],
  ['--sc-accent', 'accent'], ['--sc-focus', 'accent'], ['--sc-danger', 'negative'],
  ['--sc-font', 'font-sans'], ['--sc-radius', 'radius']
]

// The canvas derives translucent fills from these colours, which only works on six-digit hex.
const CANVAS: ReadonlyArray<['background' | 'grid' | 'text' | 'line' | 'up' | 'down', ThemeToken]> = [
  ['background', 'background'], ['grid', 'border'], ['text', 'text-muted'], ['line', 'text'], ['up', 'positive'], ['down', 'negative']
]
const HEX = /^#[0-9a-f]{6}$/i

export interface ChartHostLook {
  variables: Partial<Record<`--sc-${string}`, string>>
  render: Partial<Record<'background' | 'grid' | 'text' | 'line' | 'up' | 'down', string>>
}

/** The workspace variables and canvas colours for a host theme. A token the host did not send keeps the chart's own value. */
export function chartHostLook (theme: HostTheme | null): ChartHostLook {
  const look: ChartHostLook = { variables: {}, render: {} }
  if (theme === null) return look
  for (const [variable, token] of CHROME) {
    const value = theme.tokens[token]
    if (value !== undefined) look.variables[variable] = value
  }
  for (const [option, token] of CANVAS) {
    const value = theme.tokens[token]
    if (value !== undefined && HEX.test(value)) look.render[option] = value
  }
  return look
}
