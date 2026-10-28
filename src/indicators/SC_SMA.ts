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
 * SC_SMA (SC-167): klinecharts' built-in 'SMA' is EMA(12) under a misleading
 * name (calcParams [12, 2] feeds `(2*close + 11*prev) / 13`, an exponential
 * smooth, not a rolling mean; the built-in stays registered, unchanged, so a
 * direct `createIndicator('SMA')` keeps working until the lockstep wallet PR
 * moves it to this name). SC_SMA is the arithmetic mean TradingView's SMA
 * means, with a single Length parameter — `calcParams[1]` is never read.
 *
 * A live tick either appends one bar or replaces the last one, with the same
 * dataList reference both times (see ./tail.ts), so the tail step only sums
 * the trailing `len` closes for the changed bar — O(len), not O(n).
 *
 * Maintained by ZzyzxLabs. Part of SUPer-Chart (Apache-2.0).
 */
import type { IndicatorTemplate, KLineData } from 'klinecharts'
import { sma } from '../ta'
import { ohlcv, toRows, SERIES_PRICE } from './shared'
import { paramsKey, tailMode, type TailCache } from './tail'

type Row = Record<string, number>
interface State { rows: Row[] }

const DEFAULT_LEN = 9 // TradingView's "Simple Moving Average" default (a changed default: the old SMA was EMA(12)).

function windowSum (dataList: KLineData[], endIndex: number, len: number): number | null {
  if (endIndex - len + 1 < 0) return null
  let sum = 0
  for (let j = endIndex - len + 1; j <= endIndex; j++) sum += dataList[j].close
  return sum
}

export function createScSmaCalc (): (dataList: KLineData[], indicator?: { calcParams?: unknown[] }) => Row[] {
  // Keyed by the indicator instance, not a bare closure variable: the template
  // (and this calc function) is shared by every instance klinecharts creates
  // from it, on every pane and every chart on the page (SC-008's lesson).
  const caches = new WeakMap<object, TailCache<State>>()
  return (dataList, indicator) => {
    const len = Number(indicator?.calcParams?.[0]) > 0 ? Math.round(Number(indicator!.calcParams![0])) : DEFAULT_LEN
    const key = paramsKey([len])
    const n = dataList.length
    const cacheKey = indicator ?? dataList
    const cache = caches.get(cacheKey) ?? null
    const mode = tailMode(cache, dataList, key)
    if (mode === 'full') {
      const { close } = ohlcv(dataList)
      const rows = toRows(['sma'], [sma(close, len)])
      caches.set(cacheKey, { ref: dataList, length: n, paramsKey: key, state: { rows } })
      return rows
    }
    const rows = cache!.state.rows
    if (mode === 'replace') rows.pop()
    const s = windowSum(dataList, n - 1, len)
    rows.push(s === null ? {} : { sma: s / len })
    caches.set(cacheKey, { ref: dataList, length: n, paramsKey: key, state: { rows } })
    return rows
  }
}

export const SC_SMA: IndicatorTemplate<Row> = {
  name: 'SC_SMA',
  shortName: 'SMA',
  series: SERIES_PRICE,
  precision: 2,
  calcParams: [DEFAULT_LEN],
  figures: [{ key: 'sma', title: 'SMA: ', type: 'line' }],
  regenerateFigures: (calcParams) => [{ key: 'sma', title: `SMA${Number(calcParams?.[0]) || DEFAULT_LEN}: `, type: 'line' }],
  calc: createScSmaCalc()
}
