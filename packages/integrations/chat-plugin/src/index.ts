// SPDX-License-Identifier: GPL-3.0-or-later
import { ChartWorkspace } from '@supersolutions/super-chart-web'
import { EngineAnnotations } from '@supersolutions/super-chart-web/annotations'
import { symbolKey, type Datafeed as CoreDatafeed, type MarketBar as CoreBar, type Period as CorePeriod, type SymbolInfo as CoreSymbol } from '@supersolutions/super-chart-core'
import { TECHNICAL_INDICATOR_DEFINITIONS, CLASSIC_INDICATOR_DEFINITIONS } from '@supersolutions/super-chart-core/indicators'
import { CHART_CARD_KIND, CHART_LIMITS, chartCardKind, validateChartAnnotations, validateChartCardSpec, validatePeriod, validateSymbol, type CardMount, type CardMountContext, type ChartAnnotation, type ChartCardSpec, type ChartIndicator, type ChartType, type ChatPlugin, type Datafeed, type MarketBar, type Period, type PluginTool, type SymbolInfo } from '@supersolutions/super-protocol'

// Compile-time proof that the Apache protocol contracts and the core contracts are the same shapes.
const sameFeed = (feed: Datafeed): CoreDatafeed => feed
const sameBar = (bar: MarketBar): CoreBar => bar
const sameSymbol = (symbol: SymbolInfo): CoreSymbol => symbol
const samePeriod = (period: Period): CorePeriod => period
void sameFeed; void sameBar; void sameSymbol; void samePeriod

export interface ChartChatPluginOptions {
  /** Resolves a card's `feed: { id }` to a datafeed. Without it only inline-bar cards can be shown. */
  resolveFeed?: (id: string) => Datafeed | Promise<Datafeed>
  /** Called after a tool or the user changes a chart, so the host can persist or log it. */
  onChange?: (chartId: string, snapshot: ChartSnapshot) => void
}

export interface ChartSnapshot {
  chartId: string
  symbol: SymbolInfo
  period: Period
  chartType: ChartType
  indicators: Array<{ id: string, name: string, params: number[] }>
  annotations: ChartAnnotation[]
  bars: { count: number, first: number | null, last: number | null }
  replay: { active: boolean }
}

const RENDER_THEME = {
  light: { background: '#ffffff', grid: '#e6e9ee', text: '#3a4250', up: '#16a34a', down: '#dc2626', line: '#2962ff' },
  dark: { background: '#0f1419', grid: '#1e2630', text: '#a9b4c2', up: '#22c55e', down: '#ef4444', line: '#5b8cff' }
} as const

const CHART_TYPE_TO_ENGINE: Record<ChartType, { chartType?: string, mode: 'raw' | 'heikin-ashi' }> = {
  candles: { chartType: 'candles', mode: 'raw' },
  'hollow-candles': { chartType: 'hollow-candles', mode: 'raw' },
  ohlc: { chartType: 'ohlc', mode: 'raw' },
  line: { chartType: 'line', mode: 'raw' },
  area: { chartType: 'area', mode: 'raw' },
  baseline: { chartType: 'baseline', mode: 'raw' },
  'heikin-ashi': { chartType: 'candles', mode: 'heikin-ashi' }
}

const DEFAULT_PERIODS: Period[] = [
  { multiplier: 1, timespan: 'minute', text: '1m' }, { multiplier: 5, timespan: 'minute', text: '5m' },
  { multiplier: 15, timespan: 'minute', text: '15m' }, { multiplier: 1, timespan: 'hour', text: '1h' },
  { multiplier: 4, timespan: 'hour', text: '4h' }, { multiplier: 1, timespan: 'day', text: '1D' }
]

/** A snapshot of inline bars as a datafeed: the first request gets everything, scroll-back gets older bars. */
function staticFeed (symbol: SymbolInfo, bars: readonly MarketBar[]): Datafeed {
  return {
    searchSymbols: async () => [symbol],
    getHistoryKLineData: async (_symbol, _period, _from, _to, request) => {
      const older = request?.before
      return { bars: older === undefined ? [...bars] : bars.filter(bar => bar.timestamp < older), noData: true }
    },
    subscribe: () => {},
    unsubscribe: () => {}
  }
}

interface Mounted {
  id: string
  spec: ChartCardSpec
  workspace: ChartWorkspace
  annotations: EngineAnnotations
  notes: HTMLElement
  annotationsByKey: Map<string, ChartAnnotation>
  destroy: () => void
}

const dataKey = (spec: ChartCardSpec): string => {
  const bars = spec.bars
  const data = bars === undefined ? `feed:${spec.feed?.id ?? ''}` : `bars:${bars.length}:${bars[0]?.timestamp}:${bars[bars.length - 1]?.timestamp}:${bars[bars.length - 1]?.close}`
  return JSON.stringify([data, spec.symbol, spec.period])
}

const note = (container: HTMLElement, text: string, role?: string): void => {
  const p = container.ownerDocument.createElement('p')
  p.className = 'super-chart-note'
  p.style.cssText = 'margin:0;padding:12px;font:13px system-ui,sans-serif;opacity:.8'
  if (role !== undefined) p.setAttribute('role', role)
  p.textContent = text
  container.replaceChildren(p)
}

/** The chat plugin for `super-chart.chart` cards, plus the tools an agent uses to read and mark them. License: GPL-3.0-or-later. */
export function createChartChatPlugin (options: ChartChatPluginOptions = {}): ChatPlugin {
  const charts = new Map<string, Mounted>()
  let counter = 0
  let latest: string | null = null

  const snapshot = (chart: Mounted): ChartSnapshot => {
    const state = chart.workspace.getState()
    return {
      chartId: chart.id,
      symbol: chart.workspace.getSymbol(),
      period: chart.workspace.getPeriod(),
      chartType: chart.spec.chartType ?? 'candles',
      indicators: state.indicators.map(item => ({ id: item.id, name: item.name, params: [...item.params] })),
      annotations: [...chart.annotationsByKey.values()],
      bars: { count: state.data.count, first: state.data.firstTimestamp, last: state.data.lastTimestamp },
      replay: { active: state.replay.active }
    }
  }
  const changed = (chart: Mounted): void => { options.onChange?.(chart.id, snapshot(chart)) }

  const find = (chartId: unknown): Mounted => {
    if (chartId !== undefined && typeof chartId !== 'string') throw new TypeError('chartId must be a string')
    const id = chartId ?? latest
    const chart = id === null ? undefined : charts.get(id)
    if (chart === undefined) {
      const known = [...charts.keys()]
      throw new Error(chartId === undefined ? 'No chart is on screen. Show a super-chart.chart card first.' : `Unknown chartId "${chartId}". On screen: ${known.length > 0 ? known.join(', ') : 'none'}.`)
    }
    return chart
  }

  const applyAnnotations = (chart: Mounted, specs: readonly ChartAnnotation[], replace: boolean): { applied: readonly string[], rejected: ReadonlyArray<{ key: string, code: string }> } => {
    const next = replace ? new Map<string, ChartAnnotation>() : new Map(chart.annotationsByKey)
    for (const spec of specs) next.set(spec.key, spec)
    const result = chart.annotations.setAnnotations('agent', [...next.values()])
    // The engine keeps the previous layer when it refuses a document; mirror what it holds.
    chart.annotationsByKey = new Map(chart.annotations.getAnnotations('agent').map(item => [item.key, item as ChartAnnotation]))
    chart.workspace.chart.requestPaint()
    const keyOf = (id: string): string => { const raw = id.replace(/^sc:ann:[^:]*:/, ''); try { return decodeURIComponent(raw) } catch { return raw } }
    return { applied: result.applied.map(keyOf), rejected: result.rejected.map(item => ({ key: item.key, code: item.code })) }
  }

  const mount: CardMount = (container, initialSpec, initialContext) => {
    let destroyed = false
    let current: Mounted | null = null
    let shown = ''
    let dataSignature = ''
    let epoch = 0

    const teardown = (): void => {
      epoch++
      if (current !== null) {
        // Another card may have registered under the same id since (an agent that reuses ids, or a host that
        // unmounts an older card after a newer one appeared): only release the entry this card still owns.
        if (charts.get(current.id) === current) {
          charts.delete(current.id)
          if (latest === current.id) latest = [...charts.keys()].pop() ?? null
        }
        current.destroy()
        current = null
      }
      container.replaceChildren()
    }

    const build = async (spec: ChartCardSpec, context: CardMountContext): Promise<void> => {
      const mine = ++epoch
      const doc = container.ownerDocument
      try {
        let datafeed: Datafeed
        if (spec.bars !== undefined) datafeed = staticFeed(spec.symbol, spec.bars)
        else {
          if (options.resolveFeed === undefined) throw new Error(`This chat has no datafeed registered, so feed "${spec.feed?.id}" cannot be shown. Send the chart with inline bars instead.`)
          datafeed = await options.resolveFeed(spec.feed!.id)
        }
        if (destroyed || mine !== epoch) return
        const host = doc.createElement('div')
        host.style.cssText = `position:relative;width:100%;height:${spec.height ?? 420}px;overflow:hidden`
        const notes = doc.createElement('div')
        notes.setAttribute('role', 'status')
        notes.style.cssText = `padding:4px 12px;font:12px system-ui,sans-serif;color:${RENDER_THEME[context.theme].text}`
        container.replaceChildren(host, notes)
        const engine = CHART_TYPE_TO_ENGINE[spec.chartType ?? 'candles']
        const periods = DEFAULT_PERIODS.some(p => p.multiplier === spec.period.multiplier && p.timespan === spec.period.timespan) ? DEFAULT_PERIODS : [spec.period, ...DEFAULT_PERIODS]
        const workspace = new ChartWorkspace(host, {
          datafeed: datafeed as CoreDatafeed,
          symbol: spec.symbol,
          period: spec.period,
          periods,
          chart: { mode: engine.mode, render: { ...RENDER_THEME[context.theme], chartType: engine.chartType as never } }
        })
        for (const definition of [...TECHNICAL_INDICATOR_DEFINITIONS, ...CLASSIC_INDICATOR_DEFINITIONS]) workspace.registerIndicator(definition)
        const annotations = new EngineAnnotations({ symbol: symbolKey(spec.symbol), theme: context.theme, onChange: () => { if (!destroyed) workspace.chart.requestPaint() } })
        const removeLayer = workspace.chart.addLayer(annotations)
        const id = spec.id ?? `chart-${++counter}`
        const chart: Mounted = {
          id,
          spec,
          workspace,
          annotations,
          notes,
          annotationsByKey: new Map(),
          destroy: () => { removeLayer(); annotations.dispose?.(); workspace.dispose() }
        }
        if (mine !== epoch || destroyed) { chart.destroy(); return }
        current = chart
        charts.set(id, chart)
        latest = id
        const loaded = await workspace.ready
        if (mine !== epoch || destroyed) return
        if (loaded.status === 'error') { notes.textContent = `The chart data could not be loaded: ${loaded.message}`; return }
        applyIndicators(chart, spec.indicators ?? [])
        if (spec.annotations !== undefined && spec.annotations.length > 0) applyAnnotations(chart, spec.annotations, true)
        changed(chart)
      } catch (error) {
        if (destroyed || mine !== epoch) return
        note(container, error instanceof Error ? error.message : 'The chart could not be shown.', 'alert')
      }
    }

    const applyIndicators = (chart: Mounted, wanted: readonly ChartIndicator[]): void => {
      const engine = chart.workspace.chart
      const registered = new Set(engine.getRegisteredIndicatorNames())
      const problems: string[] = []
      for (const existing of engine.listIndicators()) engine.removeIndicator(existing.id)
      for (const item of wanted) {
        if (!registered.has(item.name)) { problems.push(`${item.name}: unknown indicator`); continue }
        // One bad indicator must not take the chart down: report it under the chart instead.
        try { engine.addIndicator({ name: item.name, params: item.params }) } catch (error) { problems.push(`${item.name}: ${error instanceof Error ? error.message : 'rejected'}`) }
      }
      chart.notes.textContent = problems.length > 0 ? `Indicators not shown — ${problems.join('; ')}.` : ''
    }

    const render = (rawSpec: unknown, context: CardMountContext): void => {
      const signature = JSON.stringify([rawSpec, context.theme, context.partial === true])
      if (signature === shown) return
      shown = signature
      if (context.partial === true) { teardown(); dataSignature = ''; note(container, 'Chart is still being written…'); return }
      const valid = validateChartCardSpec(rawSpec)
      if (!valid.ok) { teardown(); dataSignature = ''; note(container, valid.error, 'alert'); return }
      const spec = rawSpec as ChartCardSpec
      const key = dataKey(spec) + (spec.height ?? '') + context.theme + (spec.id ?? '')
      if (current !== null && key === dataSignature) {
        // Same market and data: apply only what changed, keep the viewport and drawings.
        const chart = current
        const previous = chart.spec
        chart.spec = spec
        if (JSON.stringify(previous.chartType) !== JSON.stringify(spec.chartType)) {
          const engine = CHART_TYPE_TO_ENGINE[spec.chartType ?? 'candles']
          chart.workspace.chart.setRenderOptions({ chartType: engine.chartType as never })
          chart.workspace.chart.view.setMode(engine.mode)
        }
        if (JSON.stringify(previous.indicators) !== JSON.stringify(spec.indicators)) applyIndicators(chart, spec.indicators ?? [])
        if (JSON.stringify(previous.annotations) !== JSON.stringify(spec.annotations)) applyAnnotations(chart, spec.annotations ?? [], true)
        changed(chart)
        return
      }
      teardown()
      dataSignature = key
      void build(spec, context)
    }

    render(initialSpec, initialContext)
    return { update: render, destroy () { destroyed = true; teardown() } }
  }

  const chartId = { type: 'string', description: 'Which chart; omit for the most recent one on screen.' }
  const tools: PluginTool[] = [
    {
      name: 'chart_state',
      description: 'Read a chart on screen: symbol, period, chart type, indicators, annotations, how many bars are loaded and whether replay is active.',
      inputSchema: { type: 'object', properties: { chartId } },
      run: async (input) => snapshot(find((input as { chartId?: unknown } | undefined)?.chartId))
    },
    {
      name: 'chart_bars',
      description: 'Read the most recent bars loaded in a chart (oldest first) so you can analyse the data the user is looking at. At most 500.',
      inputSchema: { type: 'object', properties: { chartId, limit: { type: 'integer', minimum: 1, maximum: 500 } } },
      run: async (input) => {
        const { chartId: id, limit } = (input ?? {}) as { chartId?: unknown, limit?: unknown }
        if (limit !== undefined && !(Number.isInteger(limit) && (limit as number) >= 1 && (limit as number) <= 500)) throw new RangeError('limit must be an integer from 1 to 500')
        const chart = find(id)
        const bars = chart.workspace.getBars({ limit: (limit as number | undefined) ?? 100 })
        return { chartId: chart.id, count: bars.length, bars }
      }
    },
    {
      name: 'chart_set_market',
      description: 'Change the symbol and/or period of a chart on screen and wait for the data to load. Needs a datafeed that serves the new market.',
      inputSchema: { type: 'object', properties: { chartId, symbol: { type: 'object', required: ['ticker'] }, period: { type: 'object', required: ['multiplier', 'timespan', 'text'] } } },
      run: async (input) => {
        const { chartId: id, symbol, period } = (input ?? {}) as { chartId?: unknown, symbol?: unknown, period?: unknown }
        if (symbol === undefined && period === undefined) throw new TypeError('Give a symbol, a period, or both.')
        const chart = find(id)
        const nextSymbol = symbol === undefined ? chart.workspace.getSymbol() : symbol
        const nextPeriod = period === undefined ? chart.workspace.getPeriod() : period
        const problem = validateSymbol(nextSymbol) ?? validatePeriod(nextPeriod)
        if (problem !== null) throw new TypeError(problem)
        if (chart.spec.bars !== undefined && JSON.stringify([nextSymbol, nextPeriod]) !== JSON.stringify([chart.spec.symbol, chart.spec.period])) {
          throw new Error('This chart shows an inline snapshot of bars and cannot change market. Show a new chart card instead.')
        }
        const result = await chart.workspace.setMarket(nextSymbol as SymbolInfo, nextPeriod as Period)
        chart.annotations.setScope(symbolKey(chart.workspace.getSymbol()))
        applyAnnotations(chart, [...chart.annotationsByKey.values()], true)
        changed(chart)
        return { chartId: chart.id, result }
      }
    },
    {
      name: 'chart_annotate',
      description: 'Mark a chart: level (horizontal price line), zone (price band over a time range) or marker (labelled point). Keys are stable: sending a key again replaces that mark. Returns which keys were applied and which the engine rejected, with a code.',
      inputSchema: {
        type: 'object',
        required: ['annotations'],
        properties: { chartId, replace: { type: 'boolean', description: 'Replace every mark instead of merging by key.' }, annotations: { type: 'array', maxItems: CHART_LIMITS.annotations, items: { type: 'object', required: ['key', 'kind', 'anchors'] } } }
      },
      run: async (input) => {
        const { chartId: id, annotations, replace } = (input ?? {}) as { chartId?: unknown, annotations?: unknown, replace?: unknown }
        const problem = validateChartAnnotations(annotations)
        if (problem !== null) throw new TypeError(problem)
        const chart = find(id)
        const result = applyAnnotations(chart, annotations as ChartAnnotation[], replace === true)
        changed(chart)
        return { chartId: chart.id, ...result, total: chart.annotationsByKey.size }
      }
    },
    {
      name: 'chart_clear_annotations',
      description: 'Remove marks from a chart: the listed keys, or every mark when no keys are given.',
      inputSchema: { type: 'object', properties: { chartId, keys: { type: 'array', items: { type: 'string' } } } },
      run: async (input) => {
        const { chartId: id, keys } = (input ?? {}) as { chartId?: unknown, keys?: unknown }
        if (keys !== undefined && !(Array.isArray(keys) && keys.every(key => typeof key === 'string'))) throw new TypeError('keys must be an array of strings')
        const chart = find(id)
        const drop = new Set(keys as string[] | undefined)
        const keep = keys === undefined ? [] : [...chart.annotationsByKey.values()].filter(item => !drop.has(item.key))
        applyAnnotations(chart, keep, true)
        changed(chart)
        return { chartId: chart.id, remaining: chart.annotationsByKey.size }
      }
    },
    {
      name: 'chart_indicators',
      description: 'Add or remove indicators on a chart (for example MA, EMA, BOLL, VOL, MACD, RSI, KDJ and the expanded catalogue). Returns the indicators now shown and the names available.',
      inputSchema: {
        type: 'object',
        properties: { chartId, add: { type: 'array', items: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, params: { type: 'array', items: { type: 'number' } } } } }, remove: { type: 'array', items: { type: 'string' }, description: 'Indicator names to remove.' } }
      },
      run: async (input) => {
        const { chartId: id, add, remove } = (input ?? {}) as { chartId?: unknown, add?: unknown, remove?: unknown }
        const chart = find(id)
        const engine = chart.workspace.chart
        const available = [...engine.getRegisteredIndicatorNames()]
        if (add !== undefined) {
          if (!Array.isArray(add)) throw new TypeError('add must be an array')
          if (engine.listIndicators().length + add.length > CHART_LIMITS.indicators) throw new RangeError(`At most ${CHART_LIMITS.indicators} indicators per chart.`)
          for (const item of add as ChartIndicator[]) {
            if (typeof item?.name !== 'string' || !available.includes(item.name)) throw new TypeError(`Unknown indicator "${String(item?.name)}". Available: ${available.join(', ')}`)
            if (item.params !== undefined && !(Array.isArray(item.params) && item.params.every(Number.isFinite))) throw new TypeError('indicator params must be finite numbers')
          }
        }
        if (remove !== undefined && !(Array.isArray(remove) && remove.every(name => typeof name === 'string'))) throw new TypeError('remove must be an array of names')
        // All or nothing: an indicator the engine refuses (bad parameters) must not leave the ones before it behind,
        // or the agent's retry would stack duplicates. Adds go first so a failure removes nothing.
        const added: string[] = []
        try {
          for (const item of (add as ChartIndicator[] | undefined) ?? []) added.push(engine.addIndicator({ name: item.name, params: item.params }))
        } catch (error) {
          for (const indicatorId of added) engine.removeIndicator(indicatorId)
          throw error
        }
        const fresh = new Set(added)
        for (const name of (remove as string[] | undefined) ?? []) for (const item of engine.listIndicators().filter(entry => entry.name === name && !fresh.has(entry.id))) engine.removeIndicator(item.id)
        chart.notes.textContent = ''
        changed(chart)
        return { chartId: chart.id, indicators: snapshot(chart).indicators, available }
      }
    },
    {
      name: 'chart_replay',
      description: 'Bar replay on a chart: "start" (optionally at a bar index), "step" forward or back by delta bars, or read the current state.',
      inputSchema: { type: 'object', required: ['action'], properties: { chartId, action: { enum: ['start', 'step', 'state'] }, at: { type: 'integer', minimum: 0 }, delta: { type: 'integer' } } },
      run: async (input) => {
        const { chartId: id, action, at, delta } = (input ?? {}) as { chartId?: unknown, action?: unknown, at?: unknown, delta?: unknown }
        const chart = find(id)
        if (action === 'start') {
          if (at !== undefined && !(Number.isInteger(at) && (at as number) >= 0)) throw new RangeError('at must be a non-negative integer')
          const started = chart.workspace.startReplay(at as number | undefined)
          return { chartId: chart.id, started, replay: chart.workspace.getReplayState() }
        }
        if (action === 'step') {
          if (delta !== undefined && !Number.isInteger(delta)) throw new RangeError('delta must be an integer')
          return { chartId: chart.id, replay: chart.workspace.stepReplay((delta as number | undefined) ?? 1) }
        }
        if (action === 'state') return { chartId: chart.id, replay: chart.workspace.getReplayState() }
        throw new TypeError('action must be start, step or state')
      }
    }
  ]

  return {
    manifest: {
      manifestVersion: 0,
      name: '@supersolutions/super-chart-chat-plugin',
      version: '0.1.0',
      license: 'GPL-3.0-or-later',
      capabilities: [
        { id: 'chart.card', surface: 'card', cardKind: CHART_CARD_KIND },
        ...tools.map(tool => ({ id: `chart.${tool.name.replace(/^chart_/, '').replace(/_/g, '-')}`, surface: 'tool' as const, toolName: tool.name }))
      ]
    },
    cardKinds: [chartCardKind],
    mounts: { [CHART_CARD_KIND]: mount },
    tools
  }
}
