/** Size classes of the workspace chrome. Pure, so the thresholds are written down once and testable without a DOM. */
export type WorkspaceLayoutMode = 'auto' | 'regular' | 'compact' | 'narrow'
export type WorkspaceLayoutClass = Exclude<WorkspaceLayoutMode, 'auto'>
export type WorkspaceIntervalControl = 'auto' | 'bar' | 'select'

/**
 * Width of the workspace's own box, not the window's: a chart in a side panel can be any width. Below
 * `narrow` the chrome is a phone layout; below `compact` the labelled tools no longer fit beside each other.
 */
export const LAYOUT_BREAKPOINTS = Object.freeze({ narrow: 560, compact: 780 })

export function resolveLayout (mode: WorkspaceLayoutMode, width: number): WorkspaceLayoutClass {
  if (mode !== 'auto') return mode
  // Before the first measurement there is nothing to go on: keep the roomy layout rather than flash a small one.
  if (!(width > 0)) return 'regular'
  return width < LAYOUT_BREAKPOINTS.narrow ? 'narrow' : width < LAYOUT_BREAKPOINTS.compact ? 'compact' : 'regular'
}

/**
 * `auto` shows an interval bar unless the layout is narrow, or the bar does not fit beside the rest of the market bar
 * (`fits` false), where one dropdown takes less room. A bar that is cut off or scrolls out of sight is never shown.
 */
export function resolveIntervalControl (control: WorkspaceIntervalControl, layout: WorkspaceLayoutClass, fits = true): 'bar' | 'select' {
  return control === 'auto' ? (layout === 'narrow' || !fits ? 'select' : 'bar') : control
}

export function validLayoutMode (value: unknown): WorkspaceLayoutMode {
  if (value !== 'auto' && value !== 'regular' && value !== 'compact' && value !== 'narrow') throw new TypeError('Workspace layout must be "auto", "regular", "compact" or "narrow"')
  return value
}

export function validIntervalControl (value: unknown): WorkspaceIntervalControl {
  if (value !== 'auto' && value !== 'bar' && value !== 'select') throw new TypeError('Workspace intervals must be "auto", "bar" or "select"')
  return value
}
