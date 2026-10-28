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
 * SC_BBP (SC-170): Bollinger %B — (price - lower band) / (upper - lower). No
 * TA-Lib function of its own; derived from the same bollinger() the ta core
 * uses for BOLL-style bands. Reads above 1 or below 0 when price is outside
 * the bands, which is expected (not clamped).
 *
 * Maintained by ZzyzxLabs. Part of SUPer-Chart (Apache-2.0).
 */
import { priceSeries } from '../core/series'
import type { IndicatorTemplate, KLineData } from 'klinecharts'
import { bbPercent } from '../ta'
import { createLevelsDraw } from './levels'
import { OSCILLATOR_PRECISION, toRows, SERIES_NORMAL } from './shared'

type Row = Record<string, number>

export function calcScBbp (dataList: KLineData[], indicator?: { calcParams?: unknown[] }): Row[] {
  const p = indicator?.calcParams ?? [20, 2]
  const len = Number(p[0]) > 0 ? Number(p[0]) : 20
  const mult = Number(p[1]) > 0 ? Number(p[1]) : 2
  const close = priceSeries(dataList, 'close')
  return toRows(['b'], [bbPercent(close, len, mult)])
}

export const SC_BBP: IndicatorTemplate<Row> = {
  name: 'SC_BBP',
  shortName: '%B',
  series: SERIES_NORMAL,
  precision: OSCILLATOR_PRECISION,
  calcParams: [20, 2],
  figures: [{ key: 'b', title: '%B: ', type: 'line' }],
  calc: calcScBbp,
  draw: createLevelsDraw('SC_BBP')
}
