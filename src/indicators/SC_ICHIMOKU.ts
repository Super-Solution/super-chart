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
 * SC_ICHIMOKU (SC-169): TradingView defaults (9, 26, 52, 26). Conversion
 * (Tenkan), base (Kijun), Senkou span A/B and the Chikou span are all placed
 * at the bar they should be READ at — `ta.ichimoku` already shifts the
 * leading spans forward and the lagging span back by `displacement - 1`
 * bars, so no further offsetting happens here.
 *
 * Known limitation, called out in the PR body rather than silently clipped:
 * klinecharts' `calc` must return one row per existing bar, so the forward
 * projection of the cloud PAST the last real bar (`ta.ichimoku`'s `futureA`/
 * `futureB`) is not drawn. Values up to and including the last bar are
 * correct; only the projection beyond the dataset is left for a follow-up
 * (a `draw` callback painting past `visibleRange`, the same technique
 * SC_SUPERTREND uses for its coloured line).
 *
 * Maintained by ZzyzxLabs. Part of SUPer-Chart (Apache-2.0).
 */
import type { IndicatorTemplate, KLineData } from 'klinecharts'
import { ichimoku } from '../ta'
import { ohlcv, toRows, lineStyle, SC_PALETTE, SERIES_PRICE } from './shared'

type Row = Record<string, number>

export function calcScIchimoku (dataList: KLineData[], indicator?: { calcParams?: unknown[] }): Row[] {
  const p = indicator?.calcParams ?? [9, 26, 52, 26]
  const conv = Number(p[0]) > 0 ? Number(p[0]) : 9
  const base = Number(p[1]) > 0 ? Number(p[1]) : 26
  const spanB = Number(p[2]) > 0 ? Number(p[2]) : 52
  const displacement = Number(p[3]) > 0 ? Number(p[3]) : 26
  const { high, low, close } = ohlcv(dataList)
  const r = ichimoku(high, low, close, conv, base, spanB, displacement)
  return toRows(['conversion', 'base', 'spanA', 'spanB', 'lagging'], [r.conversion, r.base, r.spanA, r.spanB, r.lagging])
}

export const SC_ICHIMOKU: IndicatorTemplate<Row> = {
  name: 'SC_ICHIMOKU',
  shortName: 'Ichimoku',
  series: SERIES_PRICE,
  precision: 2,
  calcParams: [9, 26, 52, 26],
  figures: [
    { key: 'conversion', title: 'Conversion: ', type: 'line' },
    { key: 'base', title: 'Base: ', type: 'line' },
    { key: 'spanA', title: 'Span A: ', type: 'line' },
    { key: 'spanB', title: 'Span B: ', type: 'line' },
    { key: 'lagging', title: 'Lagging: ', type: 'line' }
  ],
  styles: {
    lines: [
      lineStyle(SC_PALETTE[1], false, 1),
      lineStyle(SC_PALETTE[2], false, 1),
      lineStyle(SC_PALETTE[3], false, 1),
      lineStyle(SC_PALETTE[4], false, 1),
      lineStyle(SC_PALETTE[5], true, 1)
    ]
  } as IndicatorTemplate<Row>['styles'],
  calc: calcScIchimoku
}
