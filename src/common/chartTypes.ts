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

// The one chart-type list (SC-124): the top bar's menu, Settings and
// getChartType() all use it, so every type has one name everywhere and each
// menu can show every type the chart can be in.
//
// Part of SUPer-Chart (Apache-2.0).

import i18n from '../i18n'
import { CHART_TYPES, type ChartType } from '../types'

const LABEL_KEYS: Record<ChartType, string> = {
  candle_solid: 'chart_type_candles',
  candle_up_stroke: 'chart_type_hollow',
  candle_stroke: 'chart_type_outline',
  candle_down_stroke: 'chart_type_down_hollow',
  heikin_ashi: 'chart_type_heikin_ashi',
  ohlc: 'chart_type_bars',
  volume_bars: 'chart_type_volume_bars',
  columns: 'chart_type_columns',
  high_low: 'chart_type_high_low',
  line: 'chart_type_line',
  line_markers: 'chart_type_line_markers',
  step_line: 'chart_type_step_line',
  area: 'chart_type_area',
  hlc_area: 'chart_type_hlc_area',
  baseline: 'chart_type_baseline'
}

/** Menu order: the common candle types first (unchanged from before SC-NEXT; kept for hosts/tests that read the flat list). */
export const CHART_TYPE_ORDER: readonly ChartType[] = [
  'candle_solid', 'candle_up_stroke', 'candle_stroke', 'candle_down_stroke', 'heikin_ashi',
  'ohlc', 'volume_bars', 'columns', 'high_low',
  'line', 'line_markers', 'step_line',
  'area', 'hlc_area', 'baseline'
]

export function chartTypeLabel (type: ChartType, locale: string): string {
  return i18n(LABEL_KEYS[type], locale)
}

export interface ChartTypeItem { key: ChartType, text: string }

export function chartTypeItems (locale: string): ChartTypeItem[] {
  return CHART_TYPE_ORDER.map(key => ({ key, text: chartTypeLabel(key, locale) }))
}

/** For tests: every type in CHART_TYPES is listed once. */
export function chartTypeOrderIsComplete (): boolean {
  return CHART_TYPE_ORDER.length === CHART_TYPES.length && CHART_TYPES.every(t => CHART_TYPE_ORDER.includes(t))
}

// ---- Grouped + favourited chart-type menu (SC-NEXT #2) --------------------
//
// A second view of the same CHART_TYPES, grouped and curated to the 13 types
// SC-NEXT's reference (11.png) shows — 'candle_stroke' stands in for a single
// "Hollow Candle" entry ('candle_up_stroke'/'candle_down_stroke' stay valid
// ChartType values for API/backward-compat callers, just not in this menu).

export type ChartTypeGroupId = 'candles' | 'bars' | 'lines' | 'areas'

export interface ChartTypeGroup { id: ChartTypeGroupId, labelKey: string, types: readonly ChartType[] }

export const CHART_TYPE_GROUPS: readonly ChartTypeGroup[] = [
  { id: 'candles', labelKey: 'chart_type_group_candles', types: ['candle_solid', 'candle_stroke', 'heikin_ashi'] },
  { id: 'bars', labelKey: 'chart_type_group_bars', types: ['ohlc', 'volume_bars', 'columns', 'high_low'] },
  { id: 'lines', labelKey: 'chart_type_group_lines', types: ['line', 'line_markers', 'step_line'] },
  { id: 'areas', labelKey: 'chart_type_group_areas', types: ['area', 'hlc_area', 'baseline'] }
]

/** Every type CHART_TYPE_GROUPS lists, in group order — the set the grouped menu and its favourites operate over. */
export const GROUPED_CHART_TYPES: readonly ChartType[] = CHART_TYPE_GROUPS.flatMap(g => g.types)

export function isGroupedChartType (type: string): type is ChartType {
  return (GROUPED_CHART_TYPES as readonly string[]).includes(type)
}

const FAVOURITES_STORAGE_KEY = 'klinecharts-pro-chart-type-favourites'
/** Shown starred by default, matching 11.png (Candle and Heikin Ashi both starred there). */
export const DEFAULT_FAVOURITE_CHART_TYPES: readonly ChartType[] = ['candle_solid', 'heikin_ashi']

/** Adds or removes one type from a favourites set, immutably. */
export function toggleFavourite (favourites: ReadonlySet<ChartType>, type: ChartType): Set<ChartType> {
  const next = new Set(favourites)
  if (next.has(type)) next.delete(type)
  else next.add(type)
  return next
}

/** Reads the persisted favourites set from `storage` (sessionStorage/localStorage-shaped); DEFAULT_FAVOURITE_CHART_TYPES on anything missing, unparsable, or naming an unknown type. */
export function loadFavourites (storage: Pick<Storage, 'getItem'> | null | undefined): Set<ChartType> {
  try {
    const raw = storage?.getItem(FAVOURITES_STORAGE_KEY)
    if (raw === null || raw === undefined) return new Set(DEFAULT_FAVOURITE_CHART_TYPES)
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set(DEFAULT_FAVOURITE_CHART_TYPES)
    const valid = parsed.filter((v): v is ChartType => typeof v === 'string' && (CHART_TYPES as readonly string[]).includes(v))
    return new Set(valid)
  } catch {
    return new Set(DEFAULT_FAVOURITE_CHART_TYPES)
  }
}

export function saveFavourites (storage: Pick<Storage, 'setItem'> | null | undefined, favourites: ReadonlySet<ChartType>): void {
  try {
    storage?.setItem(FAVOURITES_STORAGE_KEY, JSON.stringify([...favourites]))
  } catch { /* private mode / quota: favourites just do not persist this session. */ }
}
