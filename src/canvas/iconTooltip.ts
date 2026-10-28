/**
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at

 * http://www.apache.org/licenses/LICENSE-2.0

 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// SC-099's second half: the legend icons (visible/invisible/setting/close,
// see LEGEND_ICONS in chart-theme.ts) are bare icomoon glyphs drawn on the
// canvas, with no native title. klinecharts has no public event for "the
// pointer is over icon X" — only a private per-instance active-icon getter,
// named getActiveIcon in 9.8.x and getActiveIconInfo in 9.1.x, feature-
// detected here in the same defensive style as drawing-editor/compat.ts.
// There is likewise no public API for an icon's own geometry, so the
// tooltip follows the pointer instead of anchoring to the icon's rect.
//
// Part of SUPer-Chart (Apache-2.0).

interface ActiveIconLike { id?: unknown }
interface TooltipStoreLike {
  getActiveIcon?: () => ActiveIconLike | null | undefined
  getActiveIconInfo?: () => ActiveIconLike | null | undefined
}

/** The id of the tooltip icon the pointer is currently over, or null when it is over none (or the lookup fails). */
export function activeIconId (ts: TooltipStoreLike | null | undefined): string | null {
  if (ts == null) {
    return null
  }
  try {
    const info = ts.getActiveIcon?.() ?? ts.getActiveIconInfo?.() ?? null
    return typeof info?.id === 'string' && info.id.length > 0 ? info.id : null
  } catch {
    return null
  }
}

/** Reads the chart's own tooltip store through its private getters. Returns null instead of throwing when any step of the walk is missing or fails. */
export function tooltipStoreOf (chart: unknown): TooltipStoreLike | null {
  try {
    const getChartStore = (chart as { getChartStore?: () => unknown } | null)?.getChartStore
    if (typeof getChartStore !== 'function') {
      return null
    }
    const chartStore = getChartStore.call(chart) as { getTooltipStore?: () => unknown } | null
    const getTooltipStore = chartStore?.getTooltipStore
    if (typeof getTooltipStore !== 'function') {
      return null
    }
    const store = getTooltipStore.call(chartStore) as TooltipStoreLike | null
    return store !== null && typeof store === 'object' ? store : null
  } catch {
    return null
  }
}

/** LEGEND_ICONS' ids (chart-theme.ts) to their i18n key. */
const ICON_LABEL_KEYS: Readonly<Record<string, string>> = {
  visible: 'legend_icon_show',
  invisible: 'legend_icon_hide',
  setting: 'legend_icon_settings',
  close: 'legend_icon_remove'
}

/** The i18n key for an icon id, or null for null or an id this tooltip has no label for. */
export function iconLabelKey (id: string | null): string | null {
  return id === null ? null : (ICON_LABEL_KEYS[id] ?? null)
}

export interface IconTooltipOptions {
  translate: (key: string) => string
  /** Offset from the pointer, in CSS pixels. @default 14, 16 */
  offset?: { x: number, y: number }
}

/**
 * Shows a small DOM label next to the pointer while it is over a legend
 * icon klinecharts recognises (see ICON_LABEL_KEYS). `root` must be an
 * ancestor of klinecharts' own chart container (e.g. the node passed to
 * `init()`); the listener is bubble-phase and default (not capture), so it
 * runs after klinecharts' own mousemove handler has updated the active icon
 * for this move, matching SC-099's corrected fix.
 */
export function attachIconTooltip (root: HTMLElement, chart: unknown, options: IconTooltipOptions): () => void {
  const doc = root.ownerDocument
  const el = doc.createElement('div')
  el.className = 'klinecharts-pro-icon-tooltip'
  el.style.display = 'none'
  root.appendChild(el)
  const offset = options.offset ?? { x: 14, y: 16 }

  const hide = (): void => {
    el.style.display = 'none'
  }
  const onMove = (e: MouseEvent): void => {
    const key = iconLabelKey(activeIconId(tooltipStoreOf(chart)))
    if (key === null) {
      hide()
      return
    }
    el.textContent = options.translate(key)
    const box = root.getBoundingClientRect()
    el.style.left = `${e.clientX - box.left + offset.x}px`
    el.style.top = `${e.clientY - box.top + offset.y}px`
    el.style.display = ''
  }
  root.addEventListener('mousemove', onMove)
  root.addEventListener('mouseleave', hide)
  return () => {
    root.removeEventListener('mousemove', onMove)
    root.removeEventListener('mouseleave', hide)
    el.remove()
  }
}
