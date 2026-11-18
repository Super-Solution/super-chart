// SPDX-License-Identifier: GPL-3.0-or-later
import type { CardMountContext, PluginTool } from '@supersolutions/super-protocol'

/**
 * The parts of `@supersolutions/super-protocol` 0.2.0 this plugin uses while the package still pins 0.1.0 from npm.
 * The shapes match 0.2.0 exactly. Once 0.2.0 is published, import them from the protocol and delete these copies.
 */
export type PluginToolAuthority = 'read' | 'draft' | 'act'
export type AuthorizedPluginTool = PluginTool & { authority: PluginToolAuthority, confirm?: boolean }

const THEME_TOKENS = ['background', 'surface', 'surface-raised', 'border', 'text', 'text-muted', 'accent', 'accent-contrast', 'positive', 'negative', 'warning', 'info', 'font-sans', 'font-mono', 'radius'] as const
type ThemeToken = typeof THEME_TOKENS[number]
export interface HostTheme { mode: 'light' | 'dark', tokens: Partial<Record<ThemeToken, string>> }
export type HostCardContext = CardMountContext & { hostTheme?: HostTheme }

const UNSAFE_VALUE = /[;{}<>\\]|\/\*|url\s*\(|expression\s*\(|@import/i
const isThemeValue = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '' && value.length <= 256 && !UNSAFE_VALUE.test(value)

/** Reads an untrusted theme: unknown tokens and unsafe values are dropped one by one; an unknown mode means no theme. */
export function readHostTheme (value: unknown): HostTheme | null {
  if (typeof value !== 'object' || value === null) return null
  const { mode, tokens } = value as { mode?: unknown, tokens?: unknown }
  if (mode !== 'light' && mode !== 'dark') return null
  const out: HostTheme['tokens'] = {}
  if (typeof tokens === 'object' && tokens !== null) {
    for (const token of THEME_TOKENS) {
      const candidate = (tokens as Record<string, unknown>)[token]
      if (isThemeValue(candidate)) out[token] = candidate.trim()
    }
  }
  return { mode, tokens: out }
}

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
