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
 * Small pieces every SC_* template shares (SC-172): a complete line style
 * (klinecharts 9.8.12 indexes `styles.lines[i]` per line figure and reads
 * `dashedValue[0]` while merging — a partial entry throws and blanks the
 * pane), the precision-by-value-type table, and a null-safe series reader.
 *
 * Maintained by ZzyzxLabs. Part of SUPer-Chart (Apache-2.0).
 */
import type { IndicatorSeries, KLineData } from 'klinecharts'
import type { Series } from '../ta'
import { ACCENT } from '../theme/tokens'

/**
 * `IndicatorSeries` string values, typed but never imported as a runtime
 * value: klinecharts' own UMD/CJS build does not resolve correctly under
 * Node's ESM loader (the same class of packaging bug as SC-186, but in the
 * peer dependency, not this package) — importing the ENUM OBJECT crashes at
 * module load under vitest, though the browser build (which loads the host's
 * real ESM copy) is unaffected. A plain string that matches one of the
 * enum's own values is a valid `IndicatorSeries` in every klinecharts version
 * this package targets, and this constant never touches the export.
 */
export const SERIES_NORMAL = 'normal' as IndicatorSeries
export const SERIES_PRICE = 'price' as IndicatorSeries
export const SERIES_VOLUME = 'volume' as IndicatorSeries

/** A complete klinecharts line style (never a partial object: see the module doc). */
export interface CompleteLineStyle {
  style: 'solid' | 'dashed'
  smooth: boolean
  size: number
  dashedValue: number[]
  color: string
}

export function lineStyle (color: string, dashed = false, size = 1): CompleteLineStyle {
  return { style: dashed ? 'dashed' : 'solid', smooth: false, size, dashedValue: dashed ? [4, 4] : [2, 2], color }
}

/** A small, colour-blind-friendlier palette for multi-line SC_ templates beyond the accent. */
export const SC_PALETTE: readonly string[] = [ACCENT, '#FF6D00', '#AB47BC', '#26A69A', '#EF5350', '#FFCA28']

/** Bounded/percentage oscillators: 2 decimals is enough and keeps the y-axis narrow (SC-172). */
export const OSCILLATOR_PRECISION = 2

export function ohlcv (dataList: KLineData[]): { high: Series, low: Series, close: Series, volume: Series } {
  const n = dataList.length
  const high: Series = new Array(n)
  const low: Series = new Array(n)
  const close: Series = new Array(n)
  const volume: Series = new Array(n)
  for (let i = 0; i < n; i++) {
    const d = dataList[i]
    high[i] = typeof d.high === 'number' ? d.high : null
    low[i] = typeof d.low === 'number' ? d.low : null
    close[i] = typeof d.close === 'number' ? d.close : null
    volume[i] = typeof d.volume === 'number' ? d.volume : null
  }
  return { high, low, close, volume }
}

/** Row-shape helper: zip named series into one row object per bar, dropping non-finite/null values so klinecharts sees a gap, never NaN/Infinity. */
export function toRows (keys: readonly string[], series: readonly Series[]): Array<Record<string, number>> {
  const n = series[0]?.length ?? 0
  const rows = new Array<Record<string, number>>(n)
  for (let i = 0; i < n; i++) {
    const row: Record<string, number> = {}
    for (let k = 0; k < keys.length; k++) {
      const v = series[k][i]
      if (v != null && Number.isFinite(v)) row[keys[k]] = v
    }
    rows[i] = row
  }
  return rows
}
