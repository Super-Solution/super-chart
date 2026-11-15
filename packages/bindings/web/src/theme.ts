import type { EngineRenderOptions } from '@supersolutions/super-chart-core'

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
  /** Canvas colours are explicit renderer values, independent of the DOM variables. */
  readonly render: Readonly<Required<Pick<EngineRenderOptions, 'background' | 'grid' | 'text' | 'up' | 'down' | 'line'>>>
}

/** Dark keeps the current workspace defaults; light also covers controls, menus and status surfaces. */
export const WORKSPACE_THEMES: Readonly<Record<WorkspaceThemeName, WorkspaceTheme>> = Object.freeze({
  dark: Object.freeze({
    chrome: Object.freeze({
      background: '#10151d',
      text: '#d6deea',
      surface: '#19232f',
      border: '#344150',
      divider: '#27313e',
      danger: '#f6a69e',
      toolbar: '#131b25',
      muted: '#94a3b8',
      hover: '#253444',
      hoverBorder: '#596b80',
      focus: '#77b6f5',
      accent: '#77b6f5',
      active: '#203146',
      panelBorder: '#43546a',
      panel: '#17212d',
      panelShadow: '0 10px 30px #0005',
      error: '#301e25',
      colorScheme: 'dark'
    }),
    render: Object.freeze({ background: '#10151d', grid: '#283444', text: '#aebcca', up: '#58c9ac', down: '#f28b82', line: '#8bafff' })
  }),
  light: Object.freeze({
    chrome: Object.freeze({
      background: '#ffffff',
      text: '#1f2937',
      surface: '#f3f5f8',
      border: '#b8c2d1',
      divider: '#e3e8ef',
      danger: '#b42318',
      toolbar: '#f8fafc',
      muted: '#526176',
      hover: '#e4ebf3',
      hoverBorder: '#71849c',
      focus: '#2962ff',
      accent: '#2459db',
      active: '#e5edff',
      panelBorder: '#b8c2d1',
      panel: '#ffffff',
      panelShadow: '0 10px 30px #10203022',
      error: '#fff0ee',
      colorScheme: 'light'
    }),
    render: Object.freeze({ background: '#ffffff', grid: '#e6e9ee', text: '#3a4250', up: '#16a34a', down: '#dc2626', line: '#2962ff' })
  })
})
