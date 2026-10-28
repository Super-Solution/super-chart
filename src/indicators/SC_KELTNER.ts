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
 * SC_KELTNER (SC-169): Keltner Channels (TradingView, ATR bands style) —
 * basis = ema(close, len), basis ± mult × atr(atrLen). Drawn on the price
 * pane as three lines (basis solid, bands dashed); a translucent fill between
 * the bands is left for a follow-up (see the PR body).
 *
 * Maintained by ZzyzxLabs. Part of SUPer-Chart (Apache-2.0).
 */
import type { IndicatorTemplate, KLineData } from 'klinecharts'
import { keltner } from '../ta'
import { ohlcv, toRows, lineStyle, SC_PALETTE, SERIES_PRICE } from './shared'

type Row = Record<string, number>

export function calcScKeltner (dataList: KLineData[], indicator?: { calcParams?: unknown[] }): Row[] {
  const p = indicator?.calcParams ?? [20, 2, 10]
  const len = Number(p[0]) > 0 ? Number(p[0]) : 20
  const mult = Number(p[1]) > 0 ? Number(p[1]) : 2
  const atrLen = Number(p[2]) > 0 ? Number(p[2]) : 10
  const { high, low, close } = ohlcv(dataList)
  const { basis, upper, lower } = keltner(high, low, close, len, mult, atrLen)
  return toRows(['basis', 'upper', 'lower'], [basis, upper, lower])
}

export const SC_KELTNER: IndicatorTemplate<Row> = {
  name: 'SC_KELTNER',
  shortName: 'Keltner',
  series: SERIES_PRICE,
  precision: 2,
  calcParams: [20, 2, 10],
  figures: [
    { key: 'basis', title: 'Basis: ', type: 'line' },
    { key: 'upper', title: 'Upper: ', type: 'line' },
    { key: 'lower', title: 'Lower: ', type: 'line' }
  ],
  styles: {
    lines: [lineStyle(SC_PALETTE[0], false, 1), lineStyle(SC_PALETTE[3], true, 1), lineStyle(SC_PALETTE[3], true, 1)]
  } as IndicatorTemplate<Row>['styles'],
  calc: calcScKeltner
}
