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
 * SC_VWAP (SC-168): a session-anchored VWAP with bands, off by default (the
 * adopted bare-chart defaults). SuperScript's own `vwap()` stays cumulative
 * from the first loaded bar (no session reset) — that is existing, tested
 * behaviour, and the language runtime is not owned by this batch — but the
 * chart-facing indicator now has a real session VWAP.
 *
 * calcParams are numeric (klinecharts' settings form only edits numbers):
 * [0]=anchor — 0 session/day, 1 week, 2 month, 3 quarter, 4 year — [1]=UTC
 * offset in minutes (the bucket boundary), [2]=band multiplier. Buckets are
 * computed from each bar's OWN timestamp shifted by that fixed offset, not
 * the full IANA tz-database (no DST rules): this is a documented
 * simplification, not full per-symbol timezone support. Because each bar's
 * bucket depends only on its own timestamp, the value on a bar whose whole
 * anchor period is loaded is identical whether 200, 400 or 800 bars of
 * history are loaded — the tested guarantee (SC-168's "same value at 200 vs
 * 400 bars").
 *
 * Maintained by ZzyzxLabs. Part of SUPer-Chart (Apache-2.0).
 */
import type { IndicatorTemplate, KLineData } from 'klinecharts'
import { anchoredVwap } from '../ta'
import { ohlcv, toRows, lineStyle, SC_PALETTE, SERIES_PRICE } from './shared'

type Row = Record<string, number>

const DAY_MS = 86400000

/** A key that is equal for two timestamps in the same bucket and different otherwise. Not ISO-aligned for week/quarter; only equality/inequality matters to anchoredVwap. */
export function vwapPeriodKey (timestampMs: number, anchor: number, offsetMinutes: number): number {
  const t = timestampMs + offsetMinutes * 60000
  const d = new Date(t)
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth()
  switch (anchor) {
    case 1: return Math.floor((Math.floor(t / DAY_MS) - 3) / 7) // week bucket
    case 2: return y * 100 + m // month
    case 3: return y * 10 + Math.floor(m / 3) // quarter
    case 4: return y // year
    default: return Math.floor(t / DAY_MS) // session/day
  }
}

export function calcScVwap (dataList: KLineData[], indicator?: { calcParams?: unknown[] }): Row[] {
  const p = indicator?.calcParams ?? [0, 0, 2]
  const anchor = Number(p[0]) || 0
  const offsetMinutes = Number(p[1]) || 0
  const mult = Number(p[2]) > 0 ? Number(p[2]) : 2
  const { high, low, close, volume } = ohlcv(dataList)
  const periods = dataList.map(d => vwapPeriodKey(d.timestamp, anchor, offsetMinutes))
  const { vwap, stdev } = anchoredVwap(high, low, close, volume, periods, true)
  const upper = vwap.map((v, i) => (v == null || stdev[i] == null ? null : v + mult * (stdev[i] as number)))
  const lower = vwap.map((v, i) => (v == null || stdev[i] == null ? null : v - mult * (stdev[i] as number)))
  return toRows(['vwap', 'upper', 'lower'], [vwap, upper, lower])
}

export const SC_VWAP: IndicatorTemplate<Row> = {
  name: 'SC_VWAP',
  shortName: 'VWAP',
  series: SERIES_PRICE,
  precision: 2,
  calcParams: [0, 0, 2],
  figures: [
    { key: 'vwap', title: 'VWAP: ', type: 'line' },
    { key: 'upper', title: 'Upper: ', type: 'line' },
    { key: 'lower', title: 'Lower: ', type: 'line' }
  ],
  styles: {
    lines: [lineStyle(SC_PALETTE[1], false, 1.5), lineStyle(SC_PALETTE[1], true, 1), lineStyle(SC_PALETTE[1], true, 1)]
  } as IndicatorTemplate<Row>['styles'],
  calc: calcScVwap
}
