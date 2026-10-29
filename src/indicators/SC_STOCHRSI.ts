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
 * SC_STOCHRSI (SC-170): TradingView's Stochastic RSI — `ta.stochRsi`, not
 * TA-Lib's STOCHRSI (whose default output is the unsmoothed %K). Defaults
 * (14, 14, 3, 3) match TradingView's "Stochastic RSI".
 *
 * Maintained by ZzyzxLabs. Part of SUPer-Chart (Apache-2.0).
 */
import { priceSeries } from '../core/series'
import type { IndicatorTemplate, KLineData } from 'klinecharts'
import { stochRsi } from '../ta'
import { createLevelsDraw } from './levels'
import { OSCILLATOR_PRECISION, toRows, SERIES_NORMAL } from './shared'

type Row = Record<string, number>

export function calcScStochRsi (dataList: KLineData[], indicator?: { calcParams?: unknown[] }): Row[] {
  const p = indicator?.calcParams ?? [14, 14, 3, 3]
  const rsiLen = Number(p[0]) > 0 ? Number(p[0]) : 14
  const stochLen = Number(p[1]) > 0 ? Number(p[1]) : 14
  const kLen = Number(p[2]) > 0 ? Number(p[2]) : 3
  const dLen = Number(p[3]) > 0 ? Number(p[3]) : 3
  const close = priceSeries(dataList, 'close')
  const { k, d } = stochRsi(close, rsiLen, stochLen, kLen, dLen)
  return toRows(['k', 'd'], [k, d])
}

export const SC_STOCHRSI: IndicatorTemplate<Row> = {
  name: 'SC_STOCHRSI',
  shortName: 'STOCHRSI',
  series: SERIES_NORMAL,
  precision: OSCILLATOR_PRECISION,
  calcParams: [14, 14, 3, 3],
  minValue: 0,
  maxValue: 100,
  figures: [
    { key: 'k', title: '%K: ', type: 'line' },
    { key: 'd', title: '%D: ', type: 'line' }
  ],
  calc: calcScStochRsi,
  draw: createLevelsDraw('SC_STOCHRSI')
}
