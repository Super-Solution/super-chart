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
 * SC_STOCH (SC-170): TradingView-style Stochastic. klinecharts' 'KDJ' is a
 * different smoothing (a (n-1)/n recurrence seeded at 50, plus a J line), not
 * the plain %K/%D TradingView calls "Stochastic". %K = sma(rawK, smoothK), %D
 * = sma(%K, dLen); defaults (14, 1, 3) match TradingView's Stochastic.
 *
 * Maintained by ZzyzxLabs. Part of SUPer-Chart (Apache-2.0).
 */
import type { IndicatorTemplate, KLineData } from 'klinecharts'
import { sma, stochK } from '../ta'
import { createLevelsDraw } from './levels'
import { ohlcv, OSCILLATOR_PRECISION, toRows, SERIES_NORMAL } from './shared'

type Row = Record<string, number>

export function calcScStoch (dataList: KLineData[], indicator?: { calcParams?: unknown[] }): Row[] {
  const p = indicator?.calcParams ?? [14, 1, 3]
  const len = Number(p[0]) > 0 ? Number(p[0]) : 14
  const smoothK = Number(p[1]) > 0 ? Number(p[1]) : 1
  const dLen = Number(p[2]) > 0 ? Number(p[2]) : 3
  const { high, low, close } = ohlcv(dataList)
  const rawK = stochK(high, low, close, len)
  const k = sma(rawK, smoothK)
  const d = sma(k, dLen)
  return toRows(['k', 'd'], [k, d])
}

export const SC_STOCH: IndicatorTemplate<Row> = {
  name: 'SC_STOCH',
  shortName: 'STOCH',
  series: SERIES_NORMAL,
  precision: OSCILLATOR_PRECISION,
  calcParams: [14, 1, 3],
  minValue: 0,
  maxValue: 100,
  figures: [
    { key: 'k', title: '%K: ', type: 'line' },
    { key: 'd', title: '%D: ', type: 'line' }
  ],
  calc: calcScStoch,
  draw: createLevelsDraw('SC_STOCH')
}
