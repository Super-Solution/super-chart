import type { EngineRenderOptions } from '@supersolutions/super-chart-core'

export type WorkspaceThemeName = 'dark' | 'light'
export type WorkspaceChromeKey = 'background' | 'text' | 'surface' | 'border' | 'divider' | 'danger'

/**
 * The CSS custom properties the workspace chrome (toolbars, search panel, notices) reads. Every one has a built-in
 * dark fallback, so nothing needs to be set. Set any of them on the host element or an ancestor to restyle the chrome,
 * or pass `theme` to `ChartWorkspace` for a ready-made set. The canvas colours are not CSS: use `chart.render`.
 */
export const WORKSPACE_CHROME_VARS: Readonly<Record<WorkspaceChromeKey, string>> = Object.freeze({
  background: '--super-chart-background',
  text: '--super-chart-text',
  surface: '--super-chart-surface',
  border: '--super-chart-border',
  divider: '--super-chart-divider',
  danger: '--super-chart-danger'
})

export interface WorkspaceTheme {
  /** Values for `WORKSPACE_CHROME_VARS`. */
  readonly chrome: Readonly<Record<WorkspaceChromeKey, string>>
  /** Canvas colours; the same shape as the matching `EngineRenderOptions` fields. */
  readonly render: Readonly<Required<Pick<EngineRenderOptions, 'background' | 'grid' | 'text' | 'up' | 'down' | 'line'>>>
}

/** `dark` is what the workspace looks like with no theme at all; `light` matches the chat plugin's light canvas. */
export const WORKSPACE_THEMES: Readonly<Record<WorkspaceThemeName, WorkspaceTheme>> = Object.freeze({
  dark: Object.freeze({
    chrome: Object.freeze({ background: '#10151d', text: '#d6deea', surface: '#17202c', border: '#40516b', divider: '#283444', danger: '#f4b8ae' }),
    render: Object.freeze({ background: '#10151d', grid: '#283444', text: '#aebcca', up: '#58c9ac', down: '#f28b82', line: '#8bafff' })
  }),
  light: Object.freeze({
    chrome: Object.freeze({ background: '#ffffff', text: '#1f2937', surface: '#f3f5f8', border: '#b8c2d1', divider: '#e3e8ef', danger: '#b42318' }),
    render: Object.freeze({ background: '#ffffff', grid: '#e6e9ee', text: '#3a4250', up: '#16a34a', down: '#dc2626', line: '#2962ff' })
  })
})

/** `var(--super-chart-*, <dark default>)` for inline chrome styles. */
export const chromeColor = (key: WorkspaceChromeKey): string => `var(${WORKSPACE_CHROME_VARS[key]},${WORKSPACE_THEMES.dark.chrome[key]})`
