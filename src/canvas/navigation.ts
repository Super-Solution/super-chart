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

// Chart-wide navigation: wheel (SC-097), keyboard (SC-096), the crosshair
// staying alive over the price axis (SC-107), and the legend icon cursor
// getting stuck on 'pointer' (SC-099). Pure decision functions are exported
// separately from the small `attach*` functions that wire them to a real
// klinecharts Chart, so the decisions are unit-testable without a canvas —
// the `attach*` functions touch the engine directly and are exercised by the
// e2e suite instead (see the note in crispLines.ts about runtime klinecharts
// imports and vitest's node environment).
//
// Part of SUPer-Chart (Apache-2.0).

// ---- wheel (SC-097) ---------------------------------------------------------

/** One wheel notch's next bar space (sign of `deltaY` only — magnitude does not matter, so trackpads and mice step the same amount), clamped to klinecharts' own [1, 50] range. */
export function nextBarSpace (barSpace: number, deltaY: number, min = 1, max = 50): number {
  if (deltaY === 0 || !Number.isFinite(barSpace)) {
    return barSpace
  }
  const factor = deltaY < 0 ? 1.1 : 1 / 1.1
  return Math.min(max, Math.max(min, barSpace * factor))
}

export type WheelMode = 'zoom' | 'modifier' | 'none'
export type WheelAction = 'zoom' | 'page-scroll' | 'passthrough'

/**
 * What a wheel event over the chart should do. `passthrough` means "do
 * nothing, let klinecharts (or the browser) handle it exactly as today" —
 * a horizontal-dominant wheel (trackpad scroll) is always passthrough, so
 * klinecharts keeps scrolling it.
 */
export function decideWheelAction (params: { deltaX: number, deltaY: number, mode: WheelMode, ctrlKey: boolean }): WheelAction {
  const { deltaX, deltaY, mode, ctrlKey } = params
  if (deltaY === 0 || Math.abs(deltaX) > Math.abs(deltaY)) {
    return 'passthrough'
  }
  if (mode === 'none') {
    return 'page-scroll'
  }
  if (mode === 'modifier' && !ctrlKey) {
    return 'page-scroll'
  }
  return 'zoom'
}

export interface WheelNavChart {
  getBarSpace: () => number
  setBarSpace: (space: number) => void
  isZoomEnabled: () => boolean
}

/**
 * One capture-phase, non-passive 'wheel' listener on the chart's own root
 * (never window/document, so a host input elsewhere on the page is
 * unaffected). It intercepts vertical wheel over the WHOLE chart — the main
 * pane, any y-axis and the x-axis alike — so scaling reaches 50 exactly and
 * the axes are no longer a dead zone that also blocks the page: klinecharts'
 * own listener (attached inside the root) never sees the event once this one
 * calls stopPropagation.
 */
export function attachWheelNavigation (root: HTMLElement, chart: WheelNavChart, getMode: () => WheelMode): () => void {
  const handler = (e: WheelEvent): void => {
    const action = decideWheelAction({ deltaX: e.deltaX, deltaY: e.deltaY, mode: getMode(), ctrlKey: e.ctrlKey })
    if (action === 'passthrough') {
      return
    }
    e.stopPropagation()
    if (action === 'page-scroll') {
      return // no preventDefault: the browser scrolls the page/container.
    }
    if (!chart.isZoomEnabled()) {
      e.preventDefault()
      return
    }
    e.preventDefault()
    chart.setBarSpace(nextBarSpace(chart.getBarSpace(), e.deltaY))
  }
  root.addEventListener('wheel', handler, { capture: true, passive: false })
  return () => { root.removeEventListener('wheel', handler, true) }
}

// ---- keyboard (SC-096) ------------------------------------------------------

export type NavKeyAction =
  | { kind: 'scroll', bars: number }
  | { kind: 'zoomIn' | 'zoomOut' | 'home' | 'end' | 'reset' }

/** Which navigation action (if any) a keydown maps to. Pure: no chart, no DOM. */
export function decideNavKey (e: { code: string, shiftKey: boolean, altKey: boolean, ctrlKey: boolean, metaKey: boolean, isComposing?: boolean }): NavKeyAction | null {
  if (e.ctrlKey || e.metaKey || e.isComposing === true) {
    return null
  }
  switch (e.code) {
    case 'ArrowLeft': return e.altKey ? null : { kind: 'scroll', bars: e.shiftKey ? 10 : 1 }
    case 'ArrowRight': return e.altKey ? null : { kind: 'scroll', bars: -(e.shiftKey ? 10 : 1) }
    case 'Equal': case 'NumpadAdd': return e.altKey ? null : { kind: 'zoomIn' }
    case 'Minus': case 'NumpadSubtract': return e.altKey ? null : { kind: 'zoomOut' }
    case 'Home': return e.altKey ? null : { kind: 'home' }
    case 'End': return e.altKey ? null : { kind: 'end' }
    case 'KeyR': return e.altKey ? { kind: 'reset' } : null
    default: return null
  }
}

export interface KeyNavChart {
  getDom: () => HTMLElement | null | undefined
  getBarSpace: () => number
  setBarSpace: (space: number) => void
  isZoomEnabled: () => boolean
  scrollByDistance: (distance: number) => void
  scrollToDataIndex: (index: number) => void
  scrollToRealTime: () => void
}

/**
 * A ChartKeyHandler (src/common/keyDispatcher.ts) for arrow/+/-/Home/End/
 * Alt+R chart navigation, registered at KEY_PRIORITY.CHART. It only acts
 * when the event's target is the klinecharts canvas container itself
 * (`chart.getDom()`) — never window or the chart's root — so it cannot steal
 * arrow keys from the period bar, a modal, or the drawing toolbar's grip,
 * which all live inside the same root but are not that element. Shift
 * multiplies the pan by 10; this also suppresses klinecharts' own (reversed)
 * Shift+Arrow scroll, because returning true stops the event from reaching
 * klinecharts' bubble-phase listener on the same element.
 */
export function makeKeyNavHandler (chart: KeyNavChart, getInitialBarSpace: () => number): (e: KeyboardEvent) => boolean {
  return (e: KeyboardEvent): boolean => {
    if (e.target !== chart.getDom()) {
      return false
    }
    const action = decideNavKey(e)
    if (action === null) {
      return false
    }
    switch (action.kind) {
      case 'scroll': chart.scrollByDistance(action.bars * chart.getBarSpace()); break
      case 'zoomIn': if (chart.isZoomEnabled()) chart.setBarSpace(nextBarSpace(chart.getBarSpace(), -1)); break
      case 'zoomOut': if (chart.isZoomEnabled()) chart.setBarSpace(nextBarSpace(chart.getBarSpace(), 1)); break
      case 'home': chart.scrollToDataIndex(0); break
      case 'end': chart.scrollToRealTime(); break
      case 'reset':
        if (chart.isZoomEnabled()) chart.setBarSpace(getInitialBarSpace())
        chart.scrollToRealTime()
        break
    }
    e.preventDefault()
    return true
  }
}

// ---- crosshair over the y-axis (SC-107) ------------------------------------

export interface Rect { left: number, top: number, width: number, height: number }

/** Whether (x, y) — page/client coordinates — falls inside `rect` (same units). */
export function pointInRect (x: number, y: number, rect: Rect): boolean {
  return x >= rect.left && x <= rect.left + rect.width && y >= rect.top && y <= rect.top + rect.height
}

export interface CrosshairChart {
  getDom: (paneId?: string, position?: 'main' | 'yAxis') => HTMLElement | null | undefined
  getSize: (paneId?: string, position?: 'main' | 'yAxis') => Rect | null | undefined
  /** klinecharts' private chart store (feature-detected; absent means this is a no-op). */
  getChartStore?: () => { getTooltipStore?: () => { setCrosshair?: (crosshair: unknown, options?: { notExecuteAction?: boolean }) => void } } | undefined
}

/**
 * klinecharts clears the crosshair whenever the pointer is over an axis
 * (every 9.x version), so the price/time label a user is reading disappears
 * exactly where they moved to read it precisely. This re-draws it: a
 * mousemove listener (added after klinecharts' own, so it runs after
 * klinecharts has cleared the crosshair) that puts it back when the pointer
 * is over a y-axis, using the last x seen in the candle pane. It never adds
 * a DOM element and never calls preventDefault, so drag-to-scale the axis is
 * unaffected. Best-effort: klinecharts has no public "set the crosshair"
 * call, so this reaches into the same private store `drawing-editor/compat.ts`
 * already reads for overlay selection; where that shape is missing, it is a
 * silent no-op rather than a throw.
 */
export function attachCrosshairOnYAxis (root: HTMLElement, chart: CrosshairChart, getPanes: () => readonly string[]): () => void {
  let lastMainX = 0
  const onMove = (e: MouseEvent): void => {
    const mainDom = chart.getDom('candle_pane', 'main')
    const mainRect = mainDom?.getBoundingClientRect()
    if (mainRect !== undefined && pointInRect(e.clientX, e.clientY, mainRect)) {
      lastMainX = e.clientX - mainRect.left
      return // inside the plot area: klinecharts already draws its own crosshair.
    }
    for (const paneId of getPanes()) {
      const dom = chart.getDom(paneId, 'yAxis')
      const rect = dom?.getBoundingClientRect()
      if (rect === undefined || rect === null || !pointInRect(e.clientX, e.clientY, rect)) {
        continue
      }
      const paneRect = chart.getDom(paneId, 'main')?.getBoundingClientRect()
      if (paneRect === undefined) {
        return
      }
      try {
        const store = chart.getChartStore?.()?.getTooltipStore?.()
        store?.setCrosshair?.({ x: lastMainX, y: e.clientY - paneRect.top, paneId }, { notExecuteAction: true })
      } catch { /* no such private store on this klinecharts version: no-op. */ }
      return
    }
  }
  root.addEventListener('mousemove', onMove)
  return () => { root.removeEventListener('mousemove', onMove) }
}

// ---- legend icon cursor stuck on 'pointer' (SC-099) ------------------------

export interface CursorResetChart {
  getDom: (paneId?: string, position?: 'main') => HTMLElement | null | undefined
  subscribeAction: (type: string, callback: (data: { paneId?: string }) => void) => void
  unsubscribeAction: (type: string, callback: (data: { paneId?: string }) => void) => void
}

/**
 * klinecharts sets the pane's cursor to 'pointer' while a legend icon (show/
 * hide/settings/close) is the active one, and never sets it back once the
 * pointer leaves the icon — it stays 'pointer' for the rest of the session.
 * `OnCrosshairChange` (public API) fires on every other pointer move in the
 * pane, so resetting there — and only from 'pointer' to 'crosshair', never
 * unconditionally, so a drawing-editor cursor is not overwritten — puts it
 * back the moment the pointer leaves the icon.
 */
// ---- scroll-to-latest visibility (SC-098) ----------------------------------

export interface LatestTrackChart {
  getVisibleRange: () => { to: number }
  getDataList: () => readonly unknown[]
}

/** True once the visible range reaches the newest bar (nothing to scroll forward to). */
export function isAtLatest (chart: LatestTrackChart): boolean {
  return chart.getVisibleRange().to >= chart.getDataList().length
}

export interface LatestTrackingChart extends LatestTrackChart {
  subscribeAction: (type: string, callback: () => void) => void
  unsubscribeAction: (type: string, callback: () => void) => void
}

/**
 * Tracks whether the "scroll to latest" ("»") button should show. Recomputed
 * on every action type in `actionTypes` (OnVisibleRangeChange/OnScroll/
 * OnZoom), and — because a host calling `unsubscribeAction(type)` with no
 * callback wipes every subscriber for that type, ours included — also on
 * `pointerup` and `wheel` on the chart root, so a drag or a wheel zoom still
 * updates the button even if that happens.
 */
export function attachLatestTracking (root: HTMLElement, chart: LatestTrackingChart, actionTypes: readonly string[], onChange: (atLatest: boolean) => void): () => void {
  const check = (): void => { onChange(isAtLatest(chart)) }
  actionTypes.forEach(type => { chart.subscribeAction(type, check) })
  root.addEventListener('pointerup', check)
  root.addEventListener('wheel', check, { passive: true })
  check()
  return () => {
    actionTypes.forEach(type => { chart.unsubscribeAction(type, check) })
    root.removeEventListener('pointerup', check)
    root.removeEventListener('wheel', check)
  }
}

export function attachCursorReset (chart: CursorResetChart, onCrosshairChangeType: string): () => void {
  const handler = (data: { paneId?: string }): void => {
    const el = data.paneId !== undefined ? chart.getDom(data.paneId, 'main') : null
    if (el !== null && el !== undefined && el.style.cursor === 'pointer') {
      el.style.cursor = 'crosshair'
    }
  }
  chart.subscribeAction(onCrosshairChangeType, handler)
  return () => { chart.unsubscribeAction(onCrosshairChangeType, handler) }
}
