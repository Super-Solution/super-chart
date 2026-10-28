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
 * SC_ATR_BANDS (SC-169): close ± mult × atr(len), a simpler volatility band
 * than Keltner (whose basis is an EMA, not the close itself).
 *
 * Maintained by ZzyzxLabs. Part of SUPer-Chart (Apache-2.0).
 */
import type { IndicatorTemplate, KLineData } from 'klinecharts'
import { atrBands } from '../ta'
import { ohlcv, toRows, lineStyle, SC_PALETTE, SERIES_PRICE } from './shared'

type Row = Record<string, number>

export function calcScAtrBands (dataList: KLineData[], indicator?: { calcParams?: unknown[] }): Row[] {
  const p = indicator?.calcParams ?? [14, 2]
  const len = Number(p[0]) > 0 ? Number(p[0]) : 14
  const mult = Number(p[1]) > 0 ? Number(p[1]) : 2
  const { high, low, close } = ohlcv(dataList)
  const { basis, upper, lower } = atrBands(high, low, close, len, mult)
  return toRows(['basis', 'upper', 'lower'], [basis, upper, lower])
}

export const SC_ATR_BANDS: IndicatorTemplate<Row> = {
  name: 'SC_ATR_BANDS',
  shortName: 'ATR Bands',
  series: SERIES_PRICE,
  precision: 2,
  calcParams: [14, 2],
  figures: [
    { key: 'basis', title: 'Close: ', type: 'line' },
    { key: 'upper', title: 'Upper: ', type: 'line' },
    { key: 'lower', title: 'Lower: ', type: 'line' }
  ],
  styles: {
    lines: [lineStyle(SC_PALETTE[0], false, 1), lineStyle(SC_PALETTE[4], true, 1), lineStyle(SC_PALETTE[4], true, 1)]
  } as IndicatorTemplate<Row>['styles'],
  calc: calcScAtrBands
}
