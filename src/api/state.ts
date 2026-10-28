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

// SC-130: a JSON-safe snapshot an agent (or an MCP tool) can read without
// touching the DOM or a klinecharts instance. getSymbol()/getPeriod() already
// return the *requested* pair (the v1 contract, kept); getState() adds what
// was actually *loaded*, and getContext() (src/ai/index.ts's buildChartContext,
// exposed as a ChartPro method) gives the bars themselves.
//
// `schema: 1` is deliberate: chartType/indicators/drawings/visibleRange are
// each a later batch's own area (PR 9 indicators, PR 11/12 drawings) and are
// expected to extend this same object rather than replace it — a consumer
// should key behaviour off fields it recognises, not off the exact field set.

import type { DataStatus } from '../data/loader'
import type { ChartType, Locale, Period, SymbolInfo, Theme } from '../types'

export interface LoadState {
  /** What setSymbol/setPeriod (or the constructor) last asked for. */
  requested: { symbol: SymbolInfo, period: Period }
  /** What is actually drawn; null before the first load has settled at all. */
  loaded: { symbol: SymbolInfo, period: Period } | null
  status: 'idle' | 'loading' | 'error'
  /** Set only when status is 'error'. */
  error?: string
}

function describeError (error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  try {
    return String(error)
  } catch {
    return 'unknown error'
  }
}

/** getLoadState()'s value, from the loader's own status (src/data/loader.ts). */
export function buildLoadState (
  requested: { symbol: SymbolInfo, period: Period },
  loaded: { symbol: SymbolInfo, period: Period } | null,
  status: DataStatus
): LoadState {
  const state: LoadState = {
    requested,
    loaded,
    status: status.state === 'loading' ? 'loading' : status.state === 'error' ? 'error' : 'idle'
  }
  if (status.state === 'error' && status.error !== null) {
    state.error = describeError(status.error.error)
  }
  return state
}

export interface ChartStateV1 {
  schema: 1
  symbol: SymbolInfo
  period: Period
  timezone: string
  locale: Locale
  theme: Theme
  chartType: ChartType
  /** What setPriceVolumePrecision is actually using (SymbolInfo.pricePrecision resolved). */
  pricePrecision: number
  loadState: LoadState
  replay: { active: boolean }
  data: { count: number, firstTimestamp: number | null, lastTimestamp: number | null }
}

export interface ChartStateInput {
  symbol: SymbolInfo
  period: Period
  timezone: string
  locale: Locale
  theme: Theme
  chartType: ChartType
  pricePrecision: number
  loadState: LoadState
  replayActive: boolean
  /** The chart's own data list (getChart()?.getDataList() ?? []). */
  bars: ReadonlyArray<{ timestamp: number }>
}

/** getState()'s value: JSON round-trips (JSON.parse(JSON.stringify(getState())) deep-equals it). */
export function buildChartState (input: ChartStateInput): ChartStateV1 {
  const bars = input.bars
  return {
    schema: 1,
    symbol: input.symbol,
    period: input.period,
    timezone: input.timezone,
    locale: input.locale,
    theme: input.theme,
    chartType: input.chartType,
    pricePrecision: input.pricePrecision,
    loadState: input.loadState,
    replay: { active: input.replayActive },
    data: {
      count: bars.length,
      firstTimestamp: bars.length > 0 ? bars[0].timestamp : null,
      lastTimestamp: bars.length > 0 ? bars[bars.length - 1].timestamp : null
    }
  }
}
