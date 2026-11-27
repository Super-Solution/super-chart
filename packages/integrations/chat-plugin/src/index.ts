// SPDX-License-Identifier: GPL-3.0-or-later
import { ChartWorkspace, SUPER_CHART_COLORS, FONT_SANS } from '@supersolutions/super-chart-web'
import { EngineAnnotations } from '@supersolutions/super-chart-web/annotations'
import { symbolKey, type Datafeed as CoreDatafeed, type MarketBar as CoreBar, type Period as CorePeriod, type SymbolInfo as CoreSymbol } from '@supersolutions/super-chart-core'
import { readHostTheme, CHART_CARD_KIND, CHART_LIMITS, chartCardKind, validatePeriod, validateSymbol, formatCardRef, parseChartRef, validateChartAnnotations, validateChartCardSpec as validateChartCard, type CardMount, type CardMountContext, type ChartIndicator, type ChartType, type ChatPlugin, type Datafeed, type MarketBar, type Period, type SymbolInfo, type PluginTool, type PluginToolAuthority, type CardRef, type CardRefEvent, type CardRefResult, type ChartAnnotation, type ChartCardSpec } from '@supersolutions/super-protocol'
import { chartHostLook } from './host-theme'
import { checkMarkShapes, correctTimeUnits, levelsOf, summarizeData, swingsOf, whyNotShown, type DataSummary, type MarkPlacement, type MarkWarning } from './agent-feedback'

type AuthorizedPluginTool = PluginTool & { authority: PluginToolAuthority }

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
  /** For each mark, the `ref:` link that makes words in a message point at it. Absent when the chart's id cannot be a ref target. */
  refs: Record<string, string>
  bars: { count: number, first: number | null, last: number | null }
  /** The loaded data's reach, to check a mark against: first and last time, the price range of the 500 most recent bars and the last close. */
  data: DataSummary
  /** Marks that are not on screen, each with the reason (present only when there are any). */
  notShown?: MarkPlacement[]
  replay: { active: boolean }
}

const CHART_TYPE_TO_ENGINE: Record<ChartType, { chartType?: string, mode: 'raw' | 'heikin-ashi' }> = {
  candles: { chartType: 'candles', mode: 'raw' },
  'hollow-candles': { chartType: 'hollow-candles', mode: 'raw' },
  ohlc: { chartType: 'ohlc', mode: 'raw' },
  line: { chartType: 'line', mode: 'raw' },
  area: { chartType: 'area', mode: 'raw' },
  baseline: { chartType: 'baseline', mode: 'raw' },
  'heikin-ashi': { chartType: 'candles', mode: 'heikin-ashi' }
}

/**
 * Where the host shows the card (super-protocol 0.4 `CardMountContext.placement`). Read structurally so a host that
 * predates placements, which shows every card inline, keeps working.
 */
type Placement = 'inline' | 'panel' | 'document'
const placementOf = (context: CardMountContext): Placement => {
  const value = (context as { placement?: unknown }).placement
  return value === 'panel' || value === 'document' ? value : 'inline'
}
/** In a document the chart is read, not worked on: no drawing tools or replay footer. */
const DOCUMENT_PARTS = { drawingBar: false, toolRail: false, drawingToolbar: false, footer: false } as const

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

const MAX_KEPT_CHARTS = 64

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
  // A chat host may remount a card at any time (a finished turn does). What the agent put on a chart is kept here, so the
  // same card comes back with it. A card whose data or own marks changed starts from its spec.
  const kept = new Map<string, { source: string, annotations: ChartAnnotation[], indicators: ChartIndicator[] }>()
  const keptKey = (spec: ChartCardSpec): string => spec.id ?? dataKey(spec)
  const keptSource = (spec: ChartCardSpec): string => JSON.stringify([dataKey(spec), spec.annotations ?? [], spec.indicators ?? []])
  const remember = (chart: Mounted): void => {
    const key = keptKey(chart.spec)
    kept.delete(key)
    kept.set(key, {
      source: keptSource(chart.spec),
      annotations: [...chart.annotationsByKey.values()],
      indicators: chart.workspace.getState().indicators.map(item => ({ name: item.name, params: [...item.params] }))
    })
    if (kept.size > MAX_KEPT_CHARTS) kept.delete(kept.keys().next().value as string)
  }

  /** Which of these marks are not on screen, and why, so the agent fixes them instead of telling the reader they are drawn. */
  const notShownOf = (chart: Mounted, keys: Iterable<string>): MarkPlacement[] => {
    const data = dataOf(chart), placement: MarkPlacement[] = []
    for (const key of keys) {
      const span = chart.annotations.getAnnotationSpan(key, 'agent'), mark = chart.annotationsByKey.get(key)
      if (span === null || mark === undefined || span.status === 'visible') continue
      const why = whyNotShown(mark, span.status, data)
      if (why !== null) placement.push({ key, status: span.status, why })
    }
    return placement
  }
  const snapshot = (chart: Mounted): ChartSnapshot => {
    const state = chart.workspace.getState()
    const notShown = notShownOf(chart, chart.annotationsByKey.keys())
    return {
      chartId: chart.id,
      symbol: chart.workspace.getSymbol(),
      period: chart.workspace.getPeriod(),
      chartType: chart.spec.chartType ?? 'candles',
      indicators: state.indicators.map(item => ({ id: item.id, name: item.name, params: [...item.params] })),
      annotations: [...chart.annotationsByKey.values()],
      refs: refsOf(chart),
      bars: { count: state.data.count, first: state.data.firstTimestamp, last: state.data.lastTimestamp },
      data: dataOf(chart),
      ...(notShown.length > 0 ? { notShown } : {}),
      replay: { active: state.replay.active }
    }
  }
  const dataOf = (chart: Mounted): DataSummary => {
    const state = chart.workspace.getState()
    return summarizeData(state.data.count, state.data.firstTimestamp, state.data.lastTimestamp, chart.workspace.getBars({ limit: 500 }))
  }
  const refsOf = (chart: Mounted): Record<string, string> => {
    const refs: Record<string, string> = {}
    for (const key of chart.annotationsByKey.keys()) {
      const href = formatCardRef({ target: chart.id, params: { key: [key] } })
      if (href !== null) refs[key] = href
    }
    return refs
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
        const placement = placementOf(context)
        // In the side panel the chart fills the room it is given, with every tool; in the chat and in a document it keeps its card height.
        host.style.cssText = placement === 'panel'
          ? 'position:relative;width:100%;flex:1 1 auto;height:100%;min-height:360px;overflow:hidden'
          : `position:relative;width:100%;height:${spec.height ?? (placement === 'document' ? 360 : 420)}px;overflow:hidden`
        host.dataset.placement = placement
        const notes = doc.createElement('div')
        notes.setAttribute('role', 'status')
        const hostTheme = readHostTheme(context.hostTheme)
        const look = chartHostLook(hostTheme)
        notes.style.cssText = `padding:4px 12px;font:12px ${hostTheme?.tokens['font-sans'] ?? FONT_SANS};color:${hostTheme?.tokens['text-muted'] ?? SUPER_CHART_COLORS[context.theme].inkMuted}`
        container.replaceChildren(host, notes)
        const engine = CHART_TYPE_TO_ENGINE[spec.chartType ?? 'candles']
        const periods = DEFAULT_PERIODS.some(p => p.multiplier === spec.period.multiplier && p.timespan === spec.period.timespan) ? DEFAULT_PERIODS : [spec.period, ...DEFAULT_PERIODS]
        const workspace = new ChartWorkspace(host, {
          datafeed: datafeed as CoreDatafeed,
          symbol: spec.symbol,
          period: spec.period,
          periods,
          theme: context.theme,
          ui: { variables: look.variables, ...(placement === 'document' ? { parts: DOCUMENT_PARTS } : {}) },
          chart: { mode: engine.mode, render: { ...look.render, chartType: engine.chartType as never } }
        })
        const annotations = new EngineAnnotations({ symbol: symbolKey(spec.symbol), theme: context.theme, pricePrecision: typeof spec.symbol.pricePrecision === 'number' ? spec.symbol.pricePrecision : undefined, onChange: () => { if (!destroyed) workspace.chart.requestPaint() } })
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
        const restored = kept.get(keptKey(spec))
        const resume = restored?.source === keptSource(spec) ? restored : undefined
        applyIndicators(chart, resume?.indicators ?? spec.indicators ?? [])
        const marks = resume?.annotations ?? spec.annotations ?? []
        if (marks.length > 0) applyAnnotations(chart, marks, true)
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
      const themeKey = JSON.stringify(readHostTheme(context.hostTheme))
      const signature = JSON.stringify([rawSpec, context.theme, themeKey, context.partial === true, placementOf(context)])
      if (signature === shown) return
      shown = signature
      if (context.partial === true) { teardown(); dataSignature = ''; note(container, 'Chart is still being written…'); return }
      const valid = validateChartCard(rawSpec)
      if (!valid.ok) { teardown(); dataSignature = ''; note(container, valid.error, 'alert'); return }
      const spec = rawSpec as ChartCardSpec
      // Moving between the chat, the panel and a document rebuilds the chart; its indicators and marks come back from `kept`.
      const key = dataKey(spec) + (spec.height ?? '') + context.theme + themeKey + (spec.id ?? '') + placementOf(context)
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

    /** What the span of a range or a mark is called when a host announces it. */
    const when = (time: number): string => new Date(time).toISOString().slice(0, 16).replace('T', ' ')
    const noMatch = (reason: string): CardRefResult => ({ ok: false, code: 'ref_no_match', reason })
    const clearRefs = (chart: Mounted): void => { chart.annotations.setEmphasis(null); chart.annotations.setRangeHighlight(null) }

    // Brings a stretch of time into view when it is not. Only loaded bars can be shown; it never fetches history.
    const reveal = (chart: Mounted, from: number, to: number): void => {
      const view = chart.workspace.chart.view
      const bars = view.getSnapshot().bars
      const first = bars[0]?.timestamp, last = bars[bars.length - 1]?.timestamp
      if (first !== undefined && last !== undefined && from >= first && to <= last) return
      view.seek((from + to) / 2)
    }
    const loaded = (chart: Mounted, from: number, to: number): boolean => {
      const data = chart.workspace.getState().data
      return data.firstTimestamp !== null && data.lastTimestamp !== null && to >= data.firstTimestamp && from <= data.lastTimestamp
    }

    /** Words in a message point into this chart (see `ref.ts` in super-protocol). */
    const answer = (ref: CardRef | null, event: CardRefEvent): CardRefResult => {
      const chart = current
      if (chart === null) return { ok: false, code: 'ref_no_match', reason: 'The chart is not shown.' }
      if (ref === null) { clearRefs(chart); return { ok: true } }
      if (ref.target !== chart.id) return noMatch(`This card is "${chart.id}", not "${ref.target}".`)
      const parsed = parseChartRef(ref)
      if (!parsed.ok) return { ok: false, code: 'ref_invalid', reason: parsed.error }
      if (event === 'leave') { clearRefs(chart); return { ok: true } }
      const target = parsed.chart
      let label: string
      if (target.key !== undefined) {
        const span = chart.annotations.getAnnotationSpan(target.key, 'agent')
        const mark = chart.annotationsByKey.get(target.key)
        if (span === null || mark === undefined) return noMatch(`There is no mark "${target.key}" on this chart.`)
        clearRefs(chart)
        chart.annotations.setEmphasis([target.key], 'agent')
        if (event === 'activate' && span.status !== 'visible') {
          if (loaded(chart, span.from, span.to)) reveal(chart, span.from, span.to)
          else return noMatch('That mark is outside the bars this chart has loaded.')
        }
        label = `${mark.text ?? target.key}: ${mark.kind} ${span.low !== undefined && span.low === span.high ? span.low : span.from === span.to ? when(span.from) : `${when(span.from)} to ${when(span.to)}`}`
      } else if (target.from !== undefined && target.to !== undefined) {
        if (!loaded(chart, target.from, target.to)) return noMatch('That time range is outside the bars this chart has loaded.')
        clearRefs(chart)
        chart.annotations.setRangeHighlight({ from: target.from, to: target.to, ...(target.low !== undefined && target.high !== undefined ? { low: target.low, high: target.high } : {}) })
        if (event === 'activate') reveal(chart, target.from, target.to)
        label = `${when(target.from)} to ${when(target.to)}${target.low !== undefined ? `, price ${target.low} to ${target.high}` : ''}`
      } else {
        label = `${chart.workspace.getSymbol().ticker} chart`
      }
      if (event === 'activate') {
        // Move focus to the chart and show it, so a keyboard or screen-reader reader lands where the words pointed.
        container.querySelector<HTMLElement>('[role="group"][tabindex="0"]')?.focus({ preventScroll: true })
        const reduced = container.ownerDocument.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
        container.scrollIntoView?.({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' })
      }
      chart.workspace.chart.requestPaint()
      return { ok: true, label }
    }

    render(initialSpec, initialContext)
    const handle = { update: render, ref: answer, destroy () { destroyed = true; teardown() } }
    return handle
  }

  const chartId = { type: 'string', description: 'Which chart; omit for the most recent one on screen.' }
  const tools: AuthorizedPluginTool[] = [
    {
      name: 'chart_state',
      authority: 'read',
      description: 'Read a chart on screen: symbol, period, chart type, indicators, annotations (and `notShown`: any mark that is not on screen, with the reason), how many bars are loaded, the reach of the data (first and last bar time, recent price range, last close) and whether replay is active. Read it before marking a chart.',
      inputSchema: { type: 'object', properties: { chartId } },
      run: async (input) => snapshot(find((input as { chartId?: unknown } | undefined)?.chartId))
    },
    {
      name: 'chart_bars',
      authority: 'read',
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
      name: 'chart_levels',
      authority: 'read',
      description: 'Read the support and resistance levels price has turned at, from the most recent bars (up to 500): up to five of each, nearest the last close first, with how many times price turned there and when last. Draw lines and zones at these prices instead of guessing; check them against chart_state first.',
      inputSchema: { type: 'object', properties: { chartId, strength: { type: 'integer', minimum: 1, maximum: 50, description: 'Bars on each side a turning point must out-reach; larger finds fewer, more important levels. Default 5.' } } },
      run: async (input) => {
        const { chartId: id, strength } = (input ?? {}) as { chartId?: unknown, strength?: unknown }
        if (strength !== undefined && !(Number.isInteger(strength) && (strength as number) >= 1 && (strength as number) <= 50)) throw new RangeError('strength must be an integer from 1 to 50')
        const chart = find(id)
        return { chartId: chart.id, ...levelsOf(chart.workspace.getBars({ limit: 500 }), strength as number | undefined) }
      }
    },
    {
      name: 'chart_swings',
      authority: 'read',
      description: 'Read the latest swing highs and lows of the recent bars (up to 500), oldest first and alternating, each with the time and price of a real bar, plus the last leg (previous swing to latest swing). Anchor trend lines, rays, fibonacci retracements and trade plans on these points instead of on guessed times and prices; check them against chart_state first.',
      inputSchema: { type: 'object', properties: { chartId, strength: { type: 'integer', minimum: 1, maximum: 50, description: 'Bars on each side a swing must out-reach; larger finds fewer, larger swings. Default 5.' }, count: { type: 'integer', minimum: 2, maximum: 30, description: 'How many of the latest swings to return. Default 8.' } } },
      run: async (input) => {
        const { chartId: id, strength, count } = (input ?? {}) as { chartId?: unknown, strength?: unknown, count?: unknown }
        if (strength !== undefined && !(Number.isInteger(strength) && (strength as number) >= 1 && (strength as number) <= 50)) throw new RangeError('strength must be an integer from 1 to 50')
        if (count !== undefined && !(Number.isInteger(count) && (count as number) >= 2 && (count as number) <= 30)) throw new RangeError('count must be an integer from 2 to 30')
        const chart = find(id)
        return { chartId: chart.id, ...swingsOf(chart.workspace.getBars({ limit: 500 }), strength as number | undefined, count as number | undefined) }
      }
    },
    {
      name: 'chart_set_market',
      authority: 'draft',
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
      name: 'chart_compare',
      authority: 'draft',
      description: 'Overlay another market on a chart that has a datafeed, so relative performance reads at a glance: the other market is rebased to start at this chart\'s price and drawn as a line (up to 6). action "add" takes a symbol ({ ticker, exchange? }); "remove" takes the same symbol; "list" returns what is overlaid. Fetched for the loaded range and refreshed about every 30 seconds, not streamed. Charts that show an inline snapshot of bars cannot compare.',
      inputSchema: { type: 'object', properties: { chartId, action: { type: 'string', enum: ['add', 'remove', 'list'] }, symbol: { type: 'object', required: ['ticker'] } }, required: ['action'] },
      run: async (input) => {
        const { chartId: id, action, symbol } = (input ?? {}) as { chartId?: unknown, action?: unknown, symbol?: unknown }
        if (action !== 'add' && action !== 'remove' && action !== 'list') throw new TypeError('action must be add, remove or list')
        const chart = find(id)
        if (action === 'list') return { chartId: chart.id, compares: chart.workspace.listCompares().map(item => item.symbol) }
        if (chart.spec.bars !== undefined) throw new Error('This chart shows an inline snapshot of bars and cannot compare. Show a chart card with a feed instead.')
        const problem = validateSymbol(symbol)
        if (problem !== null) throw new TypeError(problem)
        const target = symbol as SymbolInfo
        if (action === 'add') await chart.workspace.addCompare(target)
        else {
          const key = symbolKey(target), found = chart.workspace.listCompares().find(item => symbolKey(item.symbol) === key)
          if (found === undefined) throw new Error(`${target.ticker} is not overlaid on this chart`)
          chart.workspace.removeCompare(found.id)
        }
        return { chartId: chart.id, compares: chart.workspace.listCompares().map(item => item.symbol) }
      }
    },
    {
      name: 'chart_annotate',
      authority: 'draft',
      description: 'Mark a chart: level (horizontal price line, one anchor with a price), zone (price band over a time range, two anchors with prices), marker (labelled point, one anchor), trend (line through two priced anchors), ray (a trend line extended to the right), fibonacci (retracement levels between two priced anchors; params.levels is a comma list such as "0,0.5,1") or plan (entry, target and stop: three priced anchors in that order, with the risk-reward ratio; the entry and target need different times, the plan spans from one to the other). Keys are stable: sending a key again replaces that mark. Before drawing, read chart_state: its `data` gives the first and last bar time, the recent price range and the last close, so every price and time you send falls where the bars are. Times are milliseconds since the epoch (not seconds); prices are in the quote units of the symbol; keep text under 24 characters and send a few well-chosen marks, not a dense set. Returns which keys were applied and which the engine rejected, with a code; `notShown` lists applied marks that are not on screen with the reason (fix those rather than telling the reader they are drawn); and for each applied key a `ref:` link: put it in your message as [words](ref:...) and the reader can hover or focus the words to see that mark light up, or click to jump to it.',
      inputSchema: {
        type: 'object',
        required: ['annotations'],
        properties: { chartId, replace: { type: 'boolean', description: 'Replace every mark instead of merging by key.' }, annotations: { type: 'array', maxItems: CHART_LIMITS.annotations, items: { type: 'object', required: ['key', 'kind', 'anchors'], properties: { key: { type: 'string' }, kind: { enum: ['level', 'zone', 'marker', 'trend', 'ray', 'fibonacci', 'plan'] }, anchors: { type: 'array', maxItems: CHART_LIMITS.anchors, items: { type: 'object', required: ['time'], properties: { time: { type: 'number', description: 'Milliseconds since the epoch.' }, price: { type: 'number' } } } }, text: { type: 'string' }, tone: { enum: ['bull', 'bear', 'neutral', 'accent'] }, color: { type: 'string' }, params: { type: 'object' } } } } }
      },
      run: async (input) => {
        const { chartId: id, annotations, replace } = (input ?? {}) as { chartId?: unknown, annotations?: unknown, replace?: unknown }
        const problem = validateChartAnnotations(annotations)
        if (problem !== null) throw new TypeError(problem)
        const chart = find(id)
        const { annotations: corrected, warnings: unitWarnings } = correctTimeUnits(annotations as ChartAnnotation[])
        const warnings = [...unitWarnings, ...checkMarkShapes(corrected)]
        const result = applyAnnotations(chart, corrected, replace === true)
        remember(chart)
        changed(chart)
        // Say what is not on screen and why, so the agent fixes the mark instead of telling the reader it drew it.
        const data = dataOf(chart), placement = notShownOf(chart, result.applied)
        return { chartId: chart.id, ...result, refs: refsOf(chart), total: chart.annotationsByKey.size, data, ...(warnings.length > 0 ? { warnings: warnings satisfies MarkWarning[] } : {}), ...(placement.length > 0 ? { notShown: placement } : {}) }
      }
    },
    {
      name: 'chart_clear_annotations',
      authority: 'act',
      description: 'Remove marks from a chart: the listed keys, or every mark when no keys are given.',
      inputSchema: { type: 'object', properties: { chartId, keys: { type: 'array', items: { type: 'string' } } } },
      run: async (input) => {
        const { chartId: id, keys } = (input ?? {}) as { chartId?: unknown, keys?: unknown }
        if (keys !== undefined && !(Array.isArray(keys) && keys.every(key => typeof key === 'string'))) throw new TypeError('keys must be an array of strings')
        const chart = find(id)
        const drop = new Set(keys as string[] | undefined)
        const keep = keys === undefined ? [] : [...chart.annotationsByKey.values()].filter(item => !drop.has(item.key))
        applyAnnotations(chart, keep, true)
        remember(chart)
        changed(chart)
        return { chartId: chart.id, remaining: chart.annotationsByKey.size }
      }
    },
    {
      name: 'chart_indicators',
      authority: 'draft',
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
        remember(chart)
        changed(chart)
        return { chartId: chart.id, indicators: snapshot(chart).indicators, available }
      }
    },
    {
      name: 'chart_replay',
      authority: 'draft',
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
      version: '0.13.1',
      license: 'GPL-3.0-or-later',
      capabilities: [
        { id: 'chart.card', surface: 'card', cardKind: CHART_CARD_KIND },
        // A chart someone works with (drawing, replay, indicators) has room for every tool in a side panel.
        { id: 'chart.panel', surface: 'panel', cardKind: CHART_CARD_KIND },
        ...tools.map(tool => ({ id: `chart.${tool.name.replace(/^chart_/, '').replace(/_/g, '-')}`, surface: 'tool' as const, toolName: tool.name }))
      ]
    },
    cardKinds: [chartCardKind],
    mounts: { [CHART_CARD_KIND]: mount },
    tools
  }
}
