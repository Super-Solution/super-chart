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

import { createSignal, createEffect, createMemo, on, onMount, Show, onCleanup, startTransition, batch, type Component } from 'solid-js'
import { render } from 'solid-js/web'

import {
  init, dispose, utils, registerOverlay, type Nullable, type Chart, type OverlayMode, type Styles,
  ActionType, type PaneOptions, type Indicator, DomPosition, FormatDateType, type OverlayCreate, type OverlayEvent
} from 'klinecharts'

import { deepClone, getPath, setPath } from './common/object'

import { type SelectDataSourceItem } from './component'
import { DataStateLayer } from './component/loading'

import {
  PeriodBar, DrawingBar, IndicatorModal, TimezonePicker, SettingModal,
  ScreenshotModal, IndicatorSettingModal, SymbolSearchModal, DrawingToolbar, ScaleControls, ObjectsPanel
} from './widget'
import type { ObjectsPanelRow } from './widget/objects-panel'

import { DrawingEditor, addHostOverlay, type DrawingSnapshot, type ContextMenuState } from './drawing-editor/controller'
import { paneIdOf, drawingInProgress, progressInstanceId } from './drawing-editor/compat'
import { boundsOfPoints, inflateRect, unionRect, type Point2, type Rect, type Segment, type ToolbarAvoid } from './drawing-editor/geometry'
import { drawnLines } from './drawing-editor/extent'
import DrawingContextMenu from './drawing-editor/contextMenu'
import TextEditor, { defaultTextFor, isImageTool, isTextTool } from './drawing-editor/textEditor'
import { TOOLBAR_LABELS } from './drawing-editor/labels'

import { createRecentsStore } from './widget/symbol-search-modal/nav'
import { buildSnapshotResult, resolveScreenshotBackground, resolveSnapshotOptions, screenshotFilename } from './widget/screenshot-modal/snapshot'

import { createWatermark } from './watermark'
import { resolveHeaderSlot } from './headerSlot'
import { resolveIndicatorName } from './indicators/aliases'
import { readIndicators, findIndicator, ownerKey, type IndicatorSnapshot } from './indicators/state'
import { getIndicatorCatalog, getDrawingToolCatalog, addIndicatorCatalogEntries, setIndicatorCatalog, catalogEntryFor } from './indicators/catalog'
import { StyleStack } from './theme/styleStack'
import {
  accentOf, canvasTokens, chartTypeStyles, fontsLoaded, initLayers, resolveCanvasFont, resolveChromeTokens, themeLayers
} from './theme/engine'
import type { EngineContext } from './theme/engine'

import { buildChartContext, ChartContextOptions, ChartContext } from './ai'
import { SuperChartEventBus, SuperChartEventMap, SuperChartEventType } from './api/events'
import { buildChartState, buildLoadState, ChartStateV1, LoadState } from './api/state'
import { createChartData } from './data/chartData'
import { parsePeriod, resolvePeriod, sameSymbol, samePeriod } from './data/keys'
import { resolvePricePrecision } from './data/precision'
import { formatBarDate } from './time/formatBarDate'
import { localTz, resolveTz } from './time/resolveTz'

import i18n, { format, resolveLocale, supportedLocales } from './i18n'
import { ensureCanvasLocale } from './i18n/canvas'
import { formatBigNumber } from './i18n/numbers'
import { setDrawingLabelSource } from './extension/labels'
import { timezoneLabel } from './widget/timezone-modal/data'
import { chartTypeLabel, loadFavourites, saveFavourites } from './common/chartTypes'

import { createCandleLegend } from './canvas/legend'
import { COLLAPSED_PANE_HEIGHT, layoutPaneHeights, MIN_SUB_PANE_HEIGHT } from './canvas/paneLayout'
import { attachBarCountdown } from './canvas/countdown'
import { attachIconTooltip } from './canvas/iconTooltip'
import {
  attachCrosshairOnYAxis, attachCursorReset, attachLatestTracking, makeKeyNavHandler
} from './canvas/navigation'
import { createReplayController, ReplayBar } from './replay'

// ---- SC-NEXT: motion, price-axis tags, the UTC/local clock and the chart
// types with no native klinecharts equivalent -------------------------------
import { prefersReducedMotion } from './motion/easing'
import { attachWheelZoom } from './motion/wheelZoomMotion'
import { attachInertialPan } from './motion/inertialPan'
import { klineInertiaChart, klinePlotTarget, klineWheelChart, type KlineMotionChartLike } from './motion/klineAdapters'
import { attachFrameLoop, type FrameLoop } from './canvas/frameLoop'
import { attachStickyAxisWidth, type StickyAxisWidth } from './canvas/stickyAxisWidth'
import { attachHighLowTags } from './canvas/highLowTags'
import { attachClockWidget, type ClockMode } from './canvas/clockWidget'
import { attachCustomSeriesOverlay, isCustomSeriesKind, type CustomSeriesKind } from './charttypes/customSeriesOverlay'
import { triggerFadeIn } from './motion/fadeIn'

import {
  type SymbolInfo, type Period, type ChartProOptions, type ChartPro, type LoadResult, GetBarsOptions, isChartType,
  type ChartType, CHART_TYPES, type LayoutMode, type SizeClass, isLayoutMode, LAYOUT_MODES,
  type IndicatorHandle, type AddIndicatorOptions, type IndicatorChangeEvent,
  type PriceScale, type PriceScaleType, type ReplayState, type SnapshotOptions, type SnapshotResult
} from './types'

import { createChartScope, ChartScopeContext } from './common/chartScope'
import { KEY_PRIORITY, isEscape, hasCommandModifier, isTextEntryTarget } from './common/keyDispatcher'
import { attachHoldFocusBoundary, isHoldControlTarget, isHoldKeyTarget } from './draw-by-holding/focus'
import { resolveParts } from './layout/parts'
import { observeSize } from './layout/observeSize'
import { CHART_TYPE_KEY } from './widget/setting-modal/data'
import { createDrawingBarState } from './widget/drawing-bar/state'
import { chartHotkeyAction } from './drawing-editor/keyboard'

// ---- AI/MCP command layer, drawings/annotations/layout APIs, future-time
// and replay anchoring (SC-121/123/127/128/135/178/180) --------------------
import { createAnnotationsApi, type AnnotationsRawChart } from './api/annotations'
import { createDrawingCrossWatcher, createDrawingsApi, type DrawingsRawChart } from './api/drawings'
import { installReplayFutureAnchor } from './api/anchors'
import {
  applyLayout, buildLayout, readPersistedLayout, writePersistedLayout,
  type ApplyLayoutOptions, type ApplyLayoutResult, type ChartLayoutV1, type LayoutApiDeps
} from './api/layout'
import { execute as executeCommand, getCommands as getCommandRegistry, toToolDefinitions as buildToolDefinitions, type CommandBindingDeps } from './commands/bind'
import type { CommandDescriptor } from './commands/schema'
import CommandPalette from './commands/palette'
import { createHoldController, type HoldStatus } from './draw-by-holding/controller'
import { attachHoldGuide } from './draw-by-holding/guide'
import { scribbleHitsDrawing } from './draw-by-holding/hitTest'
import { createHoldNavigation } from './draw-by-holding/navigation'
import { createHoldCompatibility } from './draw-by-holding/compatibility'
import { prepareNativeHold, supportsNativeHold } from './draw-by-holding/klineCompatibility'
import { preferAxisRay, snapHorizontalWick } from './draw-by-holding/context'
import type { DrawingCandidate, Point } from './draw-by-holding/recognizer'

export interface ChartProComponentProps extends Required<Omit<ChartProOptions, 'container' | 'indicatorMenu'>> {
  ref: (chart: ChartPro) => void
  /** The engine's own root element (src/layout/hostRoot.ts). */
  root: HTMLElement
  /** Optional, unlike every other option here: 'show everything catalogued' has to be a real, distinct default from 'show nothing'. */
  indicatorMenu?: ChartProOptions['indicatorMenu']
}

// VOL pane defaults (SC-045): no MA lines, a shorter pane, and enough top gap
// to clear the legend. klinecharts turns a pixel gap into a *ratio*
// (gapPx / paneHeight) and applies it to the data range, so the clear space
// under the legend is only gapPx*(H+2)/(H+gapPx+2) of a pixel gap — measured
// (scratchpad/sc-opt/verify-vol-pane-heavy) at 46px this clears the legend's
// ~21-27px on both klinecharts 9.1.1 and 9.8.12 at the 72px pane height
// below; 22px (a literal "leave 22px of gap") does not.
//
// Colour is deliberately left alone: the corrected fix's own 45%-alpha
// instance style would freeze VOL's bar colour at whatever candle.bar was
// at creation time, immune to any setStyles/theme change afterwards — a
// real regression against the existing "VOL bars follow the current theme"
// guarantee (e2e/tests/theme.spec.ts). VOL keeps whatever the current
// global `indicator.bars` styling is, same as any other bar indicator
// (MACD included); the engine's own canvasTheme already draws those at 65%
// alpha (src/theme/tokens.ts's upBar/downBar), so VOL is not the heavy,
// fully opaque look the finding measured — it just is not uniquely lighter
// than MACD in this iteration.
const VOL_PANE_HEIGHT = 72
const VOL_PANE_TOP_GAP = 46

function createIndicator (widget: Nullable<Chart>, indicatorName: string, isStack?: boolean, paneOptions?: PaneOptions): Nullable<string> {
  const create: Record<string, unknown> = {
    name: indicatorName,
    createTooltipDataSource: ({ indicator, defaultStyles }: { indicator: Indicator, defaultStyles: Styles['indicator'] }) => {
      const icons = []
      if (indicator.visible) {
        icons.push(defaultStyles.tooltip.icons[1])
        icons.push(defaultStyles.tooltip.icons[2])
        icons.push(defaultStyles.tooltip.icons[3])
      } else {
        icons.push(defaultStyles.tooltip.icons[0])
        icons.push(defaultStyles.tooltip.icons[2])
        icons.push(defaultStyles.tooltip.icons[3])
      }
      return { icons }
    }
  }
  let options = paneOptions
  if (indicatorName === 'VOL') {
    // Every VOL pane the Pro chrome creates gets this — the default, an
    // explicit subIndicators ['VOL'], and one added from the Indicator
    // modal — never a global re-registration (SupWallet's raw
    // getChart().createIndicator('VOL') keeps klinecharts' own [5,10,20]).
    create.calcParams = []
    options = { height: VOL_PANE_HEIGHT, gap: { top: VOL_PANE_TOP_GAP, bottom: 2 }, ...paneOptions }
  }
  // @ts-expect-error create is built up conditionally above.
  return widget?.createIndicator(create, isStack, options) ?? null
}

/**
 * Sub-pane height policy (SC-159): keeps the candle pane at least ~55% of
 * the chart when sub-panes would otherwise squeeze it to a sliver or 0px.
 * Reads every sub-pane's *current* height as its "preferred" height, so a
 * user's manual drag is treated as the new preference on the next resize or
 * indicator change (an approximation of "keep the dragged ratio" that needs
 * no fragile per-version drag-event payload reading — see SC-159's
 * corrected fix for why that path is brittle across klinecharts versions).
 * Only the panes the engine created (mainIndicators/subIndicators, the
 * Indicator modal) are covered — a host's own `getChart().createIndicator`
 * pane is not wrapped in this iteration (out of scope here; disclosed in the
 * PR body).
 */
function layoutPanes (widget: Nullable<Chart>, subIndicatorPaneIds: readonly string[], mode: 'auto' | 'fixed'): void {
  if (widget === null || mode === 'fixed' || subIndicatorPaneIds.length === 0) {
    return
  }
  const candleHeight = widget.getSize('candle_pane', DomPosition.Main)?.height ?? 0
  const heights = subIndicatorPaneIds.map(id => widget.getSize(id, DomPosition.Main)?.height ?? 100)
  const paneArea = candleHeight + heights.reduce((sum, h) => sum + h, 0)
  if (paneArea <= 0) {
    return
  }
  // Most-recently-added collapses first: later panes get a lower priority number.
  const specs = subIndicatorPaneIds.map((id, i) => ({ id, preferredHeight: heights[i], priority: subIndicatorPaneIds.length - 1 - i }))
  const result = layoutPaneHeights(paneArea, specs)
  for (const pane of result.subPanes) {
    widget.setPaneOptions({ id: pane.id, height: pane.height, minHeight: pane.collapsed ? COLLAPSED_PANE_HEIGHT : MIN_SUB_PANE_HEIGHT })
  }
}

let instanceSeq = 0

const ChartProComponent: Component<ChartProComponentProps> = props => {
  // eslint-disable-next-line prefer-const -- Solid's `ref={widgetRef}` JSX binding assigns
  // this at mount, invisibly to eslint's static analysis; `const` would make that a crash.
  let widgetRef: HTMLDivElement | undefined = undefined
  // eslint-disable-next-line prefer-const -- same as widgetRef above.
  let contentRef: HTMLDivElement | undefined
  let widget: Nullable<Chart> = null
  let holdController: ReturnType<typeof createHoldController> | null = null
  let holdGuide: ReturnType<typeof attachHoldGuide> | null = null
  let holdMutation = false
  // 2026-09-28: every repaint of this chart's canvas layers, and the motion
  // that moves it, run in one frame (src/canvas/frameLoop.ts); the price axis
  // only grows while the chart moves (src/canvas/stickyAxisWidth.ts).
  let frameLoop: FrameLoop | null = null
  let stickyAxis: StickyAxisWidth | null = null
  let resizeObserver: ResizeObserver | undefined
  // The id the chart's aria-describedby points at (one per chart instance,
  // several charts on a page never collide).
  const descriptionId = `klinecharts-pro-desc-${++instanceSeq}`

  // SC-NEXT #4: resolved once (a host's element/factory, not a reactive
  // option — same treatment as watermark), handed to PeriodBar to mount in
  // the top bar in place of the built-in symbol button.
  const headerSlotNode = resolveHeaderSlot(props.headerSlot)
  let priceUnitDom: HTMLElement
  let legendInstalledByUs = false
  let disposeScaleControls: (() => void) | null = null
  let goToLatestButton: HTMLButtonElement | null = null
  // SC-NEXT #2: outer-scope like goToLatestButton, above — assigned inside
  // onMount (once widget exists) but read from the chartType effect, which
  // runs after onMount's own scope has closed.
  let customSeriesOverlay: ReturnType<typeof attachCustomSeriesOverlay> | null = null
  // Captured once, right after mount (SC-096/SC-098's Alt+R / resetView): the
  // engine's own default differs by klinecharts version (6 on 9.1.1, 8 on
  // 9.8.12), so this is never a hardcoded constant.
  let initialBarSpace = 8

  // SC-003: widget.resize() at 0x0 (a chart hidden with display:none, or
  // between mounting and its first layout) loses the user's scroll position
  // (klinecharts re-derives it from the now-zero width). Shared by the
  // window-resize fallback, the ResizeObserver and the public resize().
  const safeResize = (): void => {
    const rect = widgetRef?.getBoundingClientRect()
    if (rect !== undefined && (rect.width === 0 || rect.height === 0)) {
      return
    }
    widget?.resize()
  }

  const [theme, setTheme] = createSignal(props.theme)
  const [locale, setLocaleSignal] = createSignal(resolveLocale(props.locale))
  // A host may pass a tag the chart has no strings for (e.g. setLocale('fr-FR')
  // or a raw navigator tag); resolve it the same way the bare-chart default
  // does, so the chrome never shows raw keys.
  const setLocale = (l: string): void => { setLocaleSignal(resolveLocale(l)) }

  // An identical symbol changes nothing; what refetches is decided in src/data/chartData.
  const [symbol, setSymbol] = createSignal(props.symbol, { equals: sameSymbol })
  const [period, setPeriodSignal] = createSignal(props.period)
  const setPeriod = (p: Period | string): void => {
    const resolved = resolvePeriod(p, periods())
    if (resolved !== null) {
      setPeriodSignal(resolved)
    }
  }
  // The one owner of the chart type (SC-124): the top bar, Settings, the
  // host's setStyles({ candle: { type } }) and setChartType all set this.
  // Applied on every set, even to the same type, so no click is ever dead.
  const [chartType, setChartType] = createSignal<ChartType>(props.chartType, { equals: false })
  const applyChartType = (type: unknown, source: 'user' | 'api' = 'api'): boolean => {
    if (!isChartType(type)) {
      console.warn(`[super-chart] unknown chart type ${JSON.stringify(type)}; expected one of ${CHART_TYPES.join(', ')}. Keeping '${chartType()}'.`)
      return false
    }
    const changed = type !== chartType()
    setChartType(type)
    if (changed) {
      events.emit('chartTypeChange', { chartType: type, source })
      scheduleLayoutChange()
    }
    return true
  }
  // SC-NEXT #2: the grouped chart-type menu's starred types, persisted per
  // browser (not per instance — a host may mount more than one chart).
  const storageOrUndefined = typeof localStorage !== 'undefined' ? localStorage : undefined
  const [favouriteChartTypes, setFavouriteChartTypes] = createSignal(loadFavourites(storageOrUndefined))
  const toggleFavouriteChartType = (type: ChartType): void => {
    setFavouriteChartTypes(prev => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type); else next.add(type)
      saveFavourites(storageOrUndefined, next)
      return next
    })
  }
  // SC-NEXT #3: the UTC/local clock toggle's chosen mode, persisted the same way.
  const [clockMode, setClockMode] = createSignal<ClockMode>(
    (storageOrUndefined?.getItem('klinecharts-pro-clock-mode') === 'local' ? 'local' : 'utc')
  )
  // Chrome shape (SC-126, SC-085): parts, the layout mode, the size class.
  const [parts, setParts] = createSignal(resolveParts(props.parts))
  const [layoutMode, setLayoutMode] = createSignal<LayoutMode>(props.layout)
  const [sizeClass, setSizeClass] = createSignal<SizeClass>(props.layout === 'auto' ? 'regular' : props.layout)
  const barShown = (): boolean => !props.headless && parts().toolbar
  const [periods, setPeriods] = createSignal(props.periods)
  const [indicatorModalVisible, setIndicatorModalVisible] = createSignal(false)

  // ---- Indicators (v2, additive — SC-114) ------------------------------------
  // No shadow list: the picker, getIndicators() and the settings modal all read
  // the chart itself (readIndicators, src/indicators/state.ts). `ownedIndicators`
  // is the one thing the chart cannot answer on its own — "did the engine put
  // this here, or a host?" — so it is the only bookkeeping kept on the side.
  // `indicatorsVersion` forces a re-read after any engine-driven change; it is
  // also bumped when the picker opens, since there is no klinecharts event for
  // a host adding an indicator through getChart().
  const ownedIndicators = new Set<string>()
  const [indicatorsVersion, bumpIndicators] = createSignal(0)
  const indicators = (): IndicatorSnapshot[] => { indicatorsVersion(); return readIndicators(widget, ownedIndicators) }
  // The v1 describe()/chartSummary() indicator list: engine-owned only (a
  // host-created indicator was never in the old mainIndicators/subIndicators
  // signals this replaces), main pane first — same shape as before SC-114.
  const engineIndicatorNames = (): string[] => {
    const engineOwned = indicators().filter(i => i.owner === 'engine')
    const main = engineOwned.filter(i => i.paneId === 'candle_pane').map(i => i.name)
    const sub = engineOwned.filter(i => i.paneId !== 'candle_pane').map(i => i.name)
    return [...main, ...sub]
  }
  const indicatorListeners = new Set<(e: IndicatorChangeEvent) => void>()
  const notifyIndicators = (event: IndicatorChangeEvent): void => {
    bumpIndicators(v => v + 1)
    indicatorListeners.forEach(fn => { fn(event) })
    scheduleLayoutChange()
    // Bridge to the v1 discrete events (SC-108, on()/off()): a host already
    // listening for indicatorAdd/indicatorRemove must keep hearing about
    // every add/remove made through the v2 indicator API (addIndicator,
    // the picker, a tooltip icon), not only the old onMainIndicatorChange/
    // onSubIndicatorChange path this batch replaces. 'updated' (visibility,
    // params) has no v1 event to bridge to.
    if (event.type === 'added' || event.type === 'removed') {
      const pane = event.paneId === 'candle_pane' ? 'main' : 'sub'
      events.emit(event.type === 'added' ? 'indicatorAdd' : 'indicatorRemove', { name: event.name, pane, paneId: event.paneId, source: event.source })
    }
  }
  // Insertion order of engine-owned sub-pane ids, for the pane layout policy
  // (SC-159): later added collapses first when panes do not all fit. Derived
  // from the live v2 snapshot (indicators(), SC-114) rather than a signal of
  // its own — widget.getIndicatorByPaneId()'s own Map iteration order is
  // pane-creation order, so this needs no separate bookkeeping.
  const subIndicatorPaneIds = createMemo(() => {
    const ids: string[] = []
    for (const ind of indicators()) {
      if (ind.owner === 'engine' && ind.paneId !== 'candle_pane' && !ids.includes(ind.paneId)) {
        ids.push(ind.paneId)
      }
    }
    return ids
  })
  const relayoutPanes = (): void => { layoutPanes(widget, subIndicatorPaneIds(), props.paneLayout) }

  const [timezoneModalVisible, setTimezoneModalVisible] = createSignal(false)
  // SC-033/SC-129: only the zone id is state, always a valid IANA id (or the
  // UTC sentinel) resolved through resolveTz — never a snapshot label, and
  // never echoing an unresolved constructor prop back as "current". Labels
  // are worked out from the id and the locale wherever they are shown, so
  // they can never go stale.
  const [timezone, setTimezoneKey] = createSignal(resolveTz(props.timezone) ?? localTz())
  let timezoneAnchorEl: HTMLElement | null | undefined

  const [settingModalVisible, setSettingModalVisible] = createSignal(false)
  const [widgetDefaultStyles, setWidgetDefaultStyles] = createSignal<Styles>()

  const [screenshotUrl, setScreenshotUrl] = createSignal('')
  const [screenshotName, setScreenshotName] = createSignal('screenshot.png')

  // The price axis scale corner (SC-116): mirrors widget.getStyles().yAxis,
  // resynced after every setStyles call that could touch it (Settings, a
  // host's own setStyles, the corner's own buttons) since klinecharts has no
  // change event for it.
  const [priceScale, setPriceScaleSignal] = createSignal<PriceScale>({ type: 'normal', reverse: false })
  const syncPriceScale = (): void => {
    const y = widget?.getStyles().yAxis
    if (y !== undefined) {
      const next: PriceScale = { type: (y.type as PriceScaleType) ?? 'normal', reverse: y.reverse }
      setPriceScaleSignal(prev => (prev.type === next.type && prev.reverse === next.reverse ? prev : next))
      props.onPriceScaleChange(next)
    }
  }

  const [drawingBarVisible, setDrawingBarVisible] = createSignal(props.drawingBarVisible)
  // Narrow collapses the rail (by state, so the widget takes the width);
  // leaving narrow restores it unless the user toggled it meanwhile.
  let railBeforeNarrow: boolean | null = null

  // The rail's own tool / lock / magnet state, lifted out of DrawingBar
  // (SC-118, SC-182) so hiding and re-showing it (it sits inside a <Show>)
  // does not reset them, and they persist across a reload by default.
  const drawingBarState = createDrawingBarState(props.drawingBar)
  // "Stay in drawing mode" (SC-094): re-arms the same tool after it finishes.
  const [stayMode, setStayMode] = createSignal(false)

  const [symbolSearchModalVisible, setSymbolSearchModalVisible] = createSignal(false)
  const [symbolSearchQuery, setSymbolSearchQuery] = createSignal('')
  // In memory by default (no persistKey => nothing written to storage); the
  // host opts into persistence via props.symbolSearch.recent (SC-111).
  const recentOption = props.symbolSearch.recent
  const recentsStore = createRecentsStore(
    typeof recentOption === 'object' && !Array.isArray(recentOption)
      ? { persistKey: recentOption.persistKey, max: recentOption.max }
      : { seed: Array.isArray(recentOption) ? recentOption : undefined },
    typeof localStorage !== 'undefined' ? localStorage : undefined
  )
  const openSymbolSearch = (query: string): void => {
    if (props.onSymbolSearchRequest(query) === true) {
      return
    }
    setSymbolSearchQuery(query)
    setSymbolSearchModalVisible(true)
  }

  const [indicatorSettingModalParams, setIndicatorSettingModalParams] = createSignal({
    visible: false, indicatorName: '', paneId: '', calcParams: [] as any[]
  })

  // 'main' for a price-scale indicator (per the catalogue), 'new' pane otherwise.
  const defaultPaneOf = (name: string): 'main' | 'new' => (catalogEntryFor(name)?.pane === 'price' ? 'main' : 'new')

  const addIndicatorV2 = (name: string, options?: AddIndicatorOptions, source: 'user' | 'api' = 'api'): IndicatorHandle | null => {
    const resolved = resolveIndicatorName(name)
    const paneArg = options?.pane ?? defaultPaneOf(resolved)
    const targetPaneId = paneArg === 'main' ? 'candle_pane' : paneArg === 'new' ? undefined : paneArg
    if (targetPaneId !== undefined) {
      const existing = findIndicator(widget, resolved, targetPaneId)
      if (existing !== null) {
        if (options?.calcParams !== undefined) widget?.overrideIndicator({ name: resolved, calcParams: options.calcParams as any[] }, targetPaneId)
        ownedIndicators.add(ownerKey(targetPaneId, resolved))
        notifyIndicators({ type: 'updated', paneId: targetPaneId, name: resolved, source })
        return { paneId: targetPaneId, name: resolved }
      }
    }
    const paneOptions = targetPaneId !== undefined
      ? { id: targetPaneId }
      : (options?.height !== undefined ? { height: options.height } : undefined)
    const paneId = createIndicator(widget, resolved, targetPaneId !== undefined, paneOptions)
    if (paneId === null) return null
    if (options?.calcParams !== undefined) widget?.overrideIndicator({ name: resolved, calcParams: options.calcParams as any[] }, paneId)
    ownedIndicators.add(ownerKey(paneId, resolved))
    notifyIndicators({ type: 'added', paneId, name: resolved, source })
    if (paneId !== 'candle_pane') {
      relayoutPanes()
    }
    return { paneId, name: resolved }
  }

  const updateIndicatorV2 = (handle: IndicatorHandle, changes: { calcParams?: unknown[], visible?: boolean, styles?: any }): boolean => {
    if (findIndicator(widget, handle.name, handle.paneId) === null) return false
    widget?.overrideIndicator({ name: handle.name, calcParams: changes.calcParams as any[], visible: changes.visible, styles: changes.styles }, handle.paneId)
    notifyIndicators({ type: 'updated', paneId: handle.paneId, name: handle.name, source: 'api' })
    return true
  }

  const removeIndicatorV2 = (handle: IndicatorHandle, source: 'user' | 'api' = 'api'): boolean => {
    if (findIndicator(widget, handle.name, handle.paneId) === null) return false
    widget?.removeIndicator(handle.paneId, handle.name)
    ownedIndicators.delete(ownerKey(handle.paneId, handle.name))
    notifyIndicators({ type: 'removed', paneId: handle.paneId, name: handle.name, source })
    if (handle.paneId !== 'candle_pane') {
      relayoutPanes()
    }
    return true
  }

  const setIndicatorVisibleV2 = (name: string, visible: boolean, paneId?: string): boolean => {
    const resolved = resolveIndicatorName(name)
    const found = findIndicator(widget, resolved, paneId)
    if (found === null) return false
    widget?.overrideIndicator({ name: resolved, visible }, found.paneId)
    notifyIndicators({ type: 'updated', paneId: found.paneId, name: resolved, source: 'api' })
    return true
  }

  const setIndicatorParamsV2 = (name: string, calcParams: unknown[], paneId?: string): boolean => {
    const resolved = resolveIndicatorName(name)
    const found = findIndicator(widget, resolved, paneId)
    if (found === null) return false
    widget?.overrideIndicator({ name: resolved, calcParams: calcParams as any[] }, found.paneId)
    notifyIndicators({ type: 'updated', paneId: found.paneId, name: resolved, source: 'api' })
    return true
  }

  // Guarded the same way as the tooltip gear (SC-115): no instance, no modal.
  const openIndicatorSettingsV2 = (name: string, paneId?: string): boolean => {
    if (props.headless) return false
    const resolved = resolveIndicatorName(name)
    const found = findIndicator(widget, resolved, paneId)
    if (found === null) return false
    setIndicatorSettingModalParams({ visible: true, indicatorName: resolved, paneId: found.paneId, calcParams: found.instance.calcParams })
    return true
  }

  // ---- Drawing editor ---------------------------------------------------------
  // Selecting a drawing made from the drawing bar opens a floating toolbar to edit
  // it (see src/drawing-editor and widget/drawing-toolbar). The editor only ever
  // acts on overlays created here through editor.prepare(); host overlays created
  // via getChart().createOverlay are never edited, hidden, locked or removed —
  // that includes the drawing bar's lock / show-hide / magnet / remove-all, which
  // used to apply to every overlay on the chart.
  const [editorSnapshot, setEditorSnapshot] = createSignal<DrawingSnapshot | null>(null)
  const [editorSelectionKey, setEditorSelectionKey] = createSignal(0)
  const [contextMenu, setContextMenu] = createSignal<ContextMenuState | null>(null)
  // The drawing bar's eye: "every drawing visible". Hiding one drawing from the
  // toolbar turns it off, so a single click on the eye shows them all again.
  const [drawingsVisible, setDrawingsVisible] = createSignal(true)
  // Where the user dragged the toolbar (chart-local); kept while this chart lives.
  let toolbarUserPosition: Point2 | null = null
  let lastEditorSnapshot: DrawingSnapshot | null = null
  // Cursor feedback (SC-101): 'pointer' hovering a user drawing, 'grabbing'
  // while dragging one, else the freehand/crosshair default. Set on the
  // pane's own DOM node in an effect below — setting it anywhere else (e.g.
  // the widget wrapper) does nothing, because klinecharts sets style.cursor
  // inline on that exact node.
  const [drawingCursor, setDrawingCursor] = createSignal<'pointer' | 'grabbing' | null>(null)
  // SC-151: the object tree's rows, refreshed (debounced) on every drawing
  // change and once more whenever the panel opens.
  const [objectsPanelOpen, setObjectsPanelOpen] = createSignal(false)
  const [objectsRows, setObjectsRows] = createSignal<ObjectsPanelRow[]>([])
  let objectsPanelAnchorRef: HTMLButtonElement | undefined
  const refreshObjectsRows = (): void => { setObjectsRows(editor.listDrawings()) }
  // SC-093: the inline text/image editor open in place of a drawing, if any.
  interface TextEditState { id: string, kind: 'text' | 'image', anchor: { pageX: number, pageY: number }, initial: string, freshlyPlaced: boolean }
  const [textEdit, setTextEdit] = createSignal<TextEditState | null>(null)

  const editor = new DrawingEditor({
    getChart: () => widget,
    onChange: () => {
      const snapshot = editor.snapshot()
      if (!holdMutation) holdController?.selection(editor.selectedId)
      if (snapshot !== null) {
        lastEditorSnapshot = snapshot
      }
      batch(() => {
        setEditorSnapshot(snapshot)
        setEditorSelectionKey(editor.selectionKey)
        setDrawingCursor(editor.draggingUserDrawing ? 'grabbing' : (editor.hoveringUserDrawing ? 'pointer' : null))
        setContextMenu(editor.menu)
      })
    },
    // SC-092: no internal signal — canUndo()/canRedo() (below, via props.ref)
    // are a plain imperative query, and a host wanting a reactive undo button
    // reacts to this callback itself.
    onHistoryChange: () => { if (!holdMutation) holdController?.cancel(); props.onHistoryChange() },
    onDrawingsChange: () => {
      refreshObjectsRows()
      props.onDrawingsChange()
      scheduleLayoutChange()
    },
    onDrawingDefaultsChange: () => { props.onDrawingDefaultsChange() }
  })

  // ---- Arm / cancel a click-to-place tool (SC-094, SC-095) -------------------
  // Shared by the rail, the drawing hotkeys and the public armTool()/cancelTool().
  const [armed, setArmed] = createSignal<{ name: string, overlayId: string | null } | null>(null)

  const cancelTool = (): void => {
    const overlayId = armed()?.overlayId
    if (typeof overlayId === 'string' && widget !== null) {
      try { widget.removeOverlay({ id: overlayId }) } catch (e) { /* already gone */ }
    }
    setArmed(null)
    resolvePendingSetDrawingTool(null)
  }

  const PROMPT_TOOLS = ['text', 'note', 'callout', 'signpost', 'image']

  const armTool = (name: string): void => {
    holdController?.cancel()
    if (widget === null) {
      return
    }
    clearQuickMeasure()
    if (name === 'brush' || name === 'highlighter') {
      editor.deselect()
      cancelTool()
      setFreehand(freehand() === name ? null : name)
      return
    }
    setFreehand(null)
    const current = armed()
    // Re-arming the same tool cancels it (SC-094); arming a different one
    // replaces whichever was still being placed.
    if (current !== null) {
      const same = current.name === name
      cancelTool()
      if (same) {
        return
      }
    }
    editor.deselect()
    let overlay: OverlayCreate = { name, visible: drawingsVisible(), lock: drawingBarState.lock(), mode: drawingBarState.mode() as OverlayMode }
    // SC-093: no window.prompt (blocking, English-only, and a no-op in a
    // sandboxed iframe with no allow-modals). A text/image tool is armed
    // immediately with a default label/blank URL; the inline editor (below)
    // opens once placement actually finishes.
    if (isTextTool(name) || isImageTool(name)) {
      overlay = { ...overlay, extendData: isImageTool(name) ? '' : defaultTextFor(name, locale()) }
    }
    overlay = {
      ...overlay,
      // Clear `armed` (and, in stay mode, re-arm the same tool) once this
      // instance finishes or is removed — both fire after klinecharts has
      // completed the overlay, so a synchronous re-arm here keeps it.
      onDrawEnd: (event: OverlayEvent) => {
        setArmed(prev => (prev !== null && prev.overlayId === event.overlay.id ? null : prev))
        resolvePendingSetDrawingTool(event.overlay.id)
        if (isTextTool(name) || isImageTool(name)) {
          const initial = typeof event.overlay.extendData === 'string' ? event.overlay.extendData : ''
          openTextEditor(event.overlay.id, isImageTool(name) ? 'image' : 'text', { pageX: event.pageX ?? 0, pageY: event.pageY ?? 0 }, initial, true)
        }
        if (stayMode() && !PROMPT_TOOLS.includes(name)) {
          armTool(name)
        }
        return false
      },
      onRemoved: (event: OverlayEvent) => {
        setArmed(prev => (prev !== null && prev.overlayId === event.overlay.id ? null : prev))
        resolvePendingSetDrawingTool(null)
        return false
      }
    }
    // SC-119: a fresh drawing-bar tool picks up its remembered style, if any.
    const id = widget.createOverlay(editor.prepareNew(overlay))
    editor.track(id)
    const overlayId = typeof id === 'string' ? id : (Array.isArray(id) && typeof id[0] === 'string' ? id[0] : null)
    setArmed({ name, overlayId })
  }

  // What the toolbar should not cover when it opens (chart-local px): the
  // selected drawing's points plus the point it was clicked at, and the lines it
  // draws beyond its points (a horizontal line runs across the whole pane).
  const selectedDrawingAvoid = (): ToolbarAvoid | null => {
    const id = editor.selectedId
    const overlay = id !== null ? widget?.getOverlayById(id) : null
    if (widget === null || widgetRef === undefined || overlay === null || overlay === undefined) {
      return null
    }
    let rect: Rect | null = null
    let lines: Segment[] = []
    try {
      const paneId = paneIdOf(widget, overlay)
      const pixels = widget.convertToPixel(overlay.points, { paneId })
      const main = widget.getSize(paneId, DomPosition.Main)
      const points = (Array.isArray(pixels) ? pixels : [pixels]).map(p => ({
        x: (p.x ?? NaN) + (main?.left ?? 0),
        y: (p.y ?? NaN) + (main?.top ?? 0)
      }))
      rect = boundsOfPoints(points)
      if (main !== null && main !== undefined) {
        lines = drawnLines(overlay.name, points, { x: main.left, y: main.top, width: main.width, height: main.height }, overlay.extendData)
      }
    } catch (e) { /* bounds unknown: fall back to the click point */ }
    const anchor = editor.anchor
    if (anchor !== null) {
      const box = widgetRef.getBoundingClientRect()
      const click = inflateRect({ x: anchor.pageX - window.scrollX - box.left, y: anchor.pageY - window.scrollY - box.top, width: 0, height: 0 }, 24)
      rect = rect === null ? click : unionRect(rect, click)
    }
    if (rect === null && lines.length === 0) {
      return null
    }
    return { rect: rect === null ? null : inflateRect(rect, 8), lines }
  }

  // SC-057: while replay is on, the drawing toolbar must never land on top of
  // the replay bar — a z-index alone does not stop the toolbar's OWN default
  // placement, drag or keyboard nudge from picking a spot that covers it.
  let replayBarRef: HTMLDivElement | undefined
  const REPLAY_BAR_BOTTOM_OFFSET = 16 // index.less: .klinecharts-pro-replay-bar { bottom: 16px }
  const REPLAY_BAR_MARGIN = 8
  const toolbarReservedBottom = (): number =>
    (replayState().active && replayBarRef !== undefined) ? replayBarRef.offsetHeight + REPLAY_BAR_BOTTOM_OFFSET + REPLAY_BAR_MARGIN : 0

  // ---- Inline text/image editor (SC-093) -------------------------------------
  const openTextEditor = (id: string, kind: 'text' | 'image', anchor: { pageX: number, pageY: number }, initial: string, freshlyPlaced: boolean): void => {
    setTextEdit({ id, kind, anchor, initial, freshlyPlaced })
  }
  const commitTextEdit = (value: string): void => {
    const edit = textEdit()
    setTextEdit(null)
    if (edit === null) {
      return
    }
    widget?.overrideOverlay({ id: edit.id, extendData: value })
  }
  const cancelTextEdit = (value: string): void => {
    const edit = textEdit()
    setTextEdit(null)
    if (edit === null) {
      return
    }
    // A fresh placement left empty is removed, not kept as a blank drawing
    // the user cannot see or right-click to edit.
    if (edit.freshlyPlaced && value.length === 0) {
      editor.removeDrawing(edit.id)
    }
  }
  // Double-click on one of THIS editor's own finished text/image drawings
  // reopens the inline editor (never for a host's simpleAnnotation or similar,
  // since isTextTool/isImageTool only recognise this editor's own tool names,
  // and isUserDrawing excludes anything not tracked).
  const widgetDblClick = (e: MouseEvent): void => {
    const id = editor.selectedId
    if (id === null || widget === null || !editor.isUserDrawing(id)) {
      return
    }
    const overlay = widget.getOverlayById(id)
    if (overlay === null) {
      return
    }
    const kind = isImageTool(overlay.name) ? 'image' : isTextTool(overlay.name) ? 'text' : null
    if (kind === null) {
      return
    }
    const initial = typeof overlay.extendData === 'string' ? overlay.extendData : ''
    openTextEditor(id, kind, { pageX: e.pageX, pageY: e.pageY }, initial, false)
  }

  // History, live ticks, scroll-back, gap backfill and replay (src/data/loader.ts).
  const chartData = createChartData({ datafeed: props.datafeed, symbol, period, tickThrottleMs: props.tickThrottleMs })

  // ---- API v2: events, awaitable loads, JSON state ---------------------------
  // (src/api/events.ts, src/data/loadWaiters.ts via chartData.awaitLoad,
  // src/api/state.ts). 'source' tags a change as made through the chrome
  // ('user': the period bar, the symbol search modal, the timezone/settings
  // modals) or through a ChartPro method call ('api'), so a host or an agent
  // can tell its own writes apart from someone else's.
  const events = new SuperChartEventBus((...args) => { console.warn(...args) })

  let readyResolve: () => void = () => {}
  const readyPromise = new Promise<void>(resolve => { readyResolve = resolve })
  let readySettled = false
  chartData.loader.on('status', s => {
    if (!readySettled && (s.state === 'ready' || s.state === 'empty' || s.state === 'error')) {
      readySettled = true
      readyResolve()
    }
  })

  const invalidPeriod = (received: unknown, hint: string): LoadResult => ({
    status: 'invalid',
    error: {
      name: 'ChartError',
      code: 'INVALID_PERIOD',
      field: 'period',
      received,
      message: `[super-chart] cannot read the period ${JSON.stringify(received)}.${hint === '' ? '' : ` ${hint}`}`
    }
  })

  /** setSymbol's whole implementation, shared by the public API ('api') and the symbol search modal ('user'). */
  const applySymbol = async (s: SymbolInfo, source: 'user' | 'api'): Promise<LoadResult> => {
    const changed = !sameSymbol(symbol(), s)
    setSymbol(s)
    if (changed) {
      events.emit('symbolChange', { symbol: s, source })
    }
    return await (chartData.awaitLoad() as Promise<LoadResult>)
  }

  /** setPeriod's whole implementation, shared by the public API ('api') and the period bar ('user'). */
  const applyPeriod = async (p: Period | string, source: 'user' | 'api'): Promise<LoadResult> => {
    if (typeof p === 'string' && parsePeriod(p) === null) {
      // resolvePeriod would also warn and do nothing; this additionally
      // gives an awaiting caller a reason instead of a silent no-op.
      return invalidPeriod(p, "Expected e.g. '1m', '4H', 'D', '1W', '1M' or a TradingView resolution such as '240'.")
    }
    const resolved = resolvePeriod(p, periods())
    if (resolved === null) {
      return invalidPeriod(p, '')
    }
    const changed = !samePeriod(period(), resolved)
    setPeriodSignal(resolved)
    if (changed) {
      events.emit('periodChange', { period: resolved, source })
    }
    return await (chartData.awaitLoad() as Promise<LoadResult>)
  }

  // dataLoaded/dataError: the same 'status' the loading spinner already
  // reacts to, so a host can drop its own datafeed-sniffing (SupWallet's
  // MainChart/StudioChart) for this instead.
  let lastReportedErrorAt: unknown = null
  let lastLoadState: string = 'idle'
  chartData.loader.on('status', s => {
    const previous = lastLoadState
    lastLoadState = s.state
    // A new series is coming: its labels may be narrower, let the axis refit.
    if (s.state === 'loading') stickyAxis?.reset()
    const shown = chartData.loader.shown
    if (shown === null) {
      return
    }
    if (s.state === 'ready' || s.state === 'empty') {
      // SC-NEXT #1: a new series (initial load, symbol/period switch) fades
      // in — only when it arrives (loading -> ready). Scroll-back paging and
      // its loadingMore toggles also report 'ready'; fading the whole chart
      // out and in on each of those flashed it mid-drag (2026-09-28).
      if (props.motion && previous === 'loading') triggerFadeIn(widgetRef)
      events.emit('dataLoaded', { symbol: shown.symbol, period: shown.period, bars: widget?.getDataList().length ?? 0, source: 'api' })
    } else if (s.state === 'error' && s.error !== null && s.error !== lastReportedErrorAt) {
      lastReportedErrorAt = s.error
      events.emit('dataError', {
        symbol: shown.symbol,
        period: shown.period,
        message: s.error.error instanceof Error ? s.error.error.message : String(s.error.error),
        timeout: s.error.timeout,
        source: 'api'
      })
    }
  })
  chartData.loader.on('replay', active => { events.emit('replayChange', { active, source: 'user' }) })

  // ---- Bar replay (SC-067) ---------------------------------------------------
  // One controller both the ReplayBar widget and chartPro.replay drive, so the
  // UI and a future MCP/agent tool can never disagree about replay's state.
  const [replayState, setReplayState] = createSignal<ReplayState>({ active: false, index: -1, timestamp: null, playing: false, speed: 1 })
  const [replayPicking, setReplayPicking] = createSignal(false)
  const replay = createReplayController({
    loader: chartData.loader,
    getDataList: () => widget?.getDataList() ?? [],
    onChange: state => {
      setReplayState(state)
      if (!state.active) { setReplayPicking(false) }
      props.onReplayChange(state)
    }
  })
  onCleanup(replay.dispose)

  // ---- AI/MCP command layer + drawings/annotations/layout APIs ---------------
  // (SC-121/123/127/128/135/178/180). Additive, and built entirely on the
  // v1/v2 surface assembled elsewhere in this file: armTool/editor for
  // drawings, addHostOverlay for annotations, the v2 indicator API +
  // editor.getDrawings/setDrawings for layout. The actual logic lives in
  // src/api/{drawings,annotations,layout,anchors}.ts and
  // src/commands/{schema,bind}.ts — this block only wires them to this
  // instance's local state.

  // The key drawings are saved/restored under on a symbol change (SC-120):
  // moved up from below (unchanged) so the layout/command wiring that also
  // needs it can share one definition; its two original call sites (the
  // symbol-change effects further down) are unaffected.
  const drawingsKeyOf = (s: SymbolInfo | undefined): string => (s === undefined ? '' : props.drawingsKey(s))

  const drawingsApi = createDrawingsApi({
    getChart: () => widget as unknown as DrawingsRawChart | null,
    editor,
    getDrawingBarLock: drawingBarState.lock,
    getDrawingBarMode: () => drawingBarState.mode() as OverlayMode,
    getPeriod: period,
    getDrawingToolCatalog,
    notifyChange: () => { refreshObjectsRows(); props.onDrawingsChange(); scheduleLayoutChange() },
    emitCreate: (id, name) => { events.emit('drawingCreate', { id, name, source: 'api' }) },
    emitChange: id => { events.emit('drawingChange', { id, source: 'api' }) }
  })

  const annotationsApi = createAnnotationsApi({
    getChart: () => widget as unknown as AnnotationsRawChart | null,
    getTheme: () => theme(),
    getPeriod: period
  })

  const drawingCrossWatcher = createDrawingCrossWatcher({
    getChart: () => widget as unknown as DrawingsRawChart | null,
    listUserDrawingIds: () => editor.userDrawingIds(),
    isBusy: () => replayState().active || !(chartData.status().state === 'ready' || chartData.status().state === 'empty'),
    getPeriod: period
  })
  onCleanup(drawingCrossWatcher.dispose)

  // SC-178: while replay is active, a future point is extrapolated off the
  // currently shown data instead of letting klinecharts clamp it to the
  // second-to-last bar (src/api/anchors.ts). Installed/uninstalled with
  // replay itself, and always uninstalled on cleanup so a stale wrapper
  // never survives a symbol/period change.
  let uninstallReplayAnchor: (() => void) | null = null
  createEffect(on(() => replayState().active, active => {
    uninstallReplayAnchor?.()
    uninstallReplayAnchor = active ? installReplayFutureAnchor(widget, () => period(), () => replayState().active) : null
  }))
  onCleanup(() => { uninstallReplayAnchor?.() })

  // ---- layout save/restore (SC-121) ------------------------------------------
  const layoutStorageKey = props.layoutPersistKey.length > 0 ? props.layoutPersistKey : null
  const layoutChangeListeners = new Set<() => void>()
  let layoutChangeTimer: ReturnType<typeof setTimeout> | null = null
  const layoutDeps: LayoutApiDeps = {
    getChartType: () => chartType(),
    setChartType: type => applyChartType(type),
    getTimezone: () => timezone(),
    setTimezone: tz => {
      const resolved = resolveTz(tz)
      if (resolved !== null) {
        setTimezoneKey(resolved)
      }
    },
    getIndicators: () => indicators(),
    addIndicator: addIndicatorV2,
    updateIndicator: updateIndicatorV2,
    removeIndicator: removeIndicatorV2,
    getDrawings: key => editor.getDrawings(key),
    setDrawings: (records, key) => { editor.setDrawings(records, key) },
    getSymbolKey: () => drawingsKeyOf(symbol())
  }
  const getLayoutApi = (): ChartLayoutV1 => buildLayout(layoutDeps)
  const applyLayoutApi = (layout: ChartLayoutV1, options?: ApplyLayoutOptions): ApplyLayoutResult => applyLayout(layoutDeps, layout, options)

  /** Debounced (macrotask) so a burst of changes (restoring several indicators) persists/notifies once. */
  const scheduleLayoutChange = (): void => {
    if (layoutChangeTimer !== null) {
      return
    }
    layoutChangeTimer = setTimeout(() => {
      layoutChangeTimer = null
      props.onLayoutChange()
      layoutChangeListeners.forEach(fn => {
        try { fn() } catch (e) { console.warn('[super-chart] an onLayoutChange listener threw.', e) }
      })
      if (layoutStorageKey !== null) {
        writePersistedLayout(layoutStorageKey, getLayoutApi())
      }
    }, 0)
  }
  onCleanup(() => { if (layoutChangeTimer !== null) { clearTimeout(layoutChangeTimer) } })

  // Restore once, the first time this instance's data settles (mount, or a
  // reload if mount itself errored) — never again on a later symbol/period
  // change, which the host is driving itself.
  let layoutRestored = false
  createEffect(on(() => chartData.status().state, state => {
    if (!layoutRestored && layoutStorageKey !== null && (state === 'ready' || state === 'empty')) {
      layoutRestored = true
      const saved = readPersistedLayout(layoutStorageKey)
      if (saved !== null) {
        applyLayoutApi(saved)
      }
    }
  }))

  // ---- command registry (SC-123) ---------------------------------------------
  // `chartApi` is assigned once, right after this object's own literal is
  // built (below, where `props.ref` used to be called directly) — `execute`
  // only ever runs later, once a caller actually invokes it, by which time
  // the assignment has long since happened (the same deferred-closure
  // pattern `events`/`notifyIndicators` already rely on elsewhere in this
  // file).
  let chartApi: ChartPro
  const commandDeps: CommandBindingDeps = {
    getChart: () => chartApi,
    apis: {
      addDrawing: spec => drawingsApi.addDrawing(spec),
      updateDrawing: (id, changes) => drawingsApi.updateDrawing(id, changes),
      listDrawingTools: () => drawingsApi.listDrawingTools(),
      drawingLevelsAt: (id, ts) => drawingsApi.drawingLevelsAt(id, ts),
      setAnnotations: (layerName, specs) => annotationsApi.setAnnotations(layerName, specs),
      getAnnotations: layerName => annotationsApi.getAnnotations(layerName),
      clearAnnotations: layerName => { annotationsApi.clearAnnotations(layerName) },
      getLayout: getLayoutApi,
      applyLayout: applyLayoutApi
    }
  }
  const titleForCommand = (d: CommandDescriptor): string => i18n(d.titleKey, locale())

  // setDrawingTool (SC-127): resolves once the tool armed here finishes or is
  // cancelled. Shares armTool()/cancelTool() with the rail and the hotkeys —
  // see the two small hooks added to their onDrawEnd/onRemoved below.
  let pendingSetDrawingTool: ((id: string | null) => void) | null = null
  const resolvePendingSetDrawingTool = (id: string | null): void => {
    const resolve = pendingSetDrawingTool
    pendingSetDrawingTool = null
    resolve?.(id)
  }
  const setDrawingToolApi = async (tool: string | null): Promise<string | null> => {
    resolvePendingSetDrawingTool(null) // supersede whatever an earlier call was still waiting on
    if (tool === null) {
      cancelTool()
      return null
    }
    return await new Promise<string | null>(resolve => {
      pendingSetDrawingTool = resolve
      armTool(tool)
    })
  }

  // ---- Theme: one style stack, applied at init and once per theme change ----
  // (src/theme/styleStack.ts). Host styles are kept in the stack, so they
  // survive setTheme; the canvas follows the chrome's CSS custom properties.
  const styleStack = new StyleStack(props.styles, props.themeStyles)
  let engine: EngineContext = { theme: props.theme, chartType: props.chartType, canvasTheme: props.canvasTheme, tokens: {} }
  const readEngineContext = (): EngineContext => {
    const t = theme()
    engine = { theme: t, chartType: chartType(), canvasTheme: props.canvasTheme, tokens: canvasTokens(t, resolveChromeTokens(contentRef?.parentElement)) }
    return engine
  }
  const applyTheme = (): void => {
    const ctx = readEngineContext()
    widget?.setStyles(styleStack.compose(ctx.theme, themeLayers(ctx)))
  }

  // The candle legend (SC-042): a coloured O/H/L/C + change row. Installed
  // only when the host's own construction options (`styles`/`themeStyles`)
  // never set candle.tooltip.custom — checked on the *input*, never on
  // klinecharts' post-merge getStyles(), because klinecharts' own default is
  // a non-null array on 9.8.x (only 9.1.1/9.7.2 default it to null): reading
  // getStyles() after the fact cannot tell "klinecharts' own default" from
  // "a host set it", and got this wrong for the version every real host
  // actually runs. Re-created on a locale change (its labels are the only
  // thing not read live — precision, colours and whether to show volume are
  // closures over live state); never touched otherwise, since klinecharts
  // merges setStyles and a function-valued `custom` survives a later
  // theme/style change untouched.
  const hostConfiguredLegend = (): boolean => {
    const has = (obj: unknown): boolean => getPath(obj, 'candle.tooltip.custom') !== undefined
    return has(props.styles) || has(props.themeStyles?.light) || has(props.themeStyles?.dark)
  }
  const buildLegendFn = (): ReturnType<typeof createCandleLegend> => createCandleLegend({
    utils,
    labels: {
      open: i18n('legend_o', locale()),
      high: i18n('legend_h', locale()),
      low: i18n('legend_l', locale()),
      close: i18n('legend_c', locale()),
      volume: i18n('legend_vol', locale())
    },
    getPrecision: () => widget?.getPriceVolumePrecision() ?? { price: 2, volume: 0 },
    // No getThousandsSeparator/getDecimalFoldThreshold here on purpose: the
    // public `Chart` type (klinecharts/dist/index.d.ts, both 9.7.2 and
    // 9.8.12) never exposes either getter — only the internal, non-exported
    // `ChartStore` has them — so `(widget as any).getThousandsSeparator?.()`
    // always silently returned `undefined`. legend.ts's own defaults now
    // match klinecharts' real internal ones (',' and 3), so omitting these
    // is equivalent to what actually ran before, minus the dead cast.
    showVolume: () => !indicators().some(i => i.owner === 'engine' && i.name === 'VOL')
  })
  /** Re-creates the legend after mount (a locale change only — first install goes into init()'s own styles, see onMount, so mounting never causes an extra setStyles call). */
  const reinstallLegend = (): void => { widget?.setStyles({ candle: { tooltip: { custom: buildLegendFn() } } }) }

  // The price-axis scale corner + Settings + a host's own setStyles all
  // change yAxis.type/reverse; klinecharts has no change event for it, so
  // every call site re-syncs the signal after touching styles.
  const applyPriceScale = (change: Partial<PriceScale> & { fit?: true }): void => {
    if (widget === null) {
      return
    }
    if (change.fit === true) {
      // The only public way to reset auto-scale in both 9.1.1 and 9.8.12
      // (SC-098's corrected fix): re-apply the current type, which resets
      // klinecharts' internal auto-fit flag as a side effect.
      widget.setStyles({ yAxis: { type: widget.getStyles().yAxis.type } })
      return
    }
    // PriceScaleType's string values are identical to klinecharts' YAxisType
    // enum (verified against node_modules/klinecharts/dist/index.d.ts), but
    // TypeScript enums are not structurally assignable from a plain union.
    widget.setStyles({ yAxis: { ...(change.type !== undefined ? { type: change.type as never } : {}), ...(change.reverse !== undefined ? { reverse: change.reverse } : {}) } })
    syncPriceScale()
  }

  // Screenshot / snapshot (SC-015): a theme-correct background (a host's CSS
  // override, or the live theme — never `props.theme`, frozen at construction),
  // real metadata, and one code path for the button and the API.
  const takeSnapshot = (options?: SnapshotOptions): SnapshotResult => {
    if (widget === null) {
      throw new Error('[super-chart] snapshot() called before the chart mounted, or after dispose().')
    }
    const resolved = resolveSnapshotOptions(options)
    if (resolved.hideCrosshair) {
      try {
        const store = (widget as unknown as { getChartStore?: () => { getTooltipStore?: () => { setCrosshair?: (c: unknown, o?: unknown) => void } } }).getChartStore?.()?.getTooltipStore?.()
        store?.setCrosshair?.(undefined, { notExecuteAction: true })
      } catch { /* best effort: no such private store on this klinecharts version. */ }
    }
    const background = resolved.background === 'transparent' || (resolved.background !== undefined && resolved.background !== 'auto')
      ? resolved.background
      : resolveScreenshotBackground(contentRef ?? document.body, node => getComputedStyle(node as Element).backgroundColor, theme())
    const box = widget.getDom()?.getBoundingClientRect()
    return buildSnapshotResult(widget, {
      format: resolved.format,
      background,
      includeOverlay: true,
      width: box?.width ?? 0,
      height: box?.height ?? 0,
      pixelRatio: typeof window !== 'undefined' ? (window.devicePixelRatio > 0 ? window.devicePixelRatio : 1) : 1,
      symbol: symbol(),
      period: period(),
      timezone: timezone(),
      theme: theme()
    })
  }

  // The chart's key dispatcher and full screen, shared with every widget
  // through context (src/common/chartScope.ts).
  const scope = createChartScope(props.root, {
    fullscreen: () => props.fullscreen,
    onFullscreenChange: change => { props.onFullscreenChange(change) }
  })
  let watermarkEl: HTMLElement | null = null

  chartApi = {
    setTheme: t => {
      const changed = t !== theme()
      setTheme(t)
      if (changed) {
        events.emit('themeChange', { theme: t, source: 'api' })
      }
    },
    getTheme: () => theme(),
    setStyles: (s, options) => {
      const { apply, chartType: type } = styleStack.setHost(s, options?.theme, theme())
      if (type !== undefined && type !== chartType()) {
        setChartType(type)
        events.emit('chartTypeChange', { chartType: type, source: 'api' })
      }
      if (apply !== undefined && widget !== null) {
        widget.setStyles(apply)
      }
    },
    refreshTheme: applyTheme,
    getStyles: () => widget!.getStyles(),
    setLocale,
    getLocale: () => locale(),
    // v1: void, never throws. An id Intl rejects ('UTC+8', a typo) is
    // ignored with a console warning, keeping the current zone — the state
    // never lies about what the chart runs, unlike echoing the argument back.
    setTimezone: (tz: string) => {
      const resolved = resolveTz(tz)
      if (resolved === null) {
        console.warn(`[super-chart] unknown timezone ${JSON.stringify(tz)}; expected an IANA id (e.g. 'Asia/Taipei') or 'local'. Keeping '${timezone()}'.`)
        return
      }
      const changed = resolved !== timezone()
      setTimezoneKey(resolved)
      if (changed) {
        events.emit('timezoneChange', { timezone: resolved, source: 'api' })
        scheduleLayoutChange()
      }
    },
    getTimezone: () => timezone(),
    setSymbol: async s => await applySymbol(s, 'api'),
    getSymbol: () => symbol(),
    setPeriod: async p => await applyPeriod(p, 'api'),
    getPeriod: () => period(),
    reload: chartData.reload,
    // Expose the underlying KLineChart instance so hosts can drive the chart
    // directly (createIndicator / createOverlay / loadMore / convertFromPixel …)
    // while still using the Pro chrome around it.
    getChart: () => widget,
    // SC-003: with autoResize (the default), hosts no longer need this — the
    // ResizeObserver below already follows the container. Kept for a host
    // with autoResize: false, or one driving layout on its own schedule.
    resize: safeResize,
    getPricePrecision: () => resolvePricePrecision(symbol()?.pricePrecision, widget?.getDataList() ?? []),
    ready: readyPromise,
    getLoadState: () => buildLoadState({ symbol: symbol(), period: period() }, chartData.loader.shown, chartData.status()),
    getBars: options => chartData.getBars(options?.limit),
    on: (type, listener) => events.on(type, listener),
    off: (type, listener) => { events.off(type, listener) },
    getState: () => buildChartState({
      symbol: symbol(),
      period: period(),
      timezone: timezone(),
      locale: locale(),
      theme: theme(),
      chartType: chartType(),
      pricePrecision: resolvePricePrecision(symbol()?.pricePrecision, widget?.getDataList() ?? []),
      loadState: buildLoadState({ symbol: symbol(), period: period() }, chartData.loader.shown, chartData.status()),
      replayActive: replayState().active,
      bars: widget?.getDataList() ?? []
    }),
    getContext: options => buildChartContext({
      getChart: () => widget,
      // buildChartContext wants a resolved numeric pricePrecision; SymbolInfo's
      // is number | 'auto' | undefined (SC-020).
      getSymbol: () => ({ ...symbol(), pricePrecision: resolvePricePrecision(symbol()?.pricePrecision, widget?.getDataList() ?? []) }),
      getPeriod: () => period(),
      getTimezone: () => timezone()
    }, options),
    setVisibleRange: async ({ from, to }) => {
      const result = await chartData.loader.loadUntil(from)
      widget?.scrollToTimestamp?.(to)
      const list = widget?.getDataList() ?? []
      return { covered: result.covered, from: list.length > 0 ? Math.max(list[0].timestamp, from) : from, to }
    },
    scrollToTime: async (timestamp, opts) => {
      const result = await chartData.loader.loadUntil(timestamp)
      widget?.scrollToTimestamp?.(timestamp, opts?.animate === true ? 200 : undefined)
      const list = widget?.getDataList() ?? []
      return { reached: result.covered, firstLoaded: list.length > 0 ? list[0].timestamp : timestamp }
    },
    primeHistory: (s, p, bars) => { chartData.loader.primeHistory(s, p, bars) },
    invalidateHistory: (s, p) => { chartData.loader.invalidateHistory(s, p) },
    describe: () => {
      const stats = visibleStats()
      return {
        symbol: symbol(),
        period: period(),
        chartType: chartType(),
        locale: locale(),
        timezone: timezone(),
        ...stats,
        indicators: engineIndicatorNames()
      }
    },
    setChartType: applyChartType,
    getChartType: () => chartType(),
    setParts: p => { setParts(resolveParts(p, parts())) },
    getParts: () => ({ ...parts() }),
    setLayoutMode: mode => {
      if (!isLayoutMode(mode)) {
        console.warn(`[super-chart] unknown layout ${JSON.stringify(mode)}; expected one of ${LAYOUT_MODES.join(', ')}. Ignored.`)
        return
      }
      setLayoutMode(mode)
    },
    getSizeClass: () => sizeClass(),
    setPeriods: list => {
      if (!Array.isArray(list) || list.length === 0) {
        console.warn('[super-chart] setPeriods needs a non-empty array of periods. Ignored.')
        return
      }
      const next = list.map(p => ({ ...p }))
      batch(() => {
        setPeriods(next)
        setPeriodSignal(next.find(p => samePeriod(p, period())) ?? next[0])
      })
    },
    getPeriods: () => periods().map(p => ({ ...p })),
    setDrawingBarVisible: visible => {
      railBeforeNarrow = null
      setDrawingBarVisible(visible)
    },
    isDrawingBarVisible: () => drawingBarVisible(),
    setWatermark: w => {
      const next = createWatermark(w)
      watermarkEl?.replaceWith(next)
      watermarkEl = next
    },
    enterFullscreen: async () => await scope.fullscreen.enter(),
    exitFullscreen: async () => { await scope.fullscreen.exit() },
    isFullscreen: () => scope.fullscreen.isFullscreen(),
    // ---- Indicators (v2, additive — SC-114/SC-133/SC-152) ----------------
    getIndicators: () => indicators(),
    addIndicator: addIndicatorV2,
    updateIndicator: updateIndicatorV2,
    removeIndicator: removeIndicatorV2,
    setIndicatorVisible: setIndicatorVisibleV2,
    setIndicatorParams: setIndicatorParamsV2,
    openIndicatorSettings: openIndicatorSettingsV2,
    onIndicatorsChange: (cb) => { indicatorListeners.add(cb); return () => { indicatorListeners.delete(cb) } },
    getIndicatorCatalog,
    getDrawingToolCatalog,
    addIndicatorCatalogEntries: (entries) => { addIndicatorCatalogEntries(entries); bumpIndicators(v => v + 1) },
    setIndicatorCatalog: (entries) => { setIndicatorCatalog(entries); bumpIndicators(v => v + 1) },
    snapshot: (options?: SnapshotOptions) => takeSnapshot(options),
    scrollToLatest: options => { widget?.scrollToRealTime(options?.animationMs) },
    resetView: () => {
      if (widget === null) return
      if (widget.isZoomEnabled()) widget.setBarSpace(initialBarSpace)
      widget.scrollToRealTime()
      applyPriceScale({ fit: true })
    },
    scrollToTimestamp: (timestamp, options) => { widget?.scrollToTimestamp(timestamp, options?.animationMs) },
    setPriceScale: applyPriceScale,
    getPriceScale: () => priceScale(),
    openSymbolSearch,
    replay: replay.controls,
    armTool: name => {
      if (typeof name !== 'string' || name.length === 0) {
        console.warn('[super-chart] armTool needs a tool name. Ignored.')
        return
      }
      armTool(name)
    },
    cancelTool: () => { cancelTool() },
    setDrawingStayMode: stay => { setStayMode(stay) },
    getDrawingStayMode: () => stayMode(),
    undo: () => editor.undo(),
    redo: () => editor.redo(),
    canUndo: () => editor.canUndo(),
    canRedo: () => editor.canRedo(),
    getDrawings: key => editor.getDrawings(key),
    setDrawings: (records, key) => { editor.setDrawings(records, key) },
    clearDrawings: key => { editor.clearDrawings(key) },
    listDrawings: () => editor.listDrawings(),
    setDrawingVisible: (id, visible) => { editor.setDrawingVisible(id, visible) },
    setDrawingLocked: (id, locked) => { editor.setDrawingLocked(id, locked) },
    removeDrawing: id => { editor.removeDrawing(id) },
    getDrawingDefaults: name => editor.getDrawingDefaults(name),
    setDrawingDefaults: (name, changes) => { editor.setDrawingDefaults(name, changes) },
    clearDrawingDefaults: name => { editor.clearDrawingDefaults(name) },
    // SC-091: a host's own layer (SL/TP, an AI-drawn level), never a drawing-bar
    // overlay — addHostOverlay never enters editor state, so none of the
    // methods above ever see, list or touch it.
    addHostOverlay: (create, options) => (widget === null ? null : addHostOverlay(widget, create, options)),

    // ---- AI/MCP command layer (additive — SC-123) --------------------------
    // Preserve the command promise rather than adding an extra async wrapper.
    // eslint-disable-next-line @typescript-eslint/promise-function-async
    execute: request => executeCommand(commandDeps, request),
    getCommands: () => getCommandRegistry(),
    toToolDefinitions: options => buildToolDefinitions(commandDeps, options, titleForCommand),

    // ---- drawings API (additive — SC-127, SC-135, SC-180) ------------------
    // Preserve the drawing API promises rather than wrapping them again.
    // eslint-disable-next-line @typescript-eslint/promise-function-async
    addDrawing: spec => drawingsApi.addDrawing(spec),
    // eslint-disable-next-line @typescript-eslint/promise-function-async
    updateDrawing: (id, changes) => drawingsApi.updateDrawing(id, changes),
    listDrawingTools: () => drawingsApi.listDrawingTools(),
    // eslint-disable-next-line @typescript-eslint/promise-function-async -- forward the pending tool result
    setDrawingTool: tool => setDrawingToolApi(tool),
    drawingLevelsAt: (id, ts) => drawingsApi.drawingLevelsAt(id, ts),
    onDrawingCross: (cb, options) => drawingCrossWatcher.subscribe(cb, options),

    // ---- declarative annotation layers (additive — SC-128) -----------------
    setAnnotations: (layerName, specs) => annotationsApi.setAnnotations(layerName, specs),
    getAnnotations: layerName => annotationsApi.getAnnotations(layerName),
    clearAnnotations: layerName => { annotationsApi.clearAnnotations(layerName) },

    // ---- layout save/restore (additive — SC-121) ---------------------------
    getLayout: getLayoutApi,
    applyLayout: (layout, options) => applyLayoutApi(layout, options),
    onLayoutChange: cb => { layoutChangeListeners.add(cb); return () => { layoutChangeListeners.delete(cb) } }
  }
  props.ref(chartApi)

  const documentResize = (): void => {
    safeResize()
    relayoutPanes()
  }

  // ---- Freehand brush / highlighter -----------------------------------------
  // klinecharts overlays are click-to-place; brush/highlighter need drag-to-draw.
  // We capture pointer drags over the chart, live-preview the stroke as a growing
  // overlay, then leave the final multi-point overlay in place (so it pans/zooms).
  const [freehand, setFreehand] = createSignal<string | null>(null)
  type Pt = Partial<{ dataIndex: number; timestamp: number; value: number }>
  let strokePoints: Pt[] = []
  let strokePaneId: string | null = null
  let strokeOverlayId: string | null = null
  let strokeLast = { x: 0, y: 0 }
  let strokePointerId: number | null = null

  /** The pane under (clientX, clientY): the candle pane, or a pane the host created with getChart().createIndicator (SC-009). */
  const paneAt = (clientX: number, clientY: number): string | null => {
    if (widget === null) return null
    const candidates = ['candle_pane']
    try {
      const map = widget.getIndicatorByPaneId() as unknown as Map<string, unknown>
      if (map instanceof Map) {
        for (const id of map.keys()) {
          if (id !== 'candle_pane') candidates.push(id)
        }
      }
    } catch (err) { /* older klinecharts without a Map return: candle pane only */ }
    for (const paneId of candidates) {
      const rect = widget.getDom(paneId, DomPosition.Main)?.getBoundingClientRect()
      if (rect !== undefined && clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
        return paneId
      }
    }
    return null
  }
  const toDataPoint = (clientX: number, clientY: number, paneId: string): Pt | null => {
    if (widget === null) return null
    const rect = widget.getDom(paneId, DomPosition.Main)?.getBoundingClientRect()
    if (rect === undefined) return null
    const arr = widget.convertFromPixel([{ x: clientX - rect.left, y: clientY - rect.top }], { paneId })
    const pt = Array.isArray(arr) ? arr[0] : arr
    return (pt ?? null) as Pt | null
  }
  const [holdStatus, setHoldStatus] = createSignal<HoldStatus>({ mode: 'idle', label: '', alternatives: false })
  const holdOptions = typeof props.drawByHolding === 'object' ? props.drawByHolding : {}
  let holdPreviewId: string | null = null
  const holdNavigation = createHoldNavigation(() => widget)
  // Compatibility mouse/touch moves are suppressed until native release, even after Escape.
  // The release itself reaches klinecharts so its SyntheticEvent clears pressed state and root listeners.
  const holdCompatibility = createHoldCompatibility(() => { holdController?.cancel() })
  const mutateHold = <T,>(fn: () => T): T => {
    holdMutation = true
    try { return fn() } finally { holdMutation = false }
  }
  const clearHoldPreview = (): void => {
    if (holdPreviewId !== null) widget?.removeOverlay({ id: holdPreviewId })
    holdPreviewId = null
  }
  const holdCreateSpec = (candidate: DrawingCandidate, paneId: string): OverlayCreate | null => {
    let anchors = candidate.points
    if (candidate.kind === 'horizontal' && paneId === 'candle_pane' && widget !== null && anchors.length > 0) {
      const rect = widget.getDom(paneId, DomPosition.Main)?.getBoundingClientRect()
      const at = toDataPoint(anchors[0].x, anchors[0].y, paneId)?.dataIndex
      if (rect !== undefined && at !== undefined) {
        const bars = widget.getDataList()
        const start = Math.max(0, Math.round(at) - 2)
        const data = bars.slice(start, start + 5).flatMap((bar, i) => [{ dataIndex: start + i, value: bar.high }, { dataIndex: start + i, value: bar.low }])
        const converted = widget.convertToPixel(data, { paneId })
        const wicks = (Array.isArray(converted) ? converted : [converted]).filter((p): p is Point => p.x !== undefined && p.y !== undefined).map(p => ({ x: p.x + rect.left, y: p.y + rect.top }))
        anchors = [snapHorizontalWick(anchors[0], wicks)]
      }
    }
    const points = anchors.map(p => toDataPoint(p.x, p.y, paneId))
    if (points.length === 0 || points.some(p => p === null || !Number.isFinite(p.value) || !Number.isFinite(p.dataIndex))) return null
    return { name: candidate.tool, points: points as Pt[], lock: drawingBarState.lock(), mode: drawingBarState.mode() as OverlayMode }
  }
  if (props.drawByHolding !== false) {
    holdController = createHoldController({
      paneAt,
      keyTarget: target => isHoldKeyTarget(target, props.root, widgetRef),
      blocked: () => widget === null || !supportsNativeHold(widget) || widget.getDataList().length === 0 || scope.keys.suspended() || holdGuide?.open() === true || freehand() !== null || armed() !== null || replayPicking() || replayState().active || drawingInProgress(widget) || editor.draggingUserDrawing,
      start: () => {
        if (widget === null) return
        prepareNativeHold(widget)
        holdCompatibility.start()
        holdNavigation.start()
        // Keep a neighbouring host composer from owning Tab/Escape after a pointer stroke.
        const dom = widget.getDom() as HTMLElement | null
        try { dom?.focus({ preventScroll: true }) } catch { /* non-focusable older peer */ }
      },
      finish: () => { holdNavigation.finish() },
      preview: (pixels, paneId) => {
        if (widget === null) return
        const points = pixels.map(p => toDataPoint(p.x, p.y, paneId)).filter((p): p is Pt => p !== null)
        if (points.length < 2) return
        if (holdPreviewId === null) {
          const created = widget.createOverlay({ name: 'brush', points, lock: true }, paneId)
          holdPreviewId = typeof created === 'string' ? created : Array.isArray(created) ? created[0] : null
        } else widget.overrideOverlay({ id: holdPreviewId, points })
      },
      clearPreview: clearHoldPreview,
      create: (candidate, paneId) => {
        const create = holdCreateSpec(candidate, paneId)
        return create === null ? null : mutateHold(() => editor.createGestureDrawing(create, paneId))
      },
      replace: (id, candidate, paneId) => {
        const create = holdCreateSpec(candidate, paneId)
        return create !== null && mutateHold(() => editor.replaceGestureDrawing(id, create, paneId))
      },
      remove: id => mutateHold(() => editor.removeGestureDrawings([id]) > 0),
      exists: id => {
        const overlay = widget?.getOverlayById(id)
        return editor.isUserDrawing(id) && editor.selectedId === id && overlay !== null && overlay !== undefined && !overlay.lock && overlay.visible
      },
      erase: (stroke, paneId) => {
        if (widget === null) return 0
        const rect = widget.getDom(paneId, DomPosition.Main)?.getBoundingClientRect()
        if (rect === undefined) return 0
        const local = stroke.map(p => ({ x: p.x - rect.left, y: p.y - rect.top }))
        const hits: string[] = []
        for (const row of editor.listDrawings()) {
          if (!row.visible || row.locked) continue
          const overlay = widget.getOverlayById(row.id)
          if (overlay === null || paneIdOf(widget, overlay) !== paneId) continue
          const converted = widget.convertToPixel(overlay.points, { paneId })
          const pixels = (Array.isArray(converted) ? converted : [converted]) as Point[]
          if (scribbleHitsDrawing(local, row.name, pixels, { x: 0, y: 0, width: rect.width, height: rect.height }, overlay.extendData)) hits.push(row.id)
        }
        return mutateHold(() => editor.removeGestureDrawings(hits))
      },
      status: status => { setHoldStatus(status); holdGuide?.update(status) },
      candidates: (candidates, stroke, paneId) => {
        const rect = widget?.getDom(paneId, DomPosition.Main)?.getBoundingClientRect()
        return rect === undefined || stroke.length === 0 ? candidates.slice() : preferAxisRay(candidates, stroke[stroke.length - 1], rect.right)
      }
    }, holdOptions.delayMs)
  }
  createEffect(on([symbol, period], () => { holdController?.cancel() }, { defer: true }))
  createEffect(() => { if (scope.keys.suspended()) holdController?.cancel() })
  const holdDown = (e: PointerEvent): void => {
    if (!e.isPrimary) { holdCompatibility.release(); holdController?.down(e); return }
    else if (holdController?.active() !== true) holdCompatibility.release()
    // An existing drawing's drag handles keep their ordinary behavior.
    if (editor.hoveringUserDrawing || isHoldControlTarget(e.target)) { holdController?.cancel(); return }
    holdController?.down(e)
  }
  const holdMove = (e: PointerEvent): void => { holdController?.move(e) }
  const holdUp = (e: PointerEvent): void => { holdController?.up(e) }
  const holdPointerCancel = (e: PointerEvent): void => { if (holdController?.cancelPointer(e) === true) holdCompatibility.release() }
  const holdLeave = (): void => { holdController?.leave() }
  const holdCancel = (): void => { holdController?.cancel(); holdCompatibility.release() }
  const holdLostCapture = (): void => { if (holdController?.active() === true) holdCancel() }
  const holdNativeMove = (e: Event): void => { holdCompatibility.move(e) }
  const holdNativeEnd = (): void => { holdCompatibility.release() }
  const endStroke = (): void => {
    if (strokePoints.length < 2 && strokeOverlayId !== null && widget !== null) {
      try { widget.removeOverlay(strokeOverlayId) } catch (err) { /* ignore */ }
    } else if (strokeOverlayId !== null && strokePaneId !== null) {
      editor.selectPlaced(strokeOverlayId, strokePaneId)
    }
    strokePoints = []; strokeOverlayId = null; strokePaneId = null; strokePointerId = null
  }
  const freehandDown = (e: PointerEvent): void => {
    if (freehand() === null || widget === null) return
    if (!e.isPrimary || strokePointerId !== null) return
    const paneId = paneAt(e.clientX, e.clientY)
    if (paneId === null) return
    e.stopPropagation(); e.preventDefault()
    const p = toDataPoint(e.clientX, e.clientY, paneId)
    if (p === null) return
    strokePoints = [p]; strokeOverlayId = null; strokePaneId = paneId; strokePointerId = e.pointerId
    strokeLast = { x: e.clientX, y: e.clientY }
    try { (e.target as Element).setPointerCapture(e.pointerId) } catch (err) { /* ignore */ }
    // preventDefault above stops the browser's own focus move (SC-104): if
    // focus was outside this chart (e.g. a host chat composer beside it),
    // move it to the chart now, so an Escape right after the stroke reaches
    // this chart's key dispatcher instead of only the composer.
    if (widgetRef !== undefined) {
      const active = widgetRef.ownerDocument.activeElement
      if (active === null || !widgetRef.contains(active)) {
        try { (widgetRef.firstElementChild as HTMLElement | null)?.focus({ preventScroll: true }) } catch (err) { /* not focusable: harmless */ }
      }
    }
  }
  const freehandMove = (e: PointerEvent): void => {
    if (freehand() === null || widget === null || strokePoints.length === 0 || strokePaneId === null || e.pointerId !== strokePointerId) return
    e.stopPropagation()
    if (Math.hypot(e.clientX - strokeLast.x, e.clientY - strokeLast.y) < 3) return
    strokeLast = { x: e.clientX, y: e.clientY }
    const p = toDataPoint(e.clientX, e.clientY, strokePaneId)
    if (p === null) return
    strokePoints.push(p)
    // A stroke is a user drawing: prepare() puts it in the drawing group and
    // makes it editable (SC-119: prepareNew also picks up this tool's
    // remembered style). Created once, then overridden in place (fewer
    // remove+create round trips than the old per-move rebuild) — one entry
    // is recorded once, by prepare()'s own onDrawStart (SC-092), for the
    // single createOverlay call below; overrideOverlay on later moves is not
    // a drawStart/drawEnd, so it does not record a second one.
    const freehandName = freehand()
    if (strokeOverlayId === null && freehandName !== null) {
      const id = widget.createOverlay(editor.prepareNew({ name: freehandName, points: strokePoints.slice() }), strokePaneId)
      editor.track(id)
      strokeOverlayId = typeof id === 'string' ? id : (Array.isArray(id) && typeof id[0] === 'string' ? id[0] : null)
    } else if (strokeOverlayId !== null) {
      try { widget.overrideOverlay({ id: strokeOverlayId, points: strokePoints.slice() }) } catch (err) { /* ignore */ }
    }
  }
  const freehandUp = (e: PointerEvent): void => {
    if (e.pointerId !== strokePointerId) return
    e.stopPropagation()
    endStroke()
  }
  const freehandCancel = (e: PointerEvent): void => {
    if (e.pointerId !== strokePointerId) return
    e.stopPropagation()
    // Thrown away, not left as a stray partial stroke (SC-082: a touch
    // gesture the browser takes over, e.g. a second finger, fires this).
    if (strokeOverlayId !== null && widget !== null) {
      try { widget.removeOverlay(strokeOverlayId) } catch (err) { /* ignore */ }
    }
    strokePoints = []; strokeOverlayId = null; strokePaneId = null; strokePointerId = null
  }
  // While a stroke is armed, klinecharts must not see touch at all (SC-082):
  // otherwise it pans/pinches/long-presses under the finger. Desktop wheel
  // zoom and the chart's own scroll/zoom flags are left alone.
  const swallowTouchWhileFreehand = (e: TouchEvent): void => {
    if (freehand() !== null) {
      e.stopPropagation()
    }
  }
  // Escape leaves brush mode, and only that: through the chart's dispatcher,
  // so it is this chart's key and a dialog or menu gets it first (SC-105).
  const freehandEsc = (e: KeyboardEvent): boolean => {
    if (!isEscape(e) || freehand() === null) {
      return false
    }
    e.preventDefault()
    setFreehand(null)
    return true
  }
  // Ending freehand mode (Escape, re-clicking the brush, switching tools)
  // must also end any in-progress stroke, not just stop accepting new ones.
  createEffect(on(freehand, (mode, prev) => {
    if (mode === null && prev !== undefined && prev !== null && strokePoints.length > 0) {
      endStroke()
    }
  }))

  // ---- Quick measure (Shift+click, SC-125) -----------------------------------
  // An ephemeral priceDateRange outside the drawing group: never selected,
  // never listed by the rail's remove-all, not undoable. Two clicks place it
  // (klinecharts' own click handling, once a progress instance exists for
  // it); the next press removes it.
  let quickMeasureId: string | null = null
  const clearQuickMeasure = (): void => {
    if (quickMeasureId !== null && widget !== null) {
      try { widget.removeOverlay({ id: quickMeasureId }) } catch (err) { /* ignore */ }
    }
    quickMeasureId = null
  }
  const onQuickMeasurePointerDown = (e: PointerEvent): void => {
    if (!props.quickMeasure || widget === null) {
      return
    }
    if (quickMeasureId !== null) {
      // Still being placed (its own 1st/2nd point): let this press through to
      // klinecharts unchanged, or it would delete itself mid-placement. This
      // must check the store's progress-instance slot, not getOverlayById: an
      // overlay klinecharts still considers "being drawn" does not necessarily
      // show up there yet (it lives in that slot until finished), so comparing
      // against currentStep on whatever getOverlayById happens to return
      // treated a still-unfinished overlay as already finished and removed it
      // on the very click meant to complete it.
      if (progressInstanceId(widget) === quickMeasureId) {
        return
      }
      // Finished and waiting: this press removes it. The click that follows
      // is not swallowed, so host click handlers still fire.
      e.stopPropagation()
      clearQuickMeasure()
      return
    }
    if (e.button !== 0 || !e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) {
      return
    }
    if (armed() !== null || freehand() !== null || drawingInProgress(widget)) {
      return
    }
    const id = widget.createOverlay({
      name: 'priceDateRange',
      lock: true,
      onRemoved: () => { quickMeasureId = null; return false }
    })
    quickMeasureId = typeof id === 'string' ? id : (Array.isArray(id) && typeof id[0] === 'string' ? id[0] : null)
    // No stopPropagation: this same press should place the measure's first point.
  }

  // ---- Replay "pick a bar to start from" (SC-067) ----------------------------
  // Exclusive with freehand/drawing: a click while armed sets the replay
  // start index instead of drawing or placing an overlay.
  const replayPick = (e: PointerEvent): void => {
    if (!replayPicking() || widget === null) {
      return
    }
    e.stopPropagation(); e.preventDefault()
    const p = toDataPoint(e.clientX, e.clientY, 'candle_pane')
    if (p?.dataIndex === undefined) {
      return
    }
    replay.controls.start({ index: p.dataIndex })
    setReplayPicking(false)
  }
  const replayPickEsc = (e: KeyboardEvent): boolean => {
    if (!isEscape(e) || !replayPicking()) {
      return false
    }
    e.preventDefault()
    setReplayPicking(false)
    return true
  }

  // Escape also cancels a half-placed multi-point drawing (SC-090) — the
  // toolbar's own Escape (deselect) only runs once something is COMPLETE and
  // selected, so this is the only place that handles the in-progress case.
  const cancelInProgressEsc = (e: KeyboardEvent): boolean => {
    if (!isEscape(e)) {
      return false
    }
    if (editor.cancelInProgress()) {
      e.preventDefault()
      return true
    }
    return false
  }

  // Undo/redo/copy/paste/duplicate/nudge (SC-092, SC-109): registered on the
  // chart's key dispatcher at EDITOR priority, so a dialog or menu (POPOVER/
  // MODAL) still gets Ctrl+Z etc. first, and never while typing anywhere
  // (this editor's own inline text field, the toolbar's hex input, a host
  // field). preventDefault (and stopPropagation, via returning true) only
  // when the action actually did something, so an unhandled Ctrl+Z still
  // reaches the host page.
  const insideToolbarOrPopover = (target: EventTarget | null): boolean =>
    target instanceof Element && (target.closest('.klinecharts-pro-drawing-toolbar') !== null || target.closest('.klinecharts-pro-drawing-context-menu') !== null || target.closest('.klinecharts-pro-objects-panel') !== null)

  const editorShortcut = (e: KeyboardEvent): boolean => {
    if (isTextEntryTarget(e.target)) {
      return false
    }
    if (!e.ctrlKey && !e.metaKey) {
      // Arrow-key nudge: never while the toolbar's own grip has focus (it
      // already uses plain arrow keys to move the toolbar itself) or from
      // any other control.
      if (insideToolbarOrPopover(e.target) || e.altKey) {
        return false
      }
      const direction = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[e.key] as 'left' | 'right' | 'up' | 'down' | undefined
      if (direction === undefined) {
        return false
      }
      if (editor.nudge(direction, e.shiftKey)) {
        e.preventDefault()
        return true
      }
      return false
    }
    if (e.altKey) {
      return false
    }
    switch (e.key.toLowerCase()) {
      case 'z':
        if ((e.shiftKey ? editor.redo() : editor.undo())) {
          e.preventDefault()
          return true
        }
        return false
      case 'y':
        if (editor.redo()) {
          e.preventDefault()
          return true
        }
        return false
      case 'd':
        if (editor.selectedId !== null && editor.clone() !== null) {
          e.preventDefault()
          return true
        }
        return false
      case 'c':
        // A real text selection on the page: let the browser's own copy through.
        if ((window.getSelection()?.toString().length ?? 0) > 0) {
          return false
        }
        if (editor.copy()) {
          e.preventDefault()
          return true
        }
        return false
      case 'v':
        if (editor.paste() !== null) {
          e.preventDefault()
          return true
        }
        return false
      default:
        return false
    }
  }

  onMount(() => {
    window.addEventListener('resize', documentResize)
    const context = readEngineContext()
    const font = resolveCanvasFont(contentRef?.parentElement, props.canvasFont)
    // klinecharts keeps its own canvas-legend locale table and the drawing
    // tools' overlay labels live in module state (src/extension/labels.ts):
    // both need the initial locale before the first paint.
    ensureCanvasLocale(locale())
    setDrawingLabelSource(key => {
      const value = i18n(key, locale())
      return value === key ? undefined : value
    })
    const initStyles = styleStack.compose(context.theme, initLayers(context, font))
    // The legend (SC-042) goes into this same styles object — not a later
    // setStyles call — so mounting still lays the chart out exactly once.
    if (!hostConfiguredLegend()) {
      legendInstalledByUs = true
      setPath(initStyles, 'candle.tooltip.custom', buildLegendFn())
    }
    // Everything in one options object, so klinecharts lays the chart out once
    // with it instead of relayouting on each later setStyles/setLocale.
    widget = init(widgetRef!, {
      locale: locale(),
      timezone: timezone(),
      styles: initStyles,
      customApi: {
        formatBigNumber: (value: string | number) => formatBigNumber(value, locale(), props.numberUnits),
        // SC-021/SC-022: day-and-larger bars are read as a session date in
        // the symbol's own timezone (src/time/formatBarDate.ts), not the
        // chart's display zone — a daily bar at 00:00Z is that UTC date for
        // every viewer, as on TradingView, instead of one day early west of
        // UTC. Minute/hour bars are unchanged (the display zone), except a
        // boundary-format request ('YYYY' / 'YYYY-MM' / 'MM-DD') is now
        // answered instead of forced to 'HH:mm', so an intraday x-axis can
        // show which day a tick belongs to.
        formatDate: (dateTimeFormat: Intl.DateTimeFormat, timestamp, format: string, type: FormatDateType) => formatBarDate({
          displayDtf: dateTimeFormat,
          symbolTimezone: symbol()?.timezone,
          timespan: period().timespan,
          timestamp,
          format,
          type: type === FormatDateType.XAxis ? 'xAxis' : type === FormatDateType.Crosshair ? 'crosshair' : 'tooltip'
        })
      }
    })

    if (widget != null) {
      const chartForAxis = widget
      stickyAxis = attachStickyAxisWidth(chartForAxis)
      frameLoop = attachFrameLoop(chartForAxis, widgetRef, { onPanesAdded: () => { stickyAxis?.adopt() } })
      initialBarSpace = widget.getBarSpace()
      // What Settings > Restore defaults goes back to.
      setWidgetDefaultStyles(deepClone(widget.getStyles()))
      // Canvas text does not repaint when a font arrives: redraw once loaded.
      void fontsLoaded(widgetRef?.ownerDocument, [font]).then(() => { widget?.resize() })
      watermarkEl = createWatermark(props.watermark)
      widget.getDom('candle_pane', DomPosition.Main)?.appendChild(watermarkEl)

      const priceUnitContainer = widget.getDom('candle_pane', DomPosition.YAxis)
      priceUnitDom = document.createElement('span')
      priceUnitDom.className = 'klinecharts-pro-price-unit'
      priceUnitContainer?.appendChild(priceUnitDom)

      // The price-axis scale corner (SC-116) and the "scroll to latest"
      // button (SC-098) are rendered into klinecharts' own pane DOM — the
      // same technique the price-unit badge above uses — so they sit inside
      // that axis/pane's own box at any chart size with no manual measurement.
      if (props.priceScaleControls) {
        const anchor = document.createElement('div')
        anchor.className = 'klinecharts-pro-scale-controls-anchor'
        priceUnitContainer?.appendChild(anchor)
        disposeScaleControls = render(() => (
          <ScaleControls
            locale={locale()}
            scale={priceScale()}
            onTypeChange={t => { applyPriceScale({ type: t }) }}
            onReverseChange={r => { applyPriceScale({ reverse: r }) }}
            onFit={() => { applyPriceScale({ fit: true }) }}
          />
        ), anchor)
      }
      syncPriceScale()

      if (props.scrollToLatestButton) {
        goToLatestButton = document.createElement('button')
        goToLatestButton.type = 'button'
        goToLatestButton.className = 'klinecharts-pro-scroll-to-latest'
        goToLatestButton.setAttribute('aria-label', i18n('scroll_to_latest', locale()))
        goToLatestButton.title = i18n('scroll_to_latest', locale())
        goToLatestButton.textContent = '»'
        goToLatestButton.style.display = 'none'
        goToLatestButton.addEventListener('click', () => { widget?.scrollToRealTime() })
        widget.getDom('candle_pane', DomPosition.Main)?.appendChild(goToLatestButton)
      }
    }

    // SC-003: the widget follows its container only through CSS; nothing
    // resized klinecharts itself when the container changed size without a
    // window resize (a split pane, a sidebar, a host's own layout). One
    // resize per frame at most (the observer already batches to that), and
    // never at 0x0 (the chart hidden with display:none): resizing then loses
    // the user's scroll position, and every host would inherit that the
    // moment it deleted its own hand-rolled observer for this one.
    if (props.autoResize && typeof ResizeObserver !== 'undefined' && widgetRef !== undefined) {
      let lastSize: { width: number, height: number } | null = null
      resizeObserver = new ResizeObserver(entries => {
        const rect = entries[entries.length - 1]?.contentRect
        if (rect === undefined || rect.width === 0 || rect.height === 0) {
          return
        }
        if (lastSize !== null && lastSize.width === rect.width && lastSize.height === rect.height) {
          return
        }
        lastSize = { width: rect.width, height: rect.height }
        widget?.resize()
        relayoutPanes()
      })
      resizeObserver.observe(widgetRef)
    }

    props.mainIndicators.forEach(name => {
      const resolved = resolveIndicatorName(name)
      const paneId = createIndicator(widget, resolved, true, { id: 'candle_pane' })
      if (paneId !== null) ownedIndicators.add(ownerKey(paneId, resolved))
    })
    props.subIndicators.forEach(name => {
      const resolved = resolveIndicatorName(name)
      const paneId = createIndicator(widget, resolved)
      if (paneId !== null) ownedIndicators.add(ownerKey(paneId, resolved))
    })
    // subIndicatorPaneIds (SC-159) is a memo over indicators(), which only
    // re-reads the chart when indicatorsVersion changes: without this bump
    // its eager first computation (widget still null, ownedIndicators still
    // empty) stays cached forever, so the constructor's own subIndicators
    // never reach layoutPanes and the candle pane is never floor-protected.
    bumpIndicators(v => v + 1)
    relayoutPanes()
    chartData.attach(widget)
    widget?.subscribeAction(ActionType.OnTooltipIconClick, (data) => {
      if (data.indicatorName) {
        switch (data.iconId) {
          case 'visible': {
            widget?.overrideIndicator({ name: data.indicatorName, visible: true }, data.paneId)
            notifyIndicators({ type: 'updated', paneId: data.paneId, name: data.indicatorName, source: 'user' })
            break
          }
          case 'invisible': {
            widget?.overrideIndicator({ name: data.indicatorName, visible: false }, data.paneId)
            notifyIndicators({ type: 'updated', paneId: data.paneId, name: data.indicatorName, source: 'user' })
            break
          }
          case 'setting': {
            // SC-115: a missing instance (a stale event, or a chart teardown
            // mid-click) must not open the modal — the modal's own getConfig
            // fallback (src/widget/indicator-setting-modal) covers the other half,
            // an indicator name IndicatorSettingModal's data.ts does not list.
            const indicator = widget?.getIndicatorByPaneId(data.paneId, data.indicatorName) as Nullable<Indicator>
            if (indicator === null || indicator === undefined) break
            setIndicatorSettingModalParams({
              visible: true, indicatorName: data.indicatorName, paneId: data.paneId, calcParams: indicator.calcParams
            })
            break
          }
          case 'close': {
            widget?.removeIndicator(data.paneId, data.indicatorName)
            ownedIndicators.delete(ownerKey(data.paneId, data.indicatorName))
            notifyIndicators({ type: 'removed', paneId: data.paneId, name: data.indicatorName, source: 'user' })
            if (data.paneId !== 'candle_pane') {
              relayoutPanes()
            }
          }
        }
      }
    })

    // ---- navigation: wheel, keyboard, crosshair-over-axis, cursor (SC-096, SC-097, SC-099, SC-107) ----
    // Wheel, trackpad and pinch zoom, anchored on the bar under the cursor
    // (src/motion/wheelZoomMotion.ts); a mouse notch eases in with motion on,
    // everything else lands in the frame it arrives in. Its frames and the
    // fling's run on the frame loop, before the layers repaint. isMotionOn is
    // shared with the inertial pan below.
    const isMotionOn = (): boolean => props.motion && !prefersReducedMotion()
    const motionTarget = widget as unknown as KlineMotionChartLike | null
    const offInertialPan = widgetRef !== undefined && motionTarget !== null && frameLoop !== null
      ? attachInertialPan(widgetRef, klineInertiaChart(motionTarget), {
        clock: frameLoop.clock,
        isPanTarget: klinePlotTarget(motionTarget),
        isReducedMotion: () => !isMotionOn(),
        isSuspended: () => freehand() !== null || armed() !== null || replayState().active || holdController?.active() === true
      })
      : Object.assign(() => {}, { stop: () => {} })
    const wheelZoom = widgetRef !== undefined && motionTarget !== null && frameLoop !== null
      ? attachWheelZoom(widgetRef, klineWheelChart(motionTarget), () => props.wheel, {
        clock: frameLoop.clock,
        isReducedMotion: () => !isMotionOn(),
        onZoom: () => { offInertialPan.stop() }
      })
      : null
    const offWheel = (): void => { wheelZoom?.dispose() }
    // SC-NEXT #3: visible-range High/Low price-axis tags. They carry the two
    // prices and are placed by the live axis in the same paint as the
    // candles (no easing of their own since 2026-09-28: an eased tag trailed
    // the axis while it rescaled).
    const offHighLowTags = props.highLowTags && widget !== null
      ? (() => {
          const w = widget 
          return attachHighLowTags(w as unknown as Parameters<typeof attachHighLowTags>[0], {
            registerOverlay: registerOverlay as Parameters<typeof attachHighLowTags>[1]['registerOverlay'],
            formatPrice: value => utils.formatPrecision(value, resolvePricePrecision(symbol()?.pricePrecision, widget?.getDataList() ?? [])),
            actionTypes: [ActionType.OnVisibleRangeChange, ActionType.OnScroll, ActionType.OnZoom]
          })
        })()
      : () => {}
    // SC-NEXT #3: the bottom-right UTC/local clock toggle.
    const offClock = props.clock && widgetRef !== undefined && widget !== null
      ? (() => {
          const container = widget.getDom('candle_pane', DomPosition.Main) as HTMLElement | null
          if (container === null) return () => {}
          return attachClockWidget(container, {
            initialMode: clockMode(),
            onModeChange: mode => {
              setClockMode(mode)
              storageOrUndefined?.setItem('klinecharts-pro-clock-mode', mode)
            },
            labelFor: mode => i18n(mode === 'utc' ? 'clock_utc' : 'clock_local', props.locale),
            ariaLabel: i18n('clock_toggle', props.locale)
          })
        })()
      : () => {}
    // SC-NEXT #2: Volume Bars/Columns/High-Low/Step Line/HLC Area/Baseline/
    // Line-with-Markers/Heikin-Ashi — chart types with no native klinecharts
    // CandleType. Reactively kept in sync with the chartType signal below
    // (the createEffect near chartTypeStyles calls customSeriesOverlay.refresh()).
    customSeriesOverlay = widget !== null
      ? attachCustomSeriesOverlay(widget as unknown as Parameters<typeof attachCustomSeriesOverlay>[0], {
        getKind: () => (isCustomSeriesKind(chartType()) ? chartType() as CustomSeriesKind : null),
        registerOverlay: registerOverlay as Parameters<typeof attachCustomSeriesOverlay>[1]['registerOverlay']
      })
      : null
    const offKeyNav = widget !== null ? scope.keys.register(makeKeyNavHandler(widget, () => initialBarSpace), { priority: KEY_PRIORITY.CHART }) : () => {}
    const offCrosshairAxis = widgetRef !== undefined && widget !== null
      ? attachCrosshairOnYAxis(widgetRef, widget as unknown as Parameters<typeof attachCrosshairOnYAxis>[1], () => ['candle_pane', ...subIndicatorPaneIds()])
      : () => {}
    const offCursorReset = widget !== null
      ? attachCursorReset(widget as unknown as Parameters<typeof attachCursorReset>[0], ActionType.OnCrosshairChange)
      : () => {}
    // The icon's own hover label (SC-099's second half): the icons are bare
    // canvas glyphs with no native title.
    const offIconTooltip = widgetRef !== undefined && widget !== null
      ? attachIconTooltip(widgetRef, widget, { translate: key => i18n(key, props.locale) })
      : () => {}
    const offLatestTracking = widgetRef !== undefined && widget !== null
      ? attachLatestTracking(widgetRef, widget as unknown as Parameters<typeof attachLatestTracking>[1], [ActionType.OnVisibleRangeChange, ActionType.OnScroll, ActionType.OnZoom], atLatest => {
        if (goToLatestButton !== null) {
          goToLatestButton.style.display = atLatest ? 'none' : ''
        }
      })
      : () => {}

    // Bar-close countdown under the last-price tag (SC-052).
    const offCountdown = props.barCountdown && widget !== null
      ? attachBarCountdown(widget as unknown as Parameters<typeof attachBarCountdown>[0], {
        getPeriod: () => period(),
        registerOverlay: registerOverlay as Parameters<typeof attachBarCountdown>[1]['registerOverlay']
      })
      : () => {}

    // Type-to-search from the focused chart (SC-110): a printable a-z key
    // opens symbol search prefilled, unless a host input or another chart's
    // key dispatcher already owns it. Registered at CHART priority, same as
    // keyboard nav, so a modal/editor/popover still gets the key first.
    const offTypeToSearch = (props.keyboardShortcuts === true || (typeof props.keyboardShortcuts === 'object' && props.keyboardShortcuts.symbolSearch !== false))
      ? scope.keys.register(e => {
        if (widget === null || e.target !== widget.getDom() || hasCommandModifier(e) || e.isComposing) {
          return false
        }
        if (!/^[a-z]$/i.test(e.key)) {
          return false
        }
        e.preventDefault()
        openSymbolSearch(e.key)
        return true
      }, { priority: KEY_PRIORITY.CHART })
      : () => {}
    widgetRef?.addEventListener('pointerdown', replayPick, true)
    if (holdController !== null && widgetRef !== undefined) {
      if (holdOptions.guide !== false) {
        holdGuide = attachHoldGuide(widgetRef.parentElement ?? widgetRef, () => { holdController?.cancel() })
      }
      widgetRef.addEventListener('pointerdown', holdDown, true)
      widgetRef.addEventListener('pointermove', holdMove, true)
      widgetRef.addEventListener('pointerup', holdUp, true)
      widgetRef.addEventListener('pointerleave', holdLeave, true)
      widgetRef.addEventListener('lostpointercapture', holdLostCapture, true)
      widgetRef.addEventListener('mousemove', holdNativeMove, true)
      widgetRef.addEventListener('touchmove', holdNativeMove, { capture: true, passive: false })
      // Do not swallow native release: klinecharts installs mouseup/touchend on documentElement.
      widgetRef.addEventListener('mouseup', holdNativeEnd, true)
      widgetRef.addEventListener('touchend', holdNativeEnd, true)
      window.addEventListener('blur', holdCancel)
      const offHoldFocus = attachHoldFocusBoundary(props.root, () => widgetRef, holdController)
      // Pending holds do not capture the pointer: a release outside the plot must still clear their timer.
      window.addEventListener('pointerup', holdUp, true)
      window.addEventListener('pointercancel', holdPointerCancel, true)
      const offHoldKeys = scope.keys.register(e => holdController?.key(e) ?? false, { priority: KEY_PRIORITY.EDITOR + 1 })
      const offHoldHelpKeys = scope.keys.register(e => holdGuide?.key(e) ?? false, { priority: KEY_PRIORITY.POPOVER })
      onCleanup(() => {
        offHoldKeys(); offHoldHelpKeys()
        holdController?.dispose()
        holdGuide?.dispose()
        widgetRef?.removeEventListener('pointerdown', holdDown, true)
        widgetRef?.removeEventListener('pointermove', holdMove, true)
        widgetRef?.removeEventListener('pointerup', holdUp, true)
        widgetRef?.removeEventListener('pointerleave', holdLeave, true)
        widgetRef?.removeEventListener('lostpointercapture', holdLostCapture, true)
        widgetRef?.removeEventListener('mousemove', holdNativeMove, true)
        widgetRef?.removeEventListener('touchmove', holdNativeMove, true)
        widgetRef?.removeEventListener('mouseup', holdNativeEnd, true)
        widgetRef?.removeEventListener('touchend', holdNativeEnd, true)
        window.removeEventListener('blur', holdCancel)
        offHoldFocus()
        window.removeEventListener('pointerup', holdUp, true)
        window.removeEventListener('pointercancel', holdPointerCancel, true)
      })
    }
    widgetRef?.addEventListener('pointerdown', freehandDown, true)
    widgetRef?.addEventListener('pointermove', freehandMove, true)
    widgetRef?.addEventListener('pointerup', freehandUp, true)
    widgetRef?.addEventListener('pointerleave', freehandUp, true)
    widgetRef?.addEventListener('dblclick', widgetDblClick)
    widgetRef?.addEventListener('pointercancel', freehandCancel, true)
    widgetRef?.addEventListener('touchstart', swallowTouchWhileFreehand, true)
    widgetRef?.addEventListener('touchmove', swallowTouchWhileFreehand, true)
    widgetRef?.addEventListener('touchend', swallowTouchWhileFreehand, true)
    widgetRef?.addEventListener('pointerdown', onQuickMeasurePointerDown, true)
    const offReplayPickEsc = scope.keys.register(replayPickEsc, { priority: KEY_PRIORITY.EDITOR })
    const offFreehandEsc = scope.keys.register(freehandEsc, { priority: KEY_PRIORITY.EDITOR })
    // Escape cancels an armed-but-unfinished click-to-place tool; a second
    // Escape (nothing left armed) falls through to the toolbar's own
    // deselect (SC-094).
    const offArmedEsc = scope.keys.register(e => {
      if (!isEscape(e)) {
        return false
      }
      const current = armed()
      if (current === null || current.overlayId === null || widget === null) {
        return false
      }
      const overlay = widget.getOverlayById(current.overlayId)
      if (overlay === null || overlay.currentStep === -1) {
        return false
      }
      e.preventDefault()
      cancelTool()
      return true
    }, { priority: KEY_PRIORITY.EDITOR })
    // Escape also dismisses a quick measure (armed, or finished and waiting).
    const offQuickMeasureEsc = scope.keys.register(e => {
      if (!isEscape(e) || quickMeasureId === null) {
        return false
      }
      e.preventDefault()
      clearQuickMeasure()
      return true
    }, { priority: KEY_PRIORITY.EDITOR })
    // Drawing-tool hotkeys (SC-095): Alt+T/H/J/V/F, Alt+Shift+R.
    const offHotkeys = scope.keys.register(e => {
      if (props.hotkeys === false) {
        return false
      }
      const tool = chartHotkeyAction({
        code: e.code,
        altKey: e.altKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
        repeat: e.repeat,
        composing: e.isComposing,
        isTextEntry: isTextEntryTarget(e.target)
      })
      if (tool === null) {
        return false
      }
      e.preventDefault()
      armTool(tool)
      return true
    })
    // Safety net: a drag that ends outside the chart (released over host UI)
    // still clears the 'grabbing' cursor hint (SC-101).
    const onWindowPointerUp = (): void => { editor.clearDragHint() }
    window.addEventListener('pointerup', onWindowPointerUp)
    const offCancelInProgress = scope.keys.register(cancelInProgressEsc, { priority: KEY_PRIORITY.EDITOR })
    const offEditorShortcut = scope.keys.register(editorShortcut, { priority: KEY_PRIORITY.EDITOR })
    // The canvas follows its element's size, not only the window's (SC-085).
    // autoResize's own ResizeObserver above already does this when enabled
    // (the default): only run this one as the fallback for autoResize: false,
    // so a single container-size change never resizes the widget twice.
    const stopObserving = (!props.autoResize && widgetRef !== undefined) ? observeSize(widgetRef, documentResize) : () => {}
    onCleanup(() => {
      widgetRef?.removeEventListener('dblclick', widgetDblClick)
      offFreehandEsc()
      offArmedEsc()
      offQuickMeasureEsc()
      offHotkeys()
      window.removeEventListener('pointerup', onWindowPointerUp)
      offCancelInProgress()
      offEditorShortcut()
      stopObserving()
      offWheel()
      offInertialPan()
      offHighLowTags()
      frameLoop?.dispose()
      frameLoop = null
      stickyAxis?.dispose()
      stickyAxis = null
      offClock()
      customSeriesOverlay?.dispose()
      customSeriesOverlay = null
      offKeyNav()
      offCrosshairAxis()
      offCursorReset()
      offIconTooltip()
      offLatestTracking()
      offCountdown()
      offTypeToSearch()
      offReplayPickEsc()
      disposeScaleControls?.()
      goToLatestButton?.remove()
      goToLatestButton = null
    })
  })

  // Apply the cursor hint to the pane's own DOM node: klinecharts sets
  // style.cursor inline there, so setting it anywhere else (e.g. the widget
  // wrapper) is invisible (SC-101).
  createEffect(() => {
    const dom = widget?.getDom('candle_pane', DomPosition.Main) as HTMLElement | undefined
    if (dom === undefined) {
      return
    }
    dom.style.cursor = freehand() !== null || holdStatus().mode === 'drawing' ? 'crosshair' : (drawingCursor() ?? 'crosshair')
  })

  onCleanup(() => {
    holdController?.dispose()
    window.removeEventListener('resize', documentResize)
    resizeObserver?.disconnect()
    resizeObserver = undefined
    scope.dispose()
    widgetRef?.removeEventListener('pointerdown', replayPick, true)
    widgetRef?.removeEventListener('pointerdown', freehandDown, true)
    widgetRef?.removeEventListener('pointermove', freehandMove, true)
    widgetRef?.removeEventListener('pointerup', freehandUp, true)
    widgetRef?.removeEventListener('pointerleave', freehandUp, true)
    widgetRef?.removeEventListener('pointercancel', freehandCancel, true)
    widgetRef?.removeEventListener('touchstart', swallowTouchWhileFreehand, true)
    widgetRef?.removeEventListener('touchmove', swallowTouchWhileFreehand, true)
    widgetRef?.removeEventListener('touchend', swallowTouchWhileFreehand, true)
    widgetRef?.removeEventListener('pointerdown', onQuickMeasurePointerDown, true)
    clearQuickMeasure()
    // First: unsubscribes the datafeed and drops pending ticks before the chart goes.
    chartData.dispose()
    editor.dispose()
    // The Chart instance, not the element: klinecharts 9.1.1 cannot dispose an
    // element (it throws, and the chart DOM stays). Never pass null: 9.1.1
    // throws on that too.
    if (widget !== null) {
      dispose(widget)
      widget = null
    }
  })

  createEffect(() => {
    const s = symbol()
    if (s?.priceCurrency) {
      // textContent: priceCurrency can come from a datafeed or an agent.
      priceUnitDom.textContent = String(s.priceCurrency).toUpperCase()
      priceUnitDom.style.display = 'flex'
    } else {
      priceUnitDom.style.display = 'none'
    }
    // SC-020: an explicit pricePrecision (a number) always wins; 'auto' (or
    // omitted) derives from the loaded bars once they arrive (below). Before
    // they do (on mount, or right after a symbol/period change), this alone
    // derives from no bars, i.e. today's fallback of 2 — the same as before
    // this existed, for a series still loading.
    widget?.setPriceVolumePrecision(resolvePricePrecision(s?.pricePrecision, []), s?.volumePrecision ?? 0)
  })

  // The fresh bars a symbol/period change is about to draw (src/data/loader.ts's
  // 'bars' event, fired just before applyNewData): the one place 'auto'
  // precision can be derived from real data, before the axis and candles are
  // drawn at the wrong scale. Not re-derived for scroll-back, replay or ticks,
  // so the axis width does not jump while the user is looking at the chart.
  chartData.loader.on('bars', e => {
    widget?.setPriceVolumePrecision(resolvePricePrecision(symbol()?.pricePrecision, e.bars), symbol()?.volumePrecision ?? 0)
  })

  // A different symbol (symbol search or the host's setSymbol) saves and
  // clears the drawing editor's drawings for the OLD symbol: a drawing keeps
  // the old symbol's prices, so it would otherwise sit far off the new price
  // scale (or, on a similarly priced pair, look like a real level that was
  // never drawn there).
  createEffect(() => { editor.setDataContext(drawingsKeyOf(symbol())) })

  // Once the new symbol's history has actually settled (ready or genuinely
  // empty), restore whatever was saved for it. restoreForSymbol() itself
  // no-ops if a newer symbol change has since superseded this one.
  createEffect(on(() => chartData.status().state, state => {
    if (state === 'ready' || state === 'empty') {
      editor.restoreForSymbol(drawingsKeyOf(symbol()))
    }
  }))

  // The first run of each is in init()'s options (onMount).
  createEffect(on(theme, applyTheme, { defer: true }))

  createEffect(on(locale, l => {
    // klinecharts' own canvas-legend table and the drawing tools' overlay
    // labels (module state) follow the signal too, before the engine's full
    // repaint (setLocale) redraws everything against them.
    ensureCanvasLocale(l)
    setDrawingLabelSource(key => {
      const value = i18n(key, l)
      return value === key ? undefined : value
    })
    widget?.setLocale(l)
    // The legend's i18n labels are baked into a plain closure (not a Solid
    // component), so a locale change needs a fresh one — only when we are
    // the one who installed it; a host's own candle.tooltip.custom is never
    // touched.
    if (legendInstalledByUs) {
      reinstallLegend()
    }
  }, { defer: true }))

  // Chart type (TradingView-style): candles / hollow / bars / line / area. line and
  // area share klinecharts' 'area' type; line just drops the gradient fill.
  createEffect(on(chartType, ct => {
    engine = { ...engine, chartType: ct }
    widget?.setStyles(styleStack.over(theme(), chartTypeStyles(ct, accentOf(engine)), 'engine'))
    // SC-NEXT #2: creates/updates/removes the custom-series overlay for the
    // eight chart types with no native klinecharts CandleType.
    customSeriesOverlay?.refresh()
    // SC-NEXT #1: a chart-type switch fades in (widgetRef, not just the
    // candle pane, so the whole plot — axes and any sub-panes — dims and
    // un-dims together); a no-op under prefers-reduced-motion (CSS, index.less).
    if (props.motion) triggerFadeIn(widgetRef)
  }, { defer: true }))

  createEffect(on(timezone, tz => { widget?.setTimezone(tz) }, { defer: true }))

  // ---- Accessibility: language, name and description -----------------------
  // WCAG 3.1.2 (Language of Parts): the chrome is marked with the language it
  // is actually rendered in. A tag nobody registered strings for renders
  // English (src/i18n's fallback), so it is labelled 'en-US', never the tag
  // itself — labelling English text as (say) zh-TW would be a new mismatch.
  createEffect(() => {
    const lang = supportedLocales().includes(locale()) ? locale() : 'en-US'
    // SC-075 moved the engine's own root (props.root) one level inside the
    // host's container, so `container.closest('[lang]')` from outside no
    // longer finds it there; also set it on the container itself (the
    // root's parent) so a screen reader — or this exact lookup — still
    // finds the chart's language starting from the container.
    props.root.lang = lang
    if (props.root.parentElement !== null) {
      props.root.parentElement.lang = lang
    }
  })

  // A short, localized summary for screen readers: ticker, period, chart type,
  // and (as a visually-hidden description) last price / change over the
  // visible bars, high/low, timezone and active indicators. Recomputed on
  // every change that can make it stale; not aria-live, so it never
  // interrupts — a screen reader reads it when it lands on the chart.
  const chartLabel = createMemo(() => {
    if (props.ariaLabel.length > 0) {
      return props.ariaLabel
    }
    const s = symbol()
    return format(i18n('chart_label', locale()), {
      symbol: s?.shortName ?? s?.name ?? s?.ticker ?? '',
      period: period()?.text ?? '',
      type: chartTypeLabel(chartType(), locale())
    })
  })

  interface VisibleStats { last: number | null, change: number | null, high: number | null, low: number | null, bars: number }

  /** Price/change/high/low over the chart's current visible range (klinecharts
   *  indices), shared by the aria-description and describe(). */
  const visibleStats = (): VisibleStats => {
    let last: number | null = null
    let change: number | null = null
    let high: number | null = null
    let low: number | null = null
    let bars = 0
    try {
      if (widget !== null) {
        const range = widget.getVisibleRange()
        const data = widget.getDataList()
        const from = Math.max(0, range.realFrom)
        const to = Math.min(data.length - 1, range.realTo)
        const slice = data.slice(from, to + 1)
        bars = slice.length
        if (bars > 0) {
          const first = slice[0]
          const tail = slice[bars - 1]
          last = tail.close
          change = first.close !== 0 ? ((tail.close - first.close) / first.close) * 100 : 0
          high = Math.max(...slice.map(d => d.high))
          low = Math.min(...slice.map(d => d.low))
        }
      }
    } catch (e) { /* widget not ready yet */ }
    return { last, change, high, low, bars }
  }

  const chartSummary = (): string => {
    const l = locale()
    const s = symbol()
    const precision = resolvePricePrecision(s?.pricePrecision, widget?.getDataList() ?? [])
    const { last, change, high, low, bars } = visibleStats()
    const summaryIndicators = engineIndicatorNames()
    const fmt = (n: number | null): string => n === null ? '—' : n.toFixed(precision)
    return format(i18n('chart_summary', l), {
      last: fmt(last),
      change: change === null ? '—' : `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`,
      bars,
      high: fmt(high),
      low: fmt(low),
      timezone: timezoneLabel(timezone(), l),
      indicators: summaryIndicators.length > 0 ? summaryIndicators.join(', ') : i18n('none', l)
    })
  }

  const [chartSummaryText, setChartSummaryText] = createSignal('')
  const refreshChartSummary = (): void => {
    setChartSummaryText(props.ariaDescription.length > 0 ? props.ariaDescription : chartSummary())
  }

  // Every change that can make the summary stale: symbol/period (new data),
  // locale/timezone (labels), theme is irrelevant, and the indicator lists.
  createEffect(() => { symbol(); period(); locale(); timezone(); indicators(); chartData.status(); refreshChartSummary() })

  // The chart's own focus stop (klinecharts sets tabIndex=1 and inline
  // outline:none there, which both hijacks the host's tab order (SC-088) and
  // hides focus (SC-069)). Named and described here (SC-142); the chrome
  // around it (period bar, drawing rail, modals) keeps its own roles.
  createEffect(() => {
    const dom = widget?.getDom()
    if (dom == null) {
      return
    }
    dom.tabIndex = 0
    dom.style.outline = ''
    dom.setAttribute('role', 'img')
    dom.setAttribute('aria-roledescription', i18n('chart', locale()))
    dom.setAttribute('aria-label', chartLabel())
    dom.setAttribute('aria-describedby', descriptionId)
  })

  // Without the top bar there is nothing to fit: the forced class, or regular.
  createEffect(() => {
    if (!barShown()) {
      const mode = layoutMode()
      setSizeClass(mode === 'auto' ? 'regular' : mode)
    }
  })
  createEffect(() => { props.root.setAttribute('data-size', sizeClass()) })
  createEffect(on(sizeClass, (size, prev) => {
    if (size === 'narrow' && prev !== 'narrow') {
      if (barShown() && parts().railToggle && drawingBarVisible()) {
        railBeforeNarrow = true
        setDrawingBarVisible(false)
      }
    } else if (size !== 'narrow' && prev === 'narrow' && railBeforeNarrow !== null) {
      setDrawingBarVisible(railBeforeNarrow)
      railBeforeNarrow = null
    }
  }))

  return (
    <ChartScopeContext.Provider value={scope}>
      <Show when={symbolSearchModalVisible()}>
        <SymbolSearchModal
          locale={locale()}
          datafeed={props.datafeed}
          initialQuery={symbolSearchQuery()}
          recents={recentsStore}
          onSymbolSelected={symbol => { void applySymbol(symbol, 'user') }}
          onClose={() => { setSymbolSearchModalVisible(false); setSymbolSearchQuery('') }}/>
      </Show>
      <Show when={indicatorModalVisible()}>
        <IndicatorModal
          locale={locale()}
          indicators={indicators()}
          catalog={getIndicatorCatalog().filter(e => {
            const menu = props.indicatorMenu
            if (menu === undefined) return true
            return Array.isArray(menu) ? menu.includes(e.name) : menu(e)
          })}
          onClose={() => { setIndicatorModalVisible(false) }}
          onAdd={(entry, calcParams) => { addIndicatorV2(entry.name, { calcParams }, 'user') }}
          onRemove={name => {
            const found = findIndicator(widget, name)
            if (found !== null) removeIndicatorV2({ paneId: found.paneId, name }, 'user')
          }}/>
      </Show>
      <Show when={timezoneModalVisible()}>
        <TimezonePicker
          locale={locale()}
          timezone={timezone()}
          anchor={() => timezoneAnchorEl}
          onSelect={tz => {
            const changed = tz !== timezone()
            setTimezoneKey(tz)
            if (changed) {
              events.emit('timezoneChange', { timezone: tz, source: 'user' })
            }
          }}
          onClose={() => { setTimezoneModalVisible(false) }}
        />
      </Show>
      <Show when={settingModalVisible()}>
        <SettingModal
          locale={locale()}
          currentStyles={deepClone(widget!.getStyles())}
          chartType={chartType()}
          onChartTypeChange={ct => { applyChartType(ct, 'user') }}
          onClose={() => { setSettingModalVisible(false) }}
          onChange={style => {
            styleStack.addUser(style)
            widget?.setStyles(style)
          }}
          onRestoreDefault={(options: SelectDataSourceItem[]) => {
            // The chart type goes back to the configured one, through its owner.
            // Every other row loses its Settings value: what the host and the
            // engine set applies again, else the value the chart mounted with.
            const keys = options.map(option => option.key).filter(key => key !== CHART_TYPE_KEY)
            styleStack.clearUser(keys)
            const composed = styleStack.compose(theme(), themeLayers(readEngineContext()))
            const style = {}
            keys.forEach(key => {
              const value = getPath(composed, key)
              setPath(style, key, value !== undefined ? value : getPath(widgetDefaultStyles(), key))
            })
            widget?.setStyles(style)
            applyChartType(props.chartType, 'user')
          }}
        />
      </Show>
      <Show when={screenshotUrl().length > 0}>
        <ScreenshotModal
          locale={locale()}
          url={screenshotUrl()}
          filename={screenshotName()}
          onClose={() => { setScreenshotUrl('') }}
        />
      </Show>
      <Show when={props.commandPalette !== false && props.commandPalette !== undefined}>
        <CommandPalette
          getCommands={() => getCommandRegistry()}
          execute={chartApi.execute}
          titleFor={titleForCommand}
          hotkey={typeof props.commandPalette === 'object' ? props.commandPalette.hotkey : undefined}
        />
      </Show>
      <Show when={indicatorSettingModalParams().visible}>
        <IndicatorSettingModal
          locale={locale()}
          params={indicatorSettingModalParams()}
          onClose={() => { setIndicatorSettingModalParams({ visible: false, indicatorName: '', paneId: '', calcParams: [] }) }}
          onConfirm={(params)=> {
            const modalParams = indicatorSettingModalParams()
            widget?.overrideIndicator({ name: modalParams.indicatorName, calcParams: params }, modalParams.paneId)
          }}
        />
      </Show>
      <Show when={barShown()}>
      <PeriodBar
        locale={locale()}
        symbol={symbol()}
        headerSlotNode={headerSlotNode}
        spread={drawingBarVisible()}
        period={period()}
        periods={periods()}
        parts={parts()}
        layout={layoutMode()}
        onSizeClassChange={setSizeClass}
        onMenuClick={async () => {
          railBeforeNarrow = null
          try {
            await startTransition(() => setDrawingBarVisible(!drawingBarVisible()))
            widget?.resize()
          } catch (e) {}
        }}
        onSymbolClick={() => { symbolSearchModalVisible() ? setSymbolSearchModalVisible(false) : openSymbolSearch('') }}
        onPeriodChange={p => { void applyPeriod(p, 'user') }}
        chartType={chartType()}
        onChartTypeChange={ct => { applyChartType(ct, 'user') }}
        favouriteChartTypes={favouriteChartTypes()}
        onToggleFavouriteChartType={toggleFavouriteChartType}
        fullscreenEnabled={props.fullscreen !== false}
        fullscreen={scope.fullscreen.isFullscreen()}
        onFullscreenClick={() => { void scope.fullscreen.toggle() }}
        replay={replayState().active}
        onReplayClick={() => { if (replayState().active) { replay.controls.exit() } else { replay.controls.start() } }}
        onIndicatorClick={() => { setIndicatorModalVisible((visible => !visible)) }}
        indicatorCount={() => indicators().length}
        onTimezoneClick={() => { setTimezoneModalVisible((visible => !visible)) }}
        onTimezoneButtonRef={el => { timezoneAnchorEl = el }}
        onSettingClick={() => { setSettingModalVisible((visible => !visible)) }}
        onScreenshotClick={() => {
          const result = takeSnapshot()
          setScreenshotName(screenshotFilename(symbol().ticker, period().text, new Date(), 'png'))
          setScreenshotUrl(result.dataUrl)
        }}
      />
      </Show>
      <div
        ref={contentRef}
        class="klinecharts-pro-content">
        <DataStateLayer
          status={chartData.status()}
          locale={locale()}
          options={props.dataStates}
          drawingBarVisible={drawingBarVisible()}
          onRetry={chartData.reload}/>
        <Show when={drawingBarVisible()}>
          <DrawingBar
            locale={locale()}
            visible={drawingsVisible()}
            state={drawingBarState}
            armedTool={armed()?.name ?? (freehand() ?? null)}
            onDrawingItemClick={overlay => {
              if (typeof overlay.name === 'string') {
                armTool(overlay.name)
              }
            }}
            onModeChange={mode => { editor.setAllMode(mode as OverlayMode) }}
            onLockChange={lock => { editor.setAllLocked(lock) }}
            onVisibleChange={visible => {
              setDrawingsVisible(visible)
              editor.setAllVisible(visible)
            }}
            onRemoveClick={() => { editor.removeAll() }}/>
        </Show>
        {/* SC-151: the object tree's trigger. drawingBarVisible- and objectTree-gated. */}
        <Show when={drawingBarVisible() && props.objectTree}>
          <button
            ref={objectsPanelAnchorRef}
            type="button"
            class="klinecharts-pro-objects-trigger"
            aria-haspopup="dialog"
            aria-expanded={objectsPanelOpen()}
            title={i18n(TOOLBAR_LABELS.objectsPanelTitle, locale())}
            aria-label={i18n(TOOLBAR_LABELS.objectsPanelTitle, locale())}
            onClick={() => {
              refreshObjectsRows()
              setObjectsPanelOpen(v => !v)
            }}>▤</button>
          <Show when={objectsPanelOpen()}>
            <ObjectsPanel
              locale={props.locale}
              rows={objectsRows()}
              selectedId={editorSnapshot()?.id ?? null}
              anchor={() => objectsPanelAnchorRef}
              onSelect={id => { editor.select(id) }}
              onToggleVisible={(id, visible) => { editor.setDrawingVisible(id, visible); refreshObjectsRows() }}
              onToggleLocked={(id, locked) => { editor.setDrawingLocked(id, locked); refreshObjectsRows() }}
              onRemove={id => { editor.removeDrawing(id); refreshObjectsRows() }}
              onClose={() => { setObjectsPanelOpen(false) }}/>
          </Show>
        </Show>
        <div
          ref={widgetRef}
          class='klinecharts-pro-widget'
          data-freehand={freehand() ? 'true' : 'false'}
          style={freehand() ? 'cursor:crosshair' : ''}
          data-drawing-bar-visible={drawingBarVisible()}/>
        {/* The chart's aria-describedby target: visually hidden, never
            aria-live (it would announce on every recompute), read by a screen
            reader only when it lands on the chart's own focus stop. */}
        <span id={descriptionId} class="klinecharts-pro-visually-hidden">{chartSummaryText()}</span>
        <Show when={props.drawingToolbar && editorSnapshot() !== null}>
          <DrawingToolbar
            locale={locale()}
            snapshot={(editorSnapshot() ?? lastEditorSnapshot)!}
            selectionKey={editorSelectionKey()}
            chartElement={() => widgetRef}
            rootElement={() => contentRef?.parentElement ?? undefined}
            avoid={selectedDrawingAvoid}
            userPosition={() => toolbarUserPosition}
            onUserPositionChange={position => { toolbarUserPosition = position }}
            reservedBottom={toolbarReservedBottom}
            onStyleChange={change => { editor.applyStyle(change) }}
            onToggleLock={() => { editor.toggleLock() }}
            onDelete={() => { editor.remove() }}
            onClone={() => { editor.clone() }}
            onBringToFront={() => { editor.bringToFront() }}
            onSendToBack={() => { editor.sendToBack() }}
            onHide={() => {
              editor.hide()
              setDrawingsVisible(false)
            }}
            onDeselect={() => { editor.deselect() }}/>
        </Show>
        {/* SC-090: the right-click menu, in place of klinecharts' silent delete.
            keyed Show (not when={contextMenu() !== null} with a !-asserted
            contextMenu() in the children): that boolean form gives the
            condition and each prop its own independent read of the same
            signal, so closeMenu()/remove() setting it back to null could run
            before Show unmounts the child, crashing on contextMenu()!.anchor.
            keyed passes the raw, already non-null value into the callback,
            so it can never see it turn null out from under the render. */}
        <Show when={contextMenu()} keyed>
          {menu => (
            <DrawingContextMenu
              locale={locale()}
              anchor={menu.anchor}
              chartElement={() => widgetRef}
              locked={editorSnapshot()?.locked ?? false}
              canReorder={editorSnapshot()?.canReorder ?? false}
              onToggleLock={() => { editor.toggleLock() }}
              onClone={() => { editor.clone() }}
              onBringToFront={() => { editor.bringToFront() }}
              onSendToBack={() => { editor.sendToBack() }}
              onHide={() => {
                editor.hide()
                setDrawingsVisible(false)
              }}
              onDelete={() => { editor.remove() }}
              onClose={() => { editor.closeMenu() }}/>
          )}
        </Show>
        {/* SC-093: the inline text/image editor, in place of window.prompt().
            keyed Show, same reason as the context menu above: it hands the
            callback the already non-null value directly, so
            commitTextEdit/cancelTextEdit setting textEdit() back to null
            can't crash a prop read (textEdit()!.kind) that ran a beat too late. */}
        <Show when={textEdit()} keyed>
          {edit => (
            <TextEditor
              locale={locale()}
              kind={edit.kind}
              anchor={edit.anchor}
              chartElement={() => widgetRef}
              initialValue={edit.initial}
              onCommit={commitTextEdit}
              onCancel={cancelTextEdit}/>
          )}
        </Show>
        <Show when={replayState().active}>
          <ReplayBar
            ref={el => { replayBarRef = el }}
            locale={locale()}
            state={replayState()}
            picking={replayPicking()}
            onTogglePicking={() => { setReplayPicking(p => !p) }}
            onStepBack={() => { replay.controls.step(-1) }}
            onPlayPause={() => { replayState().playing ? replay.controls.pause() : replay.controls.play({ speed: replayState().speed }) }}
            onStepForward={() => { replay.controls.step(1) }}
            onSpeedChange={speed => { replay.controls.play({ speed }) }}
            onExit={() => { replay.controls.exit() }}/>
        </Show>
      </div>
    </ChartScopeContext.Provider>
  )
}

export default ChartProComponent
