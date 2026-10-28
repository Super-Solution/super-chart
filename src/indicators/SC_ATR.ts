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
 * SC_ATR (SC-170): Average True Range (Wilder), missing from klinecharts' 27
 * built-ins. Built on the shared ta core so it agrees with SuperScript's
 * `atr()` and with SC_KELTNER/SC_SUPERTREND/SC_ATR_BANDS, which use the same
 * function. `series: Price` only syncs the precision digit count, not the pane's
 * y-range (see SC_MACD's doc comment).
 *
 * Maintained by ZzyzxLabs. Part of SUPer-Chart (Apache-2.0).
 */
import type { IndicatorTemplate, KLineData } from 'klinecharts'
import { atr } from '../ta'
import { ohlcv, toRows, SERIES_PRICE } from './shared'

type Row = Record<string, number>

export function calcScAtr (dataList: KLineData[], indicator?: { calcParams?: unknown[] }): Row[] {
  const len = Number(indicator?.calcParams?.[0]) > 0 ? Number(indicator!.calcParams![0]) : 14
  const { high, low, close } = ohlcv(dataList)
  return toRows(['atr'], [atr(high, low, close, len)])
}

export const SC_ATR: IndicatorTemplate<Row> = {
  name: 'SC_ATR',
  shortName: 'ATR',
  series: SERIES_PRICE,
  calcParams: [14],
  minValue: 0,
  figures: [{ key: 'atr', title: 'ATR: ', type: 'line' }],
  regenerateFigures: (calcParams) => [{ key: 'atr', title: `ATR${Number(calcParams?.[0]) || 14}: `, type: 'line' }],
  calc: calcScAtr
}
