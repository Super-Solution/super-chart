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

// Layout save/restore (SC-121): a versioned, JSON-only snapshot of what the
// USER (or an API caller) put on the chart — the engine's own picker/API
// indicators and the drawing editor's tracked drawings for the current
// symbol — never anything a host created through getChart(). Restoring never
// duplicates or removes a host's own indicators/overlays, because it only
// ever calls the same v2 indicator methods and the drawing editor's
// setDrawings(), both of which are already scoped that way.
//
// Symbol/period are deliberately left out by default: SupWallet, Broker and
// ProjectX all drive those themselves (setSymbol/setPeriod from their own
// state), and restoring them here would fight the host. Drawings are scoped
// to the CURRENT symbol only — the drawing editor has no public way to
// enumerate every symbol it has ever cached (that cache is private to
// src/drawing-editor/controller.ts, owned by an earlier batch) — so a
// multi-symbol drawings dictionary is out of scope here; call getLayout()
// again after a symbol change to capture that symbol's own layout.
//
// Part of SUPer-Chart (Apache-2.0).

import type { AddIndicatorOptions, ChartType, DrawingRecord, IndicatorHandle, IndicatorSnapshot } from '../types'
import { isChartType } from '../types'
import { ChartError } from './errors'

export interface LayoutIndicatorEntry {
  name: string
  paneKind: 'main' | 'sub'
  calcParams: unknown[]
  visible: boolean
}

export interface ChartLayoutV1 {
  v: 1
  /**
   * The symbol (drawingsKey) `drawings` was captured for. applyLayout()
   * restores `drawings` only when the chart is currently on this SAME
   * symbol — never onto a different, differently-priced one, so a layout
   * saved on one ticker can never misplace old-symbol-priced drawings onto
   * another (the drawing editor itself has no cross-symbol store to draw
   * from either way; see the module comment above).
   */
  symbol: string
  chartType: ChartType
  timezone: string
  indicators: LayoutIndicatorEntry[]
  /** `symbol`'s drawings only. */
  drawings: DrawingRecord[]
}

export interface LayoutApiDeps {
  getChartType: () => ChartType
  setChartType: (type: ChartType) => boolean
  getTimezone: () => string
  setTimezone: (timezone: string) => void
  getIndicators: () => IndicatorSnapshot[]
  addIndicator: (name: string, options?: AddIndicatorOptions) => IndicatorHandle | null
  updateIndicator: (handle: IndicatorHandle, changes: { calcParams?: unknown[], visible?: boolean }) => boolean
  removeIndicator: (handle: IndicatorHandle) => boolean
  getDrawings: (key?: string) => DrawingRecord[]
  setDrawings: (records: readonly DrawingRecord[], key?: string) => void
  getSymbolKey: () => string
}

const paneKindOf = (paneId: string): 'main' | 'sub' => (paneId === 'candle_pane' ? 'main' : 'sub')

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Validate stored JSON before any restore can remove live drawings or indicators. */
export function isChartLayoutV1 (value: unknown): value is ChartLayoutV1 {
  if (!isRecord(value) || value.v !== 1 || typeof value.symbol !== 'string' || value.symbol.length === 0 ||
    !isChartType(value.chartType) || typeof value.timezone !== 'string' || value.timezone.length === 0 ||
    !Array.isArray(value.indicators) || !Array.isArray(value.drawings)) {
    return false
  }
  const validIndicator = (entry: unknown): boolean =>
    isRecord(entry) && typeof entry.name === 'string' && entry.name.length > 0 &&
    (entry.paneKind === 'main' || entry.paneKind === 'sub') && Array.isArray(entry.calcParams) && typeof entry.visible === 'boolean'
  const validPoint = (point: unknown): boolean =>
    isRecord(point) &&
    ((typeof point.timestamp === 'number' && Number.isFinite(point.timestamp)) ||
      (typeof point.barsFromLast === 'number' && Number.isFinite(point.barsFromLast))) &&
    (point.value === undefined || (typeof point.value === 'number' && Number.isFinite(point.value)))
  const validDrawing = (drawing: unknown): boolean =>
    isRecord(drawing) && drawing.v === 1 && typeof drawing.name === 'string' && drawing.name.length > 0 &&
    typeof drawing.paneId === 'string' && drawing.paneId.length > 0 &&
    Array.isArray(drawing.points) && drawing.points.length > 0 && drawing.points.every(validPoint) &&
    typeof drawing.lock === 'boolean' && typeof drawing.visible === 'boolean'
  return value.indicators.every(validIndicator) && value.drawings.every(validDrawing)
}

/** Every engine-owned indicator + this symbol's drawings + chart type/timezone, as a JSON-safe, versioned snapshot. */
export function buildLayout (deps: LayoutApiDeps): ChartLayoutV1 {
  const indicators = deps.getIndicators()
    .filter(i => i.owner === 'engine')
    .map(i => ({ name: i.name, paneKind: paneKindOf(i.paneId), calcParams: [...i.calcParams], visible: i.visible }))
  return {
    v: 1,
    symbol: deps.getSymbolKey(),
    chartType: deps.getChartType(),
    timezone: deps.getTimezone(),
    indicators,
    drawings: deps.getDrawings(deps.getSymbolKey())
  }
}

export interface ApplyLayoutResult {
  /** Indicator names that could not be created (e.g. a script indicator the host has not registered on this instance). */
  skippedIndicators: string[]
  /** False when `layout.symbol` did not match the chart's current symbol, so its drawings were intentionally left untouched. */
  drawingsApplied: boolean
}

export interface ApplyLayoutOptions {
  /** Restore chartType. @default true */
  chartType?: boolean
  /** Restore timezone. @default true */
  timezone?: boolean
}

/**
 * Replaces the engine-owned indicator set (matched by name + which pane kind
 * they are on) with `layout.indicators`, and the current symbol's drawings
 * with `layout.drawings` — never touching a host-owned indicator or overlay.
 */
export function applyLayout (deps: LayoutApiDeps, layout: ChartLayoutV1, options?: ApplyLayoutOptions): ApplyLayoutResult {
  if (!isChartLayoutV1(layout)) {
    throw new ChartError({ code: 'INVALID_ARGUMENT', field: 'layout', received: 'malformed layout', hint: 'A complete v1 layout is required; no chart state was changed.' })
  }
  if ((options?.chartType ?? true) && isChartType(layout.chartType)) {
    deps.setChartType(layout.chartType)
  }
  if ((options?.timezone ?? true) && typeof layout.timezone === 'string' && layout.timezone.length > 0) {
    deps.setTimezone(layout.timezone)
  }

  const engineIndicators = (): IndicatorSnapshot[] => deps.getIndicators().filter(i => i.owner === 'engine')
  const matches = (snapshot: IndicatorSnapshot, entry: LayoutIndicatorEntry): boolean =>
    snapshot.name === entry.name && paneKindOf(snapshot.paneId) === entry.paneKind

  const wanted = layout.indicators ?? []
  for (const current of engineIndicators()) {
    if (!wanted.some(w => matches(current, w))) {
      deps.removeIndicator({ paneId: current.paneId, name: current.name })
    }
  }

  const skipped: string[] = []
  for (const entry of wanted) {
    const existing = engineIndicators().find(s => matches(s, entry))
    if (existing !== undefined) {
      deps.updateIndicator(existing, { calcParams: entry.calcParams, visible: entry.visible })
      continue
    }
    const handle = deps.addIndicator(entry.name, { pane: entry.paneKind === 'main' ? 'main' : 'new', calcParams: entry.calcParams })
    if (handle === null) {
      skipped.push(entry.name)
      continue
    }
    if (!entry.visible) {
      deps.updateIndicator(handle, { visible: false })
    }
  }

  const currentSymbol = deps.getSymbolKey()
  const drawingsApplied = layout.symbol === currentSymbol
  if (drawingsApplied) {
    deps.setDrawings(layout.drawings ?? [], currentSymbol)
  }
  return { skippedIndicators: skipped, drawingsApplied }
}

// ---- opt-in persistence (off by default) --------------------------------------

/** Read a persisted layout; null on anything unusable (missing, blocked storage, wrong shape/version). Never throws. */
export function readPersistedLayout (key: string): ChartLayoutV1 | null {
  try {
    const raw = window.localStorage?.getItem(key)
    if (raw === null || raw === undefined) {
      return null
    }
    const parsed = JSON.parse(raw)
    return isChartLayoutV1(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** Best-effort write (private mode, a full quota, or no storage at all never throws back to the caller). */
export function writePersistedLayout (key: string, layout: ChartLayoutV1): void {
  try {
    window.localStorage?.setItem(key, JSON.stringify(layout))
  } catch { /* best-effort persistence, matching src/widget/drawing-bar/state.ts's storage guard */ }
}
