import type { EngineRenderOptions } from '@supersolutions/super-chart-core'
import { ENGINE_RENDER_THEMES } from '@supersolutions/super-chart-core'
import { SUPER_CHART_COLORS, baseTheme, withAlpha, type ThemeName } from './tokens'

/**
 * The built-in presets are `dark` and `light` plus their colour-vision-safe twins `dark-colorblind` and
 * `light-colorblind` (blue/orange candles); hosts add more with `registerWorkspaceTheme`.
 */
export type WorkspaceThemeName = 'dark' | 'light' | 'dark-colorblind' | 'light-colorblind' | (string & Record<never, never>)
export type WorkspaceChromeKey = 'background' | 'text' | 'surface' | 'border' | 'divider' | 'danger' | 'toolbar' | 'muted' | 'hover' | 'hoverBorder' | 'focus' | 'accent' | 'active' | 'panelBorder' | 'panel' | 'panelShadow' | 'error' | 'colorScheme'

/** The existing scoped workspace variables; host styles and `ui.variables` use these same names. */
export const WORKSPACE_CHROME_VARS: Readonly<Record<WorkspaceChromeKey, string>> = Object.freeze({
  background: '--sc-background',
  text: '--sc-text',
  surface: '--sc-control-background',
  border: '--sc-control-border',
  divider: '--sc-border',
  danger: '--sc-danger',
  toolbar: '--sc-toolbar-background',
  muted: '--sc-muted',
  hover: '--sc-hover-background',
  hoverBorder: '--sc-hover-border',
  focus: '--sc-focus',
  accent: '--sc-accent',
  active: '--sc-active-background',
  panelBorder: '--sc-panel-border',
  panel: '--sc-panel-background',
  panelShadow: '--sc-panel-shadow',
  error: '--sc-error-background',
  colorScheme: '--sc-color-scheme'
})

export interface WorkspaceTheme {
  /** Values for `WORKSPACE_CHROME_VARS`. */
  readonly chrome: Readonly<Record<WorkspaceChromeKey, string>>
  /**
   * Canvas colours are explicit renderer values, independent of the DOM variables. `theme` picks the rest of the
   * canvas tokens (flat candles, indicator slots, volume and zone fills, tags) from the same design-system set.
   */
  readonly render: Readonly<Required<Pick<EngineRenderOptions, 'background' | 'grid' | 'text' | 'up' | 'down' | 'line' | 'theme'>>>
}

/** Both presets are the Super Chart design tokens (./tokens.ts), so the chrome and the canvas share one source. */
function workspaceTheme (name: ThemeName, panelShadow: string): WorkspaceTheme {
  const c = SUPER_CHART_COLORS[name]
  return Object.freeze({
    chrome: Object.freeze({
      background: c.surface,
      text: c.ink,
      surface: c.surface,
      border: c.lineStrong,
      divider: c.line,
      danger: c.danger,
      toolbar: c.surface,
      muted: c.inkMuted,
      hover: c.surfaceSunken,
      hoverBorder: c.inkMuted,
      focus: c.violetStrong,
      accent: c.violetStrong,
      active: c.violetTint,
      panelBorder: c.line,
      panel: c.surface,
      panelShadow,
      error: withAlpha(c.danger, 0.1),
      colorScheme: baseTheme(name)
    }),
    render: Object.freeze({ background: c.surface, grid: c.line, text: c.inkMuted, up: c.up, down: c.down, line: c.ink, theme: name })
  })
}

/** The built-in presets. Use `getWorkspaceTheme` to also reach presets a host registered. */
export const WORKSPACE_THEMES: Readonly<Record<'dark' | 'light' | 'dark-colorblind' | 'light-colorblind', WorkspaceTheme>> = Object.freeze({
  dark: workspaceTheme('dark', '0 10px 30px rgba(0, 0, 0, 0.45)'),
  light: workspaceTheme('light', '0 10px 30px rgba(17, 17, 19, 0.12)'),
  'dark-colorblind': workspaceTheme('dark-colorblind', '0 10px 30px rgba(0, 0, 0, 0.45)'),
  'light-colorblind': workspaceTheme('light-colorblind', '0 10px 30px rgba(17, 17, 19, 0.12)')
})

const registry = new Map<string, WorkspaceTheme>(Object.entries(WORKSPACE_THEMES))
const BUILT_IN_THEMES = new Set(Object.keys(WORKSPACE_THEMES))
const THEME_NAME = /^[a-z][a-z0-9-]{0,63}$/

export interface WorkspaceThemeInput {
  /** Start from this preset (`dark` or `light` unless the host registered others). Default `dark`. */
  readonly extends?: WorkspaceThemeName
  /** Chrome variable values to override, by `WORKSPACE_CHROME_VARS` key. */
  readonly chrome?: Readonly<Partial<Record<WorkspaceChromeKey, string>>>
  /** Canvas colours to override. `theme` picks the base token set for everything not listed (`dark`, `light` or a `-colorblind` set). */
  readonly render?: Readonly<Partial<WorkspaceTheme['render']>>
}

/**
 * Register a named preset that `theme`, `setTheme` and the command palette can use. A preset is derived from an
 * existing one, so a brand theme is a few colours, not a full copy:
 * `registerWorkspaceTheme('gold', { extends: 'dark', chrome: { accent: '#d4af37' }, render: { up: '#c9a227' } })`.
 * The built-in names `dark` and `light` cannot be replaced. Registering an existing custom name replaces it.
 */
export function registerWorkspaceTheme (name: string, input: WorkspaceThemeInput): WorkspaceTheme {
  if (typeof name !== 'string' || !THEME_NAME.test(name)) throw new TypeError('A theme name is lowercase letters, digits and hyphens, starting with a letter')
  if (BUILT_IN_THEMES.has(name)) throw new RangeError('The built-in themes dark, light, dark-colorblind and light-colorblind cannot be replaced')
  if (input === null || typeof input !== 'object') throw new TypeError('Theme input must be an object')
  const base = registry.get(input.extends ?? 'dark')
  if (base === undefined) throw new RangeError(`Unknown base theme ${JSON.stringify(input.extends)}`)
  for (const [group, values] of [['chrome', input.chrome], ['render', input.render]] as const) {
    for (const [key, value] of Object.entries(values ?? {})) {
      if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`Theme ${group}.${key} must be a nonempty string`)
    }
  }
  for (const key of Object.keys(input.chrome ?? {})) if (!(key in WORKSPACE_CHROME_VARS)) throw new RangeError(`Unknown chrome key ${JSON.stringify(key)}`)
  if (input.render?.theme !== undefined && !(ENGINE_RENDER_THEMES as readonly unknown[]).includes(input.render.theme)) throw new RangeError(`render.theme must be one of ${ENGINE_RENDER_THEMES.join(', ')}`)
  const theme: WorkspaceTheme = Object.freeze({
    chrome: Object.freeze({ ...base.chrome, ...input.chrome }),
    render: Object.freeze({ ...base.render, ...input.render })
  })
  registry.set(name, theme)
  return theme
}

/** Preset by name, or undefined when none was registered under it. */
export function getWorkspaceTheme (name: string): WorkspaceTheme | undefined { return registry.get(name) }

/** Names of the presets that can be selected now: the two built-ins, then registered ones. */
export function listWorkspaceThemes (): string[] { return [...registry.keys()] }
