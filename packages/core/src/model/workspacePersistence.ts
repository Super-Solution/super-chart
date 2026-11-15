import type { Period, SymbolInfo } from '../feed'
import type { CandleMode } from '../realtimeSeries'
import { DrawingStore, type Drawing } from './drawings'
import { EngineIndicators, type EngineIndicatorInstance } from './indicators'
import { validateEngineLayout, type EngineLayout } from './frame'
import { validatePriceScale, type PriceScaleOptions } from './priceScale'
import { ENGINE_CHART_TYPES, type EngineRenderOptions } from './renderTypes'

/** Presentation only. Feed-derived date metadata and callback functions are never stored here. */
export type WorkspaceSavedRender = Omit<EngineRenderOptions, 'formatPrice' | 'showTimeAxis' | 'timespan' | 'symbolTimezone'>
export interface WorkspaceDrawingDocument {
  readonly version: 1
  readonly drawings: readonly Drawing[]
}
export interface WorkspaceDocumentV1 {
  readonly version: 1
  readonly symbol: Readonly<SymbolInfo>
  readonly period: Readonly<Period>
  readonly mode?: CandleMode
  readonly render: Readonly<WorkspaceSavedRender>
  readonly layout: Readonly<EngineLayout>
  readonly indicators: readonly EngineIndicatorInstance[]
  readonly drawings: WorkspaceDrawingDocument
}
export interface WorkspaceDocumentOptions {
  /** Explicitly registered custom definitions only; this does not register or execute them. */
  readonly registeredIndicatorNames?: readonly string[]
}
export const WORKSPACE_DOCUMENT_LIMITS = Object.freeze({
  characters: 8 * 1024 * 1024, nodes: 1_100_000, depth: 24, indicators: 64, params: 64, drawings: 1000
})

const BUILTINS = new Set(['MA', 'EMA', 'BOLL', 'VOL', 'MACD', 'RSI', 'KDJ'])
const SYMBOL_KEYS = ['ticker', 'name', 'shortName', 'exchange', 'market', 'pricePrecision', 'volumePrecision', 'priceCurrency', 'type', 'logo', 'timezone']
const RENDER_KEYS = ['chartType', 'candleDensity', 'baseline', 'background', 'grid', 'text', 'up', 'down', 'line', 'font', 'pricePrecision', 'timeZone', 'theme']
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

function object (value: unknown, allowed: readonly string[], required: readonly string[], label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`Invalid ${label}`)
  const input = value as Record<string, unknown>
  if (Object.keys(input).some(key => !allowed.includes(key)) || required.some(key => !Object.prototype.hasOwnProperty.call(input, key))) {
    throw new TypeError(`Unknown or missing ${label} property`)
  }
  return input
}
function text (value: unknown, label: string, max = 128, empty = false): string {
  if (typeof value !== 'string' || value.length > max || (!empty && value.trim() === '') ||
      Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
    throw new TypeError(`Invalid ${label}`)
  }
  return value
}
function finite (value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`Invalid ${label}`)
  return value
}
function integer (value: unknown, label: string, min: number, max = Number.MAX_SAFE_INTEGER): number {
  const n = finite(value, label)
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new RangeError(`Invalid ${label}`)
  return n
}
function flag (value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`Invalid ${label}`)
  return value
}
function timezone (value: unknown, label: string): string {
  const zone = text(value, label)
  new Intl.DateTimeFormat('en', { timeZone: zone }).format(0)
  return zone
}

/** Iterative inspection bounds hostile JSON depth without recursive parser callbacks. */
function inspectJson (value: unknown): void {
  const pending: Array<{ value: Record<string, unknown> | unknown[], keys?: string[], index: number, depth: number }> = []
  let nodes = 0
  const visit = (item: unknown, depth: number): void => {
    if (++nodes > WORKSPACE_DOCUMENT_LIMITS.nodes || depth > WORKSPACE_DOCUMENT_LIMITS.depth) throw new RangeError('Workspace document is too complex')
    if (typeof item === 'number' && !Number.isFinite(item)) throw new TypeError('Workspace document contains a nonfinite number')
    if (item !== null && typeof item === 'object') {
      const keys = Array.isArray(item) ? undefined : Object.keys(item)
      if (keys !== undefined && keys.length > 256) throw new RangeError('Workspace object has too many properties')
      pending.push({ value: item as Record<string, unknown> | unknown[], keys, index: 0, depth })
    }
  }
  visit(value, 0)
  // Walk depth-first with one frame per nesting level. A large brush array
  // must not allocate another array of every pending point during inspection.
  while (pending.length > 0) {
    const frame = pending[pending.length - 1], count = frame.keys?.length ?? (frame.value as unknown[]).length
    if (frame.index >= count) { pending.pop(); continue }
    const index = frame.index++, key = frame.keys === undefined ? String(index) : frame.keys[index]
    if (DANGEROUS_KEYS.has(key)) throw new TypeError('Workspace document contains an unsafe property')
    visit((frame.value as Record<string, unknown>)[key], frame.depth + 1)
  }
}
function freezeDocument<T> (value: T): T {
  const pending: unknown[] = [value]
  while (pending.length > 0) {
    const item = pending.pop()
    if (item !== null && typeof item === 'object' && !Object.isFrozen(item)) {
      pending.push(...Object.values(item)); Object.freeze(item)
    }
  }
  return value
}

function symbolOf (value: unknown): SymbolInfo {
  const input = object(value, SYMBOL_KEYS, ['ticker'], 'symbol')
  text(input.ticker, 'symbol ticker', 256)
  for (const key of ['name', 'shortName', 'exchange', 'market', 'priceCurrency', 'type']) {
    if (input[key] !== undefined) text(input[key], `symbol ${key}`, 256, true)
  }
  if (input.pricePrecision !== undefined && input.pricePrecision !== 'auto') integer(input.pricePrecision, 'symbol price precision', 0, 20)
  if (input.volumePrecision !== undefined) integer(input.volumePrecision, 'symbol volume precision', 0, 20)
  if (input.timezone !== undefined) timezone(input.timezone, 'symbol timezone')
  if (input.logo !== undefined) {
    const logo = text(input.logo, 'symbol logo', 2048, true)
    if (logo !== '') {
      const url = new URL(logo)
      if (!['https:', 'http:'].includes(url.protocol) || url.username !== '' || url.password !== '') throw new TypeError('Symbol logo must be an HTTP(S) URL without credentials')
    }
  }
  return { ...input } as unknown as SymbolInfo
}
function periodOf (value: unknown): Period {
  const input = object(value, ['multiplier', 'timespan', 'text'], ['multiplier', 'timespan', 'text'], 'period')
  return {
    multiplier: integer(input.multiplier, 'period multiplier', 1),
    // Core feeds deliberately allow host-defined periods; do not rename/canonicalize them here.
    timespan: text(input.timespan, 'period timespan', 64),
    text: text(input.text, 'period label', 64)
  }
}
function renderOf (value: unknown): WorkspaceSavedRender {
  const input = object(value, RENDER_KEYS, [], 'render options')
  if (input.candleDensity !== undefined && input.candleDensity !== 'raw' && input.candleDensity !== 'pixel-envelope') throw new RangeError('Unknown candle density mode')
  if (input.chartType !== undefined && !ENGINE_CHART_TYPES.includes(input.chartType as NonNullable<EngineRenderOptions['chartType']>)) throw new TypeError('Unknown chart type')
  if (input.baseline !== undefined) finite(input.baseline, 'baseline')
  if (input.pricePrecision !== undefined) integer(input.pricePrecision, 'render price precision', 0, 20)
  if (input.timeZone !== undefined) timezone(input.timeZone, 'display timezone')
  // The base colour set a preset or `render.theme` picked. A workspace that set a theme must be able to save itself.
  if (input.theme !== undefined && input.theme !== 'dark' && input.theme !== 'light') throw new RangeError('Unknown render theme')
  for (const key of ['background', 'grid', 'text', 'up', 'down', 'line', 'font']) {
    if (input[key] !== undefined) text(input[key], `render ${key}`, 256)
  }
  return { ...input } as WorkspaceSavedRender
}
function layoutOf (value: unknown): EngineLayout {
  const input = object(value, ['axisGutter', 'priceScale', 'priceRatio', 'paneWeights'], [], 'layout')
  const result: EngineLayout = {}
  if (input.axisGutter !== undefined) result.axisGutter = finite(input.axisGutter, 'axis gutter')
  if (input.priceRatio !== undefined) result.priceRatio = finite(input.priceRatio, 'price ratio')
  if (input.priceScale !== undefined) {
    const scale = object(input.priceScale, ['mode', 'reversed', 'range'], [], 'price scale')
    if (scale.reversed !== undefined) flag(scale.reversed, 'reversed scale')
    if (scale.range !== undefined) {
      if (!Array.isArray(scale.range) || scale.range.length !== 2) throw new TypeError('Price range requires two raw prices')
      const low = finite(scale.range[0], 'price range minimum'), high = finite(scale.range[1], 'price range maximum')
      const span = scale.mode === 'log' ? Math.log(high) - Math.log(low) : high - low
      if (!Number.isFinite(span) || span <= 0) throw new RangeError('Price range cannot be projected')
    }
    result.priceScale = { ...scale } as PriceScaleOptions
    validatePriceScale(result.priceScale)
  }
  if (input.paneWeights !== undefined) {
    if (input.paneWeights === null || typeof input.paneWeights !== 'object' || Array.isArray(input.paneWeights)) throw new TypeError('Invalid pane weights')
    const entries = Object.entries(input.paneWeights)
    if (entries.length > WORKSPACE_DOCUMENT_LIMITS.indicators + 1) throw new RangeError('Too many pane weights')
    for (const [id, weight] of entries) { text(id, 'pane weight id', 256); finite(weight, 'pane weight') }
    result.paneWeights = Object.fromEntries(entries) as Record<string, number>
  }
  validateEngineLayout(result)
  return result
}
function indicatorsOf (value: unknown, options: WorkspaceDocumentOptions): readonly EngineIndicatorInstance[] {
  if (!Array.isArray(value) || value.length > WORKSPACE_DOCUMENT_LIMITS.indicators) throw new TypeError('Invalid workspace indicators')
  const custom = new Set(options.registeredIndicatorNames ?? [])
  for (const name of custom) text(name, 'registered indicator name')
  const ids = new Set<string>(), builtins = new EngineIndicators()
  try {
    return value.map(item => {
      const input = object(item, ['id', 'name', 'params', 'pane', 'paneId', 'visible'], ['id', 'name', 'params', 'pane', 'visible'], 'indicator')
      const id = text(input.id, 'indicator id'), name = text(input.name, 'indicator name')
      if (ids.has(id)) throw new TypeError('Duplicate indicator id')
      ids.add(id)
      if (!BUILTINS.has(name) && !custom.has(name)) throw new TypeError(`Indicator is not registered: ${name}`)
      if (!Array.isArray(input.params) || input.params.length > WORKSPACE_DOCUMENT_LIMITS.params) throw new TypeError('Invalid indicator parameters')
      const params = input.params.map(param => finite(param, 'indicator parameter'))
      if (input.pane !== 'price' && input.pane !== 'separate') throw new TypeError('Invalid indicator pane')
      const instance: EngineIndicatorInstance = {
        id,
        name,
        params,
        pane: input.pane,
        visible: flag(input.visible, 'indicator visibility'),
        ...(input.paneId === undefined ? {} : { paneId: text(input.paneId, 'indicator pane id') })
      }
      if (BUILTINS.has(name)) builtins.add(instance)
      return instance
    })
  } finally { builtins.dispose() }
}

/**
 * Parse untrusted JSON without storage, chart mutation, feed requests or custom
 * code execution. Returns detached frozen data, not a successful restoration.
 * The host must validate custom parameters through its registered definitions,
 * load the matching market, and validate data-dependent log/percentage scales
 * before replacing any live state. This schema never restores code or layers.
 */
export function parseWorkspaceDocument (json: string, options: WorkspaceDocumentOptions = {}): WorkspaceDocumentV1 {
  if (typeof json !== 'string' || json.length === 0 || json.length > WORKSPACE_DOCUMENT_LIMITS.characters) throw new TypeError('Invalid workspace document size')
  const decoded: unknown = JSON.parse(json)
  inspectJson(decoded)
  const input = object(decoded, ['version', 'symbol', 'period', 'mode', 'render', 'layout', 'indicators', 'drawings'],
    ['version', 'symbol', 'period', 'render', 'layout', 'indicators', 'drawings'], 'workspace document')
  if (input.version !== 1) throw new TypeError('Unsupported workspace document version')
  if (input.mode !== undefined && input.mode !== 'raw' && input.mode !== 'heikin-ashi') throw new TypeError('Invalid candle display mode')
  const symbol = symbolOf(input.symbol), period = periodOf(input.period), render = renderOf(input.render), layout = layoutOf(input.layout)
  const indicators = indicatorsOf(input.indicators, options)
  const drawingDocument = object(input.drawings, ['version', 'drawings'], ['version', 'drawings'], 'drawing document')
  if (!Array.isArray(drawingDocument.drawings) || drawingDocument.drawings.length > WORKSPACE_DOCUMENT_LIMITS.drawings) throw new TypeError('Invalid drawing collection')
  const store = new DrawingStore({ historyLimit: 0 })
  store.importJson(JSON.stringify(drawingDocument))
  return freezeDocument({
    version: 1,
    symbol,
    period,
    render,
    layout,
    indicators,
    ...(input.mode === undefined ? {} : { mode: input.mode }),
    drawings: { version: 1, drawings: store.getSnapshot().drawings }
  })
}
