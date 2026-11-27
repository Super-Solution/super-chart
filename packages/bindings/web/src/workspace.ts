/* eslint-disable @typescript-eslint/promise-function-async -- Load methods validate synchronously and return the shared queue promise without an async wrapper. */
import { EngineChart, type EngineChartOptions, type EngineConfiguration } from './chart'
import { formatDateQuery, parseDateQuery } from './goToDate'
import { CompareOverlays, type CompareInfo } from './compareOverlay'
import { ENGINE_CHART_TYPES, DRAWING_TYPES, DERIVED_STYLES, createDerivedSeriesPort, DataLoader, resolvePricePrecision, symbolKey, periodKey, parsePeriod, WorkspaceEventBus, WorkspaceLoadQueue, createTimedReplay, createBarCountdown, compileSymbolSession, sessionBarClose, sessionKindAt, parseWorkspaceDocument, checkTimeZone, formatUtcOffset, timeZoneChoices, localTimeZone, COMMON_TIME_ZONES, INDICATOR_GROUPS, indicatorInfo, indicatorLabel, searchIndicators, type IndicatorDefinition, type EngineChartType, type DrawingType, type PriceScaleOptions, type DataStatus, type LoaderOptions, type ChartDataPort, type DerivedSeriesPort, type DerivedStyle, type DerivedStyleOptions, type Datafeed, type Period, type SymbolInfo, type MarketBar, type WorkspaceEvents, type WorkspaceLoadResult, type WorkspaceLoadState, type WorkspaceMarket, type WorkspaceReplayState, type WorkspaceState, type TimedReplay, type BarCountdown, type WorkspaceDocumentV1, type SessionIssue, type TradingSession } from '@supersolutions/super-chart-core'
import { DatafeedMarks, MARKS_LAYER, type WorkspaceMarksState } from './datafeedMarks'
import { EngineAnnotations, attachAnnotationIntents, type AnnotationIntentEvent, type EngineAnnotationTheme } from './annotations'
import { themeName } from './tokens'
import type { HoldDrawEvent } from './holdDraw'
import { AUTO_THEME, WORKSPACE_CHROME_VARS, followColorScheme, getWorkspaceTheme, listWorkspaceThemes, resolveThemeName, type WorkspaceChromeKey, type WorkspaceThemeName } from './theme'
import { createTranslator, resolveLocale, type Translator } from './i18n'
import { resolveLayout, resolveIntervalControl, validLayoutMode, validIntervalControl, type WorkspaceLayoutMode, type WorkspaceLayoutClass, type WorkspaceIntervalControl } from './layout'
import { CommandRegistry, validateCommand, type WorkspaceCommand } from './commands'
import { CommandPalette, ContextMenu, type ContextMenuItem } from './panels'
import { createIcon, type IconName } from './icons'
import { ToolRail } from './toolRail'
import { DrawingToolbar } from './drawingToolbar'
import { DrawingDocuments, type WorkspaceDrawingCacheOptions } from './drawingDocuments'
import { WORKSPACE_STYLE } from './workspaceStyle'
import { CHART_TYPE_GROUPS } from './chartTypes'
import { hotkeyFor, toolHotkey } from './hotkeys'
import { TECHNICAL_INDICATOR_DEFINITIONS, CLASSIC_INDICATOR_DEFINITIONS } from '@supersolutions/super-chart-core/indicators'
import { WORKSPACE_RANGES, rangeStart, firstBarFrom, type WorkspaceRange } from './ranges'
import { moveActiveIndex, decideEnter, createRecentsStore, visibleRecents, type RecentsStore } from './symbolSearchNav'

/** What opened the symbol search, so a host replacing it can tell a click from a typed letter. */
export interface SymbolSearchRequest {
  /** The text to start with: the letter typed on the chart, a command-palette query, or empty. */
  readonly query: string
  readonly trigger: 'button' | 'keyboard' | 'command' | 'api'
}

export interface WorkspaceSearchOptions {
  /**
   * Replace the built-in search panel. Called whenever it would open (symbol button, a letter typed on the chart,
   * the command palette, `openSymbolSearch()`). Return `true` when the host handled it, for example by opening its
   * own picker and calling `setSymbol` later; the built-in panel then stays closed. Return anything else to let
   * the built-in panel open. A throwing handler is reported in the notice line and the built-in panel opens.
   */
  // `void` so a handler that opens a picker and returns nothing type-checks; only `true` means handled.
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
  onRequest?: (request: SymbolSearchRequest) => boolean | void
  /** In-memory recents by default. Set zero to disable; at most 50. */
  recentLimit?: number
  initialRecent?: readonly SymbolInfo[]
  /** Explicit host namespace enables persistence; no default global storage key. */
  persistKey?: string
  storage?: Pick<Storage, 'getItem' | 'setItem'>
}

/** Scoped workspace chrome. Canvas colours remain in chart.render. */
/** Named places a host can put its own elements in the chrome. See `ChartWorkspace.getSlot`. */
export type WorkspaceSlotName = 'header-start' | 'header-end' | 'drawing-start' | 'drawing-end' | 'footer-start' | 'footer-end'
export const WORKSPACE_SLOTS: readonly WorkspaceSlotName[] = Object.freeze(['header-start', 'header-end', 'drawing-start', 'drawing-end', 'footer-start', 'footer-end'])
/** Parts of the chrome a host can switch off one by one. `headless` switches off every one of them. */
export type WorkspacePart = 'symbol' | 'intervals' | 'presentation' | 'indicators' | 'objects' | 'drawingBar' | 'toolRail' | 'drawingToolbar' | 'footer' | 'rangeBar' | 'scaleBar' | 'commands'
export const WORKSPACE_PARTS: readonly WorkspacePart[] = Object.freeze(['symbol', 'intervals', 'presentation', 'indicators', 'objects', 'drawingBar', 'toolRail', 'drawingToolbar', 'footer', 'rangeBar', 'scaleBar', 'commands'])

export interface WorkspaceAppearanceOptions {
  /** Additional root classes for host styles; .sc-workspace always remains. */
  className?: string
  density?: 'compact' | 'comfortable'
  /** CSS custom properties only; values inherit from the host when omitted. */
  variables?: Readonly<Partial<Record<`--sc-${string}`, string>>>
  /**
   * Canvas only: no market bar, drawing bar, footer, status, notice or replay controls. The workspace keeps
   * loading data, replay, drawings, the command palette (keyboard) and the API; the host supplies any chrome it
   * wants through the API or `getSlot`. Default false.
   */
  headless?: boolean
  /**
   * Chrome size class. `regular` has labelled tools; `compact` shows icons and moves secondary actions into a More
   * menu; `narrow` also collapses the drawing tools behind a Tools button and shows intervals as one dropdown.
   * `auto` (default) follows the workspace's own width (see `LAYOUT_BREAKPOINTS`).
   */
  layout?: WorkspaceLayoutMode
  /** Intervals as a row of buttons (`bar`), a dropdown (`select`), or `auto` (bar unless the layout is narrow; default). */
  intervals?: WorkspaceIntervalControl
  /** Show or hide single parts of the chrome, for example `{ symbol: false }` when the host has its own symbol picker. */
  parts?: Readonly<Partial<Record<WorkspacePart, boolean>>>
  /** Elements to mount in the named slots at construction. Host-owned content; they are removed with the workspace. */
  slots?: Readonly<Partial<Record<WorkspaceSlotName, Node>>>
}

/** What a context menu is asked about. */
export interface WorkspaceContextTarget {
  /** Pointer position in client coordinates. */
  readonly x: number
  readonly y: number
  /** The retained drawing under the pointer, when there is one. */
  readonly drawingId: string | null
  /** Price and time under the pointer, or null outside the plot. */
  readonly point: { readonly timestamp: number, readonly price: number } | null
}

export interface WorkspaceContextMenuOptions {
  /** Add host entries. Return `[]` for none. Entries come after the built-in ones, after a divider. */
  items?: (target: WorkspaceContextTarget) => readonly ContextMenuItem[]
}

export interface WorkspaceCommandOptions {
  /** Turn the palette off entirely, including its shortcut. Default true. */
  enabled?: boolean
  /** Open on Ctrl/Cmd+K while the workspace has focus. Default true. */
  shortcut?: boolean
  /** Extra commands registered at construction; `registerCommand` adds more later. */
  items?: readonly WorkspaceCommand[]
}

export interface ChartWorkspaceOptions {
  datafeed: Datafeed
  symbol: SymbolInfo
  period: Period
  periods?: readonly Period[]
  chart?: EngineChartOptions
  /**
   * `light` or `dark` for the chrome and the canvas colours; `chart.render` colours still win. `auto` follows the page's
   * `prefers-color-scheme` and switches live. Leave it out to keep the dark default and restyle through the existing
   * `--sc-*` CSS custom properties (see `WORKSPACE_CHROME_VARS`).
   */
  theme?: WorkspaceThemeName
  /** Language of the chrome text: a registered locale tag (see `registerLocale`). Default `en`. */
  locale?: string
  loader?: Omit<LoaderOptions, 'datafeed' | 'env'>
  search?: WorkspaceSearchOptions
  ui?: WorkspaceAppearanceOptions
  /** Command palette: built-in commands plus the host's own. */
  commands?: WorkspaceCommandOptions
  /** Right-click menu on the chart. `false` leaves the browser's menu alone. Default on. */
  contextMenu?: boolean | WorkspaceContextMenuOptions
  /** Host persistence for completed edits; only acknowledged documents are evicted from memory. */
  drawingCache?: WorkspaceDrawingCacheOptions
  /** Bar-close countdown: the period estimate, or the real close when the symbol has a `session`. Disable it, or supply the exchange's own close, which wins. */
  countdown?: { enabled?: boolean, closeTimestamp?: (market: WorkspaceMarket, lastBar: MarketBar) => number | null }
  /**
   * `catalog` (default true) registers the technical and classic indicator packs, about 50 more indicators next to the seven
   * built-ins, so the Indicators menu, the palette and documents can name them. `false` keeps only the built-ins.
   */
  indicators?: { catalog?: boolean }
}

/** What the price-mode control offers: the real bars, Heikin Ashi, and the price-driven styles. */
export type WorkspacePriceMode = 'raw' | 'heikin-ashi' | DerivedStyle
const PRICE_MODES: readonly WorkspacePriceMode[] = Object.freeze(['raw', 'heikin-ashi', ...DERIVED_STYLES] as const)
/** The result of `getSessionState()`. */
export type WorkspaceSessionState =
  | { readonly status: 'none' }
  | { readonly status: 'active', readonly timezone: string, readonly newestBar: 'regular' | 'pre' | 'post' | 'closed' | null }
  | { readonly status: 'invalid', readonly issues: readonly SessionIssue[] }
/** Event marks listed in the Objects menu; the rest are counted. */
const MARK_ROWS = 50
const EMPTY_DRAWINGS = '{"version":1,"drawings":[]}'
const DEFAULT_PERIODS: readonly Period[] = [
  { multiplier: 1, timespan: 'minute', text: '1m' }, { multiplier: 5, timespan: 'minute', text: '5m' },
  { multiplier: 15, timespan: 'minute', text: '15m' }, { multiplier: 1, timespan: 'hour', text: '1h' },
  { multiplier: 4, timespan: 'hour', text: '4h' }, { multiplier: 1, timespan: 'day', text: '1D' }
]
const pairKey = (symbol: SymbolInfo, period: Period): string => `${symbolKey(symbol)}:${periodKey(period)}`
const label = (value: string): string => value.replace(/-/g, ' ')
function validTheme (theme: unknown): WorkspaceThemeName {
  if (typeof theme !== 'string' || (theme !== AUTO_THEME && getWorkspaceTheme(theme) === undefined)) throw new TypeError(`Workspace theme must be "auto" or one of ${listWorkspaceThemes().map(name => JSON.stringify(name)).join(', ')} (see registerWorkspaceTheme)`)
  return theme
}
/** "Name · interval · exchange", the way the legend opens. The ticker stands in for a missing name. */
function legendTitleOf (symbol: SymbolInfo, period: Period): string {
  const name = symbol.name !== undefined && symbol.name !== '' ? symbol.name : symbol.ticker
  return [name, period.text ?? `${period.multiplier}${period.timespan}`, symbol.exchange].filter(part => part !== undefined && part !== '').join(' · ')
}
/** The faint name behind the candles: the ticker, and under it the name and the interval. */
function watermarkOf (symbol: SymbolInfo, period: Period): { title: string, subtitle?: string } {
  const text = period.text ?? `${period.multiplier}${period.timespan}`
  const subtitle = [symbol.name !== undefined && symbol.name !== '' && symbol.name !== symbol.ticker ? symbol.name : undefined, text].filter(part => part !== undefined).join(', ')
  return { title: symbol.ticker, subtitle }
}
function validSymbol (symbol: SymbolInfo): SymbolInfo {
  if (typeof symbol?.ticker !== 'string' || symbol.ticker.trim() === '') throw new TypeError('A symbol ticker is required')
  return { ...symbol }
}
function validPeriod (period: Period): Period {
  if (!Number.isSafeInteger(period?.multiplier) || period.multiplier <= 0 || typeof period.timespan !== 'string' || period.timespan.trim() === '' || typeof period.text !== 'string') {
    throw new TypeError('A positive interval and timespan are required')
  }
  return { ...period }
}

function validParts (parts: Readonly<Partial<Record<WorkspacePart, boolean>>> | undefined): Partial<Record<WorkspacePart, boolean>> {
  if (parts === undefined) return {}
  if (parts === null || typeof parts !== 'object') throw new TypeError('ui.parts must be an object')
  const result: Partial<Record<WorkspacePart, boolean>> = {}
  for (const [name, value] of Object.entries(parts)) {
    if (!(WORKSPACE_PARTS as readonly string[]).includes(name)) throw new RangeError(`Unknown workspace part ${JSON.stringify(name)}; use one of ${WORKSPACE_PARTS.join(', ')}`)
    if (typeof value !== 'boolean') throw new TypeError(`ui.parts.${name} must be true or false`)
    result[name as WorkspacePart] = value
  }
  return result
}
function toolCategory (type: DrawingType): string {
  return /fibonacci|gann/.test(type) ? 'group.fibonacci' : /waves|abcd/.test(type) ? 'group.patterns'
    : /vwap|volume-profile/.test(type) ? 'group.studies' : /brush|highlighter/.test(type) ? 'group.freehand'
      : /channel|pitchfork|regression/.test(type) ? 'group.channels' : /position|range|forecast/.test(type) ? 'group.measurement'
        : /text|note|callout|signpost|pin|image|label|flag|arrow/.test(type) ? 'group.annotations'
          : /horizontal|vertical|segment|ray|trend-line|price-line/.test(type) ? 'group.lines' : 'group.shapes'
}

/** DOM controls for the owned engine. This is not the legacy Pro API compatibility surface. */
export class ChartWorkspace {
  readonly chart: EngineChart
  /**
   * Host-owned marks drawn over the chart (levels, zones, markers, trend lines, Fibonacci, trade plans and any
   * template the host registers). They are scoped to the displayed market, hidden while it loads, kept out of the
   * person's drawings and undo history, and listed under Overlays in the object tree.
   */
  readonly annotations: EngineAnnotations
  private marks!: DatafeedMarks
  /** The symbol's trading schedule once checked; `null` when it has none or it was refused. */
  private tradingSession: { session: TradingSession | null, issues: readonly SessionIssue[] } = { session: null, issues: [] }
  /** Constructor load outcome; same-tick market changes share its final request. */
  readonly ready: Promise<WorkspaceLoadResult>
  private readonly doc: Document
  private readonly win: Window & typeof globalThis
  private readonly abort: AbortController
  private loader: DataLoader
  /** Between the loader and the chart: shows the feed as Renko, line break, range bars or Kagi when asked. */
  private readonly derived!: DerivedSeriesPort
  /** Chart type to bring back when a style drawn with its own chart type (Kagi as a step line, point and figure) is left. */
  private typeBeforeStyle: EngineChartType | null = null
  private timedReplay: TimedReplay
  private readonly countdown: BarCountdown
  private readonly loaderOptions: ChartWorkspaceOptions['loader']
  private readonly loads: WorkspaceLoadQueue
  private readonly events: WorkspaceEventBus
  private readonly loaderUnsubscribe: Array<() => void> = []
  private readonly datafeed: Datafeed
  private readonly root: HTMLDivElement
  private tr: Translator
  private locale: string
  private readonly bindings: Array<() => void> = []
  private readonly commandRegistry = new CommandRegistry()
  private readonly palette: CommandPalette
  private readonly contextMenu: ContextMenu
  private readonly contextOptions: WorkspaceContextMenuOptions | null
  private readonly paletteEnabled: boolean
  private readonly paletteShortcut: boolean
  private readonly searchRequest: WorkspaceSearchOptions['onRequest']
  private ui: { headless: boolean, layout: WorkspaceLayoutMode, intervals: WorkspaceIntervalControl, parts: Partial<Record<WorkspacePart, boolean>> }
  private layoutClass: WorkspaceLayoutClass = 'regular'
  private themeName: WorkspaceThemeName | null
  private stopFollowingScheme: (() => void) | null = null
  private toolsOpen = false
  private readonly slots = new Map<WorkspaceSlotName, HTMLElement>()
  private readonly toolbar: HTMLDivElement
  private readonly drawingBar: HTMLDivElement
  private readonly footer: HTMLDivElement
  private readonly scaleBar: HTMLDivElement
  private readonly rangeBar: HTMLDivElement
  private readonly clockNode: HTMLSpanElement
  private clockTimer: number | null = null
  private readonly percentButton: HTMLButtonElement
  private readonly logButton: HTMLButtonElement
  private readonly secondary: HTMLDivElement
  private readonly parts: { presentation: HTMLDetailsElement, indicators: HTMLDetailsElement, objects: HTMLDetailsElement, more: HTMLDetailsElement }
  private readonly toolsToggle: HTMLButtonElement
  private readonly paletteButton: HTMLButtonElement
  private readonly autoButton: HTMLButtonElement
  private readonly zoneSelect: HTMLSelectElement
  private zoneListFull = false
  private marksToggle: HTMLButtonElement | null = null
  private zoneId: string
  private readonly intervalBar: HTMLDivElement
  private readonly intervalField: HTMLLabelElement
  private readonly countdownNode: HTMLSpanElement
  private readonly objectList: HTMLDivElement
  private readonly holdNote: HTMLDivElement
  private readonly intentListeners = new Set<(event: AnnotationIntentEvent) => void>()
  private readonly objectsMenu: HTMLDetailsElement
  private objectsDirty = true
  private readonly refreshIndicatorsUi: () => void = () => {}
  private readonly fullscreenSync: () => void = () => {}
  private resizeObserver: ResizeObserver | null = null
  private readonly chartHost: HTMLDivElement
  private readonly drawingToolbar: DrawingToolbar
  private readonly statusNode: HTMLDivElement
  private readonly stageStatus: HTMLDivElement
  private readonly replayControls: HTMLDivElement
  private readonly downloadButton: HTMLButtonElement
  private downloading = false
  private reportedStatusUI = ''
  private readonly notice: HTMLDivElement
  private readonly symbolButton: HTMLButtonElement
  private readonly periodSelect: HTMLSelectElement
  private readonly drawingSelect: HTMLSelectElement
  private readonly rail: ToolRail
  private readonly drawingField: HTMLLabelElement
  private readonly clearButton: HTMLButtonElement
  private readonly history: HTMLDivElement
  private readonly drawingActions: HTMLDivElement
  private readonly drawingModes: HTMLDivElement
  private stayInDrawing = false
  private lastTool: DrawingType | null = null
  private arrangement = ''
  private readonly indicatorSearch: HTMLInputElement
  private readonly indicatorResults: HTMLDivElement
  private readonly syncPresentation: () => void
  private readonly syncChartTypeMenu: (type: string) => void
  private readonly typeMenuRoot: HTMLDetailsElement
  private readonly searchPanel: HTMLDivElement
  private readonly searchInput: HTMLInputElement
  private readonly searchResults: HTMLUListElement
  private readonly searchStatus: HTMLDivElement
  private readonly recents: RecentsStore
  private readonly recentLimit: number
  private searchSymbols: SymbolInfo[] = []
  private searchActive = -1
  private searchShownQuery = ''
  private searchLoading = false
  private readonly retryButton: HTMLButtonElement
  /** Settings and remove, shown beside the legend row of the indicator the pointer is on. */
  private readonly legendActions: HTMLDivElement
  private legendTarget: string | null = null
  private legendHideTimer = 0
  private readonly olderButton: HTMLButtonElement
  private readonly replayInfo: HTMLSpanElement
  private readonly replayButtons: { start: HTMLButtonElement, back: HTMLButtonElement, next: HTMLButtonElement, play: HTMLButtonElement, exit: HTMLButtonElement }
  private readonly replaySpeed: HTMLSelectElement
  private readonly hideAllButton: HTMLButtonElement
  private compares!: CompareOverlays
  private searchPurpose: 'symbol' | 'compare' = 'symbol'
  private readonly drawingButtons: { undo: HTMLButtonElement, redo: HTMLButtonElement, lock: HTMLButtonElement, remove: HTMLButtonElement }
  private readonly unsubscribe: Array<() => void> = []
  private readonly drawingDocuments: DrawingDocuments
  private drawingSaveTimer: number | null = null
  private readonly persistentDrawings: boolean
  private lastDrawingList: unknown = null
  private importingDrawings = false
  private readonly downloads = new Map<number, string>()
  private readonly actions = new WeakMap<HTMLButtonElement, () => unknown>()
  private symbol: SymbolInfo
  /** Whether the legend's title follows the symbol; a host that passed its own `render.legendTitle` keeps it. */
  private readonly ownLegendTitle: boolean
  private readonly ownWatermark: boolean
  private period: Period
  private readonly periods: Period[]
  private scale: PriceScaleOptions
  private drawingSymbol: string | null = null
  private displayedPair: string | null = null
  private pending = false
  private waitingStart = false
  // The loader releases this through applyMoreData, including its delayed
  // failure acknowledgement. Repeated edge gestures must not cancel a page.
  private olderPending = false
  private applyError: unknown = null
  private cancelled = false
  private reportedLoadState = ''
  private reportedReplayState = ''
  private searchAbort: AbortController | null = null
  private searchTimer: number | null = null
  private searchGeneration = 0
  private disposed = false
  private restoreGeneration = 0
  private pendingRestore: { generation: number, key: string, configuration: EngineConfiguration, applied: boolean } | null = null

  constructor (host: HTMLElement, options: ChartWorkspaceOptions) {
    // Name the misuse instead of failing on the first property read.
    if (host === null || typeof host !== 'object' || host.ownerDocument == null) throw new TypeError('ChartWorkspace needs a host HTMLElement to mount into')
    if (options === null || typeof options !== 'object') throw new TypeError('ChartWorkspace needs options: { datafeed, symbol, period }')
    if (typeof options.datafeed?.getHistoryKLineData !== 'function') throw new TypeError('options.datafeed must implement getHistoryKLineData(symbol, period, from, to)')
    this.doc = host.ownerDocument
    if (this.doc.defaultView === null) throw new Error('Workspace host needs an active document')
    this.win = this.doc.defaultView 
    this.abort = new this.win.AbortController()
    this.loads = new WorkspaceLoadQueue(callback => { this.win.queueMicrotask(callback); }, result => { this.events.emit('loadResult', result); })
    this.events = new WorkspaceEventBus((...args) => { this.win.console.warn(...args); }, callback => { this.win.queueMicrotask(callback); })
    this.loaderOptions = options.loader
    this.drawingDocuments = new DrawingDocuments(options.drawingCache)
    this.persistentDrawings = options.drawingCache !== undefined
    this.datafeed = options.datafeed
    this.ownLegendTitle = options.chart?.render?.legendTitle === undefined
    this.ownWatermark = options.chart?.render?.watermark === undefined
    this.symbol = validSymbol(options.symbol); this.period = validPeriod(options.period)
    this.recentLimit = options.search?.recentLimit ?? 8
    if (!Number.isSafeInteger(this.recentLimit) || this.recentLimit < 0 || this.recentLimit > 50) throw new RangeError('Recent-symbol limit must be from 0 to 50')
    let recentStorage = options.search?.storage
    if (options.search?.persistKey !== undefined) {
      if (typeof options.search.persistKey !== 'string' || options.search.persistKey.trim() === '' || options.search.persistKey.length > 256) throw new RangeError('Recent-symbol storage needs a bounded nonempty host key')
      try { recentStorage ??= this.win.localStorage } catch { /* Storage can be disabled by the host. */ }
    }
    this.recents = createRecentsStore({
      max: this.recentLimit,
      persistKey: options.search?.persistKey === undefined ? undefined : `owned:${options.search.persistKey}`,
      seed: options.search?.initialRecent?.slice(0, this.recentLimit).map(symbol => symbolKey(validSymbol(symbol)))
    }, recentStorage)
    this.periods = [...(options.periods ?? DEFAULT_PERIODS)].map(validPeriod)
    if (!this.periods.some(period => periodKey(period) === periodKey(this.period))) this.periods.push(this.period)
    this.scale = { ...options.chart?.layout?.priceScale }
    this.locale = resolveLocale(options.locale); this.tr = createTranslator(this.locale)
    this.root = this.node('div')
    this.root.className = 'sc-workspace'
    if (options.ui?.className !== undefined) this.root.classList.add(...options.ui.className.split(/\s+/).filter(Boolean))
    const density = options.ui?.density ?? 'compact'
    if (density !== 'compact' && density !== 'comfortable') throw new TypeError('Unknown workspace density')
    this.root.dataset.density = density
    this.ui = {
      headless: options.ui?.headless === true,
      layout: validLayoutMode(options.ui?.layout ?? 'auto'),
      intervals: validIntervalControl(options.ui?.intervals ?? 'auto'),
      parts: validParts(options.ui?.parts)
    }
    this.themeName = options.theme ?? null
    if (options.theme !== undefined) this.applyChromeTheme(resolveThemeName(validTheme(options.theme), this.win))
    for (const [name, value] of Object.entries(options.ui?.variables ?? {})) {
      if (!/^--sc-[a-z0-9-]+$/.test(name) || typeof value !== 'string') throw new TypeError('Workspace variables must use --sc- names and string values')
      this.root.style.setProperty(name, value)
    }
    this.searchRequest = options.search?.onRequest
    if (this.searchRequest !== undefined && typeof this.searchRequest !== 'function') throw new TypeError('search.onRequest must be a function')
    this.contextOptions = options.contextMenu === undefined || options.contextMenu === true ? {} : options.contextMenu === false ? null : options.contextMenu
    this.paletteEnabled = options.commands?.enabled !== false
    this.paletteShortcut = options.commands?.shortcut !== false
    const style = this.node('style'); style.textContent = WORKSPACE_STYLE; this.root.append(style)
    this.bind(() => { this.root.setAttribute('aria-label', this.t('workspace.label')); })
    this.listen(this.root, 'click', event => {
      const button = event.target instanceof this.win.Element ? event.target.closest('button') : null
      if (!this.disposed && button instanceof this.win.HTMLButtonElement && !button.disabled) this.actions.get(button)?.()
    })
    for (const name of WORKSPACE_SLOTS) {
      const slot = this.node('div'); slot.className = 'sc-slot'; slot.dataset.slot = name
      this.slots.set(name, slot)
      const given = options.ui?.slots?.[name]
      if (given !== undefined) {
        if (!(given instanceof this.win.Node)) throw new TypeError(`ui.slots.${name} must be a DOM node`)
        slot.append(given)
      }
    }
    const toolbar = this.row('bar.chart'), drawingBar = this.row('bar.drawing'), footer = this.row('bar.playback')
    this.toolbar = toolbar; this.drawingBar = drawingBar; this.footer = footer
    toolbar.classList.add('sc-marketbar'); drawingBar.classList.add('sc-drawingbar'); footer.classList.add('sc-footer')
    const presentation = this.menu('presentation', 'presentation.description', 'chart'), indicators = this.menu('indicators', 'indicators.manage', 'indicators')
    const objects = this.menu('objects', 'objects.description', 'objects'), more = this.menu('more', 'more.description', 'more')
    this.parts = { presentation: presentation.root, indicators: indicators.root, objects: objects.root, more: more.root }
    this.symbolButton = this.node('button'); this.symbolButton.type = 'button'; this.symbolButton.className = 'sc-button sc-symbol'
    this.symbolButton.textContent = this.symbol.ticker
    this.actions.set(this.symbolButton, () => this.openSearch('', 'button'))
    this.bind(() => { this.symbolButton.title = this.t('symbol.find') })
    this.symbolButton.setAttribute('aria-haspopup', 'dialog'); this.symbolButton.setAttribute('aria-expanded', 'false')
    this.toolsToggle = this.control('tools', () => { this.setToolsOpen(!this.toolsOpen); }, { icon: 'tools', title: 'tools.description' })
    this.toolsToggle.classList.add('sc-tools-toggle'); this.toolsToggle.setAttribute('aria-pressed', 'false')
    this.paletteButton = this.control('palette.open', () => this.openCommandPalette(), { icon: 'command', iconOnly: true })
    this.paletteButton.classList.add('sc-palette-button')
    this.periodSelect = this.select('interval', [], periodKey(this.period))
    this.intervalBar = this.node('div'); this.intervalBar.className = 'sc-intervals'; this.intervalBar.setAttribute('role', 'group')
    this.bind(() => { this.intervalBar.setAttribute('aria-label', this.t('interval')); })
    this.intervalField = this.field('interval', this.periodSelect)
    this.listen(this.periodSelect, 'change', () => this.run(() => {
      const period = this.periods.find(item => periodKey(item) === this.periodSelect.value)
      if (period !== undefined) void this.setPeriod(period)
    }))
    this.syncPeriodControls()
    const chartType = this.select('chartType', ENGINE_CHART_TYPES.filter(type => type !== 'point-figure').map(type => [type, () => this.t(`chartType.${type}`)] as const), options.chart?.render?.chartType ?? 'candles')
    this.listen(chartType, 'change', () => { this.run(() => { this.chart.setRenderOptions({ chartType: chartType.value as EngineChartType }); }); this.syncPresentation() })
    // The quick menu in the market bar: the same setting as the select above, one click away and with a picture of each.
    const typeMenu = this.menu('chartType', 'chartType.description')
    typeMenu.root.classList.add('sc-type-menu'); typeMenu.summary.dataset.parts = 'icon'
    typeMenu.panel.classList.add('sc-type-panel')
    const typeButtons = new Map<string, HTMLButtonElement>()
    CHART_TYPE_GROUPS.forEach((group, index) => group.forEach((type, at) => {
      const item = this.node('button'); item.type = 'button'; item.className = 'sc-button sc-menu-item sc-type-item'
      if (index > 0 && at === 0) item.dataset.separator = 'true'
      const text = this.node('span'); text.className = 'sc-label'
      item.append(createIcon(this.doc, `chartType:${type}`), text)
      this.bind(() => { text.textContent = this.t(`chartType.${type}`); item.setAttribute('aria-label', text.textContent) })
      this.actions.set(item, () => {
        this.run(() => { this.chart.setRenderOptions({ chartType: type }); })
        this.syncPresentation(); typeMenu.root.open = false; typeMenu.summary.focus()
      })
      typeButtons.set(type, item); typeMenu.panel.append(item)
    }))
    this.syncChartTypeMenu = (type: string): void => {
      const shown = typeButtons.has(type) ? type : 'candles'
      const name = this.t(`chartType.${shown}`)
      typeMenu.summary.replaceChildren(createIcon(this.doc, `chartType:${shown}`), Object.assign(this.node('span'), { className: 'sc-label', textContent: name }))
      typeMenu.summary.title = `${this.t('chartType')}: ${name}`; typeMenu.summary.setAttribute('aria-label', typeMenu.summary.title)
      for (const [value, item] of typeButtons) item.setAttribute('aria-pressed', String(value === shown))
    }
    this.bind(() => { this.syncChartTypeMenu(chartType.value) })
    this.typeMenuRoot = typeMenu.root
    const mode = this.select('candles', PRICE_MODES.map(name => [name, () => this.t(name === 'raw' ? 'priceMode.raw' : name === 'heikin-ashi' ? 'priceMode.heikin' : `priceMode.${name}`)] as const), options.chart?.mode ?? 'raw')
    this.listen(mode, 'change', () => { this.run(() => { this.setPriceMode(mode.value as WorkspacePriceMode); }); this.syncPresentation() })
    const scale = this.select('priceScale', [['linear', () => this.t('priceScale.linear')], ['log', () => this.t('priceScale.log')], ['percentage', () => this.t('priceScale.percentage')]], this.scale.mode ?? 'linear')
    this.listen(scale, 'change', () => {
      const next = { ...this.chart.getLayoutOptions().priceScale, mode: scale.value as PriceScaleOptions['mode'] }
      if (this.run(() => { this.chart.setLayout({ priceScale: next }); })) this.scale = next
      else scale.value = this.scale.mode ?? 'linear'
    })
    const reverse = this.control('priceScale.reverse', () => {
      const current = this.chart.getLayoutOptions().priceScale
      const next = { ...current, reversed: current?.reversed !== true }
      if (this.run(() => { this.chart.setLayout({ priceScale: next }); })) { this.scale = next; reverse.setAttribute('aria-pressed', String(next.reversed)) }
    })
    reverse.setAttribute('aria-pressed', String(this.scale.reversed === true))
    this.autoButton = this.control('scale.auto', () => { this.fitPriceScale(); }, { title: 'scale.auto.title' })
    this.zoneId = options.chart?.render?.timeZone ?? 'UTC'
    this.zoneSelect = this.node('select'); this.zoneSelect.className = 'sc-select sc-zone-select'
    this.bind(() => { const name = this.t('timezone'); this.zoneSelect.setAttribute('aria-label', name); this.zoneSelect.title = name; this.fillTimeZones(this.zoneListFull) })
    this.listen(this.zoneSelect, 'change', () => { this.run(() => { this.setTimeZone(this.zoneSelect.value) }) })
    // The full list (about 420 options) is built when the menu is about to open, not at mount: until then the picker holds
    // only the zone in use. Offsets are read at that moment too, so a daylight-saving change shows as it is today.
    this.listen(this.zoneSelect, 'focus', () => { this.fillTimeZones(true) })
    this.listen(this.zoneSelect, 'pointerdown', () => { if (!this.zoneListFull) this.fillTimeZones(true) })
    const scaleToggle = (mode: 'percentage' | 'log', key: string, title: string): HTMLButtonElement => {
      const button = this.control(key, () => {
        const current = this.chart.getLayoutOptions().priceScale
        const next = { ...current, mode: current?.mode === mode ? 'linear' as const : mode }
        if (this.run(() => { this.chart.setLayout({ priceScale: next }); })) { this.scale = next; this.syncPresentation() }
      }, { title })
      button.setAttribute('aria-pressed', 'false'); button.classList.add('sc-scale-toggle')
      return button
    }
    this.percentButton = scaleToggle('percentage', 'scale.percentage', 'scale.percentage.title')
    this.logButton = scaleToggle('log', 'scale.log', 'scale.log.title')
    this.clockNode = this.node('span'); this.clockNode.className = 'sc-clock'; this.clockNode.setAttribute('aria-hidden', 'true')
    this.scaleBar = this.row('bar.scale'); this.scaleBar.classList.add('sc-scalebar')
    this.scaleBar.append(this.clockNode, this.zoneSelect, this.percentButton, this.logButton, this.autoButton)
    this.rangeBar = this.row('bar.range'); this.rangeBar.classList.add('sc-ranges'); this.rangeBar.setAttribute('role', 'group')
    for (const range of WORKSPACE_RANGES) {
      const button = this.control(`range.${range}`, () => { this.showRange(range) }, { title: 'range.title' })
      button.classList.add('sc-range-button'); button.dataset.range = range
      this.bind(() => { button.title = this.t('range.named', { name: this.t(`range.${range}`) }) })
      this.rangeBar.append(button)
    }
    this.syncPresentation = () => {
      const layout = this.chart.getLayoutOptions(), render = this.chart.getRenderOptions()
      this.scale = { ...layout.priceScale }
      chartType.value = render.chartType === 'point-figure' ? this.typeBeforeStyle ?? 'candles' : render.chartType ?? 'candles'
      this.syncChartTypeMenu(chartType.value)
      mode.value = this.getPriceMode()
      scale.value = this.scale.mode ?? 'linear'
      reverse.setAttribute('aria-pressed', String(this.scale.reversed === true))
      this.percentButton.setAttribute('aria-pressed', String(this.scale.mode === 'percentage')); this.logButton.setAttribute('aria-pressed', String(this.scale.mode === 'log'))
      const auto = this.scale.range === undefined
      this.autoButton.setAttribute('aria-pressed', String(auto))
      this.showTimeZone(render.timeZone ?? 'UTC')
      // A restored document can carry its own base colours; host marks follow the canvas they sit on.
      ;(this.annotations as EngineAnnotations | undefined)?.setTheme(this.annotationTheme())
    }
    presentation.panel.classList.add('sc-settings-grid')
    presentation.panel.append(this.field('chartType', chartType), this.field('priceMode', mode), this.field('priceScale', scale), reverse)
    // Only a feed that can supply marks gets the switch; without getMarks there is nothing to show or hide.
    if (typeof options.datafeed.getMarks === 'function') {
      this.marksToggle = this.control('marks.toggle', () => { this.setMarksVisible(!this.marks.visible) }, { title: 'marks.toggle.title' })
      this.marksToggle.setAttribute('aria-pressed', 'true')
      presentation.panel.append(this.marksToggle)
    }
    toolbar.append(this.slots.get('header-start')!, this.toolsToggle, this.symbolButton, this.intervalBar, this.intervalField, this.typeMenuRoot, presentation.root, indicators.root, objects.root, more.root, this.paletteButton, this.slots.get('header-end')!)

    this.indicatorSearch = this.node('input'); this.indicatorSearch.type = 'search'; this.indicatorSearch.className = 'sc-input sc-indicator-search'
    this.indicatorSearch.autocomplete = 'off'; this.indicatorSearch.spellcheck = false
    this.bind(() => { this.indicatorSearch.placeholder = this.t('indicators.search'); this.indicatorSearch.setAttribute('aria-label', this.t('indicators.search')) })
    this.indicatorResults = this.node('div'); this.indicatorResults.className = 'sc-indicator-results'; this.indicatorResults.setAttribute('role', 'listbox')
    this.bind(() => { this.indicatorResults.setAttribute('aria-label', this.t('indicators.add')) })
    const addIndicator = (name: string): void => { this.run(() => { this.chart.addIndicator({ name }); }) }
    const fillResults = (): void => {
      const query = this.indicatorSearch.value.trim()
      const names = searchIndicators(this.chart.getRegisteredIndicatorNames(), query)
      const nodes: HTMLElement[] = []
      let group = ''
      for (const name of names) {
        const info = indicatorInfo(name)
        // With no query the list is the catalogue by family; with one it is a ranked list.
        if (query === '' && info.group !== group) {
          group = info.group
          const heading = this.node('div'); heading.className = 'sc-indicator-family'; heading.setAttribute('role', 'presentation'); heading.textContent = this.t(`indicators.family.${info.group}`)
          nodes.push(heading)
        }
        const item = this.node('button'); item.type = 'button'; item.className = 'sc-button sc-indicator-result'; item.setAttribute('role', 'option'); item.dataset.name = name
        const label = this.node('span'); label.className = 'sc-label'; label.textContent = info.label
        const id = this.node('span'); id.className = 'sc-indicator-id'; id.textContent = name.replace(/^SC_/, '')
        item.append(label, id, createIcon(this.doc, 'plus')); item.setAttribute('aria-label', this.t('indicators.add.named', { name: info.label }))
        this.actions.set(item, () => { addIndicator(name) })
        nodes.push(item)
      }
      this.indicatorResults.replaceChildren(...nodes)
      if (names.length === 0) { const none = this.node('p'); none.className = 'sc-hint'; none.textContent = this.t('indicators.noMatch'); this.indicatorResults.append(none) }
    }
    this.listen(this.indicatorSearch, 'input', fillResults)
    this.listen(this.indicatorSearch, 'keydown', event => {
      const key = event as KeyboardEvent
      if (key.key === 'Enter' && !key.isComposing) { key.preventDefault(); this.indicatorResults.querySelector<HTMLButtonElement>('button')?.click() }
      else if (key.key === 'ArrowDown') { key.preventDefault(); this.indicatorResults.querySelector<HTMLButtonElement>('button')?.focus() }
    })
    this.listen(this.indicatorResults, 'keydown', event => {
      const key = event as KeyboardEvent
      if (key.key !== 'ArrowDown' && key.key !== 'ArrowUp') return
      const items = [...this.indicatorResults.querySelectorAll<HTMLButtonElement>('button')], at = items.indexOf(this.doc.activeElement as HTMLButtonElement)
      key.preventDefault()
      if (key.key === 'ArrowUp' && at <= 0) this.indicatorSearch.focus(); else items[Math.min(items.length - 1, Math.max(0, at + (key.key === 'ArrowDown' ? 1 : -1)))]?.focus()
    })
    // Names can be registered while the menu is shut (optional packs), so the list is read again each time it opens.
    this.listen(indicators.root, 'toggle', () => { if (indicators.root.open) { fillResults(); this.indicatorSearch.focus({ preventScroll: true }) } })
    const indicatorList = this.node('div'); indicatorList.className = 'sc-indicator-list'
    let indicatorEditorDirty = true
    const renderIndicators = (): void => {
      if (!indicators.root.open || !indicatorEditorDirty) return
      const active = this.doc.activeElement
      const focused = active instanceof this.win.HTMLElement && indicatorList.contains(active) ? active : null
      const focusId = focused?.closest<HTMLElement>('[data-indicator]')?.dataset.indicator
      const focusControl = focused?.dataset.control
      const expanded = new Set([...indicatorList.querySelectorAll<HTMLDetailsElement>('details[open]')].map(item => item.dataset.indicator))
      fillResults()
      const currentIndicators = this.chart.listIndicators()
      this.setParts(indicators.summary, [[this.t('indicators')], [currentIndicators.length > 0 ? String(currentIndicators.length) : '', 'sc-count']])
      indicatorList.replaceChildren(...currentIndicators.map(indicator => {
        const settings = this.node('details'), title = this.node('summary')
        settings.className = 'sc-indicator'; settings.dataset.indicator = indicator.id; settings.open = expanded.has(indicator.id)
        title.textContent = `${indicatorLabel(indicator.name)}${indicator.params.length === 0 ? '' : ` (${indicator.params.join(', ')})`}${indicator.visible ? '' : ` ${this.t('indicators.hidden')}`}`
        const params = this.node('input'); params.type = 'text'; params.value = indicator.params.join(',')
        params.setAttribute('aria-label', this.t('indicators.params.named', { name: indicator.name })); params.className = 'sc-input'; params.dataset.control = 'params'; params.autocomplete = 'off'; params.spellcheck = false
        const pane = this.select(this.t('indicators.pane.named', { name: indicator.name }), [['price', () => this.t('indicators.pane.price')], ['overlay', () => this.t('indicators.pane.overlay')], ['separate', () => this.t('indicators.pane.separate')]], indicator.pane, true)
        const group = this.node('input'); group.type = 'text'; group.value = indicator.paneId ?? ''; group.maxLength = 128
        group.setAttribute('aria-label', this.t('indicators.group.named', { name: indicator.name })); group.placeholder = this.t('indicators.group.placeholder'); group.className = 'sc-input'; group.dataset.control = 'group'; pane.dataset.control = 'pane'
        group.disabled = pane.value !== 'separate'; pane.onchange = () => { group.disabled = pane.value !== 'separate' }
        const apply = this.button(this.t('indicators.apply'), () => this.run(() => {
          const raw = params.value.trim(), values = raw === '' ? [] : raw.split(',').map(value => {
            if (value.trim() === '') throw new TypeError(this.t('indicators.params.invalid'))
            return Number(value)
          })
          this.chart.updateIndicator(indicator.id, { params: values, pane: pane.value as 'price' | 'overlay' | 'separate', paneId: pane.value === 'separate' ? group.value.trim() || undefined : undefined })
        }))
        const toggle = this.button(this.t(indicator.visible ? 'indicators.hide' : 'indicators.show'), () => this.run(() => {
          const current = this.chart.listIndicators().find(item => item.id === indicator.id)
          if (current !== undefined) this.chart.updateIndicator(indicator.id, { visible: !current.visible })
        }))
        const remove = this.button(this.t('indicators.remove'), () => {
          this.run(() => { this.chart.removeIndicator(indicator.id) })
        })
        remove.setAttribute('aria-label', this.t('indicators.remove.named', { name: indicator.name, params: indicator.params.join(',') }))
        apply.classList.add('sc-primary'); apply.dataset.control = 'apply'; toggle.dataset.control = 'toggle'; remove.dataset.control = 'remove'
        toggle.setAttribute('aria-pressed', String(indicator.visible)); remove.classList.add('sc-danger')
        params.onkeydown = event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); apply.click() } }
        const editor = this.node('div'); editor.className = 'sc-indicator-editor'
        const actions = this.node('div'); actions.className = 'sc-actions'; actions.append(apply, toggle)
        editor.append(this.fieldText(this.t('indicators.params'), params), this.fieldText(this.t('indicators.pane'), pane), this.fieldText(this.t('indicators.group'), group), actions)
        settings.append(title, editor)
        const entry = this.node('div'); entry.className = 'sc-indicator-entry'; entry.dataset.indicator = indicator.id
        entry.append(settings, remove); return entry
      }))
      if (currentIndicators.length === 0) {
        const empty = this.node('p'); empty.className = 'sc-hint'; empty.textContent = this.t('indicators.none'); indicatorList.append(empty)
      }
      if (focused !== null) {
        const entry = [...indicatorList.children].find(node => (node as HTMLElement).dataset.indicator === focusId)
        const target = focusControl === undefined ? entry?.querySelector<HTMLElement>('summary') : entry?.querySelector<HTMLElement>(`[data-control="${focusControl}"]`)
        ;(target ?? indicators.summary).focus({ preventScroll: true })
      }
      indicatorEditorDirty = false
    }
    const refreshIndicators = (): void => {
      indicatorEditorDirty = true
      const count = this.chart.listIndicators().length
      this.setParts(indicators.summary, [[this.t('indicators')], [count > 0 ? String(count) : '', 'sc-count']])
      renderIndicators()
      this.objectsDirty = true; this.renderObjects()
    }
    this.refreshIndicatorsUi = refreshIndicators
    // Registry and model updates may arrive while the menu is closed. Build the
    // current editor once on opening; reopening unchanged preserves input drafts.
    this.listen(indicators.root, 'toggle', renderIndicators)
    this.objectList = this.node('div'); this.objectList.className = 'sc-object-list'
    objects.panel.append(this.objectList)
    this.objectsMenu = objects.root
    this.listen(objects.root, 'toggle', () => { this.objectsDirty = true; this.renderObjects() })
    const indicatorAdd = this.node('div'); indicatorAdd.className = 'sc-indicator-add'
    indicatorAdd.append(this.indicatorSearch, this.indicatorResults)
    indicators.panel.append(indicatorAdd, indicatorList)
    this.drawingSelect = this.select('draw.tool', [], '')
    this.drawingField = this.field('draw', this.drawingSelect)
    this.buildToolOptions()
    this.listen(this.drawingSelect, 'change', () => this.chooseTool(this.drawingSelect.value === '' ? null : this.drawingSelect.value as DrawingType))
    this.rail = new ToolRail({
      doc: this.doc,
      win: this.win,
      t: (key, params) => this.t(key, params),
      bind: apply => { this.bind(apply) },
      listen: (target, type, listener) => { this.listen(target, type, listener) },
      tools: DRAWING_TYPES,
      groupOf: toolCategory,
      toolLabel: type => this.toolLabel(type),
      choose: tool => { this.chooseTool(tool) }
    })
    this.drawingButtons = {
      undo: this.control('draw.undo', () => this.run(() => { this.chart.drawings.undo() }), { icon: 'undo', iconOnly: true }),
      redo: this.control('draw.redo', () => this.run(() => { this.chart.drawings.redo() }), { icon: 'redo', iconOnly: true }),
      lock: this.control('draw.lock', () => this.run(() => {
        const state = this.chart.drawings.getSnapshot(), selected = state.drawings.find(item => item.id === state.selectedId)
        if (selected !== undefined) this.chart.drawings.update(selected.id, { locked: !selected.locked })
      }), { icon: 'lock', iconOnly: true }),
      remove: this.control('draw.delete', () => this.run(() => {
        const id = this.chart.drawings.getSnapshot().selectedId
        if (id !== null) this.chart.drawings.remove(id)
      }), { icon: 'trash', iconOnly: true })
    }
    // Remove every unlocked drawing in one undoable step. It is the only drawing control that changes more than the selection.
    this.clearButton = this.control('context.removeAll', () => this.run(() => { this.chart.drawings.clear() }), { icon: 'eraser', iconOnly: true })
    this.clearButton.classList.add('sc-danger')
    const magnet = this.control('draw.magnet', () => this.run(() => {
      const next = !this.chart.getDrawingMagnet(); this.chart.setDrawingMagnet(next); magnet.setAttribute('aria-pressed', String(next))
    }), { icon: 'magnet', iconOnly: true, title: 'draw.magnet.title' })
    magnet.setAttribute('aria-pressed', 'false')
    const stay = this.control('draw.stay', () => {
      this.stayInDrawing = !this.stayInDrawing; stay.setAttribute('aria-pressed', String(this.stayInDrawing))
    }, { icon: 'keep', iconOnly: true, title: 'draw.stay.title' })
    stay.setAttribute('aria-pressed', 'false')
    this.drawingModes = this.node('div'); this.drawingModes.className = 'sc-history'; this.drawingModes.setAttribute('role', 'group')
    this.hideAllButton = this.control('draw.hideAll', () => this.run(() => { this.chart.drawings.setViewHidden(!this.chart.drawings.getSnapshot().viewHidden) }), { icon: 'eye', iconOnly: true, title: 'draw.hideAll.title' })
    this.hideAllButton.setAttribute('aria-pressed', 'false')
    this.drawingModes.append(magnet, stay, this.hideAllButton)
    const navBack = this.control('nav.back', () => this.run(() => { this.chart.view.undoNavigation() }), { icon: 'back', iconOnly: true, title: 'nav.back.title' })
    const navForward = this.control('nav.forward', () => this.run(() => { this.chart.view.redoNavigation() }), { icon: 'forward', iconOnly: true, title: 'nav.forward.title' })
    const updateNavigation = (): void => { const history = this.chart.view.getNavigationHistory(); navBack.disabled = !history.canUndo; navForward.disabled = !history.canRedo }
    navBack.disabled = navForward.disabled = true
    const latest = this.control('nav.latest', () => this.run(() => { this.chart.view.followLatest(); }), { icon: 'latest', iconOnly: true, title: 'nav.latest.title' })
    this.downloadButton = this.control('png', () => { void this.download() }, { icon: 'camera', iconOnly: true, title: 'png.title' })
    this.drawingButtons.remove.classList.add('sc-danger')
    this.secondary = this.node('div'); this.secondary.className = 'sc-secondary'
    this.secondary.append(navBack, navForward, latest, this.downloadButton)
    if (typeof this.root.requestFullscreen === 'function' && typeof this.doc.exitFullscreen === 'function') {
      const fullscreen = this.control('fullscreen', () => {
        void (this.doc.fullscreenElement === this.root ? this.doc.exitFullscreen() : this.root.requestFullscreen()).catch(error => { this.showNotice(error); })
      }, { icon: 'fullscreen', iconOnly: true })
      const syncFullscreen = (): void => {
        const active = this.doc.fullscreenElement === this.root
        const key = active ? 'fullscreen.exit' : 'fullscreen'
        this.setLabel(fullscreen, this.t(key)); fullscreen.setAttribute('aria-pressed', String(active))
        const icon = fullscreen.querySelector('.sc-icon'); if (icon !== null) icon.replaceWith(createIcon(this.doc, active ? 'exitFullscreen' : 'fullscreen'))
      }
      this.listen(this.doc, 'fullscreenchange', syncFullscreen)
      this.fullscreenSync = syncFullscreen
      fullscreen.setAttribute('aria-pressed', 'false')
      this.secondary.append(fullscreen)
    }
    // Two groups so the layout can place them apart: undo and redo go to the market bar beside the rail, lock and
    // delete (they act on the selected drawing) go to the foot of the rail; without a rail they sit together.
    this.history = this.node('div'); this.history.className = 'sc-history'; this.history.setAttribute('role', 'group')
    this.history.append(this.drawingButtons.undo, this.drawingButtons.redo)
    this.drawingActions = this.node('div'); this.drawingActions.className = 'sc-history'; this.drawingActions.setAttribute('role', 'group')
    this.drawingActions.append(this.drawingButtons.lock, this.drawingButtons.remove, this.clearButton)
    this.bind(() => { this.history.setAttribute('aria-label', this.t('draw.undo')); this.drawingActions.setAttribute('aria-label', this.t('bar.drawing')) })
    drawingBar.append(this.slots.get('drawing-start')!, this.drawingField, this.history, this.drawingModes, this.drawingActions, this.secondary, this.slots.get('drawing-end')!)

    this.searchPanel = this.node('div'); this.searchPanel.hidden = true
    this.searchPanel.setAttribute('role', 'dialog'); this.bind(() => { this.searchPanel.setAttribute('aria-label', this.t('search.title')); })
    this.searchPanel.className = 'sc-search'
    this.searchInput = this.node('input'); this.searchInput.type = 'search'
    this.bind(() => { this.syncSearchPlaceholder() })
    this.searchInput.autocomplete = 'off'; this.searchInput.spellcheck = false; this.searchInput.className = 'sc-input sc-search-input'
    this.searchStatus = this.node('div'); this.searchStatus.className = 'sc-search-status'; this.searchStatus.setAttribute('role', 'status')
    this.searchResults = this.node('ul'); this.searchResults.className = 'sc-search-results'
    this.bind(() => { this.searchResults.setAttribute('aria-label', this.t('search.results')); })
    const searchHeader = this.node('div'); searchHeader.className = 'sc-panel-header'
    const searchTitle = this.node('h2'); this.bind(() => { searchTitle.textContent = this.t('search.title') })
    searchHeader.append(searchTitle, this.control('search.close', () => { this.closeSearch(); }))
    this.searchPanel.append(searchHeader, this.searchInput, this.searchStatus, this.searchResults)
    this.listen(this.searchInput, 'input', () => { this.queueSearch(200); })
    this.listen(this.searchPanel, 'keydown', event => { this.searchKey(event as KeyboardEvent); })
    this.palette = new CommandPalette({
      doc: this.doc,
      root: this.root,
      t: () => this.tr,
      commands: () => this.collectCommands(),
      suggest: query => this.dateSuggestions(query),
      listen: (target, type, listener) => { this.listen(target, type, listener); },
      run: command => { void this.runCommand(command) },
      closeOthers: () => { this.closeFloating('palette'); }
    })
    this.contextMenu = new ContextMenu({
      doc: this.doc,
      root: this.root,
      t: () => this.tr,
      listen: (target, type, listener) => { this.listen(target, type, listener); },
      onRun: item => { this.run(() => { item.run?.() }) }
    })
    this.listen(this.root, 'keydown', event => {
      const key = event as KeyboardEvent
      if (this.ui.headless || key.isComposing) return
      if (this.paletteEnabled && this.paletteShortcut && (key.ctrlKey || key.metaKey) && !key.altKey && !key.shiftKey && key.key.toLowerCase() === 'k') {
        key.preventDefault(); key.stopPropagation()
        if (this.palette.isOpen) this.palette.close(); else this.openCommandPalette()
        return
      }
      const typing = key.target instanceof this.win.HTMLElement && key.target.closest('input,textarea,select,[contenteditable="true"]') !== null
      // `?` lists every command with its shortcut, as in other charting tools; the palette is that list.
      if (key.key === '?' && !typing && !key.ctrlKey && !key.metaKey && !key.altKey && this.paletteEnabled) {
        key.preventDefault(); key.stopPropagation(); this.openCommandPalette(); return
      }
      const hotkey = hotkeyFor(key)
      if (hotkey !== null && !(key.target instanceof this.win.HTMLElement && key.target.closest('input,textarea,select,[contenteditable="true"]') !== null)) {
        key.preventDefault(); key.stopPropagation()
        if ('tool' in hotkey.action) { const tool = hotkey.action.tool; this.run(() => { this.chart.setDrawingTool(tool); this.setToolValue(tool) }) }
        else if (hotkey.action.action === 'resetView') this.run(() => { this.chart.view.resetViewport() })
        else if (hotkey.action.action === 'goToDate') this.openGoToDate()
        else void this.download()
        return
      }
      if (key.ctrlKey || key.metaKey || key.altKey || !/^[a-z0-9]$/i.test(key.key) || !(key.target instanceof this.win.HTMLElement) || !this.chartHost.contains(key.target) || key.target.closest('input,textarea,select,[contenteditable="true"]') !== null) return
      key.preventDefault(); this.openSearch(key.key, 'keyboard')
    })
    this.listen(this.doc, 'pointerdown', event => {
      if (!(event.target instanceof this.win.Node)) return
      if (!this.searchPanel.hidden && !this.searchPanel.contains(event.target) && !this.symbolButton.contains(event.target)) this.closeSearch(false)
      if (this.palette.isOpen && !this.palette.panel.contains(event.target) && !this.paletteButton.contains(event.target)) this.palette.close(false)
      if (this.contextMenu.isOpen && !this.contextMenu.element.contains(event.target)) this.contextMenu.close(false)
      if (this.rail.isOpen && !this.rail.contains(event.target)) this.rail.close(false)
      for (const menu of this.root.querySelectorAll<HTMLDetailsElement>('.sc-menu[open]')) if (!menu.contains(event.target)) menu.open = false
    })
    this.chartHost = this.node('div')
    this.listen(this.chartHost, 'contextmenu', event => { this.onContextMenu(event as MouseEvent); })
    this.listen(this.win, 'blur', () => { this.contextMenu.close(false); })

    const stage = this.node('div'); stage.className = 'sc-stage'
    this.chartHost.className = 'sc-chart'
    this.stageStatus = this.node('div'); this.stageStatus.className = 'sc-stage-status'; this.stageStatus.setAttribute('aria-hidden', 'true')
    this.notice = this.node('div'); this.notice.className = 'sc-notice'; this.notice.setAttribute('role', 'alert')
    this.holdNote = this.node('div'); this.holdNote.className = 'sc-holdnote'; this.holdNote.setAttribute('role', 'status')
    this.statusNode = this.node('div'); this.statusNode.className = 'sc-status'; this.statusNode.setAttribute('role', 'status')
    this.legendActions = this.node('div'); this.legendActions.className = 'sc-legend-actions'; this.legendActions.hidden = true
    this.legendActions.append(
      this.control('legend.settings', () => this.run(() => { this.hideLegendActions(); this.parts.indicators.open = true }), { icon: 'gear', iconOnly: true }),
      this.control('legend.remove', () => this.run(() => { const id = this.legendTarget; this.hideLegendActions(); if (id !== null) this.chart.removeIndicator(id) }), { icon: 'stop', iconOnly: true })
    )
    this.listen(this.legendActions, 'pointerenter', () => { this.win.clearTimeout(this.legendHideTimer) })
    this.listen(this.legendActions, 'pointerleave', () => { this.scheduleLegendHide() })
    stage.append(this.chartHost, this.stageStatus, this.legendActions)
    const body = this.node('div'); body.className = 'sc-body'; body.append(this.rail.element, this.rail.flyoutElement, stage)
    this.retryButton = this.control('status.retry', () => this.reload())
    this.olderButton = this.control('status.loadOlder', () => this.run(() => { this.chart.view.requestMore(); }), { title: 'status.loadOlder.title' })
    this.replayInfo = this.node('span')
    this.replayButtons = {
      start: this.control('replay.start', () => this.run(() => { if (!this.startReplay()) throw new Error(this.t('replay.needBars')) }), { icon: 'replay', title: 'replay.start.title' }),
      back: this.control('replay.back', () => this.run(() => { this.stepReplay(-1) }), { icon: 'stepBack', iconOnly: true }),
      next: this.control('replay.next', () => this.run(() => { this.stepReplay(1) }), { icon: 'stepForward', iconOnly: true }),
      play: this.control('replay.play', () => this.run(() => { if (this.getReplayState().playing) this.pauseReplay(); else this.playReplay() }), { icon: 'play', iconOnly: true }),
      exit: this.control('replay.exit', () => this.run(() => { this.exitReplay() }), { icon: 'stop', iconOnly: false })
    }
    this.replaySpeed = this.select('replay.speed.label', [0.25, 0.5, 1, 2, 4, 8, 16].map(speed => [String(speed), () => `${speed}×`] as const), '1')
    this.listen(this.replaySpeed, 'change', () => this.run(() => { this.setReplaySpeed(Number(this.replaySpeed.value)); }))
    this.replayControls = this.node('div'); this.replayControls.className = 'sc-replay-controls'; this.replayControls.hidden = true
    this.replayInfo.className = 'sc-replay-info'
    const countdownNode = this.node('span'); countdownNode.className = 'sc-countdown'; this.bind(() => { countdownNode.title = this.t('countdown.title') })
    this.countdownNode = countdownNode
    this.replayControls.append(this.replayButtons.back, this.replayButtons.next, this.replayButtons.play, this.field('replay.speed', this.replaySpeed), this.replayButtons.exit, this.replayInfo)
    toolbar.insertBefore(this.replayButtons.start, objects.root)
    footer.append(this.slots.get('footer-start')!, this.rangeBar, this.statusNode, countdownNode, this.scaleBar, this.olderButton, this.retryButton, this.slots.get('footer-end')!)
    this.root.append(toolbar, drawingBar, this.notice, this.holdNote, body, this.replayControls, footer, this.searchPanel, this.palette.panel, this.contextMenu.element)
    host.append(this.root)
    this.startClock()
    try {
      this.chart = new EngineChart(this.chartHost, {
        ...options.chart,
        ariaLabel: this.t('chart.label'),
        descriptions: options.chart?.descriptions ?? {
          summary: text => this.t('a11y.summary', {
            ...text,
            chartType: this.t(`chartType.${text.chartType}`),
            change: text.change === '' ? '' : this.t('a11y.change', { change: text.change }),
            indicators: text.indicators === '' ? '' : this.t('a11y.indicators', { names: text.indicators })
          }),
          bar: text => this.t('a11y.bar', {
            ...text,
            change: text.change === '' ? '' : this.t('a11y.barChange', { change: text.change }),
            volume: text.volume === '' ? '' : this.t('a11y.barVolume', { volume: text.volume }),
            session: text.session === '' ? '' : this.t(`a11y.barSession.${text.session}`)
          })
        },
        render: { ...(options.theme === undefined ? {} : getWorkspaceTheme(resolveThemeName(options.theme, this.win))?.render), ...options.chart?.render, timespan: this.period.timespan, symbolTimezone: this.symbol.timezone, session: this.compileSession(this.symbol), locale: this.locale, ...(options.chart?.render?.legendTitle === undefined ? { legendTitle: legendTitleOf(this.symbol, this.period) } : {}), ...(options.chart?.render?.watermark === undefined ? { watermark: watermarkOf(this.symbol, this.period) } : {}) },
        onToolComplete: reason => {
          const again = reason === 'completed' && this.stayInDrawing ? this.lastTool : null
          this.setToolValue(null)
          // Re-arm after the pointer handler that just finished the drawing has returned.
          if (again !== null) queueMicrotask(() => { if (!this.disposed && this.drawingSelect.value === '') this.run(() => { this.chart.setDrawingTool(again); this.setToolValue(again) }) })
          options.chart?.onToolComplete?.(reason)
        },
        onHoldDraw: event => { this.showHoldDraw(event); options.chart?.onHoldDraw?.(event) }
      })
      if (options.indicators?.catalog !== false) for (const definition of [...TECHNICAL_INDICATOR_DEFINITIONS, ...CLASSIC_INDICATOR_DEFINITIONS]) this.chart.registerIndicator(definition)
      this.derived = createDerivedSeriesPort(this.chart.dataPort, () => {
        // New history changes the measured default size: the point and figure boxes follow it.
        const size = this.derived.getStyle()?.size
        if (this.chart.getRenderOptions().chartType === 'point-figure' && size !== null && size !== undefined) this.chart.setRenderOptions({ pointFigureBox: size })
      })
      this.followScheme()
      this.annotations = new EngineAnnotations({ symbol: null, theme: this.annotationTheme(), onChange: () => { this.chart.requestPaint(); this.objectsDirty = true; this.renderObjects() } })
      this.chart.addLayer(this.annotations)
      this.drawingToolbar = new DrawingToolbar({
        doc: this.doc,
        win: this.win,
        stage,
        store: this.chart.drawings,
        t: (key, params) => this.t(key, params),
        bind: apply => { this.bind(apply) },
        listen: (target, type, listener) => { this.listen(target, type, listener) },
        geometryOf: id => this.chart.getDrawingGeometry(id),
        changed: () => { this.objectsDirty = true }
      })
      this.unsubscribe.push(this.chart.onFrame(() => { this.drawingToolbar.refresh() }), this.chart.drawings.subscribe(() => { this.drawingToolbar.refresh() }))
      // Hovering an indicator's row in the legend shows its settings and remove buttons, as in other charting tools.
      this.listen(this.chartHost, 'pointermove', event => {
        const e = event as PointerEvent
        if (e.pointerType !== 'mouse' || e.buttons !== 0 || this.ui.headless) return
        const near = this.chartHost.getBoundingClientRect()
        if (e.clientX - near.left > 520 || e.clientY - near.top > 320) { this.scheduleLegendHide(); return }
        const row = this.chart.legendRowAt(e.clientX, e.clientY)
        if (row === null) { this.scheduleLegendHide(); return }
        this.win.clearTimeout(this.legendHideTimer)
        const stageBox = stage.getBoundingClientRect()
        this.legendTarget = row.id
        this.legendActions.style.left = `${Math.round(row.right - stageBox.left + 4)}px`
        this.legendActions.style.top = `${Math.round(row.top - stageBox.top - 3)}px`
        this.legendActions.hidden = false
      })
      this.listen(this.chartHost, 'pointerleave', () => { this.scheduleLegendHide() })
      this.unsubscribe.push(attachAnnotationIntents(this.chartHost, this.annotations, event => { for (const listener of [...this.intentListeners]) listener(event) }))
      this.marks = new DatafeedMarks({
        feed: this.datafeed,
        annotations: this.annotations,
        win: this.win,
        host: this.chartHost,
        stage,
        symbol: () => this.symbol,
        period: () => this.period,
        scopeKey: () => symbolKey(this.symbol),
        pairKey: () => this.requestedPair(),
        ready: () => this.getStatus().state === 'ready' && this.shownMatches() && this.displayedPair === this.requestedPair() && this.applyError === null,
        bars: () => this.chart.dataPort.getDataList(),
        view: () => { const range = this.chart.view.getSnapshot().viewport; return { i0: range.i0, i1: range.i1 } },
        format: time => this.formatMarkTime(time),
        changed: () => { this.objectsDirty = true; this.renderObjects() }
      })
      this.unsubscribe.push(this.chart.onFrame(() => { this.marks.frame() }), () => { this.marks.dispose() })
    } catch (error) { this.stopFollowingScheme?.(); this.abort.abort(); this.root.remove(); throw error }
    this.loader = this.createLoader()
    this.timedReplay = this.createReplay()
    this.countdown = createBarCountdown({
      getContext: () => {
        if (options.countdown?.enabled === false || this.getStatus().state !== 'ready' || !this.shownMatches()) return null
        const lastBar = this.chart.getLastBar()
        let closeTimestamp: number | null | undefined
        if (lastBar !== null && options.countdown?.closeTimestamp !== undefined) {
          try { closeTimestamp = options.countdown.closeTimestamp(this.market(), lastBar) } catch { return null }
        } else if (lastBar !== null && this.tradingSession.session !== null) {
          // The host's own close wins; otherwise the schedule says where this bar really ends (undefined: it cannot, keep the estimate).
          closeTimestamp = sessionBarClose(this.tradingSession.session, lastBar.timestamp, this.period, this.symbol.timezone)
        }
        return { marketKey: this.requestedPair(), lastBar, period: this.period, symbolTimezone: this.symbol.timezone, replaying: this.loader.replaying, closeTimestamp }
      },
      onChange: snapshot => { this.setText(countdownNode, snapshot === null ? '' : this.t('countdown', { text: snapshot.text })); this.chart.setLastPriceCaption(snapshot === null ? '' : snapshot.text) },
      hidden: () => this.doc.hidden,
      timer: { setTimeout: (callback, ms) => this.win.setTimeout(callback, ms), clearTimeout: handle => { this.win.clearTimeout(handle as number); } }
    })
    this.listen(this.doc, 'visibilitychange', () => { if (this.doc.hidden) this.timedReplay.pause(); this.countdown.refresh() })
    this.unsubscribe.push(this.chart.view.subscribe(updateNavigation)); updateNavigation()
    this.compares = new CompareOverlays({ datafeed: this.datafeed, chart: this.chart, market: () => ({ symbol: this.symbol, period: this.period }), report: error => { this.showNotice(error) }, now: () => Date.now() })
    this.unsubscribe.push(this.chart.onIndicatorsChanged(refreshIndicators))
    this.unsubscribe.push(this.chart.onIndicatorsChanged(() => { this.compares.reconcile() }))
    this.unsubscribe.push(this.chart.drawings.subscribe(() => { this.updateDrawingControls(); this.queueDrawingSave(); this.objectsDirty = true; this.renderObjects() }))
    this.unsubscribe.push(this.chart.onLayoutChanged(() => { this.syncPresentation(); }))
    this.loader.attach(this.dataPort())
    for (const command of options.commands?.items ?? []) this.commandRegistry.register(command)
    this.applyUi()
    this.resizeObserver = new this.win.ResizeObserver(() => { this.applyUi(); })
    this.resizeObserver.observe(this.root)
    refreshIndicators(); this.updateDrawingControls(); this.syncPresentation(); this.ready = this.request()
  }

  /**
   * How prices are shown: the real bars (`raw`), Heikin Ashi, or a price-driven style (`renko`, `line-break`, `range`,
   * `kagi`) that makes one mark per price move instead of one per time bar. `options.size` is the price distance of a
   * brick, range or Kagi reversal (default: the average true range of the loaded bars, measured when the mode is
   * chosen or a symbol loads) and `options.lines` the line-break depth (default 3). Price-driven styles use the history
   * that is loaded, do not load older pages, and are not available during replay. Indicators and drawings work on the
   * marks. The mode is not part of a saved workspace document.
   */
  setPriceMode (mode: WorkspacePriceMode, options: DerivedStyleOptions = {}): void {
    this.assertLive()
    if (!PRICE_MODES.includes(mode)) throw new TypeError('Unknown price mode')
    const derived = mode !== 'raw' && mode !== 'heikin-ashi'
    if (derived && this.loader.replaying) throw new Error(this.t('style.replayActive'))
    if (derived) {
      // Leave Heikin Ashi first: the style reads the real bars.
      this.chart.view.setMode('raw')
      this.derived.setStyle(mode, options)
      const own = mode === 'kagi' ? 'step-line' : mode === 'point-figure' ? 'point-figure' : null
      if (own !== null) {
        if (this.typeBeforeStyle === null) this.typeBeforeStyle = this.chart.getRenderOptions().chartType ?? 'candles'
        // The box height lets the renderer count the boxes of a column; it is the size the port settled on.
        this.chart.setRenderOptions({ chartType: own, pointFigureBox: this.derived.getStyle()?.size ?? undefined })
      } else this.leaveStyleType()
      return
    }
    this.derived.setStyle(null)
    this.leaveStyleType()
    this.chart.view.setMode(mode)
  }

  getPriceMode (): WorkspacePriceMode { this.assertLive(); return this.derived.getStyle()?.style ?? this.chart.view.getSnapshot().mode }

  private leaveStyleType (): void {
    if (this.typeBeforeStyle === null) return
    const back = this.typeBeforeStyle
    this.typeBeforeStyle = null
    const current = this.chart.getRenderOptions().chartType
    if (current === 'step-line' || current === 'point-figure') this.chart.setRenderOptions({ chartType: back, pointFigureBox: undefined })
  }

  getSymbol (): SymbolInfo { return { ...this.symbol } }
  getPeriod (): Period { return { ...this.period } }
  /** Register an optional pack on demand without loading it into every workspace. */
  registerIndicator (definition: IndicatorDefinition): void {
    this.assertLive(); this.chart.registerIndicator(definition)
  }

  setSymbol (symbol: SymbolInfo): Promise<WorkspaceLoadResult> { return this.setMarket(symbol, this.period) }
  setPeriod (period: Period | string): Promise<WorkspaceLoadResult> { return this.setMarket(this.symbol, period) }
  /** Validate both inputs before changing either; same-tick calls fetch the final pair once. */
  setMarket (symbol: SymbolInfo, period: Period | string): Promise<WorkspaceLoadResult> {
    this.restoreGeneration++; this.pendingRestore = null
    return this.changeMarket(symbol, period)
  }

  private changeMarket (symbol: SymbolInfo, period: Period | string): Promise<WorkspaceLoadResult> {
    this.assertLive(); this.saveDrawings()
    const nextSymbol = validSymbol(symbol), nextPeriod = this.resolvePeriod(period)
    const previous = this.market(), changed = pairKey(nextSymbol, nextPeriod) !== this.requestedPair()
    if (symbolKey(nextSymbol) !== symbolKey(this.symbol)) {
      this.scale = { ...this.chart.getLayoutOptions().priceScale, range: undefined }
      this.chart.setLayout({ priceScale: this.scale })
    }
    if (JSON.stringify(nextSymbol.session) !== JSON.stringify(this.symbol.session) || nextSymbol.timezone !== this.symbol.timezone) this.chart.setRenderOptions({ session: this.compileSession(nextSymbol) })
    if (nextPeriod.timespan !== this.period.timespan || nextSymbol.timezone !== this.symbol.timezone || (!changed && nextSymbol.pricePrecision !== this.symbol.pricePrecision)) {
      this.chart.setRenderOptions({
        timespan: nextPeriod.timespan,
        symbolTimezone: nextSymbol.timezone,
        ...(!changed && nextSymbol.pricePrecision !== this.symbol.pricePrecision ? { pricePrecision: resolvePricePrecision(nextSymbol.pricePrecision, this.chart.dataPort.getDataList()) } : {})
      })
    }
    if (!this.periods.some(item => periodKey(item) === periodKey(nextPeriod))) this.periods.push(nextPeriod)
    this.symbol = nextSymbol; this.period = nextPeriod
    if (this.ownLegendTitle) this.chart.setRenderOptions({ legendTitle: legendTitleOf(nextSymbol, nextPeriod) })
    if (this.ownWatermark) this.chart.setRenderOptions({ watermark: watermarkOf(nextSymbol, nextPeriod) })
    this.symbolButton.textContent = nextSymbol.ticker; this.syncPeriodControls()
    const result = changed ? this.request(true) : this.loads.current(this.market()) ?? Promise.resolve(this.currentResult())
    if (changed) this.events.emit('marketChange', { previous, requested: this.market() })
    this.updateStatus()
    return result
  }

  /** Starts a real fresh request even when the selected market is unchanged. */
  reload (): Promise<WorkspaceLoadResult> { this.assertLive(); this.restoreGeneration++; this.pendingRestore = null; return this.request() }
  /**
   * Abort the pending market load and its history/sync requests. Explicit
   * cancellation retires this loader's cache; the next reload starts fresh.
   * A settled chart is unaffected (returns false).
   */
  cancelLoad (): boolean {
    this.assertLive()
    this.restoreGeneration++; this.pendingRestore = null
    const waitingResult = this.loads.cancel()
    // A timed-out feed may still answer later. Cancellation also retires that
    // failed request, so an explicit cancel cannot unexpectedly recover it.
    if (waitingResult === null && this.getStatus().state !== 'error') return false
    const result: WorkspaceLoadResult = waitingResult ?? { status: 'cancelled', ...this.market() }
    this.cancelled = true; this.pending = false; this.waitingStart = false; this.olderPending = false; this.applyError = null; this.displayedPair = null
    this.timedReplay.dispose(); this.loaderUnsubscribe.splice(0).forEach(fn => { fn(); }); this.loader.dispose()
    this.loader = this.createLoader(); this.timedReplay = this.createReplay(); this.loader.attach(this.dataPort())
    this.chart.setDrawingTool(null); this.chart.setData([], false)
    this.updateStatus(); this.events.emit('loadResult', result)
    return true
  }

  /**
   * Lay another market over the chart, rebased to start at the chart's own price so the lines show relative performance.
   * Resolves with an id for `removeCompare`. The bars come from the datafeed for the range loaded; they are fetched again
   * when the market changes or older bars load, and every 30 seconds for the latest ones (not streamed live). Shown as a
   * line indicator, so the Indicators list, legend and Objects tree can hide or remove it. At most 6 at once.
   */
  addCompare (symbol: SymbolInfo): Promise<string> { this.assertLive(); return this.compares.add(validSymbol(symbol)) }
  removeCompare (id: string): boolean { this.assertLive(); return this.compares.remove(id) }
  listCompares (): CompareInfo[] { this.assertLive(); return this.compares.list() }

  on<K extends keyof WorkspaceEvents> (type: K, listener: (event: WorkspaceEvents[K]) => void): () => void {
    this.assertLive(); return this.events.on(type, listener)
  }

  off<K extends keyof WorkspaceEvents> (type: K, listener: (event: WorkspaceEvents[K]) => void): void { this.events.off(type, listener) }
  /** Detached candle objects; during replay, only revealed candles are returned. */
  getBars (options: { limit?: number } = {}): MarketBar[] {
    this.assertLive()
    if (Object.keys(options).some(key => key !== 'limit')) throw new TypeError('Only the bars limit option is supported')
    const limit = options.limit
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 0)) throw new RangeError('Bars limit must be a nonnegative safe integer')
    return this.chart.getBars(options)
  }

  getLoadState (): WorkspaceLoadState {
    this.assertLive()
    const status = this.getStatus()
    return {
      requested: this.market(),
      loaded: this.displayedPair === this.requestedPair() && this.applyError === null && status.state !== 'error' && status.state !== 'idle' ? this.market() : null,
      status: this.cancelled ? 'cancelled' : status.state,
      loadingMore: status.loadingMore || this.olderPending,
      error: status.error === null ? null : { message: this.errorMessage(status.error.error), phase: status.error.phase, timeout: status.error.timeout }
    }
  }

  getState (): WorkspaceState {
    this.assertLive()
    const bars = this.chart.dataPort.getDataList(), view = this.chart.view.getSnapshot(), drawings = this.chart.drawings.getSnapshot()
    return {
      schema: 1,
      load: this.getLoadState(),
      replay: this.getReplayState(),
      data: { count: bars.length, firstTimestamp: bars[0]?.timestamp ?? null, lastTimestamp: bars[bars.length - 1]?.timestamp ?? null },
      view: { from: view.viewport.i0, to: view.viewport.i1, following: view.following, mode: view.mode },
      indicators: this.chart.listIndicators().map(item => ({ ...item, params: [...item.params] })),
      drawings: { count: drawings.drawings.length, selectedId: drawings.selectedId }
    }
  }

  getReplayState (): WorkspaceReplayState {
    this.assertLive()
    const info = this.loader.replayInfo
    return {
      active: info !== null,
      index: info?.index ?? null,
      length: info?.length ?? this.chart.view.getSnapshot().length,
      timestamp: info !== null && Number.isFinite(info.timestamp) ? info.timestamp : null,
      atEnd: this.loader.replayAtEnd,
      playing: this.timedReplay?.getState().playing ?? false,
      speed: this.timedReplay?.getState().speed ?? 1
    }
  }

  startReplay (at?: number): boolean {
    this.assertLive()
    if (at !== undefined && (!Number.isSafeInteger(at) || at < 0)) throw new RangeError('Replay index must be a nonnegative safe integer')
    if (this.derived.getStyle() !== null) throw new Error(this.t('replay.rawStyle'))
    const started = this.timedReplay.start({ index: at }); this.updateReplay(); return started
  }

  stepReplay (delta = 1): WorkspaceReplayState {
    this.assertLive()
    if (!Number.isSafeInteger(delta)) throw new RangeError('Replay step must be a safe integer')
    if (!this.loader.replaying) throw new Error('Start replay before stepping')
    this.timedReplay.step(delta); this.updateReplay(); return this.getReplayState()
  }

  startReplayAt (timestamp: number): boolean { this.assertLive(); if (this.derived.getStyle() !== null) throw new Error(this.t('replay.rawStyle')); return this.timedReplay.startByTimestamp(timestamp) }
  playReplay (speed?: number): boolean { this.assertLive(); if (this.doc.hidden) return false; return this.timedReplay.play(speed) }
  pauseReplay (): void { this.assertLive(); this.timedReplay.pause() }
  setReplaySpeed (speed: number): void { this.assertLive(); this.timedReplay.setSpeed(speed) }
  exitReplay (): WorkspaceReplayState { this.assertLive(); this.timedReplay.exit(); this.updateReplay(); return this.getReplayState() }

  /** Market, indicators, drawings and presentation only; no feed, code or credentials. */
  exportDocument (): string {
    this.assertLive()
    const state = this.getLoadState()
    if (state.loaded === null || !['ready', 'empty'].includes(state.status)) throw new Error('Load a market before saving its workspace')
    const { formatPrice, showTimeAxis, timespan, symbolTimezone, session, pointFigureBox, locale, ...render } = this.chart.getRenderOptions()
    // A price-driven style is not saved, so neither is the chart type it borrowed (step line for Kagi, X/O for point and figure).
    if (this.typeBeforeStyle !== null && (render.chartType === 'step-line' || render.chartType === 'point-figure')) render.chartType = this.typeBeforeStyle
    const document: WorkspaceDocumentV1 = {
      version: 1,
      ...this.market(),
      mode: this.chart.view.getSnapshot().mode,
      render,
      layout: this.chart.getLayoutOptions(),
      indicators: this.chart.listIndicators(),
      drawings: JSON.parse(this.chart.drawings.exportJson())
    }
    const json = JSON.stringify(document)
    parseWorkspaceDocument(json, { registeredIndicatorNames: this.chart.getRegisteredIndicatorNames() })
    return json
  }

  /**
   * Validate/decode first, then load the requested market through the usual feed.
   * A failed or superseded load never applies saved state to a different market.
   * Registered executable layers are host-owned and are not serialized/restored.
   */
  async restoreDocument (json: string): Promise<WorkspaceLoadResult> {
    this.assertLive()
    const document = parseWorkspaceDocument(json, { registeredIndicatorNames: this.chart.getRegisteredIndicatorNames() })
    const period = this.resolvePeriod(document.period)
    this.chart.validateIndicatorReplacement(document.indicators)
    const generation = ++this.restoreGeneration
    this.pendingRestore = null
    const releaseImages = this.chart.holdDrawingImages(document.drawings.drawings)
    try {
      try { await this.chart.prepareDrawingImages(document.drawings.drawings) } catch (error) {
        if (this.disposed) return { status: 'disposed' }
        if (generation !== this.restoreGeneration) return { status: 'superseded', by: this.market() }
        throw error
      }
      if (this.disposed) return { status: 'disposed' }
      if (generation !== this.restoreGeneration) return { status: 'superseded', by: this.market() }
      const configuration: EngineConfiguration = {
        render: { ...document.render, formatPrice: this.chart.getRenderOptions().formatPrice, timespan: period.timespan, symbolTimezone: document.symbol.timezone, session: this.compileSession(document.symbol), locale: this.locale },
        layout: document.layout,
        mode: document.mode ?? 'raw',
        indicators: document.indicators,
        drawingsJson: JSON.stringify(document.drawings)
      }
      const pending = { generation, key: pairKey(document.symbol, period), configuration, applied: false }
      this.pendingRestore = pending
      this.timedReplay.exit()
      try {
        const result = await this.changeMarket(document.symbol, period)
        if (this.disposed) return { status: 'disposed' }
        if (this.pendingRestore !== pending || generation !== this.restoreGeneration || pending.key !== this.requestedPair()) return { status: 'superseded', by: this.market() }
        if ((result.status === 'loaded' || result.status === 'unchanged') && this.getLoadState().loaded !== null) {
          if (!pending.applied) this.chart.restoreConfiguration(configuration)
          this.syncPresentation()
          this.drawingSymbol = symbolKey(this.symbol)
          this.drawingDocuments.set(this.drawingSymbol, this.chart.drawings.exportJson())
          this.updateDrawingControls(); this.updateReplay()
        }
        return result
      } finally { if (this.pendingRestore === pending) this.pendingRestore = null }
    } finally { releaseImages() }
  }

  getStatus (): DataStatus {
    if (this.cancelled) return { state: 'idle', loadingMore: false, error: null }
    if (this.applyError !== null) return { state: 'error', loadingMore: false, error: { phase: 'initial', symbol: this.getSymbol(), period: this.getPeriod(), error: this.applyError, timeout: false } }
    const state = this.loader.status
    const loading = this.pending && (this.waitingStart || state.state !== 'error')
    return { ...state, state: loading ? 'loading' : state.state, error: loading || state.error === null ? null : { ...state.error, symbol: { ...state.error.symbol }, period: { ...state.error.period } } }
  }

  /**
   * Switch the chrome and the canvas colours to a preset. The preset's six canvas colours replace the current ones,
   * including any the host passed in `chart.render`; set those again afterwards through `chart.setRenderOptions`.
   * Preset chrome variables likewise replace earlier values; other `ui.variables` stay untouched.
   */
  setTheme (theme: WorkspaceThemeName): void {
    if (this.disposed) return
    const name = validTheme(theme)
    this.themeName = name
    this.applyTheme()
    this.followScheme()
  }

  /** Listen for system colour-scheme changes exactly while the theme is `auto`; dispose removes the listener. */
  private followScheme (): void {
    this.stopFollowingScheme?.(); this.stopFollowingScheme = null
    if (this.themeName === AUTO_THEME) this.stopFollowingScheme = followColorScheme(this.win, () => { if (!this.disposed && this.themeName === AUTO_THEME) this.applyTheme() })
  }

  /** Paint the chrome and canvas with the preset the current theme name stands for (`auto` reads the system now). */
  private applyTheme (): void {
    const preset = resolveThemeName(this.themeName ?? 'dark', this.win)
    this.applyChromeTheme(preset)
    this.chart.setRenderOptions({ ...getWorkspaceTheme(preset)!.render })
    this.annotations.setTheme(this.annotationTheme())
  }

  /**
   * Hear the person drag a `draggable` annotation level. Dragging is a request, never a change: the host checks it and,
   * if it agrees, writes the new price with `annotations.setAnnotations`. Returns a function that stops listening.
   */
  onAnnotationIntent (listener: (event: AnnotationIntentEvent) => void): () => void {
    this.assertLive()
    if (typeof listener !== 'function') throw new TypeError('Annotation intent listener must be a function')
    this.intentListeners.add(listener)
    return () => { this.intentListeners.delete(listener) }
  }

  /**
   * What the event marks are doing: `unsupported` when the datafeed has no `getMarks`, `hidden`, `idle`, `loading`,
   * `ready` or `error`, how many marks sit on bars, and every mark left out by its stable code (`validateMarks` and
   * `placeMarks` in core list them). A failed answer is not retried until the view leaves the window it covered or
   * `refreshMarks()` is called.
   */
  /**
   * What the symbol's `session` is doing: `none` (the symbol has no schedule), `active` (its zone and the kind of the
   * newest bar: `regular`, `pre`, `post` or `closed`), or `invalid` with every fault by stable code (see
   * `SessionIssueCode`); an invalid schedule is ignored as a whole, so the chart shows no bands and the countdown
   * keeps its estimate.
   */
  getSessionState (): WorkspaceSessionState {
    this.assertLive()
    const { session, issues } = this.tradingSession
    if (session === null) return issues.length === 0 ? { status: 'none' } : { status: 'invalid', issues }
    const last = this.chart.getLastBar()
    // A bar of a day or more has no time of day to classify.
    const intraday = ['second', 'minute', 'hour'].includes(this.period.timespan)
    return { status: 'active', timezone: session.timezone, newestBar: last === null || !intraday ? null : sessionKindAt(session, last.timestamp) }
  }

  private compileSession (symbol: SymbolInfo): TradingSession | null {
    this.tradingSession = compileSymbolSession(symbol)
    return this.tradingSession.session
  }

  getMarksState (): WorkspaceMarksState { this.assertLive(); return this.marks.getState() }

  /** Asks the datafeed for marks again for the current view (after a new filing or headline, say). */
  refreshMarks (): void { this.assertLive(); this.marks.refresh() }

  /** Shows or hides the event marks; the choice is the viewer's and is not saved in the workspace document. */
  setMarksVisible (visible: boolean): void {
    this.assertLive()
    if (typeof visible !== 'boolean') throw new TypeError('setMarksVisible needs true or false')
    this.marks.setEnabled(visible); this.syncMarksControl()
  }

  private syncMarksControl (): void {
    this.marksToggle?.setAttribute('aria-pressed', String(this.marks.visible))
  }

  private formatMarkTime (time: number): string {
    const dateOnly = ['day', 'week', 'month', 'year'].includes(this.period.timespan)
    const base: Intl.DateTimeFormatOptions = dateOnly ? { dateStyle: 'medium' } : { dateStyle: 'medium', timeStyle: 'short' }
    try { return new Intl.DateTimeFormat(this.locale, { ...base, timeZone: dateOnly ? this.symbol.timezone ?? 'UTC' : this.zoneId }).format(time) } catch { return new Date(time).toISOString() }
  }

  /** The annotation layer follows the active preset's base colours, the host's own `render.theme` included. */
  private annotationTheme (): EngineAnnotationTheme {
    return themeName(this.chart.getRenderOptions().theme)
  }

  private applyChromeTheme (theme: WorkspaceThemeName): void {
    const preset = getWorkspaceTheme(theme)!
    for (const key of Object.keys(WORKSPACE_CHROME_VARS) as WorkspaceChromeKey[]) this.root.style.setProperty(WORKSPACE_CHROME_VARS[key], preset.chrome[key])
  }

  dispose (): void {
    if (this.disposed) return
    this.saveDrawings();
    this.disposed = true; this.cancelSearch(); this.abort.abort(); this.compares.dispose()
    this.restoreGeneration++; this.pendingRestore = null
    this.stopFollowingScheme?.(); this.stopFollowingScheme = null
    if (this.clockTimer !== null) { this.win.clearInterval(this.clockTimer); this.clockTimer = null }
    this.timedReplay.dispose(); this.countdown.dispose(); this.resizeObserver?.disconnect(); this.resizeObserver = null
    this.commandRegistry.clear(); this.bindings.length = 0
    this.loads.dispose(); this.events.clear()
    this.unsubscribe.forEach(fn => { fn(); }); this.loaderUnsubscribe.splice(0).forEach(fn => { fn(); }); this.loader.dispose()
    for (const [timer, url] of this.downloads) { this.win.clearTimeout(timer); this.win.URL.revokeObjectURL(url) }
    this.downloads.clear(); this.drawingDocuments.clear()
    try { this.chart.dispose() } finally { this.root.remove() }
  }

  /** Flush a completed edit before leaving. Storage errors propagate; the document
   * stays in memory and disposal can be retried after the host handles the error. */
  saveDrawings (): void {
    if (this.drawingSaveTimer !== null) { this.win.clearTimeout(this.drawingSaveTimer); this.drawingSaveTimer = null }
    if (this.drawingSymbol !== null) this.drawingDocuments.set(this.drawingSymbol, this.chart.drawings.exportJson())
  }

  /**
   * The drawings of the shown market as one JSON document (the same text `drawings` holds inside `exportDocument()`),
   * for a host that saves them on its own, for example through `DocumentSync` in `@supersolutions/super-chart-core/sync`.
   * Throws until a market has loaded.
   */
  exportDrawings (): string {
    this.assertLive()
    if (this.drawingSymbol === null) throw new Error('Load a market before saving its drawings')
    return this.chart.drawings.exportJson()
  }

  /**
   * Replaces the drawings of the shown market with a document from `exportDrawings()`. The whole document is checked
   * first and a bad one changes nothing. Undo history starts over, and `drawingsChange` reports it with `origin: 'imported'`.
   */
  importDrawings (json: string): void {
    this.assertLive()
    if (this.drawingSymbol === null) throw new Error('Load a market before importing its drawings')
    this.importingDrawings = true
    try { this.chart.drawings.importJson(json) } finally { this.importingDrawings = false }
  }

  getDrawingCacheStats (): { symbols: number, bytes: number, unsaved: number } { return this.drawingDocuments.getStats() }

  private queueDrawingSave (): void {
    const list = this.chart.drawings.getSnapshot().drawings
    if (list === this.lastDrawingList) return
    this.lastDrawingList = list
    if (this.drawingSymbol === null) return
    // Listeners are the host's: one that throws must not stop the save below.
    try { this.events.emit('drawingsChange', { key: this.drawingSymbol, symbol: this.getSymbol(), count: list.length, origin: this.importingDrawings ? 'imported' : 'edit' }) } catch { /* the host's */ }
    if (!this.persistentDrawings) return
    if (this.drawingSaveTimer !== null) this.win.clearTimeout(this.drawingSaveTimer)
    this.drawingSaveTimer = this.win.setTimeout(() => {
      this.drawingSaveTimer = null
      try { this.saveDrawings() } catch (error) { this.showNotice(error) }
    }, 250)
  }

  private market (): WorkspaceMarket { return { symbol: this.getSymbol(), period: this.getPeriod() } }
  private requestedPair (): string { return pairKey(this.symbol, this.period) }
  private resolvePeriod (input: Period | string): Period {
    const parsed = typeof input === 'string' ? parsePeriod(input) : null
    if (typeof input === 'string' && parsed === null) throw new RangeError('Unsupported interval; use a configured period or a value such as 1m, 4H or 1D')
    let next = validPeriod(typeof input === 'string' ? { ...parsed!, text: input.trim() } : input)
    const configured = this.periods.find(item => periodKey(item) === periodKey(next))
    if (configured !== undefined) return typeof input === 'string' ? { ...configured } : next
    const resolved = this.datafeed.resolvePeriod?.({ multiplier: next.multiplier, timespan: next.timespan })
    if (resolved == null || periodKey(resolved) !== periodKey(next)) throw new RangeError('The datafeed does not support this interval')
    next = validPeriod(resolved)
    return next
  }

  private createReplay (): TimedReplay {
    return createTimedReplay({
      loader: this.loader,
      getDataList: () => this.chart.dataPort.getDataList(),
      getMarketKey: () => this.getStatus().state === 'ready' && this.shownMatches() ? this.requestedPair() : null,
      onChange: () => { this.updateReplay(); },
      timer: { setTimeout: (callback, ms) => this.win.setTimeout(callback, ms), clearTimeout: handle => { this.win.clearTimeout(handle as number); } }
    })
  }

  private createLoader (): DataLoader {
    const loader = new DataLoader({
      ...this.loaderOptions,
      datafeed: this.datafeed,
      env: {
        now: () => Date.now(),
        setTimeout: (fn, ms) => this.win.setTimeout(fn, ms),
        clearTimeout: handle => { this.win.clearTimeout(handle as number); },
        requestFrame: fn => this.win.requestAnimationFrame(fn),
        cancelFrame: handle => { this.win.cancelAnimationFrame(handle as number); },
        queueMicrotask: fn => { this.win.queueMicrotask(fn); },
        hidden: () => this.doc.hidden,
        visibility: this.doc,
        connectivity: this.win,
        warn: (...args) => { this.win.console.warn(...args); }
      }
    })
    this.loaderUnsubscribe.push(loader.on('status', status => {
      // Old promises may settle before the next request's coalescing microtask.
      if (this.waitingStart && status.state !== 'loading') return
      if (status.state === 'loading') { this.waitingStart = false; this.pending = true }
      if (status.state === 'error') this.pending = false
      this.restoreDrawings(); this.updateStatus()
    }), loader.on('bars', event => {
      if (pairKey(event.symbol, event.period) === this.requestedPair()) this.run(() => { this.chart.setRenderOptions({ pricePrecision: resolvePricePrecision(this.symbol.pricePrecision, event.bars) }); })
    }), loader.on('replay', () => { this.updateReplay(); }))
    return loader
  }

  private shownMatches (): boolean {
    const shown = this.loader.shown
    return shown !== null && pairKey(shown.symbol, shown.period) === this.requestedPair()
  }

  private prepareRequest (): void {
    this.drawingSymbol = null; this.displayedPair = null; this.pending = true; this.waitingStart = true; this.applyError = null; this.cancelled = false
    this.olderPending = false
    this.chart.setDrawingTool(null); this.setToolValue(null)
    this.chart.drawings.importJson(EMPTY_DRAWINGS); this.chart.setData([], false)
    this.annotations.setScope(null)
    this.marks.sync()
    this.holdNote.textContent = ''
    this.notice.textContent = ''; this.updateStatus()
  }

  private request (drawingsSaved = false): Promise<WorkspaceLoadResult> {
    if (!drawingsSaved) this.saveDrawings()
    this.timedReplay.pause()
    const waiting = this.loads.request(this.market())
    this.prepareRequest(); this.loader.request(this.getSymbol(), this.getPeriod())
    return waiting
  }

  private currentResult (): WorkspaceLoadResult {
    const status = this.getStatus(), market = this.market()
    if (this.cancelled) return { status: 'cancelled', ...market }
    if (status.state === 'error') return { status: 'error', ...market, message: this.errorMessage(status.error?.error), timeout: status.error?.timeout ?? false }
    return { status: 'unchanged', ...market }
  }

  private settleLoad (): void {
    if (this.waitingStart || !this.shownMatches()) return
    const status = this.getStatus(), market = this.market()
    let result: WorkspaceLoadResult
    if (status.state === 'error') result = { status: 'error', ...market, message: this.errorMessage(status.error?.error), timeout: status.error?.timeout ?? false }
    else if ((status.state === 'ready' || status.state === 'empty') && this.displayedPair === this.requestedPair()) {
      result = { status: 'loaded', ...market, bars: this.chart.view.getSnapshot().length }
    } else return
    if (this.loads.settle(market, result)) this.events.emit('loadResult', result)
  }

  private dataPort (): ChartDataPort {
    const port = this.derived
    const apply = (change: () => void, kind: 'reset' | 'prepend' | 'tail', initial = false): void => {
      if (this.disposed || this.waitingStart || (!(initial && this.loader.status.state === 'loading') && !this.shownMatches())) return
      try {
        change(); this.displayedPair = this.requestedPair()
        if (this.loader.status.state !== 'loading') this.pending = false
        this.restoreDrawings(); this.updateStatus(); this.settleLoad()
        this.events.emit('dataChange', { market: this.market(), kind, count: this.chart.view.getSnapshot().length })
        void this.compares.refresh(kind === 'tail' ? 'tail' : 'range')
      } catch (error) {
        this.applyError = error; this.pending = false
        this.chart.setDrawingTool(null); this.chart.setData([], false); this.updateStatus(); this.settleLoad()
      }
    }
    const reset = (bars: MarketBar[], more?: boolean, normalized = false): void => { apply(() => {
      const restoring = this.pendingRestore
      if (restoring !== null && !restoring.applied && restoring.generation === this.restoreGeneration && restoring.key === this.requestedPair()) {
        // With a price-driven style on, the chart must get the derived bars, not these real ones.
        if (this.derived.getStyle() === null) this.chart.restoreConfiguration(restoring.configuration, { bars, more })
        else { this.chart.restoreConfiguration(restoring.configuration); port.applyNewData(bars, more) }
        restoring.applied = true
        this.drawingSymbol = symbolKey(this.symbol)
      } else if (normalized) port.applyNormalizedData!(bars, more)
      else port.applyNewData(bars, more)
    }, 'reset', true); }
    return {
      applyNewData: (bars, more) => { reset(bars, more); },
      applyNormalizedData: (bars, more) => { reset(bars, more, true); },
      truncateData: (length, expectedLength, expectedLastTimestamp) => {
        let applied = false
        apply(() => { applied = port.truncateData!(length, expectedLength, expectedLastTimestamp) }, 'reset')
        return applied
      },
      applyMoreData: (bars, more) => { apply(() => { this.olderPending = false; port.applyMoreData(bars, more) }, 'prepend'); },
      updateData: bar => { apply(() => { port.updateData(bar); }, 'tail'); },
      updateDataBatch: (bars, more) => { apply(() => port.updateDataBatch?.(bars, more), 'tail'); },
      getDataList: port.getDataList,
      getLastTimestamp: port.getLastTimestamp,
      cancelHistoryLoad: () => { this.olderPending = false; this.updateStatus() },
      loadMore: callback => port.loadMore?.(timestamp => {
        if (this.disposed || this.olderPending || this.getStatus().state !== 'ready') return
        this.olderPending = true; this.updateStatus()
        try { callback(timestamp) } catch (error) { this.olderPending = false; this.updateStatus(); throw error }
      })
    }
  }

  private restoreDrawings (): void {
    if (this.loader.status.state !== 'ready' || !this.shownMatches() || this.displayedPair !== this.requestedPair() || this.applyError !== null) return
    this.pending = false
    const key = symbolKey(this.symbol)
    this.annotations.setPricePrecision(this.symbol.pricePrecision === undefined ? undefined : resolvePricePrecision(this.symbol.pricePrecision, this.chart.dataPort.getDataList()))
    this.annotations.setScope(key)
    this.marks.sync()
    if (this.drawingSymbol === key) return
    this.chart.drawings.importJson(this.drawingDocuments.get(key) ?? EMPTY_DRAWINGS); this.drawingSymbol = key
  }

  private updateStatus (): void {
    if (this.disposed) return
    const status = this.getStatus(), ticker = this.symbol.ticker, interval = this.period.text, pair = `${ticker} ${interval}`
    const reason = status.state === 'error' ? this.errorMessage(status.error?.error) : ''
    const text = this.cancelled ? this.t('status.cancelled', { pair }) : status.state === 'loading' ? this.t('status.loading', { pair })
      : status.state === 'error' ? this.t('status.error', { pair, reason })
        : status.state === 'empty' ? this.t('status.empty', { pair }) : status.loadingMore ? this.t('status.older', { pair }) : pair
    const message = this.cancelled ? this.t('status.cancelled.short') : status.state === 'loading' ? this.t('status.loading.short')
      : status.state === 'error' ? this.t('status.error.short', { reason }) : status.state === 'empty' ? this.t('status.empty.short') : status.loadingMore ? this.t('status.older.short') : ''
    const shown = status.state === 'ready' && this.displayedPair === this.requestedPair()
    const hasMore = this.chart.view.getSnapshot().hasMore
    const signatureUI = `${this.locale}|${text}|${shown}|${this.olderPending}|${hasMore}|${this.downloading}`
    if (signatureUI !== this.reportedStatusUI) {
      this.reportedStatusUI = signatureUI; this.setParts(this.statusNode, [[ticker, 'sc-ticker'], [interval, 'sc-interval'], [message]])
      this.root.dataset.state = this.cancelled ? 'cancelled' : status.state
      this.chartHost.style.visibility = shown ? 'visible' : 'hidden'; this.chartHost.inert = !shown
      this.setText(this.stageStatus, shown ? '' : text); this.stageStatus.hidden = shown
      this.drawingSelect.disabled = !shown; this.setToolValue(this.drawingSelect.value === '' ? null : this.drawingSelect.value as DrawingType); this.downloadButton.disabled = !shown || this.downloading
      this.retryButton.hidden = status.state !== 'error' && !this.cancelled
      this.olderButton.hidden = !hasMore && status.state === 'ready'
      this.olderButton.disabled = status.state !== 'ready' || status.loadingMore || this.olderPending || !hasMore
      this.olderButton.title = this.t(status.loadingMore || this.olderPending ? 'status.loadOlder.busy' : !hasMore ? 'status.loadOlder.done' : 'status.loadOlder.title')
    }
    this.updateReplay()
    const state = this.getLoadState(), signature = JSON.stringify(state)
    if (signature !== this.reportedLoadState) { this.reportedLoadState = signature; this.events.emit('loadState', state) }
  }

  private updateReplay (): void {
    if (this.disposed) return
    const info = this.loader.replayInfo
    const focused = this.doc.activeElement
    const entering = info !== null && this.replayControls.hidden
    const leaving = info === null && !this.replayControls.hidden
    this.replayButtons.start.disabled = this.getStatus().state !== 'ready' || info !== null || this.chart.view.getSnapshot().length < 3
    this.replayButtons.back.disabled = info === null || info.index === 0
    this.replayButtons.next.disabled = info === null || this.loader.replayAtEnd
    this.replayButtons.exit.disabled = info === null
    const playback = this.timedReplay?.getState()
    this.replayButtons.play.disabled = info === null || this.loader.replayAtEnd
    this.setLabel(this.replayButtons.play, this.t(playback?.playing ? 'replay.pause' : 'replay.play'))
    const playIcon = this.replayButtons.play.querySelector('.sc-icon')
    if (playIcon !== null && playIcon.getAttribute('data-icon') !== (playback?.playing ? 'pause' : 'play')) { const next = createIcon(this.doc, playback?.playing ? 'pause' : 'play'); next.setAttribute('data-icon', playback?.playing ? 'pause' : 'play'); playIcon.replaceWith(next) }
    this.replayButtons.play.setAttribute('aria-pressed', String(playback?.playing))
    this.replayControls.hidden = info === null
    this.replayButtons.start.hidden = info !== null
    this.replaySpeed.disabled = info === null
    if (entering && focused === this.replayButtons.start) {
      (this.replayButtons.play.disabled ? this.replayButtons.exit : this.replayButtons.play).focus({ preventScroll: true })
    } else if (leaving && focused !== null && this.replayControls.contains(focused)) {
      (this.replayButtons.start.disabled ? this.symbolButton : this.replayButtons.start).focus({ preventScroll: true })
    }
    const speed = String(playback?.speed ?? 1)
    if (![...this.replaySpeed.options].some(option => option.value === speed)) {
      this.replaySpeed.querySelector('option[data-custom]')?.remove()
      const option = this.node('option'); option.value = speed; option.textContent = `${speed}×`; option.dataset.custom = 'true'; this.replaySpeed.append(option)
    }
    this.replaySpeed.value = speed
    this.countdown?.refresh()
    this.setParts(this.replayInfo, info === null ? [] : [[`${info.index + 1} / ${info.length}`], [Number.isFinite(info.timestamp) ? new Date(info.timestamp).toISOString().replace('T', ' ').replace('.000Z', ' UTC') : '']])
    const state = this.getReplayState(), signature = JSON.stringify(state)
    if (signature !== this.reportedReplayState) { this.reportedReplayState = signature; this.events.emit('replayChange', state) }
  }

  private updateDrawingControls (): void {
    const state = this.chart.drawings.getSnapshot(), selected = state.drawings.find(item => item.id === state.selectedId)
    this.drawingButtons.undo.disabled = !state.canUndo; this.drawingButtons.redo.disabled = !state.canRedo
    const locked = selected?.locked === true
    const hiddenAll = state.viewHidden
    this.setLabel(this.hideAllButton, this.t(hiddenAll ? 'draw.showAll' : 'draw.hideAll'), this.t(hiddenAll ? 'draw.showAll.title' : 'draw.hideAll.title'))
    this.hideAllButton.setAttribute('aria-pressed', String(hiddenAll)); this.hideAllButton.disabled = state.drawings.length === 0
    const eyeIcon = this.hideAllButton.querySelector('.sc-icon')
    if (eyeIcon !== null && eyeIcon.getAttribute('data-icon') !== (hiddenAll ? 'eyeOff' : 'eye')) { const next = createIcon(this.doc, hiddenAll ? 'eyeOff' : 'eye'); next.setAttribute('data-icon', hiddenAll ? 'eyeOff' : 'eye'); eyeIcon.replaceWith(next) }
    this.drawingButtons.lock.disabled = selected === undefined
    this.setLabel(this.drawingButtons.lock, this.t(locked ? 'draw.unlock' : 'draw.lock'), this.t(selected === undefined ? 'draw.lock.pick' : locked ? 'draw.unlock.selected' : 'draw.lock.selected'))
    const lockIcon = this.drawingButtons.lock.querySelector('.sc-icon')
    if (lockIcon !== null && lockIcon.getAttribute('data-icon') !== (locked ? 'unlock' : 'lock')) { const next = createIcon(this.doc, locked ? 'unlock' : 'lock'); next.setAttribute('data-icon', locked ? 'unlock' : 'lock'); lockIcon.replaceWith(next) }
    this.drawingButtons.lock.setAttribute('aria-pressed', String(locked))
    this.setLabel(this.drawingButtons.remove, this.t('draw.delete'), this.t(locked ? 'draw.delete.locked' : 'draw.delete.selected'))
    this.drawingButtons.remove.disabled = selected === undefined || selected.locked
    this.clearButton.disabled = !state.drawings.some(item => !item.locked)
  }

  private syncSearchPlaceholder (): void {
    const text = this.t(this.searchPurpose === 'compare' ? 'compare.placeholder' : 'search.placeholder')
    this.searchInput.placeholder = text; this.searchInput.setAttribute('aria-label', text)
  }

  private openSearch (initialQuery?: string, trigger: SymbolSearchRequest['trigger'] = 'api', purpose: 'symbol' | 'compare' = 'symbol'): boolean {
    if (this.disposed) return false
    this.searchPurpose = purpose; this.syncSearchPlaceholder()
    // The host's own picker (onRequest) is for choosing the chart's market; a comparison always uses the built-in list.
    if (purpose === 'symbol' && this.searchRequest !== undefined) {
      let handled = false
      try { handled = this.searchRequest({ query: initialQuery ?? '', trigger }) === true } catch (error) { this.showNotice(error) }
      if (handled) return false
    }
    this.palette.close(false); this.contextMenu.close(false)
    if (initialQuery !== undefined && initialQuery !== '') this.searchInput.value = initialQuery
    for (const menu of this.root.querySelectorAll<HTMLDetailsElement>('.sc-menu[open]')) menu.open = false
    const toolbar = this.root.querySelector<HTMLElement>('.sc-marketbar')
    if (toolbar !== null) this.searchPanel.style.top = `${toolbar.offsetHeight + 4}px`
    this.searchPanel.hidden = false; this.symbolButton.setAttribute('aria-expanded', 'true'); this.searchInput.focus(); this.queueSearch(0)
    return true
  }

  private closeSearch (focus = true): void {
    this.cancelSearch(); this.searchPanel.hidden = true; this.symbolButton.setAttribute('aria-expanded', 'false')
    if (this.searchPurpose !== 'symbol') { this.searchPurpose = 'symbol'; this.syncSearchPlaceholder() }
    if (focus && !this.disposed) this.symbolButton.focus()
  }

  private cancelSearch (): void {
    this.searchGeneration++; this.searchAbort?.abort(); this.searchAbort = null
    if (this.searchTimer !== null) this.win.clearTimeout(this.searchTimer)
    this.searchTimer = null
    this.searchLoading = false
  }

  private queueSearch (delay: number): void {
    this.cancelSearch(); this.searchResults.replaceChildren(); this.searchStatus.textContent = this.t('search.busy')
    this.searchResults.setAttribute('aria-busy', 'true')
    this.searchLoading = true; this.searchSymbols = []; this.searchActive = -1
    const generation = this.searchGeneration
    this.searchTimer = this.win.setTimeout(() => { this.searchTimer = null; void this.search(generation) }, delay)
  }

  private async search (generation: number): Promise<void> {
    const controller = new this.win.AbortController(); this.searchAbort = controller
    const query = this.searchInput.value.trim()
    try {
      const symbols = await this.datafeed.searchSymbols(query, { signal: controller.signal })
      if (this.disposed || controller.signal.aborted || generation !== this.searchGeneration) return
      if (!Array.isArray(symbols)) throw new TypeError('Search returned an invalid symbol list')
      const offered = new Map<string, SymbolInfo>()
      for (const symbol of symbols) {
        if (typeof symbol?.ticker !== 'string' || symbol.ticker.trim() === '') continue
        const copy = validSymbol(symbol); offered.set(symbolKey(copy), copy)
        if (offered.size >= 200) break
      }
      const candidates = [...offered.values()]
      const recent = query === '' && this.recentLimit > 0 ? visibleRecents(this.recents.list(), candidates, symbolKey, this.recentLimit) : []
      const recentKeys = new Set(recent.map(symbolKey))
      const results = [...recent, ...candidates.filter(symbol => !recentKeys.has(symbolKey(symbol)))].slice(0, 50)
      this.searchSymbols = results; this.searchShownQuery = query; this.searchLoading = false; this.searchActive = -1
      this.searchResults.setAttribute('aria-busy', 'false')
      this.searchStatus.textContent = results.length === 0 ? this.t('search.empty') : symbols.length > 50 ? this.t('search.first') : this.t('search.count', { count: results.length })
      this.searchResults.replaceChildren(...results.map((symbol, index) => {
        const item = this.node('li'), button = this.button([symbol.ticker, symbol.name, symbol.exchange].filter(Boolean).join(', '), () => {
          this.chooseSearchResult(index)
        })
        button.classList.add('sc-search-result')
        const ticker = this.node('strong'); ticker.textContent = symbol.ticker
        const name = this.node('span'); name.textContent = symbol.name ?? ''
        const venue = this.node('span'); venue.className = 'sc-venue'; venue.textContent = symbol.exchange ?? ''; venue.hidden = !symbol.exchange
        button.replaceChildren(ticker, name, venue); item.append(button); return item
      }))
    } catch (error) {
      if (this.disposed || controller.signal.aborted || generation !== this.searchGeneration) return
      this.searchStatus.replaceChildren(this.doc.createTextNode(this.t('search.failed', { error: this.errorMessage(error) })), this.button(this.t('search.retry'), () => { this.queueSearch(0); }))
      this.searchLoading = false; this.searchResults.setAttribute('aria-busy', 'false')
    } finally { if (this.searchAbort === controller) this.searchAbort = null }
  }

  private chooseSearchResult (index: number): void {
    const decision = decideEnter({ isComposing: false, shownQuery: this.searchShownQuery, currentQuery: this.searchInput.value.trim(), loading: this.searchLoading, activeIndex: index, resultCount: this.searchSymbols.length })
    if (decision.action !== 'select') return
    const symbol = this.searchSymbols[decision.index]
    if (this.searchPurpose === 'compare') {
      this.closeSearch()
      void this.compares.add(symbol).catch((error: unknown) => { this.showNotice(error) })
      return
    }
    if (this.run(() => { void this.setSymbol(symbol) })) {
      this.recents.push(symbolKey(symbol)); this.closeSearch()
    }
  }

  private searchKey (event: KeyboardEvent): void {
    if (event.isComposing) return
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.closeSearch(); return }
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    if (event.key === 'Enter' && event.target === this.searchInput) {
      event.preventDefault(); this.chooseSearchResult(this.searchActive); return
    }
    if (this.searchLoading || !(event.target instanceof this.win.Node) || (event.target !== this.searchInput && !this.searchResults.contains(event.target))) return
    const buttons = [...this.searchResults.querySelectorAll('button')]
    const focused = buttons.indexOf(this.doc.activeElement as HTMLButtonElement)
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      this.searchActive = moveActiveIndex(focused, event.key === 'ArrowDown' ? 1 : -1, buttons.length)
    } else if ((event.key === 'Home' || event.key === 'End') && focused !== -1) {
      this.searchActive = event.key === 'Home' ? 0 : buttons.length - 1
    } else return
    event.preventDefault()
    const selected = buttons[this.searchActive]
    selected?.focus({ preventScroll: true }); selected?.scrollIntoView({ block: 'nearest' })
  }

  private async download (): Promise<void> {
    if (this.disposed || this.downloading) return
    this.downloading = true; this.setLabel(this.downloadButton, this.t('png.saving')); this.updateStatus()
    try {
      if (this.getStatus().state !== 'ready') throw new Error(this.t('png.needData'))
      const filename = `${this.symbol.ticker.replace(/[^a-z0-9._-]/gi, '_')}-${this.period.text.replace(/[^a-z0-9._-]/gi, '_')}.png`
      const blob = await this.chart.snapshot()
      if (this.disposed) return
      const url = this.win.URL.createObjectURL(blob), link = this.node('a')
      link.href = url; link.download = filename
      this.root.append(link); link.click(); link.remove()
      const timer = this.win.setTimeout(() => { this.win.URL.revokeObjectURL(url); this.downloads.delete(timer) }, 1000)
      this.downloads.set(timer, url)
    } catch (error) { this.showNotice(error) } finally {
      this.downloading = false
      if (!this.disposed) { this.setLabel(this.downloadButton, this.t('png'), this.t('png.title')); this.updateStatus() }
    }
  }

  /** Locale actually in use, a lowercase tag of a registered catalogue (`en` when the requested one has none). */
  getLocale (): string { this.assertLive(); return this.locale }

  /**
   * Change the language of the chrome text. Takes a tag registered with `registerLocale` (or one of the built-ins);
   * a tag without a catalogue falls back to English. Open panels are redrawn; data, drawings and the chart canvas
   * are untouched.
   */
  setLocale (locale: string): void {
    this.assertLive()
    if (typeof locale !== 'string' || locale.trim() === '') throw new TypeError('A locale tag is required')
    this.locale = resolveLocale(locale); this.tr = createTranslator(this.locale)
    this.root.lang = this.locale
    this.chart.setRenderOptions({ locale: this.locale })
    for (const apply of this.bindings) apply()
    this.buildToolOptions(); this.syncPeriodControls(); this.refreshIndicatorsUi(); this.updateDrawingControls(); this.syncPresentation()
    this.fullscreenSync(); this.objectsDirty = true; this.renderObjects(); this.palette.applyText(); this.contextMenu.close(false)
    this.chart.setAriaLabel(this.t('chart.label')); this.reportedStatusUI = ''; this.updateStatus(); this.countdown.refresh()
  }

  /** The chrome size class in effect (`regular`, `compact` or `narrow`), after resolving `auto` against the width. */
  getLayout (): WorkspaceLayoutClass { this.assertLive(); return this.layoutClass }

  /**
   * Change the chrome without rebuilding the workspace: `headless`, `layout`, `intervals` and `parts`.
   * Omitted keys stay as they are; `parts` merges (`{ symbol: undefined }` is not allowed, use `true`).
   */
  setUi (changes: Pick<WorkspaceAppearanceOptions, 'headless' | 'layout' | 'intervals' | 'parts'>): void {
    this.assertLive()
    const next = {
      headless: changes.headless === undefined ? this.ui.headless : changes.headless,
      layout: changes.layout === undefined ? this.ui.layout : validLayoutMode(changes.layout),
      intervals: changes.intervals === undefined ? this.ui.intervals : validIntervalControl(changes.intervals),
      parts: { ...this.ui.parts, ...validParts(changes.parts) }
    }
    this.ui = next; this.applyUi()
  }

  /**
   * An empty container in the chrome that the host fills with its own elements: a title or account button in
   * `header-start`/`header-end` (the market bar), extra tools in `drawing-start`/`drawing-end`, notes in
   * `footer-start`/`footer-end`. The workspace never writes into it, hides it with its row, and removes it with
   * everything else on `dispose()`. Listeners and nodes the host adds are the host's to clean up.
   */
  getSlot (name: WorkspaceSlotName): HTMLElement {
    this.assertLive()
    const slot = this.slots.get(name)
    if (slot === undefined) throw new RangeError(`Unknown slot ${JSON.stringify(name)}; use one of ${WORKSPACE_SLOTS.join(', ')}`)
    return slot
  }

  /**
   * Open the symbol search, or the host's replacement when `search.onRequest` handles it. Returns true when the
   * built-in panel opened, false when the host took it.
   */
  openSymbolSearch (query = ''): boolean {
    this.assertLive()
    if (typeof query !== 'string') throw new TypeError('The search query must be a string')
    return this.openSearch(query, 'api')
  }

  /** Add a command to the palette. Returns the function that removes it. */
  registerCommand (command: WorkspaceCommand): () => void {
    this.assertLive(); validateCommand(command)
    return this.commandRegistry.register(command)
  }

  /** Open the command palette. False when it is disabled (`commands.enabled: false`). */
  openCommandPalette (query = ''): boolean {
    this.assertLive()
    if (!this.paletteEnabled) return false
    this.palette.open(query); return true
  }

  closeCommandPalette (): void { this.assertLive(); this.palette.close() }

  /** Everything the palette can run now: built-ins for this workspace's state, then the host's commands. */
  listCommands (): WorkspaceCommand[] { this.assertLive(); return this.collectCommands() }

  /** Name of the preset applied by `theme` or `setTheme`; null when the workspace follows host CSS variables. */
  getTheme (): WorkspaceThemeName | null { this.assertLive(); return this.themeName }

  private async runCommand (command: WorkspaceCommand): Promise<void> {
    try { await command.run(); if (!this.disposed) this.notice.textContent = '' } catch (error) { this.showNotice(error) }
  }

  private closeFloating (except?: 'palette' | 'search' | 'menu' | 'context'): void {
    if (except !== 'search') this.closeSearch(false)
    if (except !== 'palette') this.palette?.close(false)
    if (except !== 'context') this.contextMenu?.close(false)
    if (except !== 'menu') for (const menu of this.root.querySelectorAll<HTMLDetailsElement>('.sc-menu[open]')) menu.open = false
  }

  private scheduleLegendHide (): void {
    this.win.clearTimeout(this.legendHideTimer)
    this.legendHideTimer = this.win.setTimeout(() => { this.hideLegendActions() }, 220)
  }

  private hideLegendActions (): void { this.legendActions.hidden = true; this.legendTarget = null }

  private toolLabel (type: DrawingType): string { return this.t(`tool.${type}`) }

  /** The person picked a drawing tool (rail or dropdown), or the cursor (`null`). */
  private chooseTool (tool: DrawingType | null): void {
    this.setToolValue(this.run(() => { this.chart.setDrawingTool(tool) }) ? tool : null)
    this.chartHost.querySelector<HTMLElement>('[tabindex="0"]')?.focus({ preventScroll: true })
  }

  /** Show the armed tool in every control that names one: the dropdown and the rail. */
  private setToolValue (tool: DrawingType | null): void {
    this.drawingSelect.value = tool ?? ''; if (tool !== null) this.lastTool = tool
    this.rail.sync(tool, this.drawingSelect.disabled)
  }

  private buildToolOptions (): void {
    const select = this.drawingSelect, current = select.value
    const none = this.node('option'); none.value = ''; none.textContent = this.t('draw.none')
    select.replaceChildren(none)
    const groups = new Map<string, HTMLOptGroupElement>()
    for (const type of DRAWING_TYPES) {
      const category = toolCategory(type)
      let group = groups.get(category)
      if (group === undefined) { group = this.node('optgroup'); group.label = this.t(category); groups.set(category, group); select.append(group) }
      const option = this.node('option'); option.value = type; option.textContent = this.toolLabel(type); group.append(option)
    }
    select.value = current
  }

  private syncPeriodControls (): void {
    const key = periodKey(this.period)
    this.periodSelect.replaceChildren(...this.periods.map(period => {
      const option = this.node('option'); option.value = periodKey(period); option.textContent = period.text; return option
    }))
    this.periodSelect.value = key
    this.intervalBar.replaceChildren(...this.periods.map(period => {
      const button = this.node('button'); button.type = 'button'; button.className = 'sc-button sc-interval-button'; button.textContent = period.text
      button.setAttribute('aria-pressed', String(periodKey(period) === key)); button.dataset.interval = periodKey(period)
      this.actions.set(button, () => this.run(() => { void this.setPeriod(period) }))
      return button
    }))
  }

  /** Re-read the width, resolve the layout class, and apply headless, parts and the interval control. */
  private applyUi (): void {
    if (this.disposed) return
    const width = this.root.clientWidth || this.root.getBoundingClientRect().width
    this.layoutClass = resolveLayout(this.ui.layout, width)
    const headless = this.ui.headless, show = (part: WorkspacePart): boolean => !headless && this.ui.parts[part] !== false
    const intervals = resolveIntervalControl(this.ui.intervals, this.layoutClass)
    this.root.dataset.layout = this.layoutClass; this.root.dataset.headless = String(headless); this.root.dataset.intervals = intervals
    this.symbolButton.hidden = !show('symbol')
    this.intervalBar.hidden = !show('intervals') || intervals !== 'bar'; this.intervalField.hidden = !show('intervals') || intervals !== 'select'
    this.parts.presentation.hidden = !show('presentation'); this.parts.indicators.hidden = !show('indicators'); this.parts.objects.hidden = !show('objects')
    this.paletteButton.hidden = !show('commands') || !this.paletteEnabled
    this.scaleBar.hidden = !show('scaleBar'); this.rangeBar.hidden = !show('rangeBar') || this.layoutClass === 'narrow'
    const compact = this.layoutClass !== 'regular'
    this.parts.more.hidden = !show('drawingBar') || !compact
    this.toolsToggle.hidden = !show('drawingBar') || this.layoutClass !== 'narrow'
    if (this.layoutClass !== 'narrow') this.toolsOpen = false
    this.toolsToggle.setAttribute('aria-pressed', String(this.toolsOpen)); this.toolsToggle.setAttribute('aria-expanded', String(this.toolsOpen))
    // The rail replaces the tool dropdown wherever there is room beside the chart; a phone keeps the Tools button.
    this.drawingToolbar.setEnabled(show('drawingToolbar'))
    const rail = show('drawingBar') && show('toolRail') && this.layoutClass !== 'narrow'
    this.root.dataset.rail = String(rail); this.rail.element.hidden = !rail; this.drawingField.hidden = rail
    if (!rail) this.rail.close(false)
    const slotted = [this.slots.get('drawing-start'), this.slots.get('drawing-end')].some(slot => slot !== undefined && slot.childNodes.length > 0)
    this.drawingBar.hidden = !show('drawingBar') || (this.layoutClass === 'narrow' && !this.toolsOpen) || (rail && !slotted)
    // Secondary actions (view history, latest, PNG, fullscreen) sit inline when there is room and in the More menu otherwise.
    // With the rail, undo and redo lead the right of the market bar and lock and delete sit at the foot of the rail.
    const narrow = this.layoutClass === 'narrow', paletteInMore = narrow && !this.parts.more.hidden
    const arrangement = `${rail}|${compact}|${narrow}|${paletteInMore}`
    if (arrangement !== this.arrangement) {
      this.arrangement = arrangement
      const inMenu = this.parts.more.querySelector<HTMLElement>('.sc-menu-panel')!, end = this.slots.get('drawing-end')!
      if (rail) {
        this.rail.modes.append(this.drawingModes); this.rail.foot.append(this.drawingActions)
        // Beside the rail there is room for undo and redo only on a wide bar; a narrower one keeps them with the other actions in More.
        if (compact) inMenu.append(this.history, this.secondary)
        else { this.toolbar.insertBefore(this.history, this.parts.more); this.toolbar.insertBefore(this.secondary, this.parts.more) }
      } else {
        this.drawingBar.insertBefore(this.history, end); this.drawingBar.insertBefore(this.drawingModes, end); this.drawingBar.insertBefore(this.drawingActions, end)
        if (compact) inMenu.append(this.secondary); else this.drawingBar.insertBefore(this.secondary, end)
      }
      // A phone's footer keeps the status and the playback buttons; the price-range and time-zone controls join the Chart
      // settings, and the command-palette button joins More, so the market bar stays one row.
      if (narrow) this.parts.presentation.querySelector('.sc-menu-panel')!.append(this.scaleBar)
      else this.footer.insertBefore(this.scaleBar, this.olderButton)
      // Replay is a market-bar action like in other charting tools; a phone's bar has no room, so it stays in the footer.
      if (narrow) this.footer.insertBefore(this.replayButtons.start, this.olderButton); else this.toolbar.insertBefore(this.replayButtons.start, this.parts.objects)
      if (paletteInMore) inMenu.append(this.paletteButton)
      else this.toolbar.insertBefore(this.paletteButton, this.slots.get('header-end')!)
    }
    this.fitIntervals(show('intervals'))
    this.footer.hidden = !show('footer')
    const marketBarEmpty = !show('symbol') && !show('intervals') && !show('presentation') && !show('indicators') && !show('objects') && !show('commands') && !(compact && show('drawingBar')) && !rail &&
      ![this.slots.get('header-start'), this.slots.get('header-end')].some(slot => slot !== undefined && slot.childNodes.length > 0)
    this.toolbar.hidden = headless || marketBarEmpty
    if (headless) this.closeFloating()
  }

  /**
   * `auto` intervals show the bar while it fits. In the compact layout the market bar never wraps, so a bar that does not
   * fit would be clipped or scrolled out of sight: look, and give it the dropdown instead. Measured after the other
   * parts are placed, and only where the bar is the candidate, so a resize costs one layout read there.
   */
  private fitIntervals (shown: boolean): void {
    if (!shown || this.ui.intervals !== 'auto' || this.layoutClass !== 'compact' || this.root.dataset.intervals !== 'bar') return
    // The bar shrinks and scrolls itself before the market bar overflows, so both are read.
    const fits = this.intervalBar.scrollWidth <= this.intervalBar.clientWidth + 1 && this.toolbar.scrollWidth <= this.toolbar.clientWidth + 1
    const intervals = resolveIntervalControl(this.ui.intervals, this.layoutClass, fits)
    if (intervals === 'bar') return
    this.root.dataset.intervals = intervals; this.intervalBar.hidden = true; this.intervalField.hidden = false
  }

  private setToolsOpen (open: boolean): void {
    this.toolsOpen = open && this.layoutClass === 'narrow'; this.applyUi()
  }

  private fitPriceScale (): void {
    this.run(() => { this.chart.setLayout({ priceScale: { ...this.chart.getLayoutOptions().priceScale, range: undefined } }) })
    this.syncPresentation()
  }

  /** Time zone of the axis and crosshair labels for intraday bars: an IANA id, `UTC` unless the host or the person chose. */
  getTimeZone (): string { this.assertLive(); return this.zoneId }

  /**
   * Show intraday times in an IANA zone (`Asia/Taipei`, `America/New_York`, `UTC`). Day-and-larger bars keep reading
   * in the symbol's own zone. A name Intl does not know throws a `RangeError` whose `code` is `time_zone_unknown`
   * (`time_zone_type` for a non-string); the picker offers the zones from `listTimeZones()`.
   */
  setTimeZone (timeZone: string): void {
    this.assertLive()
    const check = checkTimeZone(timeZone)
    if (!check.ok) throw Object.assign(new RangeError(check.hint), { code: check.code })
    this.chart.setRenderOptions({ timeZone: check.id })
    this.showTimeZone(check.id)
    this.syncPresentation()
  }

  /** Make the picker read `id`; the list is rebuilt only when the zone is not already the one it shows. */
  /**
   * Show the window from the latest bar back to the start of `range`. If the loaded history does not reach that far
   * and the feed has more, older pages are requested until it does (or the feed runs out, or ten seconds pass).
   * `all` fits everything loaded. The window follows the latest bar afterwards.
   */
  showRange (range: WorkspaceRange): void {
    this.assertLive()
    if (!(WORKSPACE_RANGES as readonly string[]).includes(range)) throw new RangeError('Unknown range')
    const view = this.chart.view, port = this.chart.dataPort
    const fit = (): boolean => {
      const bars = port.getDataList()
      if (bars.length === 0) return true
      const start = rangeStart(range, bars[bars.length - 1].timestamp)
      const count = start === null ? bars.length : Math.max(2, bars.length - firstBarFrom(bars, start))
      view.followLatest(count)
      return start === null || bars[0].timestamp <= start
    }
    if (fit() || !view.getSnapshot().hasMore) return
    let length = port.getDataList().length
    const stop = (): void => { off(); this.win.clearTimeout(timer) }
    const off = view.subscribe(() => {
      if (this.disposed) { stop(); return }
      const now = port.getDataList().length
      if (now === length) return
      length = now
      if (fit() || !view.getSnapshot().hasMore) stop(); else view.requestMore()
    })
    const timer = this.win.setTimeout(stop, 10_000)
    view.requestMore()
  }

  /** The clock beside the time-zone picker: the time in the zone the axis uses, with its offset. */
  private startClock (): void {
    const tick = (): void => {
      if (this.disposed || this.doc.hidden) return
      const zone = this.zoneId
      try {
        const time = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(this.win.Date.now())
        const offset = formatUtcOffset(zone, this.win.Date.now()).replace(/^([+-])0?(\d+):00$/, '$1$2')
        const text = `${time} ${offset === '+0' ? 'UTC' : `UTC${offset}`}`
        if (this.clockNode.textContent !== text) this.clockNode.textContent = text
      } catch { this.clockNode.textContent = '' }
    }
    tick(); this.clockTimer = this.win.setInterval(tick, 1000)
  }

  private showTimeZone (id: string): void {
    this.zoneId = id
    if (this.zoneSelect.value !== id) { this.zoneSelect.value = id; if (this.zoneSelect.value !== id) this.fillTimeZones(this.zoneListFull) }
  }

  private toggleTimeZone (): void {
    this.run(() => { this.setTimeZone(this.zoneId === 'UTC' ? localTimeZone() : 'UTC') })
  }

  /** The zone picker: this device and the common zones, then all the others, offsets as of now. */
  private fillTimeZones (full: boolean): void {
    this.zoneListFull = full
    const local = localTimeZone(), groups = new Map<string, HTMLOptGroupElement>()
    const choices = full ? timeZoneChoices({ extra: [this.zoneId], local }) : [{ id: this.zoneId, offset: formatUtcOffset(this.zoneId, Date.now()), group: 'common' as const }]
    for (const choice of choices) {
      let group = groups.get(choice.group)
      if (group === undefined) { group = this.node('optgroup'); group.label = this.t(choice.group === 'common' ? 'timezone.common' : 'timezone.all'); groups.set(choice.group, group) }
      const option = this.node('option'); option.value = choice.id
      option.textContent = choice.id === 'UTC' ? 'UTC' : `${choice.id} (${choice.id === local ? `${this.t('timezone.device')}, ` : ''}UTC${choice.offset})`
      group.append(option)
    }
    this.zoneSelect.replaceChildren(...groups.values())
    this.zoneSelect.value = this.zoneId
  }

  private renderObjects (): void {
    if (this.disposed || !this.objectsMenu.open || !this.objectsDirty) return
    this.objectsDirty = false
    const section = (title: string, rows: HTMLElement[]): HTMLElement[] => {
      if (rows.length === 0) return []
      const heading = this.node('h3'); heading.textContent = title; heading.className = 'sc-object-heading'
      return [heading, ...rows]
    }
    const row = (name: string, actions: ReadonlyArray<readonly [string, () => void, boolean?]>, select?: () => void): HTMLElement => {
      const item = this.node('div'); item.className = 'sc-object-row'
      const label = this.node('button'); label.type = 'button'; label.className = 'sc-button sc-object-name'; label.textContent = name; label.title = name
      if (select !== undefined) this.actions.set(label, () => { this.run(select) }); else label.disabled = true
      item.append(label)
      for (const [text, action, disabled] of actions) {
        const button = this.button(text, () => { this.run(action) }); button.disabled = disabled === true; item.append(button)
      }
      return item
    }
    const indicators = this.chart.listIndicators().map(indicator => row(`${indicatorLabel(indicator.name)}${indicator.params.length === 0 ? '' : ` (${indicator.params.join(', ')})`}`, [
      [this.t(indicator.visible ? 'objects.hide' : 'objects.show'), () => { this.chart.updateIndicator(indicator.id, { visible: !indicator.visible }) }],
      [this.t('objects.delete'), () => { this.chart.removeIndicator(indicator.id) }]
    ]))
    const state = this.chart.drawings.getSnapshot()
    const drawings = state.drawings.map(drawing => row(drawing.text === undefined ? this.toolLabel(drawing.type) : this.t('objects.name.text', { type: this.toolLabel(drawing.type), text: drawing.text }), [
      [this.t(drawing.hidden ? 'objects.show' : 'objects.hide'), () => { this.chart.drawings.update(drawing.id, { hidden: !drawing.hidden }) }],
      [this.t(drawing.locked ? 'objects.unlock' : 'objects.lock'), () => { this.chart.drawings.update(drawing.id, { locked: !drawing.locked }) }],
      [this.t('objects.delete'), () => { this.chart.drawings.remove(drawing.id) }, drawing.locked]
    ], () => { this.chart.drawings.select(drawing.id) }))
    const overlays = this.renderOverlayRows(row)
    const children = [...section(this.t('objects.drawings'), drawings), ...section(this.t('objects.indicators'), indicators), ...section(this.t('objects.overlays'), overlays), ...section(this.t('objects.marks'), this.renderMarkRows(row))]
    if (children.length === 0) { const empty = this.node('p'); empty.className = 'sc-hint'; empty.textContent = this.t('objects.none'); children.push(empty) }
    this.objectList.replaceChildren(...children)
  }

  /** Host annotations are read-only here: the host owns them, so the tree lists them without edit actions. */
  private renderOverlayRows (row: (name: string, actions: ReadonlyArray<readonly [string, () => void, boolean?]>, select?: () => void) => HTMLElement): HTMLElement[] {
    return this.annotations.getSnapshot().annotations.filter(item => item.layer !== MARKS_LAYER).map(item => row(item.spec.text === undefined || item.spec.text === '' ? `${item.spec.kind} · ${item.spec.key}` : `${item.spec.kind} · ${item.spec.text}`, []))
  }

  /** The event marks as words, newest first and capped, for the keyboard and screen readers (the canvas markers carry only a label). */
  private renderMarkRows (row: (name: string, actions: ReadonlyArray<readonly [string, () => void, boolean?]>, select?: () => void) => HTMLElement): HTMLElement[] {
    if (!this.marks.visible) return []
    const marks = this.marks.list(), shown = marks.slice(-MARK_ROWS).reverse()
    // Read-only text, not a disabled button: a disabled control cannot take keyboard focus, and these rows exist to be read.
    const rows = shown.map(mark => {
      const text = `${this.formatMarkTime(mark.time)} · ${mark.label}${mark.text === undefined || mark.text === '' ? '' : ` — ${mark.text}`}`
      const item = row(text, []), label = item.firstElementChild as HTMLElement
      const note = this.node('div'); note.className = 'sc-mark-row'; note.tabIndex = 0; note.textContent = text
      label.replaceWith(note)
      return item
    })
    if (marks.length > shown.length) { const more = this.node('p'); more.className = 'sc-hint'; more.textContent = this.t('objects.marks.more', { count: marks.length - shown.length }); rows.push(more) }
    return rows
  }

  private onContextMenu (event: MouseEvent): void {
    if (this.disposed || this.ui.headless || this.contextOptions === null) return
    event.preventDefault()
    this.closeFloating('context')
    const hit = this.chart.drawingAt(event.clientX, event.clientY, 8), point = this.chart.pointAt(event.clientX, event.clientY)
    const items: ContextMenuItem[] = []
    if (this.chart.zoneAt(event.clientX, event.clientY) === 'price-axis') {
      // Over the price axis the menu is about the scale, as in other charting tools.
      const mode = this.chart.getLayoutOptions().priceScale?.mode ?? 'linear'
      const setScale = (changes: Partial<PriceScaleOptions>): void => {
        const next = { ...this.chart.getLayoutOptions().priceScale, ...changes }
        this.chart.setLayout({ priceScale: next }); this.scale = next; this.syncPresentation()
      }
      items.push(
        { id: 'scale.auto', label: this.t('context.scaleAuto'), run: () => { this.fitPriceScale() } },
        { id: 'scale.linear', label: this.t('priceScale.linear'), separator: true, run: () => { setScale({ mode: 'linear' }) }, disabled: mode === 'linear' },
        { id: 'scale.log', label: this.t('priceScale.log'), run: () => { setScale({ mode: 'log' }) }, disabled: mode === 'log' },
        { id: 'scale.percentage', label: this.t('priceScale.percentage'), run: () => { setScale({ mode: 'percentage' }) }, disabled: mode === 'percentage' },
        { id: 'scale.reverse', label: this.t('palette.reverse'), separator: true, run: () => { setScale({ reversed: this.chart.getLayoutOptions().priceScale?.reversed !== true }) } }
      )
      this.contextMenu.open(items, event.clientX, event.clientY, this.t('context.label'))
      return
    }
    if (this.chart.zoneAt(event.clientX, event.clientY) === 'time-axis') {
      // Over the time axis the menu is about time: jump, reset, follow. The price commands do not belong here.
      items.push(
        { id: 'view.goto', label: this.t('palette.goto'), run: () => { this.openGoToDate() } },
        { id: 'view.reset', label: this.t('context.reset'), separator: true, run: () => { this.chart.view.resetViewport() } },
        { id: 'view.latest', label: this.t('context.latest'), run: () => { this.chart.view.followLatest() } }
      )
      this.contextMenu.open(items, event.clientX, event.clientY, this.t('context.label'))
      return
    }
    if (hit !== null) {
      this.chart.drawings.select(hit.id)
      const drawing = this.chart.drawings.getSnapshot().drawings.find(item => item.id === hit.id)
      if (drawing !== undefined) {
        items.push(
          { id: 'drawing.lock', label: `${this.t('context.drawing')}: ${this.t(drawing.locked ? 'draw.unlock' : 'draw.lock')}`, run: () => { this.chart.drawings.update(drawing.id, { locked: !drawing.locked }) } },
          { id: 'drawing.delete', label: `${this.t('context.drawing')}: ${this.t('objects.delete')}`, disabled: drawing.locked, danger: true, run: () => { this.chart.drawings.remove(drawing.id) } }
        )
      }
    }
    if (point !== null) {
      const digits = this.chart.getRenderOptions().pricePrecision ?? resolvePricePrecision(this.symbol.pricePrecision, this.chart.dataPort.getDataList())
      const text = point.price.toFixed(digits)
      items.push(
        { id: 'price.copy', label: this.t('context.copyPrice', { price: text }), separator: items.length > 0, run: () => { void this.win.navigator.clipboard?.writeText(text).catch(error => { this.showNotice(error) }) } },
        {
          id: 'price.horizontal',
          label: this.t('context.horizontal', { price: text }),
          run: () => {
            const store = this.chart.drawings
            let id: string, n = 0
            do { id = `drawing-${Date.now().toString(36)}-h${(++n).toString(36)}` } while (store.getSnapshot().drawings.some(item => item.id === id))
            store.add({ id, type: 'horizontal', anchors: [{ timestamp: point.timestamp, price: point.price }] }); store.select(id)
          }
        }
      )
    }
    items.push(
      { id: 'view.fit', label: this.t('context.fit'), separator: items.length > 0, run: () => { this.fitPriceScale() } },
      { id: 'view.reset', label: this.t('context.reset'), run: () => { this.chart.view.resetViewport() } },
      { id: 'view.latest', label: this.t('context.latest'), run: () => { this.chart.view.followLatest() } }
    )
    if (this.chart.drawings.getSnapshot().drawings.length > 0) items.push({ id: 'drawings.toggle', label: this.t(this.chart.drawings.getSnapshot().viewHidden ? 'draw.showAll' : 'draw.hideAll'), run: () => { this.chart.drawings.setViewHidden(!this.chart.drawings.getSnapshot().viewHidden) } })
    if (this.chart.drawings.getSnapshot().drawings.length > 0) items.push({ id: 'drawings.clear', label: this.t('context.removeAll'), danger: true, separator: true, run: () => { this.chart.drawings.clear() } })
    if (this.paletteEnabled) items.push({ id: 'palette', label: this.t('context.palette'), separator: true, run: () => { this.openCommandPalette() } })
    items.push({ id: 'search', label: this.t('context.search'), separator: !this.paletteEnabled, run: () => { this.openSearch('', 'command') } })
    let extra: readonly ContextMenuItem[] = []
    try { extra = this.contextOptions.items?.({ x: event.clientX, y: event.clientY, drawingId: hit?.id ?? null, point }) ?? [] } catch (error) { this.showNotice(error) }
    extra.forEach((item, index) => items.push(index === 0 ? { ...item, separator: true } : item))
    this.contextMenu.open(items, event.clientX, event.clientY, this.t('context.label'))
  }

  private collectCommands (): WorkspaceCommand[] {
    const t = this.t.bind(this), commands: WorkspaceCommand[] = []
    const add = (id: string, title: string, group: string, run: () => void | Promise<void>, extra: Partial<WorkspaceCommand> = {}): void => { commands.push({ id, title, group: t(group), run, ...extra }) }
    add('workspace.search', t('palette.search'), 'palette.group.general', () => { this.openSearch('', 'command') }, { keywords: ['symbol', 'ticker'] })
    add('workspace.compare', t('palette.compare'), 'palette.group.chart', () => { this.openSearch('', 'command', 'compare') }, { keywords: ['compare', 'overlay', 'symbol', 'versus', 'vs'] })
    for (const item of this.compares.list()) add(`compare.remove.${item.id}`, t('palette.compare.remove', { name: item.symbol.ticker }), 'palette.group.chart', () => { this.compares.remove(item.id) })
    add('workspace.reload', t('palette.reload'), 'palette.group.general', () => { void this.reload() })
    for (const name of [AUTO_THEME, ...listWorkspaceThemes()]) add(`theme.${name}`, t('palette.theme', { name: t(`theme.${name}`) }), 'palette.group.general', () => { this.setTheme(name) }, { keywords: ['theme', 'dark', 'light'], when: () => this.themeName !== name })
    for (const period of this.periods) add(`interval.${periodKey(period)}`, t('palette.interval', { name: period.text }), 'palette.group.interval', () => { void this.setPeriod(period) }, { keywords: ['interval', 'timeframe', 'period'], when: () => periodKey(period) !== periodKey(this.period) })
    // Point and figure belongs to the price mode (it needs a box size), so it is not offered as a plain chart type.
    for (const type of ENGINE_CHART_TYPES.filter(type => type !== 'point-figure')) add(`chartType.${type}`, t('palette.chartType', { name: t(`chartType.${type}`) }), 'palette.group.chart', () => { this.chart.setRenderOptions({ chartType: type }); this.syncPresentation() })
    for (const mode of ['linear', 'log', 'percentage'] as const) add(`scale.${mode}`, t('palette.scale', { name: t(`priceScale.${mode}`) }), 'palette.group.chart', () => { this.chart.setLayout({ priceScale: { ...this.chart.getLayoutOptions().priceScale, mode } }); this.syncPresentation() })
    for (const name of PRICE_MODES) add(`priceMode.${name}`, t('palette.priceMode', { name: t(name === 'raw' ? 'priceMode.raw' : name === 'heikin-ashi' ? 'priceMode.heikin' : `priceMode.${name}`) }), 'palette.group.chart', () => { this.setPriceMode(name); this.syncPresentation() }, { keywords: ['renko', 'kagi', 'range', 'line break', 'point and figure', 'x o', 'price mode'], when: () => this.getPriceMode() !== name })
    add('chart.heikin', t('palette.heikin'), 'palette.group.chart', () => { this.setPriceMode(this.getPriceMode() === 'heikin-ashi' ? 'raw' : 'heikin-ashi'); this.syncPresentation() })
    add('chart.reverse', t('palette.reverse'), 'palette.group.chart', () => { const current = this.chart.getLayoutOptions().priceScale; this.chart.setLayout({ priceScale: { ...current, reversed: current?.reversed !== true } }); this.syncPresentation() })
    if (typeof this.datafeed.getMarks === 'function') add('chart.marks', t('palette.marks'), 'palette.group.chart', () => { this.setMarksVisible(!this.marks.visible) }, { keywords: ['events', 'earnings', 'dividend', 'split', 'news'] })
    for (const range of WORKSPACE_RANGES) add(`view.range.${range}`, t('range.named', { name: t(`range.${range}`) }), 'palette.group.view', () => { this.showRange(range) }, { keywords: ['range', 'zoom', 'period', 'ytd'] })
    add('view.fit', t('context.fit'), 'palette.group.view', () => { this.fitPriceScale() })
    add('draw.toggleHidden', t(this.chart.drawings.getSnapshot().viewHidden ? 'draw.showAll' : 'draw.hideAll'), 'palette.group.draw', () => { this.chart.drawings.setViewHidden(!this.chart.drawings.getSnapshot().viewHidden) }, { keywords: ['hide', 'show', 'visible', 'drawings', 'eye'], when: () => this.chart.drawings.getSnapshot().drawings.length > 0 })
    add('view.goto', t('palette.goto'), 'palette.group.view', () => { this.openGoToDate() }, { shortcut: 'Alt+G', keywords: ['date', 'time', 'jump', 'seek'] })
    add('view.reset', t('context.reset'), 'palette.group.view', () => { this.chart.view.resetViewport() }, { shortcut: 'Alt+R' })
    add('view.latest', t('nav.latest.title'), 'palette.group.view', () => { this.chart.view.followLatest() })
    add('view.timezone', t(this.zoneId === 'UTC' ? 'scale.local.title' : 'scale.utc.title'), 'palette.group.view', () => { this.toggleTimeZone() })
    for (const id of new Set([localTimeZone(), ...COMMON_TIME_ZONES])) add(`view.timezone.${id}`, t('palette.timezone', { name: id }), 'palette.group.view', () => { this.setTimeZone(id) }, { keywords: ['time', 'zone', 'timezone', 'utc'], when: () => this.zoneId !== id })
    add('draw.pan', t('palette.tool', { name: t('draw.none') }), 'palette.group.draw', () => { this.chart.setDrawingTool(null); this.setToolValue(null) })
    for (const type of DRAWING_TYPES) add(`draw.${type}`, t('palette.tool', { name: this.toolLabel(type) }), 'palette.group.draw', () => { this.chart.setDrawingTool(type); this.setToolValue(type) }, { keywords: ['draw', type], ...(toolHotkey(type) === undefined ? {} : { shortcut: toolHotkey(type) }) })
    add('draw.undo', t('draw.undo'), 'palette.group.draw', () => { this.chart.drawings.undo() }, { shortcut: 'Ctrl+Z', when: () => this.chart.drawings.getSnapshot().canUndo })
    add('draw.redo', t('draw.redo'), 'palette.group.draw', () => { this.chart.drawings.redo() }, { shortcut: 'Ctrl+Shift+Z', when: () => this.chart.drawings.getSnapshot().canRedo })
    add('draw.clear', t('palette.clearDrawings'), 'palette.group.draw', () => { this.chart.drawings.clear() }, { when: () => this.chart.drawings.getSnapshot().drawings.length > 0 })
    for (const name of searchIndicators(this.chart.getRegisteredIndicatorNames(), '')) add(`indicator.add.${name}`, t('palette.indicator.add', { name: indicatorLabel(name) }), 'palette.group.indicators', () => { this.chart.addIndicator({ name }) }, { keywords: ['indicator', name, name.replace(/^SC_/, ''), ...indicatorInfo(name).keywords.split(' ')] })
    for (const indicator of this.chart.listIndicators()) add(`indicator.remove.${indicator.id}`, t('palette.indicator.remove', { name: `${indicatorLabel(indicator.name)}${indicator.params.length === 0 ? '' : ` (${indicator.params.join(', ')})`}` }), 'palette.group.indicators', () => { this.chart.removeIndicator(indicator.id) })
    const replaying = this.loader.replayInfo !== null
    add('replay.start', t('replay.start'), 'palette.group.replay', () => { if (!this.startReplay()) throw new Error(t('replay.needBars')) }, { when: () => !replaying && this.getStatus().state === 'ready' })
    add('replay.play', t(this.getReplayState().playing ? 'replay.pause' : 'replay.play'), 'palette.group.replay', () => { if (this.getReplayState().playing) this.pauseReplay(); else this.playReplay() }, { when: () => replaying })
    add('replay.exit', t('replay.exit'), 'palette.group.replay', () => { this.exitReplay() }, { when: () => replaying })
    add('workspace.png', t('png.title'), 'palette.group.general', () => { void this.download() }, { shortcut: 'Alt+S' })
    return [...commands, ...this.commandRegistry.list()]
  }

  private node<K extends keyof HTMLElementTagNameMap> (tag: K): HTMLElementTagNameMap[K] { return this.doc.createElement(tag) }
  private listen (target: EventTarget, type: string, listener: EventListener): void { target.addEventListener(type, listener, { signal: this.abort.signal }) }
  private button (text: string, action: () => unknown): HTMLButtonElement {
    const button = this.node('button'); button.type = 'button'; button.textContent = text
    button.className = 'sc-button'; button.title = text
    this.actions.set(button, action); return button
  }

  /**
   * A translated button. `key` is the label; `icon` adds a glyph that the compact and narrow layouts show instead of
   * the label (which stays for assistive technology); `iconOnly` always hides the label.
   */
  private control (key: string, action: () => unknown, options: { icon?: IconName, iconOnly?: boolean, title?: string } = {}): HTMLButtonElement {
    const button = this.node('button'); button.type = 'button'; button.className = 'sc-button'
    if (options.icon !== undefined) {
      button.classList.add('sc-icon-button'); if (options.iconOnly === true) button.classList.add('sc-icon-only')
      const label = this.node('span'); label.className = 'sc-label'
      button.append(createIcon(this.doc, options.icon), label)
    }
    this.actions.set(button, action)
    this.bind(() => { this.setLabel(button, this.t(key), options.title === undefined ? undefined : this.t(options.title)); })
    return button
  }

  /** Set a button's visible label, tooltip and accessible name together; icons stay in place. */
  private setLabel (button: HTMLElement, text: string, title = text): void {
    const label = button.querySelector<HTMLElement>(':scope > .sc-label')
    if (label !== null) { if (label.textContent !== text) label.textContent = text } else if (button.textContent !== text) button.textContent = text
    if (button.title !== title) button.title = title
    button.setAttribute('aria-label', text)
  }

  private select (name: string, values: ReadonlyArray<readonly [string, string | (() => string)]>, selected: string, literal = false): HTMLSelectElement {
    const select = this.node('select'); select.className = 'sc-select'
    const apply = (): void => {
      const label = literal ? name : this.t(name)
      select.setAttribute('aria-label', label); select.title = label
      const current = select.value
      select.replaceChildren(...values.map(([value, text]) => {
        const option = this.node('option'); option.value = value; option.textContent = typeof text === 'function' ? text() : text; return option
      }))
      select.value = current === '' ? selected : current
    }
    select.value = selected
    if (literal) apply(); else this.bind(apply)
    select.value = selected; return select
  }

  private row (nameKey: string): HTMLDivElement {
    const row = this.node('div'); row.setAttribute('role', 'toolbar')
    this.bind(() => { row.setAttribute('aria-label', this.t(nameKey)); })
    row.className = 'sc-row'; return row
  }

  private field (nameKey: string, control: HTMLElement): HTMLLabelElement {
    const field = this.node('label'); field.className = 'sc-field'
    const caption = this.node('span'); caption.className = 'sc-field-label'
    this.bind(() => { caption.textContent = this.t(nameKey) })
    field.append(caption, control); return field
  }

  /** A field whose caption is already translated text (used inside rebuilt lists). */
  private fieldText (text: string, control: HTMLElement): HTMLLabelElement {
    const field = this.node('label'); field.className = 'sc-field'
    const caption = this.node('span'); caption.className = 'sc-field-label'; caption.textContent = text
    field.append(caption, control); return field
  }

  private t (key: string, params?: Readonly<Record<string, string | number>>): string { return this.tr(key, params) }
  /** Run `apply` now and again whenever the locale changes. */
  private bind (apply: () => void): void { this.bindings.push(apply); apply() }

  private setText (node: HTMLElement, value: string): void { if (node.textContent !== value) node.textContent = value }

  /** Separate values as separate elements that CSS spaces apart, never one string joined with separators. Empty parts are left out. */
  private setParts (node: HTMLElement, parts: ReadonlyArray<readonly [text: string, className?: string]>): void {
    const shown = parts.filter(([text]) => text !== '')
    const signature = JSON.stringify(shown)
    if (node.dataset.parts === signature) return
    node.dataset.parts = signature
    node.replaceChildren(...shown.map(([text, className]) => {
      const part = this.node('span'); part.textContent = text
      if (className !== undefined) part.className = className
      return part
    }))
  }

  /** A dropdown of the market bar. `icon` is what the narrow layout shows in place of the name (the text stays for assistive technology). */
  private menu (nameKey: string, descriptionKey: string, icon?: string): { root: HTMLDetailsElement, summary: HTMLElement, panel: HTMLDivElement } {
    const root = this.node('details'); root.className = 'sc-menu'
    if (icon !== undefined) root.dataset.icon = icon
    const summary = this.node('summary')
    const panel = this.node('div'); panel.className = 'sc-menu-panel'; panel.setAttribute('role', 'group')
    this.bind(() => {
      // The indicators summary carries a count badge; keep it when the locale changes.
      if (summary.dataset.parts === undefined) summary.textContent = this.t(nameKey)
      summary.title = this.t(descriptionKey); panel.setAttribute('aria-label', this.t(descriptionKey))
    })
    root.append(summary, panel)
    this.listen(root, 'toggle', () => {
      if (root.open) {
        const toolbar = this.root.querySelector<HTMLElement>('.sc-marketbar')
        if (toolbar !== null) panel.style.top = `${toolbar.offsetHeight + 4}px`
        if (root.classList.contains('sc-type-menu')) panel.style.left = `${Math.max(0, Math.round(root.getBoundingClientRect().left - this.root.getBoundingClientRect().left))}px`
        this.closeSearch(false); this.palette?.close(false); this.contextMenu?.close(false)
        for (const other of this.root.querySelectorAll<HTMLDetailsElement>('.sc-menu[open]')) if (other !== root) other.open = false
      }
    })
    this.listen(root, 'keydown', event => {
      const key = event as KeyboardEvent
      if (key.key === 'Escape' && root.open) { key.preventDefault(); key.stopPropagation(); root.open = false; summary.focus() }
    })
    return { root, summary, panel }
  }

  private run (action: () => void): boolean {
    if (this.disposed) return false
    try { action(); this.notice.textContent = ''; return true } catch (error) { this.showNotice(error); return false }
  }

  private errorMessage (error: unknown): string { return error instanceof Error ? error.message : String(error ?? 'Unknown error') }
  private showHoldDraw (event: HoldDrawEvent): void {
    if (this.disposed) return
    this.holdNote.textContent = event.phase === 'armed' ? this.t('hold.armed')
      : event.phase === 'recognized' ? this.t('hold.recognized', { shape: this.toolLabel(event.shape) })
        : event.phase === 'erased' ? this.t('hold.erased', { count: String(event.count) })
          : event.phase === 'removed' ? this.t('hold.removed') : this.t('hold.unrecognized')
  }

  /** Open the palette on a date to edit: the latest bar's, selected, so typing replaces it and Enter goes there. */
  private openGoToDate (): void {
    const zone = this.chart.getRenderOptions().timeZone ?? 'UTC', last = this.chart.getBars({ limit: 1 })[0]
    if (this.paletteEnabled) this.palette.open(last === undefined ? '' : formatDateQuery(last.timestamp, zone), true)
  }

  /** A date typed in the palette becomes a command that moves the view to the nearest loaded bar, and says when the date is outside what is loaded. */
  private dateSuggestions (query: string): WorkspaceCommand[] {
    const zone = this.chart.getRenderOptions().timeZone ?? 'UTC', timestamp = parseDateQuery(query, zone)
    if (timestamp === null) return []
    return [{
      id: 'view.goto.date',
      group: this.t('palette.group.view'),
      title: this.t('palette.goto.to', { date: formatDateQuery(timestamp, zone) }),
      run: () => {
        const bars = this.chart.getBars(), first = bars[0], last = bars.at(-1)
        if (first === undefined || last === undefined) throw new Error(this.t('goto.before', { date: '-' }))
        this.chart.view.seek(timestamp)
        // Thrown so the command runner shows it as the notice (it clears the notice after a quiet run).
        if (timestamp < first.timestamp) throw new Error(this.t('goto.before', { date: formatDateQuery(first.timestamp, zone) }))
        if (timestamp > last.timestamp) throw new Error(this.t('goto.after', { date: formatDateQuery(last.timestamp, zone) }))
      }
    }]
  }

  private showNotice (error: unknown): void { if (!this.disposed) this.notice.textContent = this.errorMessage(error) }
  private assertLive (): void { if (this.disposed) throw new Error('Chart workspace is disposed') }
}
