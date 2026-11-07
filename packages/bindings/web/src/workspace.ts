/* eslint-disable @typescript-eslint/promise-function-async -- Load methods validate synchronously and return the shared queue promise without an async wrapper. */
import { EngineChart, type EngineChartOptions, type EngineConfiguration } from './chart'
import { ENGINE_CHART_TYPES, DRAWING_TYPES, DataLoader, resolvePricePrecision, symbolKey, periodKey, parsePeriod, WorkspaceEventBus, WorkspaceLoadQueue, createTimedReplay, createBarCountdown, parseWorkspaceDocument, type IndicatorDefinition, type EngineChartType, type DrawingType, type PriceScaleOptions, type DataStatus, type LoaderOptions, type ChartDataPort, type Datafeed, type Period, type SymbolInfo, type MarketBar, type WorkspaceEvents, type WorkspaceLoadResult, type WorkspaceLoadState, type WorkspaceMarket, type WorkspaceReplayState, type WorkspaceState, type TimedReplay, type BarCountdown, type WorkspaceDocumentV1 } from '@supersolutions/super-chart-core'
import { moveActiveIndex, decideEnter, createRecentsStore, visibleRecents, type RecentsStore } from './symbolSearchNav'

export interface WorkspaceSearchOptions {
  /** In-memory recents by default. Set zero to disable; at most 50. */
  recentLimit?: number
  initialRecent?: readonly SymbolInfo[]
  /** Explicit host namespace enables persistence; no default global storage key. */
  persistKey?: string
  storage?: Pick<Storage, 'getItem' | 'setItem'>
}

export interface ChartWorkspaceOptions {
  datafeed: Datafeed
  symbol: SymbolInfo
  period: Period
  periods?: readonly Period[]
  chart?: EngineChartOptions
  loader?: Omit<LoaderOptions, 'datafeed' | 'env'>
  search?: WorkspaceSearchOptions
  /** Period-close estimate. Disable or supply the exchange's real session close. */
  countdown?: { enabled?: boolean, closeTimestamp?: (market: WorkspaceMarket, lastBar: MarketBar) => number | null }
}

const EMPTY_DRAWINGS = '{"version":1,"drawings":[]}'
const INDICATORS = ['MA', 'EMA', 'BOLL', 'VOL', 'MACD', 'RSI', 'KDJ'] as const
const DEFAULT_PERIODS: readonly Period[] = [
  { multiplier: 1, timespan: 'minute', text: '1m' }, { multiplier: 5, timespan: 'minute', text: '5m' },
  { multiplier: 15, timespan: 'minute', text: '15m' }, { multiplier: 1, timespan: 'hour', text: '1h' },
  { multiplier: 4, timespan: 'hour', text: '4h' }, { multiplier: 1, timespan: 'day', text: '1D' }
]
const pairKey = (symbol: SymbolInfo, period: Period): string => `${symbolKey(symbol)}:${periodKey(period)}`
const label = (value: string): string => value.replace(/-/g, ' ')
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

/** DOM controls for the owned engine. This is not the legacy Pro API compatibility surface. */
export class ChartWorkspace {
  readonly chart: EngineChart
  /** Constructor load outcome; same-tick market changes share its final request. */
  readonly ready: Promise<WorkspaceLoadResult>
  private readonly doc: Document
  private readonly win: Window & typeof globalThis
  private readonly abort: AbortController
  private loader: DataLoader
  private timedReplay: TimedReplay
  private readonly countdown: BarCountdown
  private readonly loaderOptions: ChartWorkspaceOptions['loader']
  private readonly loads: WorkspaceLoadQueue
  private readonly events: WorkspaceEventBus
  private readonly loaderUnsubscribe: Array<() => void> = []
  private readonly datafeed: Datafeed
  private readonly root: HTMLDivElement
  private readonly chartHost: HTMLDivElement
  private readonly statusNode: HTMLDivElement
  private readonly notice: HTMLDivElement
  private readonly symbolButton: HTMLButtonElement
  private readonly periodSelect: HTMLSelectElement
  private readonly drawingSelect: HTMLSelectElement
  private readonly indicatorSelect: HTMLSelectElement
  private readonly syncPresentation: () => void
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
  private readonly olderButton: HTMLButtonElement
  private readonly replayInfo: HTMLSpanElement
  private readonly replayButtons: { start: HTMLButtonElement, back: HTMLButtonElement, next: HTMLButtonElement, play: HTMLButtonElement, exit: HTMLButtonElement }
  private readonly replaySpeed: HTMLSelectElement
  private readonly drawingButtons: { undo: HTMLButtonElement, redo: HTMLButtonElement, lock: HTMLButtonElement, remove: HTMLButtonElement }
  private readonly unsubscribe: Array<() => void> = []
  private readonly drawingDocuments = new Map<string, string>()
  private readonly downloads = new Map<number, string>()
  private readonly actions = new WeakMap<HTMLButtonElement, () => unknown>()
  private symbol: SymbolInfo
  private period: Period
  private periods: Period[]
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
    this.doc = host.ownerDocument
    if (this.doc.defaultView === null) throw new Error('Workspace host needs an active document')
    this.win = this.doc.defaultView as Window & typeof globalThis
    this.abort = new this.win.AbortController()
    this.loads = new WorkspaceLoadQueue(callback => this.win.queueMicrotask(callback), result => this.events.emit('loadResult', result))
    this.events = new WorkspaceEventBus((...args) => this.win.console.warn(...args), callback => this.win.queueMicrotask(callback))
    this.loaderOptions = options.loader
    this.datafeed = options.datafeed
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
    this.root = this.node('div')
    this.root.style.cssText = 'display:flex;flex-direction:column;position:relative;width:100%;height:100%;min-height:280px;background:#10151d;color:#d6deea;font:13px system-ui;box-sizing:border-box;'
    this.root.setAttribute('aria-label', 'Chart workspace')
    this.listen(this.root, 'click', event => {
      const button = event.target instanceof this.win.Element ? event.target.closest('button') : null
      if (!this.disposed && button instanceof this.win.HTMLButtonElement && !button.disabled) this.actions.get(button)?.()
    })
    const toolbar = this.row('Chart controls'), drawingBar = this.row('Drawing controls'), footer = this.row('Chart playback')
    this.symbolButton = this.button(this.symbol.ticker, () => this.openSearch())
    this.symbolButton.setAttribute('aria-haspopup', 'dialog'); this.symbolButton.setAttribute('aria-expanded', 'false')
    this.periodSelect = this.select('Interval', this.periods.map(period => [periodKey(period), period.text]), periodKey(this.period))
    this.listen(this.periodSelect, 'change', () => this.run(() => {
      const period = this.periods.find(item => periodKey(item) === this.periodSelect.value)
      if (period !== undefined) void this.setPeriod(period)
    }))
    const chartType = this.select('Chart type', ENGINE_CHART_TYPES.map(type => [type, label(type)]), options.chart?.render?.chartType ?? 'candles')
    this.listen(chartType, 'change', () => this.run(() => this.chart.setRenderOptions({ chartType: chartType.value as EngineChartType })))
    const mode = this.select('Candles', [['raw', 'Original prices'], ['heikin-ashi', 'Heikin Ashi']], options.chart?.mode ?? 'raw')
    this.listen(mode, 'change', () => this.run(() => this.chart.view.setMode(mode.value as 'raw' | 'heikin-ashi')))
    const scale = this.select('Price scale', [['linear', 'Linear'], ['log', 'Logarithmic'], ['percentage', 'Percentage']], this.scale.mode ?? 'linear')
    this.listen(scale, 'change', () => {
      const next = { ...this.chart.getLayoutOptions().priceScale, mode: scale.value as PriceScaleOptions['mode'] }
      if (this.run(() => this.chart.setLayout({ priceScale: next }))) this.scale = next
      else scale.value = this.scale.mode ?? 'linear'
    })
    const reverse = this.button('Reverse scale', () => {
      const current = this.chart.getLayoutOptions().priceScale
      const next = { ...current, reversed: current?.reversed !== true }
      if (this.run(() => this.chart.setLayout({ priceScale: next }))) { this.scale = next; reverse.setAttribute('aria-pressed', String(next.reversed)) }
    })
    reverse.setAttribute('aria-pressed', String(this.scale.reversed === true))
    this.syncPresentation = () => {
      this.scale = { ...this.chart.getLayoutOptions().priceScale }
      chartType.value = this.chart.getRenderOptions().chartType ?? 'candles'
      mode.value = this.chart.view.getSnapshot().mode
      scale.value = this.scale.mode ?? 'linear'
      reverse.setAttribute('aria-pressed', String(this.scale.reversed === true))
    }
    toolbar.append(this.symbolButton, this.field('Interval', this.periodSelect), this.field('Type', chartType), this.field('Prices', mode), this.field('Scale', scale), reverse)

    this.indicatorSelect = this.select('Add indicator', INDICATORS.map(name => [name, name]), 'MA')
    const indicatorList = this.node('span')
    const refreshIndicators = (): void => {
      const expanded = new Set([...indicatorList.querySelectorAll<HTMLDetailsElement>('details[open]')].map(item => item.dataset.indicator))
      const selected = this.indicatorSelect.value
      this.indicatorSelect.replaceChildren(...this.chart.getRegisteredIndicatorNames().map(name => {
        const option = this.node('option'); option.value = name; option.textContent = name; return option
      }))
      if (this.chart.getRegisteredIndicatorNames().includes(selected)) this.indicatorSelect.value = selected
      indicatorList.replaceChildren(...this.chart.listIndicators().map(indicator => {
        const settings = this.node('details'), title = this.node('summary')
        settings.dataset.indicator = indicator.id; settings.open = expanded.has(indicator.id)
        title.textContent = `${indicator.name} ${indicator.params.join(',')}${indicator.visible ? '' : ' (hidden)'}`
        const params = this.node('input'); params.type = 'text'; params.value = indicator.params.join(',')
        params.setAttribute('aria-label', `${indicator.name} parameters`)
        const pane = this.select(`${indicator.name} pane`, [['price', 'Price pane'], ['separate', 'Separate pane']], indicator.pane)
        const group = this.node('input'); group.type = 'text'; group.value = indicator.paneId ?? ''; group.maxLength = 128
        group.setAttribute('aria-label', `${indicator.name} pane group`); group.placeholder = 'Independent pane'
        const apply = this.button('Apply indicator', () => this.run(() => {
          const raw = params.value.trim(), values = raw === '' ? [] : raw.split(',').map(value => {
            if (value.trim() === '') throw new TypeError('Indicator parameters must be numbers separated by commas')
            return Number(value)
          })
          this.chart.updateIndicator(indicator.id, { params: values, pane: pane.value as 'price' | 'separate', paneId: group.value.trim() || undefined })
        }))
        const toggle = this.button(indicator.visible ? 'Hide indicator' : 'Show indicator', () => this.run(() => {
          const current = this.chart.listIndicators().find(item => item.id === indicator.id)
          if (current !== undefined) this.chart.updateIndicator(indicator.id, { visible: !current.visible })
        }))
        const remove = this.button(`${indicator.name} ${indicator.params.join(',')}${indicator.visible === false ? ' (hidden)' : ''} ×`, () => {
          this.run(() => { this.chart.removeIndicator(indicator.id) })
        })
        remove.setAttribute('aria-label', `Remove ${indicator.name} ${indicator.params.join(',')}`)
        settings.append(title, this.field('Parameters', params), this.field('Pane', pane), this.field('Group', group), apply, toggle)
        const entry = this.node('span'); entry.style.cssText = 'display:inline-flex;align-items:start;gap:4px;'
        entry.append(settings, remove); return entry
      }))
    }
    toolbar.append(this.field('Indicator', this.indicatorSelect), this.button('Add', () => {
      this.run(() => { this.chart.addIndicator({ name: this.indicatorSelect.value }) })
    }), indicatorList)
    this.drawingSelect = this.select('Drawing tool', [['', 'Pan / select'], ...DRAWING_TYPES.map(type => [type, label(type)] as [string, string])], '')
    this.listen(this.drawingSelect, 'change', () => this.run(() => {
      this.chart.setDrawingTool(this.drawingSelect.value === '' ? null : this.drawingSelect.value as DrawingType)
      this.chartHost.querySelector<HTMLElement>('[tabindex="0"]')?.focus({ preventScroll: true })
    }))
    this.drawingButtons = {
      undo: this.button('Undo', () => this.run(() => { this.chart.drawings.undo() })),
      redo: this.button('Redo', () => this.run(() => { this.chart.drawings.redo() })),
      lock: this.button('Lock', () => this.run(() => {
        const state = this.chart.drawings.getSnapshot(), selected = state.drawings.find(item => item.id === state.selectedId)
        if (selected !== undefined) this.chart.drawings.update(selected.id, { locked: !selected.locked })
      })),
      remove: this.button('Delete drawing', () => this.run(() => {
        const id = this.chart.drawings.getSnapshot().selectedId
        if (id !== null) this.chart.drawings.remove(id)
      }))
    }
    drawingBar.append(this.field('Draw', this.drawingSelect), ...Object.values(this.drawingButtons), this.button('Follow latest', () => this.run(() => this.chart.view.followLatest())), this.button('Download PNG', () => { void this.download() }))
    if (typeof this.root.requestFullscreen === 'function' && typeof this.doc.exitFullscreen === 'function') {
      const fullscreen = this.button('Fullscreen', () => {
        void (this.doc.fullscreenElement === this.root ? this.doc.exitFullscreen() : this.root.requestFullscreen()).catch(error => this.showNotice(error))
      })
      this.listen(this.doc, 'fullscreenchange', () => { fullscreen.textContent = this.doc.fullscreenElement === this.root ? 'Exit fullscreen' : 'Fullscreen' })
      drawingBar.append(fullscreen)
    }

    this.searchPanel = this.node('div'); this.searchPanel.hidden = true
    this.searchPanel.setAttribute('role', 'dialog'); this.searchPanel.setAttribute('aria-label', 'Find a symbol')
    this.searchPanel.style.cssText = 'position:absolute;z-index:4;top:44px;left:8px;right:8px;max-width:480px;padding:12px;border:1px solid #40516b;background:#17202c;box-sizing:border-box;'
    this.searchInput = this.node('input'); this.searchInput.type = 'search'; this.searchInput.placeholder = 'Symbol or name'; this.searchInput.setAttribute('aria-label', 'Symbol or name')
    this.searchInput.autocomplete = 'off'; this.searchInput.style.cssText = 'width:75%;padding:6px;'
    this.searchStatus = this.node('div'); this.searchStatus.setAttribute('role', 'status')
    this.searchResults = this.node('ul'); this.searchResults.style.cssText = 'list-style:none;margin:8px 0 0;padding:0;max-height:260px;overflow:auto;'
    this.searchPanel.append(this.searchInput, this.button('Close', () => this.closeSearch()), this.searchStatus, this.searchResults)
    this.listen(this.searchInput, 'input', () => this.queueSearch(200))
    this.listen(this.searchPanel, 'keydown', event => this.searchKey(event as KeyboardEvent))
    this.listen(this.root, 'keydown', event => {
      const key = event as KeyboardEvent
      if (key.isComposing || key.ctrlKey || key.metaKey || key.altKey || !/^[a-z0-9]$/i.test(key.key) || !(key.target instanceof this.win.HTMLElement) || !this.chartHost.contains(key.target) || key.target.closest('input,textarea,select,[contenteditable="true"]') !== null) return
      key.preventDefault(); this.openSearch(key.key)
    })
    this.listen(this.doc, 'pointerdown', event => {
      if (!this.searchPanel.hidden && event.target instanceof this.win.Node && !this.searchPanel.contains(event.target) && !this.symbolButton.contains(event.target)) this.closeSearch(false)
    })

    const stage = this.node('div'); stage.style.cssText = 'flex:1;min-height:160px;position:relative;'
    this.chartHost = this.node('div'); this.chartHost.style.cssText = 'position:absolute;inset:0;'
    this.notice = this.node('div'); this.notice.setAttribute('role', 'alert'); this.notice.style.cssText = 'padding:0 8px;color:#f4b8ae;'
    this.statusNode = this.node('div'); this.statusNode.setAttribute('role', 'status'); this.statusNode.style.cssText = 'padding:4px 8px;'
    stage.append(this.chartHost)
    this.retryButton = this.button('Retry', () => this.reload())
    this.olderButton = this.button('Load older', () => this.run(() => this.chart.view.requestMore()))
    this.replayInfo = this.node('span')
    this.replayButtons = {
      start: this.button('Replay', () => this.run(() => { if (!this.startReplay()) throw new Error('At least three loaded bars are needed for replay') })),
      back: this.button('Previous bar', () => this.run(() => { this.stepReplay(-1) })),
      next: this.button('Next bar', () => this.run(() => { this.stepReplay(1) })),
      play: this.button('Play replay', () => this.run(() => { if (this.getReplayState().playing) this.pauseReplay(); else this.playReplay() })),
      exit: this.button('Exit replay', () => this.run(() => { this.exitReplay() }))
    }
    this.replaySpeed = this.select('Replay speed', [0.25, 0.5, 1, 2, 4, 8, 16].map(speed => [String(speed), `${speed}×`]), '1')
    this.listen(this.replaySpeed, 'change', () => this.run(() => this.setReplaySpeed(Number(this.replaySpeed.value))))
    const countdownNode = this.node('span'); countdownNode.title = 'Period boundary estimate; exchange holidays and early closes need a host-provided close time.'
    footer.append(...Object.values(this.replayButtons), this.field('Speed', this.replaySpeed), this.replayInfo, countdownNode, this.olderButton, this.retryButton)
    this.root.append(toolbar, drawingBar, this.notice, stage, this.statusNode, footer, this.searchPanel)
    host.append(this.root)
    try {
      this.chart = new EngineChart(this.chartHost, {
        ...options.chart,
        render: { ...options.chart?.render, timespan: this.period.timespan, symbolTimezone: this.symbol.timezone },
        onToolComplete: () => {
          this.drawingSelect.value = ''; options.chart?.onToolComplete?.()
        }
      })
    } catch (error) { this.abort.abort(); this.root.remove(); throw error }
    this.loader = this.createLoader()
    this.timedReplay = this.createReplay()
    this.countdown = createBarCountdown({
      getContext: () => {
        if (options.countdown?.enabled === false || this.getStatus().state !== 'ready' || !this.shownMatches()) return null
        const lastBar = this.chart.getLastBar()
        let closeTimestamp: number | null | undefined
        if (lastBar !== null && options.countdown?.closeTimestamp !== undefined) {
          try { closeTimestamp = options.countdown.closeTimestamp(this.market(), lastBar) } catch { return null }
        }
        return { marketKey: this.requestedPair(), lastBar, period: this.period, symbolTimezone: this.symbol.timezone, replaying: this.loader.replaying, closeTimestamp }
      },
      onChange: snapshot => { countdownNode.textContent = snapshot === null ? '' : `Estimated interval close · ${snapshot.text}` },
      hidden: () => this.doc.hidden,
      timer: { setTimeout: (callback, ms) => this.win.setTimeout(callback, ms), clearTimeout: handle => this.win.clearTimeout(handle as number) }
    })
    this.listen(this.doc, 'visibilitychange', () => { if (this.doc.hidden) this.timedReplay.pause(); this.countdown.refresh() })
    this.unsubscribe.push(this.chart.onIndicatorsChanged(refreshIndicators))
    this.unsubscribe.push(this.chart.drawings.subscribe(() => this.updateDrawingControls()))
    this.loader.attach(this.dataPort())
    refreshIndicators(); this.updateDrawingControls(); this.ready = this.request()
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
    this.assertLive()
    const nextSymbol = validSymbol(symbol), nextPeriod = this.resolvePeriod(period)
    const previous = this.market(), changed = pairKey(nextSymbol, nextPeriod) !== this.requestedPair()
    if (symbolKey(nextSymbol) !== symbolKey(this.symbol)) {
      this.scale = { ...this.chart.getLayoutOptions().priceScale, range: undefined }
      this.chart.setLayout({ priceScale: this.scale })
    }
    if (nextPeriod.timespan !== this.period.timespan || nextSymbol.timezone !== this.symbol.timezone || (!changed && nextSymbol.pricePrecision !== this.symbol.pricePrecision)) {
      this.chart.setRenderOptions({
        timespan: nextPeriod.timespan,
        symbolTimezone: nextSymbol.timezone,
        ...(!changed && nextSymbol.pricePrecision !== this.symbol.pricePrecision ? { pricePrecision: resolvePricePrecision(nextSymbol.pricePrecision, this.chart.dataPort.getDataList()) } : {})
      })
    }
    if (!this.periods.some(item => periodKey(item) === periodKey(nextPeriod))) {
      this.periods.push(nextPeriod)
      const option = this.node('option'); option.value = periodKey(nextPeriod); option.textContent = nextPeriod.text; this.periodSelect.append(option)
    }
    this.symbol = nextSymbol; this.period = nextPeriod
    this.symbolButton.textContent = nextSymbol.ticker; this.periodSelect.value = periodKey(nextPeriod)
    const result = changed ? this.request() : this.loads.current(this.market()) ?? Promise.resolve(this.currentResult())
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
    this.timedReplay.dispose(); this.loaderUnsubscribe.splice(0).forEach(fn => fn()); this.loader.dispose()
    this.loader = this.createLoader(); this.timedReplay = this.createReplay(); this.loader.attach(this.dataPort())
    this.chart.setDrawingTool(null); this.chart.setData([], false)
    this.updateStatus(); this.events.emit('loadResult', result)
    return true
  }

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
    const started = this.timedReplay.start({ index: at }); this.updateReplay(); return started
  }

  stepReplay (delta = 1): WorkspaceReplayState {
    this.assertLive()
    if (!Number.isSafeInteger(delta)) throw new RangeError('Replay step must be a safe integer')
    if (!this.loader.replaying) throw new Error('Start replay before stepping')
    this.timedReplay.step(delta); this.updateReplay(); return this.getReplayState()
  }

  startReplayAt (timestamp: number): boolean { this.assertLive(); return this.timedReplay.startByTimestamp(timestamp) }
  playReplay (speed?: number): boolean { this.assertLive(); if (this.doc.hidden) return false; return this.timedReplay.play(speed) }
  pauseReplay (): void { this.assertLive(); this.timedReplay.pause() }
  setReplaySpeed (speed: number): void { this.assertLive(); this.timedReplay.setSpeed(speed) }
  exitReplay (): WorkspaceReplayState { this.assertLive(); this.timedReplay.exit(); this.updateReplay(); return this.getReplayState() }

  /** Market, indicators, drawings and presentation only; no feed, code or credentials. */
  exportDocument (): string {
    this.assertLive()
    const state = this.getLoadState()
    if (state.loaded === null || !['ready', 'empty'].includes(state.status)) throw new Error('Load a market before saving its workspace')
    const { formatPrice, showTimeAxis, timespan, symbolTimezone, ...render } = this.chart.getRenderOptions()
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
        render: { ...document.render, formatPrice: this.chart.getRenderOptions().formatPrice, timespan: period.timespan, symbolTimezone: document.symbol.timezone },
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

  dispose (): void {
    if (this.disposed) return
    this.disposed = true; this.cancelSearch(); this.abort.abort()
    this.restoreGeneration++; this.pendingRestore = null
    this.timedReplay.dispose(); this.countdown.dispose()
    this.loads.dispose(); this.events.clear()
    this.unsubscribe.forEach(fn => fn()); this.loaderUnsubscribe.splice(0).forEach(fn => fn()); this.loader.dispose()
    for (const [timer, url] of this.downloads) { this.win.clearTimeout(timer); this.win.URL.revokeObjectURL(url) }
    this.downloads.clear(); this.drawingDocuments.clear()
    try { this.chart.dispose() } finally { this.root.remove() }
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
      onChange: () => this.updateReplay(),
      timer: { setTimeout: (callback, ms) => this.win.setTimeout(callback, ms), clearTimeout: handle => this.win.clearTimeout(handle as number) }
    })
  }

  private createLoader (): DataLoader {
    const loader = new DataLoader({
      ...this.loaderOptions,
      datafeed: this.datafeed,
      env: {
        now: () => Date.now(),
        setTimeout: (fn, ms) => this.win.setTimeout(fn, ms),
        clearTimeout: handle => this.win.clearTimeout(handle as number),
        requestFrame: fn => this.win.requestAnimationFrame(fn),
        cancelFrame: handle => this.win.cancelAnimationFrame(handle as number),
        queueMicrotask: fn => this.win.queueMicrotask(fn),
        hidden: () => this.doc.hidden,
        visibility: this.doc,
        connectivity: this.win,
        warn: (...args) => this.win.console.warn(...args)
      }
    })
    this.loaderUnsubscribe.push(loader.on('status', status => {
      // Old promises may settle before the next request's coalescing microtask.
      if (this.waitingStart && status.state !== 'loading') return
      if (status.state === 'loading') { this.waitingStart = false; this.pending = true }
      if (status.state === 'error') this.pending = false
      this.restoreDrawings(); this.updateStatus()
    }), loader.on('bars', event => {
      if (pairKey(event.symbol, event.period) === this.requestedPair()) this.run(() => this.chart.setRenderOptions({ pricePrecision: resolvePricePrecision(this.symbol.pricePrecision, event.bars) }))
    }), loader.on('replay', () => this.updateReplay()))
    return loader
  }

  private shownMatches (): boolean {
    const shown = this.loader.shown
    return shown !== null && pairKey(shown.symbol, shown.period) === this.requestedPair()
  }

  private prepareRequest (): void {
    if (this.drawingSymbol !== null) this.drawingDocuments.set(this.drawingSymbol, this.chart.drawings.exportJson())
    this.drawingSymbol = null; this.displayedPair = null; this.pending = true; this.waitingStart = true; this.applyError = null; this.cancelled = false
    this.olderPending = false
    this.chart.setDrawingTool(null); this.drawingSelect.value = ''
    this.chart.drawings.importJson(EMPTY_DRAWINGS); this.chart.setData([], false)
    this.notice.textContent = ''; this.updateStatus()
  }

  private request (): Promise<WorkspaceLoadResult> {
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
    const port = this.chart.dataPort
    const apply = (change: () => void, kind: 'reset' | 'prepend' | 'tail', initial = false): void => {
      if (this.disposed || this.waitingStart || (!(initial && this.loader.status.state === 'loading') && !this.shownMatches())) return
      try {
        change(); this.displayedPair = this.requestedPair()
        if (this.loader.status.state !== 'loading') this.pending = false
        this.restoreDrawings(); this.updateStatus(); this.settleLoad()
        this.events.emit('dataChange', { market: this.market(), kind, count: this.chart.view.getSnapshot().length })
      } catch (error) {
        this.applyError = error; this.pending = false
        this.chart.setDrawingTool(null); this.chart.setData([], false); this.updateStatus(); this.settleLoad()
      }
    }
    return {
      applyNewData: (bars, more) => apply(() => {
        const restoring = this.pendingRestore
        if (restoring !== null && !restoring.applied && restoring.generation === this.restoreGeneration && restoring.key === this.requestedPair()) {
          this.chart.restoreConfiguration(restoring.configuration, { bars, more }); restoring.applied = true
          this.drawingSymbol = symbolKey(this.symbol)
        } else port.applyNewData(bars, more)
      }, 'reset', true),
      applyMoreData: (bars, more) => apply(() => { this.olderPending = false; port.applyMoreData(bars, more) }, 'prepend'),
      updateData: bar => apply(() => port.updateData(bar), 'tail'),
      updateDataBatch: (bars, more) => apply(() => port.updateDataBatch?.(bars, more), 'tail'),
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
    if (this.drawingSymbol === key) return
    this.chart.drawings.importJson(this.drawingDocuments.get(key) ?? EMPTY_DRAWINGS); this.drawingSymbol = key
  }

  private updateStatus (): void {
    if (this.disposed) return
    const status = this.getStatus(), pair = `${this.symbol.ticker} · ${this.period.text}`
    this.statusNode.textContent = this.cancelled ? `Loading cancelled · ${pair}` : status.state === 'loading' ? `Loading ${pair}…`
      : status.state === 'error' ? `Could not load ${pair}: ${this.errorMessage(status.error?.error)}`
        : status.state === 'empty' ? `No data for ${pair}` : status.loadingMore ? `${pair} · Loading older bars…` : pair
    this.chartHost.style.visibility = status.state === 'ready' && this.displayedPair === this.requestedPair() ? 'visible' : 'hidden'
    this.chartHost.inert = status.state !== 'ready'
    this.drawingSelect.disabled = status.state !== 'ready'; this.retryButton.hidden = status.state !== 'error' && !this.cancelled
    this.olderButton.disabled = status.state !== 'ready' || status.loadingMore || this.olderPending || !this.chart.view.getSnapshot().hasMore
    this.updateReplay()
    const state = this.getLoadState(), signature = JSON.stringify(state)
    if (signature !== this.reportedLoadState) { this.reportedLoadState = signature; this.events.emit('loadState', state) }
  }

  private updateReplay (): void {
    if (this.disposed) return
    const info = this.loader.replayInfo
    this.replayButtons.start.disabled = this.getStatus().state !== 'ready' || info !== null
    this.replayButtons.back.disabled = info === null || info.index === 0
    this.replayButtons.next.disabled = info === null
    this.replayButtons.exit.disabled = info === null
    const playback = this.timedReplay?.getState()
    this.replayButtons.play.disabled = info === null || this.loader.replayAtEnd
    this.replayButtons.play.textContent = playback?.playing === true ? 'Pause replay' : 'Play replay'
    const speed = String(playback?.speed ?? 1)
    if (![...this.replaySpeed.options].some(option => option.value === speed)) {
      this.replaySpeed.querySelector('option[data-custom]')?.remove()
      const option = this.node('option'); option.value = speed; option.textContent = `${speed}×`; option.dataset.custom = 'true'; this.replaySpeed.append(option)
    }
    this.replaySpeed.value = speed
    this.countdown?.refresh()
    this.replayInfo.textContent = info === null ? '' : `Replay · ${Number.isFinite(info.timestamp) ? new Date(info.timestamp).toISOString() : ''}`
    const state = this.getReplayState(), signature = JSON.stringify(state)
    if (signature !== this.reportedReplayState) { this.reportedReplayState = signature; this.events.emit('replayChange', state) }
  }

  private updateDrawingControls (): void {
    const state = this.chart.drawings.getSnapshot(), selected = state.drawings.find(item => item.id === state.selectedId)
    this.drawingButtons.undo.disabled = !state.canUndo; this.drawingButtons.redo.disabled = !state.canRedo
    this.drawingButtons.lock.disabled = selected === undefined; this.drawingButtons.lock.textContent = selected?.locked === true ? 'Unlock' : 'Lock'
    this.drawingButtons.remove.disabled = selected === undefined || selected.locked
  }

  private openSearch (initialQuery?: string): void {
    if (this.disposed) return
    if (initialQuery !== undefined) this.searchInput.value = initialQuery
    this.searchPanel.hidden = false; this.symbolButton.setAttribute('aria-expanded', 'true'); this.searchInput.focus(); this.queueSearch(0)
  }

  private closeSearch (focus = true): void {
    this.cancelSearch(); this.searchPanel.hidden = true; this.symbolButton.setAttribute('aria-expanded', 'false')
    if (focus && !this.disposed) this.symbolButton.focus()
  }

  private cancelSearch (): void {
    this.searchGeneration++; this.searchAbort?.abort(); this.searchAbort = null
    if (this.searchTimer !== null) this.win.clearTimeout(this.searchTimer)
    this.searchTimer = null
    this.searchLoading = false
  }

  private queueSearch (delay: number): void {
    this.cancelSearch(); this.searchResults.replaceChildren(); this.searchStatus.textContent = 'Searching…'
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
      this.searchStatus.textContent = results.length === 0 ? 'No matching symbols' : symbols.length > 50 ? 'Showing the first 50 matches' : `${results.length} matches`
      this.searchResults.replaceChildren(...results.map((symbol, index) => {
        const item = this.node('li'), button = this.button(`${symbol.ticker}${symbol.name ? ` · ${symbol.name}` : ''}${symbol.exchange ? ` · ${symbol.exchange}` : ''}`, () => {
          this.chooseSearchResult(index)
        })
        button.style.cssText += ';width:100%;text-align:left;margin-bottom:4px;'; item.append(button); return item
      }))
    } catch (error) {
      if (this.disposed || controller.signal.aborted || generation !== this.searchGeneration) return
      this.searchStatus.replaceChildren(this.doc.createTextNode(`Search failed: ${this.errorMessage(error)} `), this.button('Retry search', () => this.queueSearch(0)))
      this.searchLoading = false
    } finally { if (this.searchAbort === controller) this.searchAbort = null }
  }

  private chooseSearchResult (index: number): void {
    const decision = decideEnter({ isComposing: false, shownQuery: this.searchShownQuery, currentQuery: this.searchInput.value.trim(), loading: this.searchLoading, activeIndex: index, resultCount: this.searchSymbols.length })
    if (decision.action !== 'select') return
    const symbol = this.searchSymbols[decision.index]
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
    try {
      if (this.getStatus().state !== 'ready') throw new Error('Load chart data before downloading an image')
      const filename = `${this.symbol.ticker.replace(/[^a-z0-9._-]/gi, '_')}-${this.period.text.replace(/[^a-z0-9._-]/gi, '_')}.png`
      const blob = await this.chart.snapshot()
      if (this.disposed) return
      const url = this.win.URL.createObjectURL(blob), link = this.node('a')
      link.href = url; link.download = filename
      this.root.append(link); link.click(); link.remove()
      const timer = this.win.setTimeout(() => { this.win.URL.revokeObjectURL(url); this.downloads.delete(timer) }, 1000)
      this.downloads.set(timer, url)
    } catch (error) { this.showNotice(error) }
  }

  private node<K extends keyof HTMLElementTagNameMap> (tag: K): HTMLElementTagNameMap[K] { return this.doc.createElement(tag) }
  private listen (target: EventTarget, type: string, listener: EventListener): void { target.addEventListener(type, listener, { signal: this.abort.signal }) }
  private button (text: string, action: () => unknown): HTMLButtonElement {
    const button = this.node('button'); button.type = 'button'; button.textContent = text
    button.style.cssText = 'padding:5px 8px;border:1px solid #40516b;border-radius:4px;background:#17202c;color:inherit;font:inherit;cursor:pointer;'
    this.actions.set(button, action); return button
  }

  private select (name: string, values: ReadonlyArray<readonly [string, string]>, selected: string): HTMLSelectElement {
    const select = this.node('select'); select.setAttribute('aria-label', name)
    select.style.cssText = 'padding:4px;border:1px solid #40516b;background:#17202c;color:inherit;font:inherit;max-width:160px;'
    for (const [value, text] of values) { const option = this.node('option'); option.value = value; option.textContent = text; select.append(option) }
    select.value = selected; return select
  }

  private row (name: string): HTMLDivElement {
    const row = this.node('div'); row.setAttribute('role', 'toolbar'); row.setAttribute('aria-label', name)
    row.style.cssText = 'display:flex;align-items:center;flex-wrap:wrap;gap:6px;padding:6px 8px;border-bottom:1px solid #283444;'; return row
  }

  private field (name: string, control: HTMLElement): HTMLLabelElement {
    const field = this.node('label'); field.style.cssText = 'display:inline-flex;align-items:center;gap:4px;'; field.append(this.doc.createTextNode(`${name} `), control); return field
  }

  private run (action: () => void): boolean {
    if (this.disposed) return false
    try { action(); this.notice.textContent = ''; return true } catch (error) { this.showNotice(error); return false }
  }

  private errorMessage (error: unknown): string { return error instanceof Error ? error.message : String(error ?? 'Unknown error') }
  private showNotice (error: unknown): void { if (!this.disposed) this.notice.textContent = this.errorMessage(error) }
  private assertLive (): void { if (this.disposed) throw new Error('Chart workspace is disposed') }
}
