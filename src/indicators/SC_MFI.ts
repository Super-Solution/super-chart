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
 * SC_MFI (SC-170): Money Flow Index (volume-weighted RSI over hlc3), missing
 * from klinecharts' 27 built-ins. Built on the same `ta.mfi` SuperScript's
 * `mfi()` calls.
 *
 * Maintained by ZzyzxLabs. Part of SUPer-Chart (Apache-2.0).
 */
import type { IndicatorTemplate, KLineData } from 'klinecharts'
import { mfi } from '../ta'
import { createLevelsDraw } from './levels'
import { ohlcv, OSCILLATOR_PRECISION, toRows, SERIES_NORMAL } from './shared'

type Row = Record<string, number>

export function calcScMfi (dataList: KLineData[], indicator?: { calcParams?: unknown[] }): Row[] {
  const len = Number(indicator?.calcParams?.[0]) > 0 ? Number(indicator!.calcParams![0]) : 14
  const { high, low, close, volume } = ohlcv(dataList)
  return toRows(['mfi'], [mfi(high, low, close, volume, len)])
}

export const SC_MFI: IndicatorTemplate<Row> = {
  name: 'SC_MFI',
  shortName: 'MFI',
  series: SERIES_NORMAL,
  precision: OSCILLATOR_PRECISION,
  calcParams: [14],
  minValue: 0,
  maxValue: 100,
  figures: [{ key: 'mfi', title: 'MFI: ', type: 'line' }],
  regenerateFigures: (calcParams) => [{ key: 'mfi', title: `MFI${Number(calcParams?.[0]) || 14}: `, type: 'line' }],
  calc: calcScMfi,
  draw: createLevelsDraw('SC_MFI')
}
