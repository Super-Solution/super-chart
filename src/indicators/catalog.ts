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

/**
 * The indicator/drawing-tool catalogue (SC-113, SC-133): plain data the
 * picker renders from (search, categories, presets) instead of two hard-coded
 * arrays, and the same data an MCP tool schema or an AI prompt can enumerate.
 *
 * This is Super Chart's own registry, layered OVER klinecharts' (a peer
 * singleton): registering a script indicator does not, by itself, make it
 * catalogued/pickable — a host opts a script in through
 * `registerCatalogedScriptIndicator` (this module) instead of the bare
 * `registerScriptIndicator` (src/superscript/indicator.ts, owned by another
 * batch and not modified here), so a host-private registration such as
 * SupWallet StudioChart's `COMPARE` never appears in another chart's list
 * unless that chart's host opts it in too.
 *
 * Maintained by ZzyzxLabs. Part of SUPer-Chart (Apache-2.0).
 */
import { getSupportedOverlays } from 'klinecharts'
import overlays from '../extension/index'
import { registerScriptIndicator, type ScriptIndicatorOptions } from '../superscript/indicator'
import { SC_INDICATOR_NAMES } from './register'
import { INDICATOR_ALIAS_SOURCE } from './aliases'

export type IndicatorCategory = 'trend' | 'momentum' | 'volatility' | 'volume' | 'scripts' | 'other'
export type IndicatorSource = 'builtin' | 'script' | 'host'
export type IndicatorPane = 'price' | 'new'

export interface IndicatorCatalogParam {
  key: string
  label: string
  default?: number
  min?: number
  max?: number
  step?: number
  precision?: number
}

export interface IndicatorCatalogPreset {
  label: string
  calcParams: number[]
}

export interface IndicatorCatalogEntry {
  name: string
  title: string
  i18nKey?: string
  category: IndicatorCategory
  pane: IndicatorPane
  params: IndicatorCatalogParam[]
  presets?: IndicatorCatalogPreset[]
  figures?: Array<{ key: string, title: string }>
  source: IndicatorSource
  /** Whether the picker should offer it. False keeps a registration out of every chart's menu until a host opts it in. */
  listed: boolean
}

function len (key: string, label: string, def: number, min = 1): IndicatorCatalogParam {
  return { key, label, default: def, min, step: 1, precision: 0 }
}

// The 27 klinecharts built-ins, unaliased ones included (their picker rows still
// resolve to the plain built-in template; only 'RSI'/'MACD'/'SMA' get routed to an
// SC_ one — see ./aliases.ts, applied by the engine, not by this table).
const BUILTIN: IndicatorCatalogEntry[] = [
  { name: 'MA', title: 'MA', i18nKey: 'ma', category: 'trend', pane: 'price', params: [], source: 'builtin', listed: true },
  {
    name: 'EMA',
    title: 'EMA',
    i18nKey: 'ema',
    category: 'trend',
    pane: 'price',
    params: [],
    source: 'builtin',
    listed: true,
    presets: [{ label: '20/50/200', calcParams: [20, 50, 200] }] 
  },
  { name: 'SMA', title: 'SMA', i18nKey: 'sma', category: 'trend', pane: 'price', params: [], source: 'builtin', listed: true },
  { name: 'BOLL', title: 'BOLL', i18nKey: 'boll', category: 'volatility', pane: 'price', params: [], source: 'builtin', listed: true },
  { name: 'SAR', title: 'SAR', i18nKey: 'sar', category: 'trend', pane: 'price', params: [], source: 'builtin', listed: true },
  { name: 'BBI', title: 'BBI', i18nKey: 'bbi', category: 'trend', pane: 'price', params: [], source: 'builtin', listed: true },
  { name: 'AVP', title: 'AVP', category: 'volume', pane: 'price', params: [], source: 'builtin', listed: true },
  { name: 'VOL', title: 'VOL', i18nKey: 'vol', category: 'volume', pane: 'new', params: [], source: 'builtin', listed: true },
  { name: 'MACD', title: 'MACD', i18nKey: 'macd', category: 'momentum', pane: 'new', params: [], source: 'builtin', listed: true },
  { name: 'KDJ', title: 'KDJ', i18nKey: 'kdj', category: 'momentum', pane: 'new', params: [], source: 'builtin', listed: true },
  { name: 'RSI', title: 'RSI', i18nKey: 'rsi', category: 'momentum', pane: 'new', params: [], source: 'builtin', listed: true },
  { name: 'BIAS', title: 'BIAS', i18nKey: 'bias', category: 'momentum', pane: 'new', params: [], source: 'builtin', listed: true },
  { name: 'BRAR', title: 'BRAR', i18nKey: 'brar', category: 'momentum', pane: 'new', params: [], source: 'builtin', listed: true },
  { name: 'CCI', title: 'CCI', i18nKey: 'cci', category: 'momentum', pane: 'new', params: [], source: 'builtin', listed: true },
  { name: 'DMI', title: 'DMI / ADX', i18nKey: 'dmi', category: 'trend', pane: 'new', params: [], source: 'builtin', listed: true },
  { name: 'CR', title: 'CR', i18nKey: 'cr', category: 'momentum', pane: 'new', params: [], source: 'builtin', listed: true },
  { name: 'PSY', title: 'PSY', i18nKey: 'psy', category: 'momentum', pane: 'new', params: [], source: 'builtin', listed: true },
  { name: 'DMA', title: 'DMA', i18nKey: 'dma', category: 'trend', pane: 'new', params: [], source: 'builtin', listed: true },
  { name: 'TRIX', title: 'TRIX', i18nKey: 'trix', category: 'trend', pane: 'new', params: [], source: 'builtin', listed: true },
  { name: 'OBV', title: 'OBV', i18nKey: 'obv', category: 'volume', pane: 'new', params: [], source: 'builtin', listed: true },
  { name: 'VR', title: 'VR', i18nKey: 'vr', category: 'volume', pane: 'new', params: [], source: 'builtin', listed: true },
  { name: 'WR', title: 'WR', i18nKey: 'wr', category: 'momentum', pane: 'new', params: [], source: 'builtin', listed: true },
  { name: 'MTM', title: 'MTM', i18nKey: 'mtm', category: 'momentum', pane: 'new', params: [], source: 'builtin', listed: true },
  { name: 'EMV', title: 'EMV', i18nKey: 'emv', category: 'volume', pane: 'new', params: [], source: 'builtin', listed: true },
  { name: 'ROC', title: 'ROC', i18nKey: 'roc', category: 'momentum', pane: 'new', params: [], source: 'builtin', listed: true },
  { name: 'PVT', title: 'PVT', i18nKey: 'pvt', category: 'volume', pane: 'new', params: [], source: 'builtin', listed: true },
  { name: 'AO', title: 'AO', i18nKey: 'ao', category: 'momentum', pane: 'new', params: [], source: 'builtin', listed: true }
]

// The SC_ pack this batch adds (SC-155/160/167/168/169/170/171). Presets/params
// are richer here since these are the ones a settings form / MCP schema most needs.
//
// SC_RSI/SC_MACD/SC_SMA are `listed: false`: they are the replacements
// resolveIndicatorName (./aliases.ts) routes 'RSI'/'MACD'/'SMA' to, so the
// picker reaches them through THOSE rows (RSI/MACD/SMA further up this seed).
// Listing both would show the same indicator twice under two names. The
// entries stay in the catalogue (unlisted) so a settings form or an MCP tool
// can still look up their schema by the SC_ name directly.
const SC_PACK: IndicatorCatalogEntry[] = [
  {
    name: 'SC_RSI',
    title: 'RSI (Wilder)',
    category: 'momentum',
    pane: 'new',
    source: 'builtin',
    listed: false,
    params: [len('len', 'Length', 14)]
  },
  {
    name: 'SC_MACD',
    title: 'MACD',
    category: 'momentum',
    pane: 'new',
    source: 'builtin',
    listed: false,
    params: [len('fast', 'Fast', 12), len('slow', 'Slow', 26), len('signal', 'Signal', 9)]
  },
  {
    name: 'SC_SMA',
    title: 'SMA (true mean)',
    category: 'trend',
    pane: 'price',
    source: 'builtin',
    listed: false,
    params: [len('len', 'Length', 9)]
  },
  {
    name: 'SC_VWAP',
    title: 'VWAP (anchored)',
    category: 'volume',
    pane: 'price',
    source: 'builtin',
    listed: true,
    params: [{ key: 'anchor', label: 'Anchor', default: 0, min: 0, max: 4, step: 1, precision: 0 }] 
  },
  {
    name: 'SC_ATR',
    title: 'ATR',
    category: 'volatility',
    pane: 'new',
    source: 'builtin',
    listed: true,
    params: [len('len', 'Length', 14)] 
  },
  {
    name: 'SC_STOCH',
    title: 'Stochastic',
    category: 'momentum',
    pane: 'new',
    source: 'builtin',
    listed: true,
    params: [len('len', '%K Length', 14), len('smoothK', '%K Smoothing', 1), len('dLen', '%D Smoothing', 3)] 
  },
  {
    name: 'SC_STOCHRSI',
    title: 'Stochastic RSI',
    category: 'momentum',
    pane: 'new',
    source: 'builtin',
    listed: true,
    params: [len('rsiLen', 'RSI Length', 14), len('stochLen', 'Stochastic Length', 14), len('kLen', 'K', 3), len('dLen', 'D', 3)] 
  },
  {
    name: 'SC_BBP',
    title: 'Bollinger %B',
    category: 'volatility',
    pane: 'new',
    source: 'builtin',
    listed: true,
    params: [len('len', 'Length', 20), { key: 'mult', label: 'StdDev', default: 2, min: 0.1, step: 0.1, precision: 1 }] 
  },
  {
    name: 'SC_MFI',
    title: 'Money Flow Index',
    category: 'volume',
    pane: 'new',
    source: 'builtin',
    listed: true,
    params: [len('len', 'Length', 14)] 
  },
  {
    name: 'SC_SUPERTREND',
    title: 'SuperTrend',
    category: 'trend',
    pane: 'price',
    source: 'builtin',
    listed: true,
    params: [len('len', 'ATR Length', 10), { key: 'factor', label: 'Factor', default: 3, min: 0.1, step: 0.1, precision: 1 }] 
  },
  {
    name: 'SC_KELTNER',
    title: 'Keltner Channels',
    category: 'volatility',
    pane: 'price',
    source: 'builtin',
    listed: true,
    params: [len('len', 'Length', 20), { key: 'mult', label: 'Multiplier', default: 2, min: 0.1, step: 0.1, precision: 1 }, len('atrLen', 'ATR Length', 10)] 
  },
  {
    name: 'SC_DONCHIAN',
    title: 'Donchian Channels',
    category: 'volatility',
    pane: 'price',
    source: 'builtin',
    listed: true,
    params: [len('len', 'Length', 20)] 
  },
  {
    name: 'SC_ATR_BANDS',
    title: 'ATR Bands',
    category: 'volatility',
    pane: 'price',
    source: 'builtin',
    listed: true,
    params: [len('len', 'Length', 14), { key: 'mult', label: 'Multiplier', default: 2, min: 0.1, step: 0.1, precision: 1 }] 
  },
  {
    name: 'SC_ICHIMOKU',
    title: 'Ichimoku Cloud',
    category: 'trend',
    pane: 'price',
    source: 'builtin',
    listed: true,
    params: [len('conversion', 'Conversion', 9), len('base', 'Base', 26), len('spanB', 'Span B', 52), len('displacement', 'Displacement', 26)] 
  },
  {
    name: 'SC_VRVP',
    title: 'Visible Range Volume Profile',
    category: 'volume',
    pane: 'price',
    source: 'builtin',
    listed: true,
    params: [len('rows', 'Rows', 24)]
  },
  {
    name: 'SC_ORDER_BLOCKS',
    title: 'Order Blocks (SMC)',
    category: 'other',
    pane: 'price',
    source: 'builtin',
    listed: true,
    params: [
      len('swingLookback', 'Swing Lookback', 10),
      len('lookahead', 'Lookahead', 3),
      { key: 'displacementFactor', label: 'Displacement', default: 1.5, min: 0.1, step: 0.1, precision: 1 }
    ]
  },
  {
    name: 'SC_FVG',
    title: 'Fair Value Gaps (SMC)',
    category: 'other',
    pane: 'price',
    source: 'builtin',
    listed: true,
    params: []
  },
  {
    name: 'SC_PDHL',
    title: 'Previous Day/Week High-Low',
    category: 'other',
    pane: 'price',
    source: 'builtin',
    listed: true,
    params: [{ key: 'period', label: 'Period', default: 0, min: 0, max: 1, step: 1, precision: 0 }]
  }
]

const SEED: IndicatorCatalogEntry[] = [...BUILTIN, ...SC_PACK]

let entries = new Map<string, IndicatorCatalogEntry>(SEED.map(e => [e.name, e]))

/** A copy of the current catalogue, in seed order followed by anything added later. */
export function getIndicatorCatalog (): IndicatorCatalogEntry[] {
  return Array.from(entries.values()).map(e => ({ ...e, params: e.params.map(p => ({ ...p })), presets: e.presets?.map(p => ({ ...p })) }))
}

/** Add or replace entries by name, keeping everything else. */
export function addIndicatorCatalogEntries (add: readonly IndicatorCatalogEntry[]): void {
  for (const e of add) entries.set(e.name, e)
}

/** Replace the whole catalogue (a host that wants to curate its own list from scratch). */
export function setIndicatorCatalog (list: readonly IndicatorCatalogEntry[]): void {
  entries = new Map(list.map(e => [e.name, e]))
}

/** Test-only: restore the built-in seed (SC_ pack + klinecharts' 27), undoing addIndicatorCatalogEntries/setIndicatorCatalog. */
export function resetIndicatorCatalog (): void {
  entries = new Map(SEED.map(e => [e.name, e]))
}

/** The catalogue entry the picker should show for a plain name — the SC_ one when `name` is aliased, else the entry itself. */
export function catalogEntryFor (name: string): IndicatorCatalogEntry | undefined {
  return entries.get(name)
}

/** True when `name` is one of this pack's SC_ replacement templates (used to hide the redundant plain-name row once its SC_ one is listed). */
export function isScReplacement (name: string): boolean {
  return name in INDICATOR_ALIAS_SOURCE
}

export { SC_INDICATOR_NAMES }

/**
 * Register a script indicator AND add it to the catalogue in one call — the
 * opt-in `registerScriptIndicator` needs to make a script pickable (SC-133).
 * A plain `registerScriptIndicator` call (src/superscript/indicator.ts,
 * unchanged by this batch) still registers the indicator on klinecharts, it
 * just stays unlisted until a host does this, or calls
 * `addIndicatorCatalogEntries` itself.
 */
export function registerCatalogedScriptIndicator (
  options: ScriptIndicatorOptions,
  meta: { title?: string, category?: IndicatorCategory, pane?: IndicatorPane, params?: IndicatorCatalogParam[] } = {},
  // Injectable for tests: klinecharts' real registerIndicator/getSupportedIndicators
  // (which this calls through to) need a browser ESM host, so a unit test passes
  // a fake registrar instead of the real one.
  register: (o: ScriptIndicatorOptions) => string = registerScriptIndicator
): string {
  const name = register(options)
  addIndicatorCatalogEntries([{
    name,
    title: meta.title ?? name,
    category: meta.category ?? 'scripts',
    pane: meta.pane ?? 'new',
    params: meta.params ?? [],
    source: 'script',
    listed: true
  }])
  return name
}

// --------------------------------------------------------------------------
// Drawing-tool catalogue (SC-133): read-only over the extension's own list
// plus klinecharts' built-in overlay names, minus the non-tool entries
// (priceLine/simpleAnnotation/simpleTag) the finding calls out. Never edits
// src/widget/drawing-bar (owned by another batch).
// --------------------------------------------------------------------------

export interface DrawingToolCatalogEntry {
  name: string
  group: 'extension' | 'builtin'
  /** Point count, when known (the extension's own tools declare `totalStep`; klinecharts' built-ins do not expose it through a stable API). */
  pointsRequired?: number
}

const NOT_A_TOOL = new Set(['priceLine', 'simpleAnnotation', 'simpleTag'])

let getDrawingToolCatalogCache: DrawingToolCatalogEntry[] | null = null

/**
 * Every drawing tool the rail can place: this package's own overlays, plus
 * klinecharts' built-ins, minus figures that are not tools.
 *
 * `builtinOverlayNames` is injectable for tests (klinecharts' real
 * getSupportedOverlays() needs a browser ESM host); production callers pass
 * nothing and get the real registry.
 */
export function getDrawingToolCatalog (builtinOverlayNames: readonly string[] = getSupportedOverlays()): DrawingToolCatalogEntry[] {
  if (getDrawingToolCatalogCache !== null) return getDrawingToolCatalogCache.map(e => ({ ...e }))
  const own = new Map(overlays.map(o => [o.name, { name: o.name, group: 'extension' as const, pointsRequired: o.totalStep !== undefined ? o.totalStep - 1 : undefined }]))
  const builtinNames = builtinOverlayNames.filter(n => !own.has(n) && !NOT_A_TOOL.has(n))
  const list = [...own.values(), ...builtinNames.map(n => ({ name: n, group: 'builtin' as const, pointsRequired: undefined }))]
  getDrawingToolCatalogCache = list
  return list.map(e => ({ ...e }))
}
