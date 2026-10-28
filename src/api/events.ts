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

// SC-108: before this, the only way a host learned that the user (or an
// agent) changed the symbol, period, chart type or an indicator was to sniff
// datafeed.getHistoryKLineData, which misses a chart-type change, an
// indicator added from the modal, and a drawing entirely. on()/off() give a
// host (or the planned MCP layer) one place to observe every discrete change,
// tagged with whether it came from the user or from an API call.
//
// Deliberately not here: crosshair/click (continuous, 60 Hz pointer events;
// they belong on their own live-only listener, never in a replay buffer) and
// a since(seq) ring buffer for replaying missed events (an MCP-layer concern,
// built on top of on() when it is needed). Both are additive and can land in
// a later batch without changing this one.

import type { ChartType, Period, SymbolInfo, Theme } from '../types'

/** 'user': the top bar, the symbol search modal, a drawing made by hand. 'api': a ChartPro method call. */
export type EventSource = 'user' | 'api'

interface EventBase {
  /** Increases by one per event on this chart, across every type: gives a total order. */
  seq: number
  /** Date.now() when the event was emitted. */
  ts: number
  source: EventSource
}

export interface SymbolChangeEvent extends EventBase { symbol: SymbolInfo }
export interface PeriodChangeEvent extends EventBase { period: Period }
export interface ChartTypeChangeEvent extends EventBase { chartType: ChartType }
export interface TimezoneChangeEvent extends EventBase { timezone: string }
export interface ThemeChangeEvent extends EventBase { theme: Theme }
export interface IndicatorAddEvent extends EventBase { name: string, pane: 'main' | 'sub', paneId: string }
export interface IndicatorRemoveEvent extends EventBase { name: string, pane: 'main' | 'sub', paneId: string }
export interface DrawingCreateEvent extends EventBase { id: string, name: string }
export interface DrawingChangeEvent extends EventBase { id: string }
export interface DrawingRemoveEvent extends EventBase { id: string }
export interface DataLoadedEvent extends EventBase { symbol: SymbolInfo, period: Period, bars: number }
export interface DataErrorEvent extends EventBase { symbol: SymbolInfo, period: Period, message: string, timeout: boolean }
export interface ReplayChangeEvent extends EventBase { active: boolean }

/** Every event ChartPro.on() can subscribe to, and its payload. */
export interface SuperChartEventMap {
  symbolChange: SymbolChangeEvent
  periodChange: PeriodChangeEvent
  chartTypeChange: ChartTypeChangeEvent
  timezoneChange: TimezoneChangeEvent
  themeChange: ThemeChangeEvent
  indicatorAdd: IndicatorAddEvent
  indicatorRemove: IndicatorRemoveEvent
  drawingCreate: DrawingCreateEvent
  drawingChange: DrawingChangeEvent
  drawingRemove: DrawingRemoveEvent
  dataLoaded: DataLoadedEvent
  dataError: DataErrorEvent
  replayChange: ReplayChangeEvent
}

export type SuperChartEventType = keyof SuperChartEventMap

type Listener<K extends SuperChartEventType> = (event: SuperChartEventMap[K]) => void

/**
 * A small typed pub/sub, one instance per chart. A throwing listener is
 * caught and warned about (via `warn`), never breaking the caller that
 * triggered the emit — the same guarantee src/data/loader.ts's own `on()`
 * gives its 'status'/'error'/'replay' listeners.
 */
// Stored untyped (a generic K cannot index the mapped mapped-by-K mapped type
// below, a known TS limitation with generic keys); on/off/emit stay fully
// typed at the public boundary above this line.
type AnyListener = (event: SuperChartEventMap[SuperChartEventType]) => void

export class SuperChartEventBus {
  private readonly _listeners = new Map<SuperChartEventType, Set<AnyListener>>()
  private _seq = 0
  private readonly _warn: (...args: unknown[]) => void

  constructor (warn: (...args: unknown[]) => void = (...a) => { console.warn(...a) }) {
    this._warn = warn
  }

  /** Subscribe; returns the function that unsubscribes (also given to off()). */
  on<K extends SuperChartEventType> (type: K, fn: Listener<K>): () => void {
    let set = this._listeners.get(type)
    if (set === undefined) {
      set = new Set()
      this._listeners.set(type, set)
    }
    set.add(fn as AnyListener)
    return () => { this.off(type, fn) }
  }

  off<K extends SuperChartEventType> (type: K, fn: Listener<K>): void {
    this._listeners.get(type)?.delete(fn as AnyListener)
  }

  /** Fills `seq`/`ts`; the caller supplies everything else the event needs. */
  emit<K extends SuperChartEventType> (type: K, payload: Omit<SuperChartEventMap[K], 'seq' | 'ts'>): void {
    // seq always advances, whether or not anything is listening right now: a
    // future since(seq) (an MCP-layer addition) can tell "nothing happened"
    // apart from "nobody was listening".
    const event = { ...payload, seq: ++this._seq, ts: Date.now() } as SuperChartEventMap[K]
    const set = this._listeners.get(type)
    if (set === undefined || set.size === 0) {
      return
    }
    for (const fn of [...set]) {
      try {
        fn(event)
      } catch (e) {
        this._warn(`[super-chart] a '${type}' listener threw.`, e)
      }
    }
  }

  /** Drop every listener (called from dispose()). */
  clear (): void {
    this._listeners.clear()
  }
}
