import type { EngineRenderOptions } from '@supersolutions/super-chart-core'
import { SUPER_CHART_COLORS, withAlpha } from './tokens'

export type WorkspaceThemeName = 'dark' | 'light'
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
function workspaceTheme (name: WorkspaceThemeName, panelShadow: string): WorkspaceTheme {
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
      colorScheme: name
    }),
    render: Object.freeze({ background: c.surface, grid: c.line, text: c.inkMuted, up: c.up, down: c.down, line: c.ink, theme: name })
  })
}

export const WORKSPACE_THEMES: Readonly<Record<WorkspaceThemeName, WorkspaceTheme>> = Object.freeze({
  dark: workspaceTheme('dark', '0 10px 30px rgba(0, 0, 0, 0.45)'),
  light: workspaceTheme('light', '0 10px 30px rgba(17, 17, 19, 0.12)')
})
