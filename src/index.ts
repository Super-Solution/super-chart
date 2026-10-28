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

import { registerExtensions } from './extension/register'
import { registerScIndicators } from './indicators/register'

import DefaultDatafeed from './DefaultDatafeed'
import KLineChartPro from './KLineChartPro'

import { load, resolveLocale as resolveLocaleTag, supportedLocales } from './i18n'
import { registerCanvasStrings } from './i18n/canvas'

import {
  Datafeed, SymbolInfo, Period, DatafeedSubscribeCallback, ChartProOptions, ChartPro, SuperChartInstance,
  Theme, ChartType, Locale, IndicatorName, Timespan, DataStatesOption, SetStylesOptions,
  LoadResult, GetBarsOptions, HistoryRequest, HistoryResult, SearchRequest, ChartDescription, NumberUnits,
  ChartPart, ChartParts, LayoutMode, SizeClass, FullscreenOption, FullscreenMode, FullscreenChange,
  IndicatorHandle, IndicatorSnapshot, AddIndicatorOptions, IndicatorChangeEvent, IndicatorMenuOption,
  PriceScale, PriceScaleType, WheelOption, PaneLayoutOption, SnapshotOptions, SnapshotResult,
  ReplayState, ReplayStartOptions, ReplayControls, SymbolSearchOption, SymbolSearchRecent,
  DrawingRecord, DrawingListRow, HostOverlayOptions,
  AddDrawingSpec, UpdateDrawingChanges, DrawingLevel, DrawingCrossEvent, DrawingTimePoint,
  AnnotationSpec, AnnotationAnchor, AnnotationKind, AnnotationTone, AnnotationRejectCode, AnnotationRejection, SetAnnotationsResult,
  ChartLayoutV1, LayoutIndicatorEntry, ApplyLayoutOptions, ApplyLayoutResult,
  ExecuteRequest, ExecuteResult, ToToolDefinitionsOptions, ToolDefinition, CommandDescriptor, JSONSchema, JSONSchemaType
} from './types'
import type { WatermarkOption } from './watermark'
import {
  ChartError, isChartError, checkPeriodObject, checkSymbol, checkTimezone, checkIndicatorName, checkDrawingTool,
  checkNumber, checkOneOf, getSupportedTimespans
} from './api/errors'
import type { ChartErrorCode, ChartErrorDetails, ChartErrorJSON } from './api/errors'
import type {
  SuperChartEventMap, SuperChartEventType, EventSource, SymbolChangeEvent, PeriodChangeEvent, ChartTypeChangeEvent,
  TimezoneChangeEvent, ThemeChangeEvent, IndicatorAddEvent, IndicatorRemoveEvent, DrawingCreateEvent,
  DrawingChangeEvent, DrawingRemoveEvent, DataLoadedEvent, DataErrorEvent, ReplayChangeEvent
} from './api/events'
import type { ChartStateV1, LoadState } from './api/state'
import type { HistoryCacheOptions } from './data/historyCache'
import { derivePrecision, resolvePricePrecision } from './data/precision'
import type { OhlcLike } from './data/precision'

import './index.less'

// The full entry registers Super Chart's figures, drawing overlays and the
// SC_* indicator pack when it loads (package.json lists this file under
// "sideEffects" for that reason). Registering SC_* templates never touches
// klinecharts' own built-in names — see src/indicators/aliases.ts.
registerExtensions()
registerScIndicators()

// SUPer-Chart extensions (maintained by ZzyzxLabs on top of the KLineChart Pro base):
//   • superscript — the SuperScript indicator/strategy language runtime (+ other langs)
//   • ai          — AI features (chart analysis, natural-language → SuperScript, etc.)
//   • indicators  — the SC_* built-in pack, its name aliasing, and the indicator/drawing-tool catalogue
export * from './superscript'
export * from './superscript/indicator'
export * from './ai'
export * from './indicators'
export { chartStyles, canvasTheme, canvasFontStyles } from './chart-theme'
export { CANVAS_FONT, ICON_FONT_FAMILY } from './theme/tokens'
export { THEMES, CHART_TYPES, BUILTIN_LOCALES, CHART_PARTS, LAYOUT_MODES, isTheme, isChartType, isLayoutMode } from './types'
export { ChartDisposedError } from './errors'

/**
 * Add or extend the strings of a locale. They are merged over the locale's
 * current strings (a built-in locale keeps the keys you leave out), and a key
 * the locale lacks shows its en-US text, so a partial dictionary is fine. The
 * keys are those of src/i18n/en-US.json; the canvas keys klinecharts draws
 * (time, open, high, low, close, volume, turnover, change) are passed on to
 * klinecharts' own table as well.
 *
 * A mounted chart shows new chrome strings at once; canvas strings appear
 * with its next repaint.
 */
export function registerLocale (locale: Locale, strings: Readonly<Record<string, string>>): void {
  load(locale, strings)
  registerCanvasStrings(locale, strings)
}

/** v1 name of registerLocale (same merge semantics). */
export function loadLocales (key: Locale, ls: Readonly<Record<string, string>>): void {
  registerLocale(key, ls)
}

/** The locales with chrome strings: en-US, zh-CN, zh-TW and every registered one. */
export function getSupportedLocales (): Locale[] {
  return supportedLocales()
}

/**
 * The supported locale a BCP-47 tag stands for (what the chart uses for it):
 * an exact (registered) match first, then zh-TW for Traditional Chinese
 * (zh-TW, zh-HK, zh-MO, zh-Hant), zh-CN for other Chinese, en-US for any
 * English, and en-US for anything else.
 */
export function resolveLocale (tag: string): Locale {
  return resolveLocaleTag(tag)
}

export {
  DefaultDatafeed,
  KLineChartPro,
  // SuperChart is the public name of the SUPer-Chart engine (the KLineChart-Pro
  // base class, which we extend). `new SuperChart(options)`.
  KLineChartPro as SuperChart
}

export type {
  Datafeed, SymbolInfo, Period, DatafeedSubscribeCallback, ChartProOptions, ChartPro, SuperChartInstance,
  Theme, ChartType, Locale, IndicatorName, Timespan, WatermarkOption, DataStatesOption, SetStylesOptions,
  ChartDescription, NumberUnits,
  ChartPart, ChartParts, LayoutMode, SizeClass, FullscreenOption, FullscreenMode, FullscreenChange,
  IndicatorHandle, IndicatorSnapshot, AddIndicatorOptions, IndicatorChangeEvent, IndicatorMenuOption,
  PriceScale, PriceScaleType, WheelOption, PaneLayoutOption, SnapshotOptions, SnapshotResult,
  ReplayState, ReplayStartOptions, ReplayControls, SymbolSearchOption, SymbolSearchRecent,
  DrawingRecord, DrawingListRow, HostOverlayOptions
}

// ---- AI/MCP command layer, drawings/annotations/layout APIs (SC-121/123/127/128) ----
// The command registry's DOM-free descriptors/schema helpers are ALSO the
// `./commands` subpath (src/commands/schema.ts — no klinecharts/Solid import,
// so a server can list/validate tool schemas with no chart, no DOM). The
// `run`/`execute`/`toToolDefinitions` implementations are per-instance
// methods on a live chart (`chart.execute(...)`, `chart.toToolDefinitions()`)
// — never free functions here, since they need a mounted instance anyway.
export { COMMAND_DESCRIPTORS, getCommandDescriptors, findCommandDescriptor, validateAgainstSchema } from './commands/schema'
export type {
  AddDrawingSpec, UpdateDrawingChanges, DrawingLevel, DrawingCrossEvent, DrawingTimePoint,
  AnnotationSpec, AnnotationAnchor, AnnotationKind, AnnotationTone, AnnotationRejectCode, AnnotationRejection, SetAnnotationsResult,
  ChartLayoutV1, LayoutIndicatorEntry, ApplyLayoutOptions, ApplyLayoutResult,
  ExecuteRequest, ExecuteResult, ToToolDefinitionsOptions, ToolDefinition, CommandDescriptor, JSONSchema, JSONSchemaType
}

// ---- API v2: awaitable loads, events, JSON state, typed errors, datafeed context, cache, precision ----

/** Thrown by v2 (strict) calls; a v1 call warns and keeps its state instead. */
export { ChartError, isChartError }
/**
 * Validators a host, tool schema or MCP adapter can reuse instead of
 * duplicating the allowed-value lists (they are read live, e.g.
 * klinecharts.getSupportedIndicators(), never a hard-coded copy).
 */
export { checkPeriodObject, checkSymbol, checkTimezone, checkIndicatorName, checkDrawingTool, checkNumber, checkOneOf, getSupportedTimespans }
/** SymbolInfo.pricePrecision's 'auto': the rule ChartPro.getPricePrecision()/getState() use. */
export { derivePrecision, resolvePricePrecision }

export type { ChartErrorCode, ChartErrorDetails, ChartErrorJSON }
export type { LoadResult, GetBarsOptions, HistoryRequest, HistoryResult, SearchRequest, HistoryCacheOptions, OhlcLike }
export type { ChartStateV1, LoadState }
export type {
  SuperChartEventMap, SuperChartEventType, EventSource, SymbolChangeEvent, PeriodChangeEvent, ChartTypeChangeEvent,
  TimezoneChangeEvent, ThemeChangeEvent, IndicatorAddEvent, IndicatorRemoveEvent, DrawingCreateEvent,
  DrawingChangeEvent, DrawingRemoveEvent, DataLoadedEvent, DataErrorEvent, ReplayChangeEvent
}

export { enableCrispLines } from './canvas/crispLines'
export { parsePeriod, periodKey } from './period/parsePeriod'
