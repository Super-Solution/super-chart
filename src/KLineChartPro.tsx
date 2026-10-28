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

import { render } from 'solid-js/web'

import { utils, type Nullable, type DeepPartial, type Styles, type Chart, type KLineData, type OverlayCreate } from 'klinecharts'

import type { ChartContext, ChartContextOptions } from './ai'
import type { SuperChartEventMap, SuperChartEventType } from './api/events'
import type { ChartStateV1, LoadState } from './api/state'
import ChartProComponent from './ChartProComponent'

import {
  type SymbolInfo, type Period, type ChartPro, type ChartProOptions, type SuperChartInstance, type Theme, type ChartType, type Locale, type SetStylesOptions,
  THEMES, CHART_TYPES, isTheme, isChartType, type LoadResult, type GetBarsOptions, type ChartDescription,
  type ChartParts, type LayoutMode, type SizeClass, LAYOUT_MODES, isLayoutMode, type FullscreenMode, type FullscreenOption,
  type IndicatorHandle, type IndicatorSnapshot, type AddIndicatorOptions, type IndicatorChangeEvent,
  type PriceScale, type ReplayControls, type SnapshotOptions, type SnapshotResult,
  type DrawingRecord, type DrawingListRow, type HostOverlayOptions,
  type AddDrawingSpec, type UpdateDrawingChanges, type DrawingLevel, type DrawingCrossEvent,
  type AnnotationSpec, type SetAnnotationsResult,
  type ChartLayoutV1, type ApplyLayoutOptions, type ApplyLayoutResult,
  type ExecuteRequest, type ExecuteResult, type ToToolDefinitionsOptions, type ToolDefinition, type CommandDescriptor
} from './types'
import type { IndicatorCatalogEntry, DrawingToolCatalogEntry } from './indicators/catalog'
import type { StyleChange, StyleRecord } from './drawing-editor/styles'
import { ChartDisposedError } from './errors'
import { splitChartType } from './theme/styleStack'
import { negotiateLocale, resolveLocale, viewerLanguages } from './i18n'
import { localTimeZone } from './widget/timezone-modal/data'
import { mergeDeep } from './common/object'
import { mountRoot, type MountedRoot } from './layout/hostRoot'
import type { WatermarkOption } from './watermark'

// Bare-chart default (SC-046, adopted): no high/low price marks — a busy
// first load otherwise. This is a style, not a theme colour, so it belongs
// here (the host layer) rather than in theme/engine.ts's canvasTheme(): it
// must survive setTheme (the host layer does) and stay overridable by a
// host's own `styles.candle.priceMark.high/low.show`, which mergeDeep here
// (host wins, applied last) leaves alone.
const BARE_STYLE_DEFAULTS: DeepPartial<Styles> = {
  candle: { priceMark: { high: { show: false }, low: { show: false } } }
}

const FULLSCREEN_OPTIONS: readonly FullscreenOption[] = ['auto', 'native', 'pseudo', false]
function isFullscreenOption (value: unknown): value is FullscreenOption {
  return (FULLSCREEN_OPTIONS as readonly unknown[]).includes(value)
}

/** A known value, or the fallback with a console warning (JSON callers bypass TypeScript). */
function checked<T extends string> (what: string, value: unknown, known: readonly T[], isKnown: (v: unknown) => v is T, fallback: T): T {
  if (value === undefined || isKnown(value)) {
    return value ?? fallback
  }
  console.warn(`[super-chart] unknown ${what} ${JSON.stringify(value)}; expected one of ${known.join(', ')}. Using '${fallback}'.`)
  return fallback
}

export default class KLineChartPro implements SuperChartInstance {
  constructor (options: ChartProOptions) {
    if (typeof document === 'undefined') {
      // Importing the package is safe on a server; rendering a chart is not.
      throw new Error('SuperChart needs a DOM: create it in the browser (for example in an effect), not during server rendering.')
    }
    const theme = checked<Theme>('theme', options.theme, THEMES, isTheme, 'light')
    // A candle.type in `styles` is the initial chart type when `chartType` is not given.
    const chartType = checked<ChartType>('chartType', options.chartType ?? splitChartType(options.styles).chartType, CHART_TYPES, isChartType, 'candle_solid')
    const layout = checked<LayoutMode>('layout', options.layout, LAYOUT_MODES, isLayoutMode, 'auto')
    let fullscreen: FullscreenOption = options.fullscreen ?? 'auto'
    if (!isFullscreenOption(fullscreen)) {
      console.warn(`[super-chart] unknown fullscreen ${JSON.stringify(fullscreen)}; expected 'auto', 'native', 'pseudo' or false. Using 'auto'.`)
      fullscreen = 'auto'
    }
    if (utils.isString(options.container)) {
      this._container = document.getElementById(options.container)
      if (this._container == null) {
        throw new Error('Container is null')
      }
    } else {
      this._container = options.container 
    }
    // The engine renders into its own root inside the container; the
    // container keeps only the theme (SC-075, src/layout/hostRoot.ts).
    const mounted = mountRoot(this._container, { theme, headless: options.headless ?? false })
    this._root = mounted

    this._dispose = render(
      () => (
        <ChartProComponent
          ref={(chart: ChartPro) => { this._chartApi = chart }}
          root={mounted.root}
          parts={options.parts ?? {}}
          layout={layout}
          fullscreen={fullscreen}
          onFullscreenChange={change => { options.onFullscreenChange?.(change) }}
          styles={mergeDeep(BARE_STYLE_DEFAULTS, options.styles ?? {})}
          themeStyles={options.themeStyles ?? {}}
          canvasTheme={options.canvasTheme ?? true}
          canvasFont={options.canvasFont ?? ''}
          watermark={options.watermark ?? ''}
          headerSlot={options.headerSlot ?? null}
          theme={theme}
          // Resolved the same way at every entry point (see ChartPro.setLocale):
          // an explicit tag is matched to a supported locale (never passed
          // through raw); with none given, the first of the viewer's languages
          // that resolves to one, else en-US.
          locale={options.locale !== undefined ? resolveLocale(options.locale) : negotiateLocale(viewerLanguages())}
          numberUnits={options.numberUnits ?? 'western'}
          ariaLabel={options.ariaLabel ?? ''}
          ariaDescription={options.ariaDescription ?? ''}
          drawingBarVisible={options.drawingBarVisible ?? true}
          drawingToolbar={options.drawingToolbar ?? true}
          drawingBar={options.drawingBar ?? {}}
          hotkeys={options.hotkeys ?? ((options.drawingBarVisible ?? true) ? 'focus' : false)}
          quickMeasure={options.quickMeasure ?? true}
          drawByHolding={options.drawByHolding ?? false}
          headless={options.headless ?? false}
          chartType={chartType}
          symbol={options.symbol}
          period={options.period}
          periods={
            options.periods ?? [
              { multiplier: 1, timespan: 'minute', text: '1m' },
              { multiplier: 5, timespan: 'minute', text: '5m' },
              { multiplier: 15, timespan: 'minute', text: '15m' },
              { multiplier: 1, timespan: 'hour', text: '1H' },
              { multiplier: 2, timespan: 'hour', text: '2H' },
              { multiplier: 4, timespan: 'hour', text: '4H' },
              { multiplier: 1, timespan: 'day', text: 'D' },
              { multiplier: 1, timespan: 'week', text: 'W' },
              { multiplier: 1, timespan: 'month', text: 'M' },
              { multiplier: 1, timespan: 'year', text: 'Y' }
            ]
          }
          // The viewer's own zone (D10: viewer-local, never a fixed zone) —
          // never a UI sentinel, so it can go straight to klinecharts.
          timezone={options.timezone ?? localTimeZone()}
          // A bare chart shows no overlay indicator (adopted default); the
          // slim volume pane is the only one on by default.
          mainIndicators={options.mainIndicators ?? []}
          subIndicators={options.subIndicators ?? ['VOL']}
          datafeed={options.datafeed}
          dataStates={options.dataStates ?? true}
          tickThrottleMs={options.tickThrottleMs ?? 0}
          autoResize={options.autoResize ?? true}
          historyCache={options.historyCache === false ? false : (options.historyCache ?? { max: 8, ttlMs: 600_000 })}
          indicatorMenu={options.indicatorMenu}
          wheel={options.wheel ?? 'zoom'}
          barCountdown={options.barCountdown ?? true}
          motion={options.motion ?? true}
          highLowTags={options.highLowTags ?? true}
          clock={options.clock ?? true}
          paneLayout={options.paneLayout ?? 'auto'}
          priceScaleControls={options.priceScaleControls ?? true}
          onPriceScaleChange={scale => { options.onPriceScaleChange?.(scale) }}
          scrollToLatestButton={options.scrollToLatestButton ?? true}
          keyboardShortcuts={options.keyboardShortcuts ?? !(options.headless ?? false)}
          onSymbolSearchRequest={query => options.onSymbolSearchRequest?.(query) ?? false}
          symbolSearch={options.symbolSearch ?? {}}
          customPeriods={options.customPeriods ?? false}
          onReplayChange={state => { options.onReplayChange?.(state) }}
          onHistoryChange={() => { options.onHistoryChange?.() }}
          onDrawingsChange={() => { options.onDrawingsChange?.() }}
          onDrawingDefaultsChange={() => { options.onDrawingDefaultsChange?.() }}
          drawingsKey={options.drawingsKey ?? (symbol => symbol.ticker)}
          objectTree={options.objectTree ?? true}
          commandPalette={options.commandPalette ?? false}
          onLayoutChange={() => { options.onLayoutChange?.() }}
          layoutPersistKey={options.layoutPersistKey ?? ''}/>

      ),
      mounted.root
    )
  }

  private _container: Nullable<HTMLElement>

  private _root: Nullable<MountedRoot> = null

  private _chartApi: Nullable<ChartPro> = null

  // Solid render disposer, so the chart can be torn down (dispose()).
  private _dispose: Nullable<() => void> = null

  private _disposed = false

  /** The live chart API, or ChartDisposedError after dispose(). */
  private _api (method: string): ChartPro {
    if (this._disposed || this._chartApi === null) {
      throw new ChartDisposedError(method)
    }
    return this._chartApi
  }

  /** An unknown theme is ignored with a console warning; the chart keeps its theme. */
  setTheme (theme: Theme): void {
    const api = this._api('setTheme')
    if (!isTheme(theme)) {
      console.warn(`[super-chart] unknown theme ${JSON.stringify(theme)}; expected one of ${THEMES.join(', ')}. Keeping '${api.getTheme()}'.`)
      return
    }
    this._root?.setTheme(theme)
    api.setTheme(theme)
  }

  getTheme (): Theme {
    return this._api('getTheme').getTheme()
  }

  /**
   * Merge styles now and keep them over the engine's theme (they survive
   * setTheme). With `{ theme }` they are kept for that theme only. An unknown
   * theme is ignored with a console warning.
   */
  setStyles (styles: DeepPartial<Styles>, options?: SetStylesOptions): void {
    const api = this._api('setStyles')
    if (options?.theme !== undefined && !isTheme(options.theme)) {
      console.warn(`[super-chart] unknown theme ${JSON.stringify(options.theme)} in setStyles; expected one of ${THEMES.join(', ')}. Ignored.`)
      return
    }
    api.setStyles(styles, options)
  }

  /** Re-read the chrome's CSS custom properties into the canvas theme. */
  refreshTheme (): void {
    this._api('refreshTheme').refreshTheme()
  }

  getStyles (): Styles {
    return this._api('getStyles').getStyles()
  }

  setLocale (locale: Locale): void {
    this._api('setLocale').setLocale(locale)
  }

  getLocale (): Locale {
    return this._api('getLocale').getLocale()
  }

  setTimezone (timezone: string): void {
    this._api('setTimezone').setTimezone(timezone)
  }

  getTimezone (): string {
    return this._api('getTimezone').getTimezone()
  }

  // Not async: _api() must throw ChartDisposedError synchronously (this
  // class's contract for every method, asserted in e2e/tests/lifecycle.spec.ts),
  // not as a rejected promise — an async wrapper would turn that throw into
  // a rejection instead.
  // eslint-disable-next-line @typescript-eslint/promise-function-async
  setSymbol (symbol: SymbolInfo): Promise<LoadResult> {
    return this._api('setSymbol').setSymbol(symbol)
  }

  getSymbol (): SymbolInfo {
    return this._api('getSymbol').getSymbol()
  }

  // eslint-disable-next-line @typescript-eslint/promise-function-async
  setPeriod (period: Period | string): Promise<LoadResult> {
    return this._api('setPeriod').setPeriod(period)
  }

  getPeriod (): Period {
    return this._api('getPeriod').getPeriod()
  }

  reload (): void {
    this._api('reload').reload()
  }

  /** The underlying klinecharts instance; null before mount and after dispose(). */
  getChart (): Nullable<Chart> {
    return this._disposed ? null : this._chartApi?.getChart() ?? null
  }

  resize (): void {
    this._api('resize').resize()
  }

  getPricePrecision (): number {
    return this._api('getPricePrecision').getPricePrecision()
  }

  /** Resolves once the first load (mount or a later change) has settled — ready, empty or error. */
  get ready (): Promise<void> {
    return this._api('ready').ready
  }

  getLoadState (): LoadState {
    return this._api('getLoadState').getLoadState()
  }

  getBars (options?: GetBarsOptions): KLineData[] {
    return this._api('getBars').getBars(options)
  }

  on<K extends SuperChartEventType> (type: K, listener: (event: SuperChartEventMap[K]) => void): () => void {
    return this._api('on').on(type, listener)
  }

  off<K extends SuperChartEventType> (type: K, listener: (event: SuperChartEventMap[K]) => void): void {
    this._api('off').off(type, listener)
  }

  getState (): ChartStateV1 {
    return this._api('getState').getState()
  }

  getContext (options?: ChartContextOptions): ChartContext {
    return this._api('getContext').getContext(options)
  }

  async setVisibleRange (range: { from: number, to: number }): Promise<{ covered: boolean, from: number, to: number }> {
    return await this._api('setVisibleRange').setVisibleRange(range)
  }

  async scrollToTime (timestamp: number, options?: { animate?: boolean }): Promise<{ reached: boolean, firstLoaded: number }> {
    return await this._api('scrollToTime').scrollToTime(timestamp, options)
  }

  primeHistory (symbol: SymbolInfo, period: Period, bars: KLineData[]): void {
    this._api('primeHistory').primeHistory(symbol, period, bars)
  }

  invalidateHistory (symbol?: SymbolInfo, period?: Period): void {
    this._api('invalidateHistory').invalidateHistory(symbol, period)
  }

  describe (): ChartDescription {
    return this._api('describe').describe()
  }

  /**
   * Switch the chart type, as the top bar and Settings do (they share this
   * one owner). An unknown type is refused with a console warning: false.
   */
  setChartType (type: ChartType): boolean {
    return this._api('setChartType').setChartType(type)
  }

  getChartType (): ChartType {
    return this._api('getChartType').getChartType()
  }

  /** Show or remove single controls of the chrome (merged over the current parts). */
  setParts (parts: Partial<ChartParts>): void {
    this._api('setParts').setParts(parts)
  }

  getParts (): ChartParts {
    return this._api('getParts').getParts()
  }

  /** Force a size class ('regular', 'compact', 'narrow'), or 'auto'. */
  setLayoutMode (mode: LayoutMode): void {
    this._api('setLayoutMode').setLayoutMode(mode)
  }

  /** The size class the chrome is in now. */
  getSizeClass (): SizeClass {
    return this._api('getSizeClass').getSizeClass()
  }

  /** Replace the top bar's periods (the current one stays if listed, else the first loads). */
  setPeriods (periods: Period[]): void {
    this._api('setPeriods').setPeriods(periods)
  }

  getPeriods (): Period[] {
    return this._api('getPeriods').getPeriods()
  }

  setDrawingBarVisible (visible: boolean): void {
    this._api('setDrawingBarVisible').setDrawingBarVisible(visible)
  }

  isDrawingBarVisible (): boolean {
    return this._api('isDrawingBarVisible').isDrawingBarVisible()
  }

  /** Text (never parsed as HTML), a Node, a function returning one, or '' for none. */
  setWatermark (watermark: WatermarkOption): void {
    this._api('setWatermark').setWatermark(watermark)
  }

  /** Enter full screen; resolves with the mode entered or null. Never rejects. */
  async enterFullscreen (): Promise<FullscreenMode | null> {
    return await this._api('enterFullscreen').enterFullscreen()
  }

  /** Leave this chart's full screen (never the host's own). Never rejects. */
  async exitFullscreen (): Promise<void> {
    await this._api('exitFullscreen').exitFullscreen()
  }

  isFullscreen (): boolean {
    return this._api('isFullscreen').isFullscreen()
  }

  /** A theme-correct capture with metadata (SC-015): the screenshot button uses this too. */
  snapshot (options?: SnapshotOptions): SnapshotResult {
    return this._api('snapshot').snapshot(options)
  }

  /** Scrolls to the newest bar. */
  scrollToLatest (options?: { animationMs?: number }): void {
    this._api('scrollToLatest').scrollToLatest(options)
  }

  /** Scrolls to the newest bar, restores the mounted bar space, and turns price-axis auto-scale back on. */
  resetView (): void {
    this._api('resetView').resetView()
  }

  scrollToTimestamp (timestamp: number, options?: { animationMs?: number }): void {
    this._api('scrollToTimestamp').scrollToTimestamp(timestamp, options)
  }

  /** Sets the price axis's scale (SC-116). `fit: true` re-fits without changing type/reverse. */
  setPriceScale (scale: Partial<PriceScale> & { fit?: true }): void {
    this._api('setPriceScale').setPriceScale(scale)
  }

  getPriceScale (): PriceScale {
    return this._api('getPriceScale').getPriceScale()
  }

  /** Opens symbol search (or calls `onSymbolSearchRequest` when the host provides one), prefilled with `query`. */
  openSymbolSearch (query?: string): void {
    this._api('openSymbolSearch').openSymbolSearch(query)
  }

  /** Bar replay (SC-067): `.start()`, `.step()`, `.play()`, `.pause()`, `.exit()`, `.getState()`. */
  get replay (): ReplayControls {
    return this._api('replay').replay
  }

  /** Arm a drawing tool, as clicking the rail does (SC-095). Re-arming the same tool cancels it (SC-094). */
  armTool (name: string): void {
    this._api('armTool').armTool(name)
  }

  /** Cancel the tool armed by the rail, a hotkey or armTool(), if any. */
  cancelTool (): void {
    this._api('cancelTool').cancelTool()
  }

  /** "Stay in drawing mode": a finished click-to-place tool re-arms instead of disarming. */
  setDrawingStayMode (stay: boolean): void {
    this._api('setDrawingStayMode').setDrawingStayMode(stay)
  }

  getDrawingStayMode (): boolean {
    return this._api('getDrawingStayMode').getDrawingStayMode()
  }

  undo (): boolean {
    return this._api('undo').undo()
  }

  redo (): boolean {
    return this._api('redo').redo()
  }

  canUndo (): boolean {
    return this._api('canUndo').canUndo()
  }

  canRedo (): boolean {
    return this._api('canRedo').canRedo()
  }

  getDrawings (key?: string): DrawingRecord[] {
    return this._api('getDrawings').getDrawings(key)
  }

  setDrawings (records: readonly DrawingRecord[], key?: string): void {
    this._api('setDrawings').setDrawings(records, key)
  }

  clearDrawings (key?: string): void {
    this._api('clearDrawings').clearDrawings(key)
  }

  listDrawings (): DrawingListRow[] {
    return this._api('listDrawings').listDrawings()
  }

  setDrawingVisible (id: string, visible: boolean): void {
    this._api('setDrawingVisible').setDrawingVisible(id, visible)
  }

  setDrawingLocked (id: string, locked: boolean): void {
    this._api('setDrawingLocked').setDrawingLocked(id, locked)
  }

  removeDrawing (id: string): void {
    this._api('removeDrawing').removeDrawing(id)
  }

  getDrawingDefaults (name: string): StyleRecord | null {
    return this._api('getDrawingDefaults').getDrawingDefaults(name)
  }

  setDrawingDefaults (name: string, changes: readonly StyleChange[]): void {
    this._api('setDrawingDefaults').setDrawingDefaults(name, changes)
  }

  clearDrawingDefaults (name: string): void {
    this._api('clearDrawingDefaults').clearDrawingDefaults(name)
  }

  addHostOverlay (create: OverlayCreate, options?: HostOverlayOptions): string | null {
    return this._api('addHostOverlay').addHostOverlay(create, options)
  }

  isDisposed (): boolean {
    return this._disposed
  }

  // ---- AI/MCP command layer (additive — SC-123) ----------------------------
  async execute (request: ExecuteRequest): Promise<ExecuteResult> {
    return await this._api('execute').execute(request)
  }

  getCommands (): readonly CommandDescriptor[] {
    return this._api('getCommands').getCommands()
  }

  toToolDefinitions (options?: ToToolDefinitionsOptions): ToolDefinition[] {
    return this._api('toToolDefinitions').toToolDefinitions(options)
  }

  // ---- drawings API (additive — SC-127, SC-135, SC-180) --------------------
  addDrawing (spec: AddDrawingSpec): string | null {
    return this._api('addDrawing').addDrawing(spec)
  }

  updateDrawing (id: string, changes: UpdateDrawingChanges): boolean {
    return this._api('updateDrawing').updateDrawing(id, changes)
  }

  listDrawingTools (): string[] {
    return this._api('listDrawingTools').listDrawingTools()
  }

  async setDrawingTool (tool: string | null): Promise<string | null> {
    return await this._api('setDrawingTool').setDrawingTool(tool)
  }

  drawingLevelsAt (id: string, timestamp: number): DrawingLevel[] | null {
    return this._api('drawingLevelsAt').drawingLevelsAt(id, timestamp)
  }

  onDrawingCross (cb: (event: DrawingCrossEvent) => void, options?: { ids?: readonly string[] }): () => void {
    return this._api('onDrawingCross').onDrawingCross(cb, options)
  }

  // ---- declarative annotation layers (additive — SC-128) -------------------
  setAnnotations (layer: string, specs: readonly AnnotationSpec[]): SetAnnotationsResult {
    return this._api('setAnnotations').setAnnotations(layer, specs)
  }

  getAnnotations (layer?: string): AnnotationSpec[] {
    return this._api('getAnnotations').getAnnotations(layer)
  }

  clearAnnotations (layer: string): void {
    this._api('clearAnnotations').clearAnnotations(layer)
  }

  // ---- layout save/restore (additive — SC-121) ------------------------------
  getLayout (): ChartLayoutV1 {
    return this._api('getLayout').getLayout()
  }

  applyLayout (layout: ChartLayoutV1, options?: ApplyLayoutOptions): ApplyLayoutResult {
    return this._api('applyLayout').applyLayout(layout, options)
  }

  onLayoutChange (cb: () => void): () => void {
    return this._api('onLayoutChange').onLayoutChange(cb)
  }

  // ---- Indicators (v2, additive — SC-114/SC-133/SC-152) --------------------
  getIndicators (): IndicatorSnapshot[] {
    return this._api('getIndicators').getIndicators()
  }

  addIndicator (name: string, options?: AddIndicatorOptions): Nullable<IndicatorHandle> {
    return this._api('addIndicator').addIndicator(name, options)
  }

  updateIndicator (handle: IndicatorHandle, changes: { calcParams?: unknown[], visible?: boolean, styles?: DeepPartial<Styles> }): boolean {
    return this._api('updateIndicator').updateIndicator(handle, changes)
  }

  removeIndicator (handle: IndicatorHandle): boolean {
    return this._api('removeIndicator').removeIndicator(handle)
  }

  setIndicatorVisible (name: string, visible: boolean, paneId?: string): boolean {
    return this._api('setIndicatorVisible').setIndicatorVisible(name, visible, paneId)
  }

  setIndicatorParams (name: string, calcParams: unknown[], paneId?: string): boolean {
    return this._api('setIndicatorParams').setIndicatorParams(name, calcParams, paneId)
  }

  openIndicatorSettings (name: string, paneId?: string): boolean {
    return this._api('openIndicatorSettings').openIndicatorSettings(name, paneId)
  }

  onIndicatorsChange (cb: (event: IndicatorChangeEvent) => void): () => void {
    return this._api('onIndicatorsChange').onIndicatorsChange(cb)
  }

  getIndicatorCatalog (): IndicatorCatalogEntry[] {
    return this._api('getIndicatorCatalog').getIndicatorCatalog()
  }

  getDrawingToolCatalog (): DrawingToolCatalogEntry[] {
    return this._api('getDrawingToolCatalog').getDrawingToolCatalog()
  }

  addIndicatorCatalogEntries (entries: readonly IndicatorCatalogEntry[]): void {
    this._api('addIndicatorCatalogEntries').addIndicatorCatalogEntries(entries)
  }

  setIndicatorCatalog (entries: readonly IndicatorCatalogEntry[]): void {
    this._api('setIndicatorCatalog').setIndicatorCatalog(entries)
  }

  /**
   * Tear the chart down and empty its container. Idempotent: later calls do
   * nothing. If the teardown itself throws, the container is still emptied and
   * the instance still counts as disposed; the error is then rethrown.
   */
  dispose (): void {
    if (this._disposed) {
      return
    }
    this._disposed = true
    const container = this._container
    const root = this._root
    const disposeRender = this._dispose
    this._dispose = null
    this._chartApi = null
    this._container = null
    this._root = null
    try {
      disposeRender?.()
    } finally {
      root?.dispose()
      if (container !== null) {
        container.innerHTML = ''
      }
    }
  }
}
