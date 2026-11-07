import { RealtimeSeries, RealtimeView, normalizeBars, normalizeBar, ENGINE_CHART_TYPES, buildEngineFrame, validateEngineLayout, validatePriceScale, EngineIndicators, DrawingStore, projectDrawing, type CandleMode, type MarketBar, type ChartDataPort, type EngineRenderOptions, type EngineFrame, type EngineLayout, type EngineInspection, type EngineIndicatorSpec, type IndicatorDefinition, type Drawing, type DrawingType } from '@supersolutions/super-chart-core'
import { paintEngineFrame, paintEngineCursor } from './canvasRenderer'
import { attachEngineGestures } from './gestures'
import { attachDrawingInteraction } from './drawingInteraction'
import { paintDrawings } from './drawingRenderer'
import type { EngineLayer } from './layer'
import { attachPaneInteraction } from './paneInteraction'
import { DrawingImageRenderer } from './drawingMedia'

export interface EngineChartOptions {
  count?: number
  mode?: CandleMode
  layout?: EngineLayout
  render?: EngineRenderOptions
  indicators?: readonly EngineIndicatorSpec[]
  inertia?: boolean
  onInspect?: (inspection: EngineInspection | null) => void
  onToolComplete?: () => void
}

export interface EngineConfiguration {
  render: EngineRenderOptions
  layout: EngineLayout
  indicators: readonly EngineIndicatorSpec[]
  drawingsJson: string
  mode: CandleMode
}

function copyLayout (layout: EngineLayout): EngineLayout {
  return {
    ...layout,
    ...(layout.priceScale === undefined ? {} : {
      priceScale: {
        ...layout.priceScale,
        ...(layout.priceScale.range === undefined ? {} : { range: [...layout.priceScale.range] as [number, number] })
      }
    }),
    ...(layout.paneWeights === undefined ? {} : { paneWeights: { ...layout.paneWeights } })
  }
}

/** Owned Canvas renderer. The migration guide lists intentionally retired Pro APIs. */
export class EngineChart {
  private readonly series = new RealtimeSeries({ referenceIndicators: false })
  /** Loader boundary. Data reads return copies and are not used by the render hot path. */
  readonly dataPort: ChartDataPort = Object.freeze({
    applyNewData: (bars: MarketBar[], more?: boolean) => { this.setData(bars, more) },
    applyMoreData: (bars: MarketBar[], more?: boolean) => { this.prependData(bars, more) },
    updateData: (bar: MarketBar) => { this.update(bar) },
    updateDataBatch: (bars: MarketBar[], more?: boolean) => { this.updateBatch(bars, more) },
    getDataList: () => this.getBars(),
    getLastTimestamp: () => { this.assertLive(); return this.series.getLastTimestamp() },
    loadMore: (callback: (timestamp: number | null) => void) => { this.assertLive(); this.series.loadMore(callback) }
  })

  readonly view: RealtimeView
  readonly drawings = new DrawingStore()
  private readonly indicators = new EngineIndicators()
  private readonly doc: Document
  private readonly win: Window & typeof globalThis
  private readonly root: HTMLDivElement
  private readonly canvas: HTMLCanvasElement
  private readonly cursorCanvas: HTMLCanvasElement
  private readonly drawingCanvas: HTMLCanvasElement
  private readonly drawingContext: CanvasRenderingContext2D
  private readonly drawingImages: DrawingImageRenderer
  private readonly context: CanvasRenderingContext2D
  private readonly cursorContext: CanvasRenderingContext2D
  private readonly resizeObserver: ResizeObserver
  private readonly abort: AbortController
  private readonly unsubscribers: Array<() => void> = []
  private readonly stopGestures: ReturnType<typeof attachEngineGestures>
  private readonly drawingInput: ReturnType<typeof attachDrawingInteraction>
  private readonly onInspect?: EngineChartOptions['onInspect']
  private readonly inputs = new Map<number, (time: number) => void>()
  private readonly layers = new Set<EngineLayer>()
  private readonly indicatorListeners = new Set<() => void>()
  private indicatorNoticeQueued = false
  private inputId = 0
  private draining = false
  private preview: Drawing | null = null
  private frame: EngineFrame | null = null
  private frameId = 0
  private cursorX: number | null = null
  private width = 0
  private height = 0
  private ratio = 0
  private geometryDirty = true
  private paintDirty = true
  private drawingDirty = true
  private cursorDirty = true
  private disposed = false
  private readonly invalidateDrawings = (): void => { if (!this.disposed) { this.drawingDirty = true; this.schedule() } }
  private layout: EngineLayout
  private renderOptions: EngineRenderOptions
  private dprQuery: MediaQueryList | null = null
  private readonly counters = { frames: 0, geometryBuilds: 0, plotPaints: 0, drawingPaints: 0, cursorPaints: 0, lastFrameMs: 0, firstDataFrameMs: 0, maxFrameMs: 0 }

  constructor (host: HTMLElement, options: EngineChartOptions = {}) {
    this.doc = host.ownerDocument
    if (this.doc.defaultView === null) throw new Error('Chart host needs an active document')
    this.win = this.doc.defaultView as Window & typeof globalThis
    this.drawingImages = new DrawingImageRenderer(async blob => await this.win.createImageBitmap(blob))
    this.abort = new this.win.AbortController()
    this.layout = copyLayout(options.layout ?? {})
    validateEngineLayout(this.layout)
    validatePriceScale(this.layout.priceScale ?? {})
    this.renderOptions = { ...options.render }
    this.validateRender(this.renderOptions)
    for (const spec of options.indicators ?? [{ name: 'MA', params: [20] }, { name: 'EMA', params: [21] }]) this.indicators.add(spec)
    this.view = new RealtimeView(this.series, { count: options.count, mode: options.mode, continuous: true })
    this.onInspect = options.onInspect
    this.root = this.doc.createElement('div')
    this.root.style.cssText = 'position:relative;width:100%;height:100%;min-height:0;overflow:hidden;touch-action:none;'
    this.root.tabIndex = 0
    this.root.setAttribute('role', 'group')
    this.root.setAttribute('aria-label', 'Chart. Drag to pan, pinch or wheel to zoom; Home follows the latest candle.')
    this.canvas = this.doc.createElement('canvas')
    this.drawingCanvas = this.doc.createElement('canvas')
    this.cursorCanvas = this.doc.createElement('canvas')
    for (const canvas of [this.canvas, this.drawingCanvas, this.cursorCanvas]) {
      canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;'
      canvas.setAttribute('aria-hidden', 'true')
      this.root.append(canvas)
    }
    const context = this.canvas.getContext('2d'), drawingContext = this.drawingCanvas.getContext('2d'), cursorContext = this.cursorCanvas.getContext('2d')
    if (context === null || drawingContext === null || cursorContext === null) { this.view.dispose(); throw new Error('Canvas 2D is unavailable') }
    this.context = context; this.drawingContext = drawingContext; this.cursorContext = cursorContext
    host.append(this.root)
    this.unsubscribers.push(this.series.subscribe(change => {
      this.indicators.invalidate(change)
      if (change.kind !== 'availability') {
        if (this.indicators.hasCustom() || this.layers.size > 0) this.geometryDirty = true
        if (this.drawings.getSnapshot().drawings.length > 0) this.drawingDirty = true
        if (this.geometryDirty || this.drawingDirty) this.schedule()
      }
    }))
    this.unsubscribers.push(this.view.subscribe(() => {
      const snapshot = this.view.getSnapshot(), previous = this.frame?.snapshot
      // Offscreen appends can change total length without changing visible pixels.
      if (previous === undefined || snapshot.bars !== previous.bars || snapshot.ma20 !== previous.ma20 || snapshot.ema21 !== previous.ema21) {
        this.geometryDirty = true
      }
      this.cursorDirty = true
      this.schedule()
    }))
    this.unsubscribers.push(this.drawings.subscribe(() => { this.retainDrawingImages(); this.drawingDirty = true; this.schedule() }))
    this.unsubscribers.push(attachPaneInteraction(this.root, () => this.frame, () => this.layout, options => this.setLayout(options), () => this.stopGestures.cancelInput()))
    this.drawingInput = attachDrawingInteraction(this.root, this.drawings, () => this.frame, preview => {
      this.preview = preview; this.drawingDirty = true; this.schedule()
    }, options.onToolComplete, () => this.stopGestures.cancelInput(), this.drawingImages)
    this.stopGestures = attachEngineGestures(this.root, this.view, () => this.frame?.model.geometry ?? null, x => {
      this.cursorX = x; this.cursorDirty = true; this.schedule()
    }, {
      inertia: options.inertia,
      frameScheduler: {
        request: callback => { const id = ++this.inputId; this.inputs.set(id, callback); this.schedule(); return id },
        cancel: id => { this.inputs.delete(id) }
      }
    })
    this.resizeObserver = new this.win.ResizeObserver(() => this.schedule())
    this.resizeObserver.observe(this.root)
    this.doc.addEventListener('visibilitychange', () => {
      if (this.doc.hidden && this.frameId !== 0) { this.win.cancelAnimationFrame(this.frameId); this.frameId = 0 }
      else this.schedule()
    }, { signal: this.abort.signal })
    this.watchPixelRatio()
    this.schedule()
  }

  /** Millisecond OHLC input is normalized once at the data boundary. */
  setData (bars: unknown, more = false): void {
    this.assertLive()
    const normalized = normalizeBars(bars, 1).bars
    this.validateBars(normalized, this.layout, normalized[0]?.close); this.series.applyNewData(normalized, more)
  }

  update (bar: unknown): void {
    this.assertLive()
    const normalized = normalizeBar(bar, 1)
    if (normalized === null) throw new TypeError('Invalid OHLC candle')
    this.validateBars([normalized], this.layout, this.updateReference([normalized])); this.series.updateData(normalized)
  }

  prependData (bars: unknown, more = false): void {
    this.assertLive()
    const normalized = normalizeBars(bars, 1).bars, first = this.series.getDataList()[0]
    const base = first === undefined || (normalized[0] !== undefined && normalized[0].timestamp < first.timestamp) ? normalized[0]?.close : first.close
    this.validateBars(normalized, this.layout, base); this.series.applyMoreData(normalized, more)
  }

  updateBatch (bars: unknown, more?: boolean): void {
    this.assertLive()
    const normalized = normalizeBars(bars, 1).bars
    this.validateBars(normalized, this.layout, this.updateReference(normalized)); this.series.updateDataBatch(normalized, more)
  }

  registerIndicator (definition: IndicatorDefinition): void { this.assertLive(); this.indicators.register(definition); this.notifyIndicators() }
  unregisterIndicator (name: string, expectedCalculate?: IndicatorDefinition['calculate']): boolean {
    this.assertLive()
    const removed = this.indicators.unregister(name, expectedCalculate)
    if (removed) this.notifyIndicators()
    return removed
  }

  addIndicator (spec: EngineIndicatorSpec): string {
    this.assertLive()
    const id = this.indicators.add(spec)
    this.geometryDirty = true; this.schedule(); this.notifyIndicators(); return id
  }

  removeIndicator (id: string): boolean {
    this.assertLive()
    const removed = this.indicators.remove(id)
    if (removed) { this.geometryDirty = true; this.schedule(); this.notifyIndicators() }
    return removed
  }

  updateIndicator (id: string, changes: Pick<EngineIndicatorSpec, 'params' | 'pane' | 'paneId' | 'visible'>): boolean {
    this.assertLive()
    const updated = this.indicators.update(id, changes)
    if (updated) { this.geometryDirty = true; this.schedule(); this.notifyIndicators() }
    return updated
  }

  listIndicators (): ReturnType<EngineIndicators['list']> { return this.indicators.list() }
  getRegisteredIndicatorNames (): readonly string[] { return this.indicators.registeredNames() }
  validateIndicatorReplacement (specs: readonly EngineIndicatorSpec[]): void { this.indicators.validateReplacement(specs) }
  replaceIndicators (specs: readonly EngineIndicatorSpec[]): void {
    this.assertLive(); this.indicators.replace(specs)
    this.geometryDirty = true; this.schedule(); this.notifyIndicators()
  }

  onIndicatorsChanged (listener: () => void): () => void {
    this.assertLive(); this.indicatorListeners.add(listener)
    return () => { this.indicatorListeners.delete(listener) }
  }

  private notifyIndicators (): void {
    if (this.indicatorNoticeQueued || this.disposed) return
    this.indicatorNoticeQueued = true
    this.win.queueMicrotask(() => {
      this.indicatorNoticeQueued = false
      if (this.disposed) return
      for (const listener of [...this.indicatorListeners]) {
        if (!this.indicatorListeners.has(listener)) continue
        try { listener() } catch (error) { this.win.console.warn('Indicator change listener failed', error) }
      }
    })
  }

  setDrawingTool (tool: DrawingType | null): void { this.assertLive(); this.drawingInput.setTool(tool) }

  /** Own this layer until removal or chart disposal. It receives only revealed replay data. */
  addLayer (layer: EngineLayer): () => void {
    this.assertLive()
    if (this.layers.has(layer)) throw new Error('Layer is already attached')
    this.layers.add(layer); this.geometryDirty = true; this.schedule()
    return () => {
      if (!this.layers.delete(layer)) return
      this.paintDirty = true; this.schedule(); layer.dispose?.()
    }
  }

  setRenderOptions (options: EngineRenderOptions): void {
    this.assertLive()
    const next = { ...this.renderOptions, ...options }
    this.validateRender(next); this.renderOptions = next
    this.paintDirty = true; this.drawingDirty = true; this.cursorDirty = true; this.schedule()
  }

  setLayout (options: EngineLayout): void {
    this.assertLive()
    const next = copyLayout({ ...this.layout, ...options })
    validateEngineLayout(next)
    validatePriceScale(next.priceScale ?? {})
    this.validateBars(this.series.getDataList(), next)
    this.layout = next
    this.geometryDirty = true; this.schedule()
  }

  getMetrics (): Readonly<typeof this.counters> { return { ...this.counters } }
  /** Copy only the requested tail; the feed/render hot path keeps its owned array. */
  getBars (options: { limit?: number } = {}): MarketBar[] {
    this.assertLive()
    if (Object.keys(options).some(key => key !== 'limit')) throw new TypeError('Only the bars limit option is supported')
    const limit = options.limit
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 0)) throw new RangeError('Bars limit must be a nonnegative safe integer')
    const bars = this.series.getDataList(), start = limit === undefined ? 0 : Math.max(0, bars.length - limit)
    const result: MarketBar[] = []
    for (let index = start; index < bars.length; index++) result.push({ ...bars[index] })
    return result
  }

  getLastBar (): MarketBar | null {
    this.assertLive()
    const bars = this.series.getDataList(), bar = bars[bars.length - 1]
    return bar === undefined ? null : { ...bar }
  }

  getLayoutOptions (): EngineLayout {
    this.assertLive()
    return copyLayout(this.layout)
  }

  getRenderOptions (): EngineRenderOptions { this.assertLive(); return { ...this.renderOptions } }

  /** Validate all supplied state before replacing any live configuration. */
  restoreConfiguration (configuration: EngineConfiguration, data?: { bars: readonly MarketBar[], more?: boolean }): void {
    this.assertLive()
    if (configuration.mode !== 'raw' && configuration.mode !== 'heikin-ashi') throw new TypeError('Invalid candle mode')
    const render = { ...configuration.render }, layout = copyLayout(configuration.layout)
    this.validateRender(render); validateEngineLayout(layout); validatePriceScale(layout.priceScale ?? {})
    const bars = data === undefined ? this.series.getDataList() : normalizeBars(data.bars, 1).bars
    this.validateBars(bars, layout, bars[0]?.close)
    const drawings = new DrawingStore({ historyLimit: 0 })
    drawings.importJson(configuration.drawingsJson)
    const normalizedDrawings = drawings.exportJson()
    // Registered custom parameter validators may reject; this is still before
    // render, scale, drawing or viewport mutation.
    this.indicators.replace(configuration.indicators)
    this.renderOptions = render; this.layout = layout
    this.drawings.importJson(normalizedDrawings, { recordHistory: false })
    try {
      this.view.setMode(configuration.mode)
      if (data !== undefined) this.series.applyNewData(bars, data.more)
    } finally {
      this.geometryDirty = true; this.drawingDirty = true; this.cursorDirty = true
      this.schedule(); this.notifyIndicators()
    }
  }

  /** Repaint owned layers after their model changes without rebuilding candle geometry. */
  requestPaint (): void { this.assertLive(); this.paintDirty = true; this.schedule() }

  /** Decode local raster resources before an import commits retained drawings. */
  async prepareDrawingImages (drawings: readonly Drawing[]): Promise<void> {
    this.assertLive()
    const release = this.holdDrawingImages(drawings)
    const sources = new Set(drawings.flatMap(drawing => drawing.image === undefined ? [] : [drawing.image]))
    try {
      const results = await Promise.allSettled([...sources].map(async source => await this.drawingImages.prepare(source)))
      const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
      if (failed !== undefined) throw failed.reason
      this.assertLive()
    } finally { release() }
  }

  /** Hold decoded resources across asynchronous market loading; release in finally. */
  holdDrawingImages (drawings: readonly Drawing[]): () => void {
    this.assertLive()
    const release = this.drawingImages.hold(new Set(drawings.flatMap(drawing => drawing.image === undefined ? [] : [drawing.image])))
    return () => { release(); this.retainDrawingImages(); this.invalidateDrawings() }
  }

  private retainDrawingImages (): void {
    const sources = new Set(this.drawings.getSnapshot().drawings.flatMap(drawing => drawing.image === undefined ? [] : [drawing.image]))
    if (this.preview?.image !== undefined) sources.add(this.preview.image)
    this.drawingImages.retain(sources)
  }

  async snapshot (): Promise<Blob> {
    this.assertLive()
    const drawings = this.drawings.getSnapshot().drawings
    const release = this.holdDrawingImages(drawings)
    try {
      await this.prepareDrawingImages(drawings)
      if (this.drawings.getSnapshot().drawings !== drawings) throw new Error('Drawings changed while preparing the image; capture again')
      if (this.frameId !== 0) { this.win.cancelAnimationFrame(this.frameId); this.frameId = 0 }
      this.renderTick(this.win.performance.now())
      this.assertLive()
      if (this.width <= 0 || this.height <= 0) throw new Error('Cannot capture a zero-sized chart')
      if (this.frame === null || this.drawings.getSnapshot().drawings !== drawings) throw new Error('Chart changed while preparing the image; capture again')
      // Paint committed drawings separately: edits in progress and selection
      // handles are transient and must not leak into a saved chart image.
      const copy = this.doc.createElement('canvas')
      copy.width = this.canvas.width; copy.height = this.canvas.height
      const ctx = copy.getContext('2d')
      if (ctx === null) throw new Error('Canvas 2D is unavailable')
      ctx.drawImage(this.canvas, 0, 0)
      ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0)
      const bounds = this.frame.model.geometry
      paintDrawings(ctx, this.drawings.geometry(this.frame.project, bounds, this.frame.drawingContext), null, { bounds, imageRenderer: this.drawingImages })
      return await new Promise((resolve, reject) => copy.toBlob(blob => {
        if (blob === null) reject(new Error('PNG encoding failed')); else resolve(blob)
      }, 'image/png'))
    } finally { release() }
  }

  dispose (): void {
    if (this.disposed) return
    this.disposed = true
    this.abort.abort(); this.resizeObserver.disconnect(); this.unsubscribers.forEach(fn => fn())
    this.drawingInput.dispose(); this.drawingImages.dispose(); this.stopGestures(); this.view.dispose()
    this.dprQuery?.removeEventListener('change', this.pixelRatioChanged)
    if (this.frameId !== 0) this.win.cancelAnimationFrame(this.frameId)
    this.frameId = 0; this.inputs.clear(); this.frame = null; this.preview = null
    this.series.loadMore(() => {}); this.series.applyNewData([]); this.indicators.dispose()
    this.indicatorListeners.clear()
    this.root.remove()
    this.canvas.width = this.canvas.height = this.drawingCanvas.width = this.drawingCanvas.height = this.cursorCanvas.width = this.cursorCanvas.height = 0
    const layers = [...this.layers]; this.layers.clear()
    // Finish owned cleanup even when a host-provided layer has a failing disposer.
    const failures: unknown[] = []
    for (const layer of layers) { try { layer.dispose?.() } catch (error) { failures.push(error) } }
    if (failures.length > 0) throw failures[0]
  }

  private assertLive (): void { if (this.disposed) throw new Error('Chart is disposed') }
  private updateReference (bars: readonly MarketBar[]): number | undefined {
    const current = this.series.getDataList()
    return current.length === 0 ? bars[0]?.close : current.length === 1 ? bars.find(bar => bar.timestamp === current[0].timestamp)?.close ?? current[0].close : current[0].close
  }

  private validateBars (bars: readonly MarketBar[], layout = this.layout, base = this.series.getDataList()[0]?.close ?? bars[0]?.close): void {
    if (layout.priceScale?.mode === 'percentage' && base === 0) throw new RangeError('Percentage scale needs a nonzero reference price')
    for (const bar of bars) {
      if (![bar.timestamp, bar.open, bar.high, bar.low, bar.close].every(Number.isFinite) || bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close)) throw new RangeError('Candle has invalid OHLC bounds')
      if (Math.abs(bar.timestamp) > 8.64e15) throw new RangeError('Candle timestamp is outside the supported Date range')
      if (layout.priceScale?.mode === 'log' && Math.min(bar.open, bar.high, bar.low, bar.close) <= 0) throw new RangeError('Log scale requires positive prices')
    }
  }

  private validateRender (options: EngineRenderOptions): void {
    if (options.timeZone !== undefined) new Intl.DateTimeFormat('en', { timeZone: options.timeZone }).format(0)
    if (options.chartType !== undefined && !ENGINE_CHART_TYPES.includes(options.chartType)) throw new RangeError('Unknown chart type')
    if (options.baseline !== undefined && !Number.isFinite(options.baseline)) throw new RangeError('Baseline must be a finite price')
  }

  private readonly pixelRatioChanged = (): void => { this.watchPixelRatio(); this.schedule() }
  private watchPixelRatio (): void {
    this.dprQuery?.removeEventListener('change', this.pixelRatioChanged)
    this.dprQuery = this.win.matchMedia(`(resolution: ${this.win.devicePixelRatio || 1}dppx)`)
    this.dprQuery.addEventListener('change', this.pixelRatioChanged)
  }

  private schedule (): void {
    if (this.disposed || this.doc.hidden || this.frameId !== 0 || this.draining) return
    this.frameId = this.win.requestAnimationFrame(time => { this.frameId = 0; this.renderTick(time) })
  }

  private renderTick (time: number): void {
    this.draining = true
    let rendered = false
    try {
      const pending = [...this.inputs.entries()]
      for (const [id, callback] of pending) { if (this.inputs.delete(id)) callback(time) }
      this.flush()
      rendered = true
    } finally {
      this.draining = false
      if (rendered && (this.inputs.size > 0 || (this.width > 0 && this.height > 0 && (this.geometryDirty || this.paintDirty || this.drawingDirty || this.cursorDirty)))) this.schedule()
    }
  }

  private flush (): void {
    if (this.disposed) return
    const started = this.win.performance.now(), rect = this.root.getBoundingClientRect(), ratio = this.win.devicePixelRatio || 1
    const sizeChanged = rect.width !== this.width || rect.height !== this.height
    if (sizeChanged || ratio !== this.ratio) {
      this.width = rect.width; this.height = rect.height; this.ratio = ratio
      for (const canvas of [this.canvas, this.drawingCanvas, this.cursorCanvas]) {
        canvas.width = Math.round(this.width * ratio); canvas.height = Math.round(this.height * ratio)
      }
      this.geometryDirty = this.geometryDirty || sizeChanged
      this.paintDirty = true; this.drawingDirty = true; this.cursorDirty = true
    }
    if (this.width <= 0 || this.height <= 0) return
    if (this.geometryDirty || this.frame === null) {
      const bars = this.series.getDataList()
      const indicators = this.indicators.compute(bars).map(result => ({ ...result, pane: result.pane === 'price' ? 'price' : `indicator:${result.paneId ?? result.id}` }))
      const snapshot = this.view.getSnapshot(), from = snapshot.dataStart ?? snapshot.viewport.i0
      const previousClose = from > 0 ? this.series.snapshot(from - 1, from, snapshot.mode).bars[0]?.close : undefined
      this.frame = buildEngineFrame(snapshot, bars, indicators, this.width, this.height, this.layout, previousClose, this.series.version)
      for (const layer of this.layers) layer.update(this.frame, bars)
      if (this.disposed) return
      this.geometryDirty = false; this.paintDirty = true; this.drawingDirty = true; this.cursorDirty = true
      this.counters.geometryBuilds++
    }
    if (this.paintDirty) {
      this.context.setTransform(ratio, 0, 0, ratio, 0, 0)
      this.context.clearRect(0, 0, this.width, this.height)
      for (const [i, pane] of this.frame.panes.entries()) {
        this.context.save(); this.context.translate(0, pane.top)
        paintEngineFrame(this.context, pane.frame, { ...this.renderOptions, formatPrice: i === 0 ? pane.scale.label : price => String(Number(price.toPrecision(6))), showTimeAxis: i === this.frame.panes.length - 1 })
        this.context.restore()
      }
      for (const layer of this.layers) {
        this.context.save()
        try { layer.paint(this.context) } finally { this.context.restore() }
        if (this.disposed) return
      }
      this.paintDirty = false; this.counters.plotPaints++
    }
    if (this.drawingDirty) {
      this.drawingContext.setTransform(ratio, 0, 0, ratio, 0, 0)
      this.drawingContext.clearRect(0, 0, this.width, this.height)
      const g = this.frame.model.geometry
      this.retainDrawingImages()
      // Offscreen tail edits need not rebuild candles, but anchored calculations
      // must see the current raw revision rather than the last viewport revision.
      this.frame.drawingContext = { bars: this.series.getDataList(), revision: this.series.version, visibleRange: [this.frame.snapshot.viewport.i0, this.frame.snapshot.viewport.i1] }
      const geometries = this.drawings.geometry(this.frame.project, g, this.frame.drawingContext).filter(item => item.id !== this.preview?.id)
      if (this.preview !== null) { const geometry = projectDrawing(this.preview, this.frame.project, g, this.frame.drawingContext); if (geometry !== null) geometries.push(geometry) }
      paintDrawings(this.drawingContext, geometries, this.preview?.id ?? this.drawings.getSnapshot().selectedId, { bounds: g, imageRenderer: this.drawingImages, onInvalidate: this.invalidateDrawings })
      this.drawingDirty = false; this.counters.drawingPaints++
    }
    if (this.cursorDirty) {
      this.cursorContext.setTransform(ratio, 0, 0, ratio, 0, 0)
      this.cursorContext.clearRect(0, 0, this.width, this.height)
      if (this.cursorX !== null) { for (const [i, pane] of this.frame.panes.entries()) {
        this.cursorContext.save(); this.cursorContext.translate(0, pane.top)
        paintEngineCursor(this.cursorContext, pane.frame, this.cursorX, { ...this.renderOptions, formatPrice: pane.scale.label, showTimeAxis: i === this.frame.panes.length - 1 })
        this.cursorContext.restore()
      } }
      this.cursorDirty = false; this.counters.cursorPaints++
      this.onInspect?.(this.cursorX === null ? null : this.frame.inspect(this.cursorX))
    }
    if (this.disposed || this.frame === null) return
    this.counters.frames++; this.counters.lastFrameMs = this.win.performance.now() - started
    if (this.counters.firstDataFrameMs === 0 && this.frame.snapshot.bars.length > 0) this.counters.firstDataFrameMs = this.counters.lastFrameMs
    this.counters.maxFrameMs = Math.max(this.counters.maxFrameMs, this.counters.lastFrameMs)
  }
}
