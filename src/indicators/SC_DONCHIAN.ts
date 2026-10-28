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
 * SC_DONCHIAN (SC-169): Donchian Channels — upper = highest(high, len),
 * lower = lowest(low, len), basis = their midpoint.
 *
 * Maintained by ZzyzxLabs. Part of SUPer-Chart (Apache-2.0).
 */
import type { IndicatorTemplate, KLineData } from 'klinecharts'
import { donchian } from '../ta'
import { ohlcv, toRows, lineStyle, SC_PALETTE, SERIES_PRICE } from './shared'

type Row = Record<string, number>

export function calcScDonchian (dataList: KLineData[], indicator?: { calcParams?: unknown[] }): Row[] {
  const len = Number(indicator?.calcParams?.[0]) > 0 ? Number(indicator!.calcParams![0]) : 20
  const { high, low } = ohlcv(dataList)
  const { basis, upper, lower } = donchian(high, low, len)
  return toRows(['basis', 'upper', 'lower'], [basis, upper, lower])
}

export const SC_DONCHIAN: IndicatorTemplate<Row> = {
  name: 'SC_DONCHIAN',
  shortName: 'Donchian',
  series: SERIES_PRICE,
  precision: 2,
  calcParams: [20],
  figures: [
    { key: 'basis', title: 'Basis: ', type: 'line' },
    { key: 'upper', title: 'Upper: ', type: 'line' },
    { key: 'lower', title: 'Lower: ', type: 'line' }
  ],
  styles: {
    lines: [lineStyle(SC_PALETTE[0], true, 1), lineStyle(SC_PALETTE[1], false, 1), lineStyle(SC_PALETTE[1], false, 1)]
  } as IndicatorTemplate<Row>['styles'],
  calc: calcScDonchian
}
