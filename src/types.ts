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

import { type KLineData, type Styles, type DeepPartial, type Chart, type Nullable, type OverlayCreate } from 'klinecharts'
import type { SymbolInfo, Period, Datafeed, Timespan } from './core/feed'
import type { IndicatorCatalogEntry, DrawingToolCatalogEntry } from './indicators/catalog'

import type { ChartContext, ChartContextOptions } from './ai'
import type { ChartErrorJSON } from './api/errors'
import type { SuperChartEventMap, SuperChartEventType } from './api/events'
import type { ChartStateV1, LoadState } from './api/state'
import type { HistoryCacheOptions } from './data/historyCache'
import type { NumberUnits } from './i18n/numbers'
import type { DrawingRecord, HostOverlayOptions } from './drawing-editor/controller'
import type { StyleChange, StyleRecord } from './drawing-editor/styles'
import type { AnnotationSpec, SetAnnotationsResult } from './api/annotations'
import type { AddDrawingSpec, DrawingCrossEvent, DrawingLevel, UpdateDrawingChanges } from './api/drawings'
import type { ApplyLayoutOptions, ApplyLayoutResult, ChartLayoutV1 } from './api/layout'
import type { ExecuteRequest, ExecuteResult, ToToolDefinitionsOptions, ToolDefinition } from './commands/bind'
import type { CommandDescriptor } from './commands/schema'

export type { NumberUnits }
export type { DrawingRecord, HostOverlayOptions } from './drawing-editor/controller'
export type { AnnotationAnchor, AnnotationKind, AnnotationRejectCode, AnnotationRejection, AnnotationSpec, AnnotationTone, SetAnnotationsResult } from './api/annotations'
export type { AddDrawingSpec, DrawingCrossEvent, DrawingLevel, DrawingTimePoint, UpdateDrawingChanges } from './api/drawings'
export type { ApplyLayoutOptions, ApplyLayoutResult, ChartLayoutV1, LayoutIndicatorEntry } from './api/layout'
export type { ExecuteRequest, ExecuteResult, ToToolDefinitionsOptions, ToolDefinition } from './commands/bind'
export type { CommandDescriptor, JSONSchema, JSONSchemaType } from './commands/schema'

/** The themes the chrome CSS and klinecharts' built-in styles support. */
export const THEMES = ['light', 'dark'] as const
export type Theme = typeof THEMES[number]

/**
 * Chart types: klinecharts' own candle types, plus SC-NEXT's #2 additions —
 * 'heikin_ashi' (a data transform, src/data/heikinAshi.ts), 'line_markers'
 * (the area type plus per-point circles) and six types with no klinecharts
 * equivalent at all (src/charttypes/customSeriesOverlay.ts draws them: an
 * overlay on top of a transparent candle so the price axis still auto-scales
 * from the real high/low). Additive: every pre-existing value keeps its exact
 * old meaning and rendering.
 */
export const CHART_TYPES = [
  'candle_solid', 'candle_stroke', 'candle_up_stroke', 'candle_down_stroke', 'heikin_ashi',
  'ohlc', 'volume_bars', 'columns', 'high_low',
  'line', 'line_markers', 'step_line',
  'area', 'hlc_area', 'baseline'
] as const
export type ChartType = typeof CHART_TYPES[number]

/** Locales with built-in chrome strings. `registerLocale` adds others, so Locale stays open. */
export const BUILTIN_LOCALES = ['en-US', 'zh-CN', 'zh-TW'] as const
// `(string & {})` keeps autocomplete for the literals while accepting any string.
// eslint-disable-next-line @typescript-eslint/ban-types
export type Locale = typeof BUILTIN_LOCALES[number] | (string & {})

/** klinecharts' built-in indicators (what the indicator picker offers). Open:
 *  hosts register their own with `registerIndicator`/`registerScriptIndicator`. */
export type IndicatorName =
  | 'MA' | 'EMA' | 'SMA' | 'BBI' | 'BOLL' | 'SAR' | 'VOL' | 'MACD' | 'KDJ' | 'RSI' | 'BIAS' | 'BRAR'
  | 'CCI' | 'DMI' | 'CR' | 'PSY' | 'DMA' | 'TRIX' | 'OBV' | 'VR' | 'WR' | 'MTM' | 'EMV' | 'ROC'
  | 'PVT' | 'AO' | 'AVP'
  // eslint-disable-next-line @typescript-eslint/ban-types
  | (string & {})

export type { Timespan } from './core/feed'

/**
 * Controls of the chrome a host can remove one by one (SC-126). Every flag
 * defaults to true, and with every flag true the chrome is what it always
 * was. `toolbar: false` removes the whole top bar, like `headless`.
 * `railToggle` is the top bar's button that shows and hides the drawing rail.
 */
export const CHART_PARTS = [
  'toolbar', 'railToggle', 'symbol', 'periods', 'chartType', 'indicators', 'replay', 'timezone', 'settings', 'screenshot', 'fullscreen'
] as const
export type ChartPart = typeof CHART_PARTS[number]
export type ChartParts = Record<ChartPart, boolean>

/**
 * How the chrome fits its width (SC-085). 'auto' (default): the least
 * compact size class whose top bar fits. 'regular': labelled tools.
 * 'compact': icon-only tools. 'narrow': icon-only tools, the periods in one
 * dropdown and the drawing rail collapsed until opened. In every class, tools
 * that still do not fit move into the top bar's More menu.
 */
export const LAYOUT_MODES = ['auto', 'regular', 'compact', 'narrow'] as const
export type LayoutMode = typeof LAYOUT_MODES[number]
export type SizeClass = Exclude<LayoutMode, 'auto'>

/**
 * Full screen (SC-081). 'auto' (default): the browser's full screen, else
 * the chart maximised inside the page (iPhone Safari, an iframe without
 * allow="fullscreen", a call without a user gesture). 'native': the browser's
 * only. 'pseudo': always inside the page. false: none, and no button.
 */
export type FullscreenOption = 'auto' | 'native' | 'pseudo' | false
export type FullscreenMode = 'native' | 'pseudo'
export interface FullscreenChange {
  /** The current mode, or null when the chart left full screen. */
  mode: FullscreenMode | null
}

/** True for a value in THEMES. For callers that pass JSON (agents, MCP tools). */
export function isTheme (value: unknown): value is Theme {
  return (THEMES as readonly unknown[]).includes(value)
}

/** True for a value in CHART_TYPES. */
export function isChartType (value: unknown): value is ChartType {
  return (CHART_TYPES as readonly unknown[]).includes(value)
}

/** True for a value in LAYOUT_MODES. */
export function isLayoutMode (value: unknown): value is LayoutMode {
  return (LAYOUT_MODES as readonly unknown[]).includes(value)
}

export type { SymbolInfo, Period, DatafeedSubscribeCallback, HistoryRequest, HistoryResult, SearchRequest, Datafeed } from './core/feed'

/**
 * What a load (setSymbol, setPeriod, setView, reload) came to. The promise
 * never rejects, so ignoring it is safe.
 * - loaded: the pair's bars are in the chart (getBars() returns them; the
 *   canvas paints on the next animation frame). `stale`: the datafeed
 *   answered with nothing and the chart kept the cached bars it had painted.
 * - unchanged: the call changed nothing that is fetched (same symbol and
 *   period, or only a display field such as the name).
 * - superseded: a later change started another load before this one landed;
 *   `by` is that pair (its own promise says how it ended).
 * - error: the datafeed rejected, or did not answer in time.
 * - invalid: the input was refused (v1 calls warn and resolve with this; v2
 *   calls with `{ strict: true }` throw the ChartError instead).
 * - disposed: the chart was disposed first.
 */
export type LoadResult =
  | { status: 'loaded', symbol: SymbolInfo, period: Period, bars: number, stale?: boolean }
  | { status: 'unchanged', symbol: SymbolInfo, period: Period }
  | { status: 'superseded', by: { symbol: SymbolInfo, period: Period } }
  | { status: 'error', symbol: SymbolInfo, period: Period, message: string, timeout: boolean }
  | { status: 'invalid', error: ChartErrorJSON }
  | { status: 'disposed' }

/** getBars()'s options. */
export interface GetBarsOptions {
  /** The newest `limit` bars only (default: every loaded bar). */
  limit?: number
}

/**
 * The chart's own empty and error states. true (default): "No data" and an
 * error banner with Retry. false: neither (hosts with their own status line).
 * An object: the same, with these labels.
 */
export type DataStatesOption = boolean | { empty?: string, error?: string }

/** Which theme a style layer is for (see ChartProOptions.themeStyles and ChartPro.setStyles). */
export interface SetStylesOptions {
  /** Keep these styles for this theme only: applied now if it is the current
   *  theme, and again every time the chart switches to it. */
  theme?: Theme
}

/** The price axis's scale (SC-116). */
export type PriceScaleType = 'normal' | 'percentage' | 'log'
export interface PriceScale {
  type: PriceScaleType
  reverse: boolean
}

/** Vertical wheel over the chart. @default 'zoom' — see ChartProOptions.wheel (SC-097). */
export type WheelOption = 'zoom' | 'modifier' | 'none'

/** How the sub-panes and the candle pane share the chart's height. @default 'auto' (SC-159). */
export type PaneLayoutOption = 'auto' | 'fixed'

export interface SnapshotOptions {
  /** @default 'png' */
  format?: 'png' | 'jpeg' | 'webp'
  /** For 'jpeg'/'webp', 0-1. */
  quality?: number
  /** @default 'auto': the chrome's own resolved background (honours a host's
   *  CSS override), falling back to the current theme's default. */
  background?: 'auto' | 'transparent' | string
  /** Composite without the user's current crosshair/hover state. @default true */
  hideCrosshair?: boolean
}

export interface SnapshotResult {
  dataUrl: string
  mime: string
  width: number
  height: number
  /** The device pixel ratio the image was composed at (reported, not chosen — klinecharts always uses the live devicePixelRatio). */
  pixelRatio: number
  symbol: SymbolInfo
  period: Period
  timezone: string
  theme: Theme
  visibleRange: { from: number, to: number, realFrom: number, realTo: number }
}

/** `chartPro.replay`'s state (SC-067). */
export interface ReplayState {
  active: boolean
  /** Index of the bar replay is showing, or -1 when replay is not active. */
  index: number
  /** That bar's timestamp, or null when replay is not active. */
  timestamp: number | null
  playing: boolean
  /** Multiplier over the base step interval (1 = normal speed). */
  speed: number
}

export interface ReplayStartOptions {
  /** A data index to start at (overrides `timestamp` when both are given). */
  index?: number
  /** The bar at or immediately before this timestamp. */
  timestamp?: number
}

/** The chart's bar-replay controls (SC-067), at `chartPro.replay`. */
export interface ReplayControls {
  /** Starts (or restarts) replay. Defaults to 60% of the way into the current data, matching the chart's long-standing default. False when there is nothing to replay (too little data, or no chart yet). */
  start (options?: ReplayStartOptions): boolean
  /** Moves the replay head `n` bars (default 1); negative steps back. No-op outside replay. */
  step (n?: number): void
  /** Starts (or resumes) auto-play. `speed` is a multiplier over the base step interval. No-op outside replay or already at the newest bar. */
  play (options?: { speed?: number }): void
  pause (): void
  /** Ends replay and shows every bar, including what arrived while it ran. */
  exit (): void
  getState (): ReplayState
}

export type SymbolSearchRecent = string[] | 'session' | { persistKey: string, max?: number }

/** The symbol-search modal's recent/favourite list (SC-111). No storage unless the host opts in with a `persistKey` (or a raw ticker array it manages itself). */
export interface SymbolSearchOption {
  recent?: SymbolSearchRecent
  favorites?: string[]
  onFavoritesChange?: (tickers: string[]) => void
}

export interface ChartProOptions {
  /** Hold the primary pointer still for 333 ms, then draw one stroke. Quick drags keep panning.
   * Recognized drawings are editable/undoable; Tab cycles alternatives and Escape removes the latest result.
   * Disabled by default. `guide: false` hides the help button; state is scoped to this instance. */
  drawByHolding?: boolean | { delayMs?: number, guide?: boolean }
  /** An element, or an element id (no '#'). */
  container: string | HTMLElement
  /** klinecharts styles over the engine's theme. They are kept: every
   *  setTheme applies the new theme and then these again, so they survive a
   *  theme switch. A `candle.type` here is not kept as a style: it is the
   *  initial chart type when `chartType` is not given. */
  styles?: DeepPartial<Styles>
  /** Styles for one theme only, applied over `styles` whenever that theme is
   *  current (e.g. a grid colour per theme). */
  themeStyles?: Partial<Record<Theme, DeepPartial<Styles>>>
  /** The engine paints the canvas from its own palette and the chrome's CSS
   *  custom properties (grid, axes, candles, crosshair, legend icons, drawing
   *  defaults). `false` keeps klinecharts' built-in light/dark look instead.
   *  @default true */
  canvasTheme?: boolean
  /** Font family (a CSS font-family list) for every text on the canvas.
   *  Default: the `--sc-font-numeric` custom property on the chart element if
   *  set, else "Helvetica Neue", "Segoe UI", Roboto, Arial, "Noto Sans",
   *  sans-serif (tabular digits, no serif fallback). A web font is redrawn
   *  once it has loaded. Read once, when the chart mounts: refreshTheme()
   *  does not re-read `--sc-font-numeric`. */
  canvasFont?: string
  /** Watermark in the price pane. Default: none. A string is shown as text
   *  (never parsed as HTML); pass a Node, or a function returning one (called
   *  once per chart), for markup. A Node that is already attached anywhere
   *  (the page, another chart) is deep-cloned, which drops its event listeners;
   *  pass a detached Node or a function to keep a live element. */
  watermark?: string | Node | (() => Node)
  /**
   * SC-NEXT #4: lets a host (e.g. ProjectX, SupWallet) render its own symbol
   * selector/header inside the top bar instead of the built-in symbol
   * button, which is hidden automatically while this is set. Same Node
   * semantics as `watermark` (a Node already attached elsewhere is
   * deep-cloned, dropping its listeners — pass a detached Node or a factory
   * to keep a live, interactive element), minus the plain-string form: a
   * header slot is for a selector, not a label. @default none
   */
  headerSlot?: Node | (() => Node) | null
  /** @default 'light'. An unknown value is ignored with a console warning. */
  theme?: Theme
  /**
   * A BCP-47 tag (e.g. 'zh-Hant', 'en-GB'), resolved to a supported locale the
   * same way at every entry point (this option, `setLocale`, and the
   * negotiated default below) — never passed through raw, so the chrome
   * never shows raw keys. Traditional Chinese (zh-TW, zh-HK, zh-MO, zh-Hant-*)
   * resolves to zh-TW, other Chinese to zh-CN, any English to en-US, and a
   * `registerLocale`d tag is kept exactly.
   * @default the first of the viewer's languages (`navigator.languages`) that
   * resolves to a supported locale, else 'en-US'.
   */
  locale?: Locale
  /**
   * 'western' (the default) writes K/M/B in every locale, the TradingView
   * convention. 'locale' uses the chart locale's own compact units — 万/亿 for
   * zh-CN, 萬/億 for zh-TW — for prices and volumes at or above 1000; any other
   * locale still falls back to 'western'.
   * @default 'western'
   */
  numberUnits?: NumberUnits
  /** Overrides the chart's own accessible name (built from the symbol, period
   *  and chart type, and kept in sync with them). Localize it yourself if you
   *  set it. */
  ariaLabel?: string
  /** Overrides the chart's own accessible description (a short summary: last
   *  price, change over the visible bars, high/low, timezone, indicators). */
  ariaDescription?: string
  /** @default true */
  drawingBarVisible?: boolean
  /** Show the floating toolbar that edits a drawing when it is selected
   *  (colour, width, style, lock, delete, clone, order, hide) and enable the
   *  Delete / Backspace / Escape shortcuts for it. Default true. Only drawings
   *  made from the drawing bar are editable; overlays the host creates through
   *  `getChart()` never are. */
  drawingToolbar?: boolean
  /** Headless / embedded mode: render only the chart canvas (no period/symbol
   *  toolbar). For hosts that supply their own chrome and drive the chart through
   *  `getChart()`. Combine with `drawingBarVisible: false` to hide the draw rail. */
  headless?: boolean
  /** Remove single controls of the chrome, e.g. `{ symbol: false }` for a
   *  host with its own symbol picker. Every flag defaults to true; change them
   *  later with setParts(). */
  parts?: Partial<ChartParts>
  /** How the chrome fits its width. @default 'auto' */
  layout?: LayoutMode
  /** @default 'auto' */
  fullscreen?: FullscreenOption
  /** Called when the chart enters or leaves full screen, whatever caused it
   *  (its button, the API, Escape, the browser). */
  onFullscreenChange?: (change: FullscreenChange) => void
  /** Initial chart type — 'candle_solid' | 'candle_up_stroke' (hollow) | 'ohlc'
   *  (bars) | 'line' | 'area'. Switchable at runtime from the top bar.
   *  @default 'candle_solid'. An unknown value is ignored with a console warning. */
  chartType?: ChartType
  symbol: SymbolInfo
  period: Period
  /** @default 1m 5m 15m 1H 2H 4H D W M Y */
  periods?: Period[]
  /** An IANA zone (e.g. 'America/New_York'), never a UI sentinel.
   *  @default the viewer's own zone (`Intl.DateTimeFormat().resolvedOptions().timeZone`), else 'Etc/UTC'. */
  timezone?: string
  /** A bare chart shows no overlay indicator by default; add your own (e.g. ['MA']).
   *  @default [] */
  mainIndicators?: IndicatorName[]
  /** @default ['VOL'] */
  subIndicators?: IndicatorName[]
  datafeed: Datafeed
  /** The chart's empty and error states. @default true */
  dataStates?: DataStatesOption
  /**
   * Live bars are applied once per animation frame. A value above 0 applies
   * them at most once per that many ms instead, which adds up to that much
   * latency. @default 0
   */
  tickThrottleMs?: number
  /**
   * Follow the container's own size with a ResizeObserver (a split pane, a
   * sidebar, any layout change that is not a window resize). `false`: only
   * the window 'resize' event (and `resize()`) resize the chart, as before
   * this option existed. @default true
   */
  autoResize?: boolean
  /**
   * A per-instance cache of the bars last shown for a (symbol, period), so
   * revisiting one (1H -> 4H -> 1H) paints at once while the datafeed is
   * still asked (its answer is merged in, never skipped). `false`: no cache.
   * @default { max: 8, ttlMs: 600000 }
   */
  historyCache?: HistoryCacheOptions | false
  /**
   * Filters the indicator picker's rows (SC-113/SC-133). A function receives
   * each catalogue entry (see getIndicatorCatalog()); an array of names keeps
   * only those. Undefined shows every catalogued (listed) entry, including
   * any host has added with addIndicatorCatalogEntries/registerCatalogedScriptIndicator.
   * Never affects what a host can create through getChart() or the v2 API.
   */
  indicatorMenu?: IndicatorMenuOption
  /**
   * Vertical wheel over the chart (main pane, any y-axis, the x-axis) —
   * SC-097. 'zoom' (default): always zooms, so the axes are never a dead
   * zone. 'modifier': zooms only with Ctrl/Cmd held (trackpad pinch sends
   * this); otherwise the event is released for the page to scroll. 'none':
   * never zooms; the page always scrolls. Horizontal (trackpad) scroll is
   * never affected. @default 'zoom'
   */
  wheel?: WheelOption
  /** A countdown to the next bar close, under the last-price tag (SC-052). @default true */
  barCountdown?: boolean
  /**
   * SC-NEXT #1: a mouse-wheel notch eases in, and a drag/flick keeps
   * panning with deceleration after release (inertia, mouse and pen; touch
   * keeps klinecharts' own fling). Every animation this option covers is
   * skipped under `prefers-reduced-motion: reduce` regardless of its value —
   * `motion: true` never overrides that signal. `false`: a notch lands in one
   * frame and a drag stops dead on release. Either way zoom is anchored on
   * the bar under the cursor and follows the wheel's actual distance
   * (trackpad and pinch included), and every canvas layer repaints in one
   * frame with the chart's motion.
   * @default true
   */
  motion?: boolean
  /** Visible-range High/Low tags on the price axis (SC-NEXT #3). @default true */
  highLowTags?: boolean
  /** A UTC/local clock toggle, bottom right of the chart (SC-NEXT #3). @default true */
  clock?: boolean
  /**
   * How sub-panes share height with the candle pane (SC-159). 'auto'
   * (default): the candle pane keeps at least ~55% of the chart, shrinking
   * sub-panes (never below a usable minimum, then collapsing the newest ones
   * to a legend-only strip) rather than letting it disappear. 'fixed':
   * klinecharts' own behaviour (a fixed height per sub-pane, no floor).
   * @default 'auto'
   */
  paneLayout?: PaneLayoutOption
  /** The %/log/invert/auto-fit corner over the price axis (SC-116, SC-098). @default true */
  priceScaleControls?: boolean
  /** Called when the price axis scale changes, from the corner controls, Settings, or `setPriceScale`. */
  onPriceScaleChange?: (scale: PriceScale) => void
  /** The floating "scroll to latest" ("»") button once the view has scrolled away from the newest bar (SC-098). @default true */
  scrollToLatestButton?: boolean
  /**
   * Keyboard shortcuts scoped to this chart (arrow-key pan/zoom, Home/End,
   * Alt+R reset — SC-096; typing a letter opens symbol search — SC-110).
   * `{ symbolSearch: false }` keeps navigation but not the letter shortcut,
   * e.g. for a host with its own type-ahead. @default true, false when `headless`.
   */
  keyboardShortcuts?: boolean | { symbolSearch?: boolean }
  /**
   * Let a host own symbol search instead of the built-in modal (SC-110):
   * called with the typed query (from a letter keystroke) or '' (from the
   * symbol button / `openSymbolSearch()`). Return true to say the host
   * handled it — the built-in modal is skipped; false or nothing falls back
   * to it.
   */
  onSymbolSearchRequest?: (query: string) => boolean | undefined
  /** Recent and favourite symbols in the search modal (SC-111). No storage unless `recent` has a `persistKey`. */
  symbolSearch?: SymbolSearchOption
  /**
   * Let a typed or picked interval outside the configured `periods` reach
   * the datafeed (SC-112): `true` allows any interval `parsePeriod` can
   * read; a predicate decides per period. Off by default — implementing
   * `datafeed.resolvePeriod` is itself an opt-in, so this only needs setting
   * when the datafeed has no such method but should still accept the
   * interval as given.
   */
  customPeriods?: boolean | ((period: Pick<Period, 'multiplier' | 'timespan'>) => boolean)
  /** Called when replay starts, steps, plays, pauses or exits. */
  onReplayChange?: (state: ReplayState) => void
  /**
   * The drawing rail's own state (SC-118): which tool each group starts on,
   * and whether the rail's tool / lock / magnet choices persist across
   * reloads (one namespaced localStorage key; wrapped so a blocked or
   * throwing storage never breaks the rail). Persistence is on by default;
   * an unknown stored tool name falls back to the group's default rather
   * than breaking the rail.
   */
  drawingBar?: DrawingBarOption
  /**
   * Scope for the drawing hotkeys (Alt+T Trend Line, Alt+H/J/V horizontal /
   * horizontal-ray / vertical line, Alt+F Fibonacci, Alt+Shift+R rectangle;
   * SC-095). `'focus'` arms a tool only while this chart last had focus or
   * was pressed, so a second chart on the page and host inputs keep their
   * own keys; `false` disables them (e.g. an embedded, read-only chart).
   * @default drawingBarVisible ? 'focus' : false
   */
  hotkeys?: 'focus' | false
  /**
   * Shift+click on the chart drops (or, on a finished one, removes) an
   * ephemeral price+date measurement outside the drawing group: never
   * selected, never listed by the rail's remove-all, and not undoable
   * (SC-125). @default true
   */
  quickMeasure?: boolean
  /** Called whenever canUndo()/canRedo() may have changed. */
  onHistoryChange?: () => void
  /** Called (debounced) whenever a tracked drawing is created, changed, reordered or removed — never for a host overlay. */
  onDrawingsChange?: () => void
  /** Called whenever a tool's remembered style (setDrawingDefaults, or drawing then restyling) changes. */
  onDrawingDefaultsChange?: () => void
  /** The key drawings are saved and restored under on a symbol change (SC-120). @default the ticker */
  drawingsKey?: (symbol: SymbolInfo) => string
  /** The object tree's trigger + panel. @default true */
  objectTree?: boolean
  /**
   * The opt-in command palette (SC-123): a Ctrl/Cmd+K list of the command
   * registry (see `execute`/`getCommands`), searchable and runnable. Off by
   * default, in line with the adopted "AI hooks but no AI panel" default —
   * this is a developer/power-user launcher over the same commands an
   * agent/MCP caller drives, not an AI panel. It opens only while this chart
   * owns the key (the shared hotkey-focus rule every other shortcut here
   * follows), so a host's own Cmd/Ctrl+K and the browser's are never
   * hijacked when the chart is not the interaction target.
   * @default false
   */
  commandPalette?: boolean | { hotkey?: { key?: string } }
  /**
   * Called (debounced) whenever getLayout()'s inputs change: a picker
   * indicator add/remove/param change, a drawing create/restyle/lock/hide/
   * reorder/move, or a chart-type/timezone/settings change. Read/write pair
   * for `getLayout()`/`applyLayout()` (SC-121).
   */
  onLayoutChange?: () => void
  /**
   * Opt-in, persisted layout (SC-121): a namespaced localStorage key under
   * which the chart automatically saves (debounced, on `onLayoutChange`) and,
   * once on mount, restores its own layout — the SAME scoping
   * `getLayout()`/`applyLayout()` use (engine-owned indicators + the current
   * symbol's drawings + chart type/timezone; never a host's own indicators
   * or overlays). Off by default, so an existing host sees no behaviour
   * change until it opts in. Reads/writes are wrapped in try/catch (private
   * mode, a full quota) and never throw.
   */
  layoutPersistKey?: string
}

/** SC-118: the drawing rail's initial tools and its persistence. Additive. */
export interface DrawingBarOption {
  /** Initial tool per group (e.g. `{ singleLine: 'horizontalStraightLine' }`), overriding the built-in defaults and (when persistence is on) a stored choice. Unknown group keys are ignored. */
  tools?: Record<string, string>
  /** `true` (default): persist to `localStorage` under a namespaced key. `false`: never read or write storage — for a host that keeps its own preferences and supplies them via `tools`. An object picks the storage key. */
  persist?: boolean | { key: string }
}

export type IndicatorMenuOption = string[] | ((entry: IndicatorCatalogEntry) => boolean)

/** A specific indicator instance on the chart: which pane, and its plain name. */
export interface IndicatorHandle {
  paneId: string
  name: string
}

/** What getIndicators() reports for one instance, read straight from the chart (never a shadow list — SC-114). */
export interface IndicatorSnapshot extends IndicatorHandle {
  calcParams: unknown[]
  visible: boolean
  /** 'engine' for anything created through mainIndicators/subIndicators, the picker or the v2 API; 'host' for anything else (getChart().createIndicator, an agent, another library). Host-owned indicators are reported, never edited or removed, unless the host itself calls the v2 API on them. */
  owner: 'engine' | 'host'
}

export interface AddIndicatorOptions {
  /** 'main' = the candle pane, 'new' = its own pane (default for anything not on the price scale), or an existing paneId. */
  pane?: 'main' | 'new' | string
  calcParams?: unknown[]
  /** New pane height in px (ignored for 'main' or an existing paneId). */
  height?: number
}

export interface IndicatorChangeEvent extends IndicatorHandle {
  type: 'added' | 'removed' | 'updated'
  /** 'user' for a picker/tooltip-icon action, 'api' for a v2 call. */
  source: 'user' | 'api'
}

export interface ChartPro {
  setTheme: (theme: Theme) => void
  getTheme: () => Theme
  /** Merge klinecharts styles now and keep them over the engine's theme, so
   *  they survive setTheme. With `{ theme }` they apply to that theme only.
   *  Per-theme styles and Settings changes stay on top of them, now and after
   *  a theme switch. A `candle.type` switches the chart type (as the top bar
   *  does) instead of being kept; with `{ theme }` it is ignored. */
  setStyles(styles: DeepPartial<Styles>, options?: SetStylesOptions): void
  getStyles(): Styles
  setLocale(locale: Locale): void
  getLocale(): Locale
  /** void, and never throws: an id Intl rejects ('UTC+8', a typo) is ignored
   *  with a console warning, keeping the current zone. Accepts any IANA id
   *  (any case; common aliases such as 'UTC' resolve to the picker's own
   *  zone), or 'local' for the viewer's own zone. */
  setTimezone(timezone: string): void
  /** The zone actually in use (what the chart runs and the picker shows),
   *  never a rejected argument echoed back. */
  getTimezone(): string
  /**
   * A symbol equal in every field to the current one changes nothing
   * (resolves 'unchanged'). Returns a Promise<LoadResult> that never
   * rejects — ignoring it is safe, so this is a backward-compatible widening
   * of the v1 (void) contract. See LoadResult for what each status means.
   */
  setSymbol(symbol: SymbolInfo): Promise<LoadResult>
  /** The requested symbol (not necessarily what is drawn yet — see getLoadState()/getState()). */
  getSymbol(): SymbolInfo
  /**
   * A Period, or shorthand: '1m' (minute) and '1M' (month) differ, '4h'/'4H',
   * 'D', 'W', 'Y', or a TradingView resolution such as '240'. Shorthand
   * selects the configured period with the same multiplier and timespan. The
   * chart refetches only when multiplier or timespan change. Returns a
   * Promise<LoadResult> that never rejects (see setSymbol).
   */
  setPeriod(period: Period | string): Promise<LoadResult>
  /** The requested period (see getSymbol()). */
  getPeriod(): Period
  /** Fetch the current symbol and period again (for example after a failed load). */
  reload: () => void
  /** The underlying KLineChart instance (for direct overlay/indicator/loadMore
   *  access). Non-null synchronously right after `new SuperChart(...)`
   *  returns (klinecharts is constructed eagerly, before any data has
   *  loaded); null again after `dispose()`. Waiting on it with a poll loop
   *  is never needed — use `ready`/`getLoadState()` for "has data arrived"
   *  instead of "has the chart mounted". */
  getChart: () => Nullable<Chart>
  /** Re-read the chrome's CSS custom properties into the canvas theme, for a
   *  host that changes them without calling setTheme. */
  refreshTheme(): void
  /** Resize the canvas to its container now. Guarded against 0x0 (a chart
   *  hidden with display:none), which would otherwise lose the user's scroll
   *  position. With autoResize (the default), hosts do not need to call this
   *  themselves — a ResizeObserver already does. */
  resize(): void
  /** The price-axis decimal precision actually in use (SymbolInfo.pricePrecision resolved: a number as given, or derived from the loaded bars for 'auto'/omitted). */
  getPricePrecision(): number
  /**
   * Resolves once the first load (mount, or a later setSymbol/setPeriod/
   * reload) has settled — ready, empty or error, whichever comes first. Not
   * "the chart has mounted": use this instead of a getChart() != null poll
   * to know data has actually been applied.
   */
  readonly ready: Promise<void>
  /** requested/loaded pair and status, without waiting on a promise — for polling from a render loop or a tool call. */
  getLoadState(): LoadState
  /** The chart's own bars (getChart()?.getDataList() plainly bounded), newest `limit` when given. */
  getBars(options?: GetBarsOptions): KLineData[]
  /** Subscribe to a discrete change; returns the unsubscribe function (also usable with off()). */
  on<K extends SuperChartEventType>(type: K, listener: (event: SuperChartEventMap[K]) => void): () => void
  off<K extends SuperChartEventType>(type: K, listener: (event: SuperChartEventMap[K]) => void): void
  /** A JSON-safe snapshot (JSON.parse(JSON.stringify(getState())) deep-equals it). `schema: 1`; later batches extend it, never replace it. */
  getState(): ChartStateV1
  /** The bars an agent should analyse (src/ai/index.ts's buildChartContext): the visible window by default, aggregated to fit `maxBars`. */
  getContext(options?: ChartContextOptions): ChartContext
  /**
   * Page older history in (never through the datafeed alone skipping it) and
   * scroll so `to` is at the right edge, `from` at or before the left one.
   * `covered: false` when the feed ran out, or a page didn't answer in time,
   * before reaching `from`.
   */
  setVisibleRange(range: { from: number, to: number }): Promise<{ covered: boolean, from: number, to: number }>
  /** Scroll to `timestamp`, paging older history in as needed. `reached: false` on the same conditions as setVisibleRange. */
  scrollToTime(timestamp: number, options?: { animate?: boolean }): Promise<{ reached: boolean, firstLoaded: number }>
  /** Seed the history cache (historyCache option) for a pair from bars a host already has, so visiting it later paints at once. No-op when historyCache is off. */
  primeHistory(symbol: SymbolInfo, period: Period, bars: KLineData[]): void
  /** Drop cached history: one pair, every period of a symbol (period omitted), or everything (no arguments). */
  invalidateHistory(symbol?: SymbolInfo, period?: Period): void
  /** A snapshot of what the chart currently shows: the same data behind its
   *  accessible description, structured for a host, an agent or an MCP tool.
   *  `last`/`change`/`high`/`low` are null (and `bars` 0) before the chart has
   *  any data in its visible range. */
  describe(): ChartDescription
  /**
   * Switch the chart type, as the top bar and Settings do: they share this
   * one owner, so the bar's label, Settings and getChartType() always agree.
   * An unknown type (JSON callers) is refused with a console warning and
   * returns false. Setting the current type applies it again.
   */
  setChartType(type: ChartType): boolean
  getChartType(): ChartType
  /** Show or remove single controls (merged over the current parts). */
  setParts(parts: Partial<ChartParts>): void
  getParts(): ChartParts
  /** Force a size class, or 'auto'. An unknown value is ignored with a warning. */
  setLayoutMode(mode: LayoutMode): void
  /** The size class the chrome is in now. */
  getSizeClass(): SizeClass
  /**
   * Replace the top bar's periods. The current period stays when the new list
   * has it (same multiplier and timespan); otherwise the chart switches to the
   * first period of the new list and loads it. An empty list is ignored.
   */
  setPeriods(periods: Period[]): void
  getPeriods(): Period[]
  /** Show or hide the drawing rail (the chart is resized to fit). */
  setDrawingBarVisible(visible: boolean): void
  isDrawingBarVisible(): boolean
  /** Replace the watermark: text (never parsed as HTML), a Node, a function
   *  returning one, or '' for none. */
  setWatermark(watermark: string | Node | (() => Node)): void
  /**
   * Enter full screen (see the `fullscreen` option). Resolves with the mode
   * entered, or null when it could not. Never rejects. Without a user gesture
   * (an API or agent call) browsers refuse their own full screen, so 'auto'
   * then maximises the chart inside the page.
   */
  enterFullscreen(): Promise<FullscreenMode | null>
  /** Leave this chart's full screen (never the host's own). Never rejects. */
  exitFullscreen(): Promise<void>
  isFullscreen(): boolean

  // ---- Indicators (v2, additive — SC-114/SC-133/SC-152) ------------------
  // Reads the chart directly every time (readIndicators()), never a shadow
  // list: a host's own getChart().createIndicator()/removeIndicator() calls
  // and an engine addIndicator/removeIndicator agree from the first render.
  // 'RSI'/'MACD'/'SMA' resolve to their SC_ replacement here (see
  // resolveIndicatorName, exported from the package root); every other name,
  // including 'MA'/'EMA'/'BOLL'/'VOL'/'COMPARE' and any host or script
  // indicator, is created exactly as given.

  /** Every indicator instance on the chart, host-created ones included. */
  getIndicators: () => IndicatorSnapshot[]
  /** Idempotent for a main-pane name: a second call with the same name on the same pane returns the existing handle instead of failing (klinecharts allows only one instance of a name per pane). */
  addIndicator: (name: string, options?: AddIndicatorOptions) => IndicatorHandle | null
  updateIndicator: (handle: IndicatorHandle, changes: { calcParams?: unknown[], visible?: boolean, styles?: DeepPartial<Styles> }) => boolean
  removeIndicator: (handle: IndicatorHandle) => boolean
  setIndicatorVisible: (name: string, visible: boolean, paneId?: string) => boolean
  setIndicatorParams: (name: string, calcParams: unknown[], paneId?: string) => boolean
  /** Opens the settings modal for the first instance of `name` (on `paneId`, when given). false when there is no such instance. UI-only: does nothing headless. */
  openIndicatorSettings: (name: string, paneId?: string) => boolean
  /** Fires on every add/remove/visibility/param change, from the picker, a tooltip icon or a v2 call. Returns an unsubscribe function. */
  onIndicatorsChange: (cb: (event: IndicatorChangeEvent) => void) => () => void
  /** A copy of the indicator catalogue (see getIndicatorCatalog(), also exported from the package root). */
  getIndicatorCatalog: () => IndicatorCatalogEntry[]
  getDrawingToolCatalog: () => DrawingToolCatalogEntry[]
  addIndicatorCatalogEntries: (entries: readonly IndicatorCatalogEntry[]) => void
  setIndicatorCatalog: (entries: readonly IndicatorCatalogEntry[]) => void
  /**
   * A theme-correct capture (SC-015): the background matches what the chart
   * actually shows (a host's CSS override, or the current theme), the
   * crosshair is cleared by default, and the result carries metadata for an
   * agent or MCP tool. The screenshot button uses this too.
   */
  snapshot(options?: SnapshotOptions): SnapshotResult
  /** Scrolls to the newest bar (the "»" button's action). */
  scrollToLatest(options?: { animationMs?: number }): void
  /** Scrolls to the newest bar, restores the bar space the chart mounted (or last reset) with, and turns price-axis auto-scale back on. Never touches indicators or drawings. */
  resetView(): void
  /** Scrolls to the bar at or immediately before `timestamp`. */
  scrollToTimestamp(timestamp: number, options?: { animationMs?: number }): void
  /** Sets the price axis's scale (SC-116). `fit: true` re-fits (auto-scale) without changing `type`/`reverse`. */
  setPriceScale(scale: Partial<PriceScale> & { fit?: true }): void
  getPriceScale(): PriceScale
  /** Opens the built-in symbol search (or calls `onSymbolSearchRequest` when the host provides one), prefilled with `query`. */
  openSymbolSearch(query?: string): void
  /** Bar replay (SC-067): `chartPro.replay.start()`, `.step()`, `.play()`, `.pause()`, `.exit()`, `.getState()`. */
  readonly replay: ReplayControls
  /**
   * Arm a drawing tool by its klinecharts overlay name, exactly as clicking
   * the rail does (SC-095): the drawing bar's magnet/lock/visible state
   * still applies, and the next click(s) on the chart place it. Calling it
   * again with the SAME name cancels the still-unfinished drawing instead of
   * arming a second one (SC-094); calling it with a different name replaces
   * whichever tool was armed. A name outside the drawing rail's own tools
   * (e.g. a host-only overlay) is refused with a console warning.
   */
  armTool: (name: string) => void
  /** Cancel the tool armed by the rail, a hotkey or armTool(), if any (no-op otherwise). */
  cancelTool: () => void
  /**
   * "Stay in drawing mode" (SC-094): when a click-to-place tool finishes, it
   * re-arms instead of disarming, so the next click starts another of the
   * same tool. Off by default, so existing hosts see no change.
   */
  setDrawingStayMode: (stay: boolean) => void
  getDrawingStayMode: () => boolean

  // ---- Drawing editor (additive: SC-090/091/092/109/119/120/151) --------------
  // Every method here only ever touches a drawing made through the drawing bar
  // or freehand — never an overlay a host created through getChart(). These
  // are the typed surface a later AI/MCP command layer's drawings API and
  // layout save/restore are meant to build on.

  /** Undo the most recent drawing action (create, remove, style, lock, visibility, move, or a reorder on klinecharts >= 9.x). False with nothing to undo. */
  undo(): boolean
  /** Redo the most recently undone action. False with nothing to redo. */
  redo(): boolean
  canUndo(): boolean
  canRedo(): boolean
  /** This symbol's drawings (default: the current one) as a JSON-safe snapshot — also what setDrawings/restore() take. */
  getDrawings(key?: string): DrawingRecord[]
  /** Replace this symbol's drawings (default: the current one) with `records`. Not itself undo-able (a bulk replace, not a gesture). */
  setDrawings(records: readonly DrawingRecord[], key?: string): void
  /** Remove this symbol's drawings (default: the current one). */
  clearDrawings(key?: string): void
  /** Every tracked drawing for the object tree, in z-order (back to front). */
  listDrawings(): DrawingListRow[]
  setDrawingVisible(id: string, visible: boolean): void
  setDrawingLocked(id: string, locked: boolean): void
  removeDrawing(id: string): void
  /** The style this tool's next fresh drawing (from the drawing bar or freehand) will use, or null (the theme/tool default). */
  getDrawingDefaults(name: string): StyleRecord | null
  /** Change what this tool remembers, without touching any existing drawing (the toolbar's own vocabulary: lineColor/textColor/lineWidth/lineStyle). */
  setDrawingDefaults(name: string, changes: readonly StyleChange[]): void
  /** Forget this tool's remembered style (its next drawing uses the theme default again). */
  clearDrawingDefaults(name: string): void
  /**
   * A host's own overlay (a stop-loss/take-profit line, an AI-drawn level) —
   * never a drawing-bar or freehand drawing, and never touched by any method
   * above: it enters neither the undo stack, getDrawings()/listDrawings(),
   * nor the drawing-bar's lock-all/hide-all/remove-all (SC-091). Locked
   * (immovable) and safe from klinecharts' own right-click delete by
   * default; pass `draggable: true` to opt into movement, reported through
   * `onChange` only when the points actually changed. Returns the new
   * overlay's id, or null if the chart is not ready.
   */
  addHostOverlay(create: OverlayCreate, options?: HostOverlayOptions): string | null

  // ---- AI/MCP command layer (additive — SC-123) --------------------------
  // A schema'd, JSON-safe wrapper over the API above: `execute` validates its
  // own arguments and never throws, so an agent/palette caller gets a result
  // object back every time. Built on the same v2 methods above (setSymbol/
  // setPeriod's own load-settled promise, the drawing/annotation/layout APIs
  // below) — nothing here bypasses them.

  /** Validates `request.args` against the command's schema and runs it. Never throws or rejects. */
  execute: (request: ExecuteRequest) => Promise<ExecuteResult>
  /** The command registry this instance supports (the same list for every instance today; kept per-instance for a future host-narrowed registry). */
  getCommands: () => readonly CommandDescriptor[]
  /** Neutral, MCP-shaped tool definitions with this instance's live enums (indicators, periods, drawing tools) resolved in. Destructive commands are excluded by default. */
  toToolDefinitions: (options?: ToToolDefinitionsOptions) => ToolDefinition[]

  // ---- drawings API (additive — SC-127, SC-135, SC-180) ------------------
  // JSON in, JSON out: `points`' `time` is a plain ms timestamp, mapped to
  // whatever klinecharts point shape keeps it correctly positioned (see
  // src/api/anchors.ts) — a future time is never silently clamped to the
  // last bar. Every drawing made this way is a normal user (rail-editable,
  // undo-able) drawing, exactly like one made with the drawing bar; a host's
  // own getChart().createOverlay layer is never affected.

  /** Creates a complete (not click-placed) user drawing from JSON points. Returns its id, or null for an unknown tool/empty points (a console warning explains which). */
  addDrawing: (spec: AddDrawingSpec) => string | null
  /** Patches an existing user drawing's points/styles/text/lock/visibility. False for a host overlay or an unknown id. */
  updateDrawing: (id: string, changes: UpdateDrawingChanges) => boolean
  /** Every tool name the rail (and addDrawing) accepts — getDrawingToolCatalog()'s names, for a caller that only wants the strings. */
  listDrawingTools: () => string[]
  /**
   * Arms `tool` exactly like clicking the rail (armTool), but resolves once
   * placement finishes: the new drawing's id, or null on cancel/Escape/a
   * different tool re-armed over it. `null` cancels whatever is armed and
   * resolves with null immediately.
   */
  setDrawingTool: (tool: string | null) => Promise<string | null>
  /**
   * The price level(s) a user drawing sits at at `timestamp`, in the pane's
   * own coordinate space (geometric on a log axis). Null for a tool with no
   * price meaning (a vertical line, text, brush) or a segment/ray outside
   * its span. See src/api/drawings.ts for exactly which tools get more than
   * one level (a rect's top/bottom) versus the generic two-point line.
   */
  drawingLevelsAt: (id: string, timestamp: number) => DrawingLevel[] | null
  /**
   * Fires once per crossing of a user drawing's price level by the latest
   * bar's close (SC-180) — evaluated only while at least one listener is
   * installed, and only on settled, live data (never during a history load,
   * loadMore or replay). In-session only: a durable alert belongs to the
   * host or a server, fed by `listDrawings()` + `drawingLevelsAt`. Scoped to
   * user drawings on the current symbol by default; pass `ids` for specific
   * drawings (host overlay ids included).
   */
  onDrawingCross: (cb: (event: DrawingCrossEvent) => void, options?: { ids?: readonly string[] }) => () => void

  // ---- declarative annotation layers (additive — SC-128) -----------------
  // Never a user drawing: created through the same addHostOverlay() path a
  // host's own SL/TP lines use, so an annotation is immovable by default,
  // right-click-safe, and invisible to undo/getDrawings()/the rail's
  // remove-all. `layer` is any string namespace the caller picks ('host',
  // 'ai', a host's own name); each key inside it upserts instead of
  // recreating, so identical specs repaint nothing.

  /** Upserts `specs` into `layer` by their `key`, diffing against what is already there. Returns which ids were applied and which specs were rejected (with a reason code). */
  setAnnotations: (layer: string, specs: readonly AnnotationSpec[]) => SetAnnotationsResult
  /** The specs currently applied to `layer` (every layer, when omitted), as given — not re-derived from overlay geometry. */
  getAnnotations: (layer?: string) => AnnotationSpec[]
  /** Removes every annotation in `layer`. */
  clearAnnotations: (layer: string) => void

  // ---- layout save/restore (additive — SC-121) ----------------------------
  // Scoped to the user layer only (see the module comment in src/api/layout.ts):
  // engine-owned indicators (the picker/mainIndicators/subIndicators/v2 API)
  // and the CURRENT symbol's drawings, plus chart type and timezone. A
  // host's own indicators/overlays and its own symbol/period control are
  // never captured or restored.

  getLayout: () => ChartLayoutV1
  /** Replaces the engine-owned indicator set and the current symbol's drawings with `layout`'s. Chart type/timezone restore by default; pass `{ chartType: false }`/`{ timezone: false }` to skip either. */
  applyLayout: (layout: ChartLayoutV1, options?: ApplyLayoutOptions) => ApplyLayoutResult
  /** Fires (debounced) whenever anything `getLayout()` reads changes — see the `onLayoutChange` option. Returns an unsubscribe function. */
  onLayoutChange: (cb: () => void) => () => void
}

/** A drawing's row in listDrawings() / the object tree. */
export interface DrawingListRow {
  id: string
  name: string
  visible: boolean
  locked: boolean
}

/** See ChartPro.describe(). */
export interface ChartDescription {
  symbol: SymbolInfo
  period: Period
  chartType: ChartType
  locale: Locale
  /** An IANA zone (never a UI sentinel), the same value getTimezone() returns. */
  timezone: string
  /** Over the chart's current visible range. */
  last: number | null
  /** Percent change from the first to the last visible bar. */
  change: number | null
  high: number | null
  low: number | null
  /** How many bars are in the visible range (0 before the chart has data). */
  bars: number
  /** Every active main + sub indicator's name, main first. */
  indicators: IndicatorName[]
}

/**
 * What `new SuperChart(options)` returns: the ChartPro API plus its lifecycle.
 * After `dispose()`, every ChartPro method throws `ChartDisposedError`,
 * `getChart()` returns null and `isDisposed()` returns true.
 */
export interface SuperChartInstance extends ChartPro {
  /** Tear the chart down and empty its container. Idempotent. */
  dispose: () => void
  isDisposed: () => boolean
}
