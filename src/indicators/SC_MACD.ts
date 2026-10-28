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
 * SC_MACD (SC-160): klinecharts' built-in 'MACD' sets `histogram = (dif - dea) * 2`
 * and paints every bar with only two colours (stroke above/below, hollow —
 * `style` is never 'fill'). SC_MACD uses `hist = dif - dea` (TradingView) from
 * the shared ta core, and a filled 4-colour histogram (strong/light up, light/
 * strong down) so rising vs falling reads at a glance, following the adopted
 * TradingView-conventions default. The built-in stays registered, unchanged,
 * for existing direct callers; engine paths alias 'MACD' to this name.
 *
 * `series: Price` only syncs this instance's *precision digit count* to the
 * symbol's price precision (klinecharts' own IndicatorStore.synchronizeSeriesPrecision) —
 * it does not move the pane onto the price axis' numeric range, which stays
 * auto-fit to MACD's own values as normal for a sub-pane oscillator.
 *
 * Maintained by ZzyzxLabs. Part of SUPer-Chart (Apache-2.0).
 */
import type { IndicatorFigureStyle, IndicatorStyle, IndicatorTemplate, KLineData } from 'klinecharts'
import { macd } from '../ta'
import { ohlcv, SERIES_PRICE } from './shared'

interface Row { dif: number, dea: number, hist: number }

function hexToRgba (hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (m === null) return hex
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

/** Strong colour when the bar continues its side's move, a lighter shade when it eases back toward zero. */
function histColor (defaults: IndicatorStyle, hist: number, prev: number | undefined): string {
  const up = defaults.bars[0].upColor
  const down = defaults.bars[0].downColor
  const rising = prev === undefined ? hist >= 0 : hist >= prev
  if (hist >= 0) return rising ? up : hexToRgba(up, 0.5)
  return rising ? hexToRgba(down, 0.5) : down
}

export function calcScMacd (dataList: KLineData[], indicator?: { calcParams?: unknown[] }): Row[] {
  const p = indicator?.calcParams ?? [12, 26, 9]
  const fast = Number(p[0]) > 0 ? Number(p[0]) : 12
  const slow = Number(p[1]) > 0 ? Number(p[1]) : 26
  const signal = Number(p[2]) > 0 ? Number(p[2]) : 9
  const { close } = ohlcv(dataList)
  const { dif, dea, hist } = macd(close, fast, slow, signal)
  return dataList.map((_, i) => {
    const row: Partial<Row> = {}
    if (dif[i] != null) row.dif = dif[i] as number
    if (dea[i] != null) row.dea = dea[i] as number
    if (hist[i] != null) row.hist = hist[i] as number
    return row as Row
  })
}

export const SC_MACD: IndicatorTemplate<Row> = {
  name: 'SC_MACD',
  shortName: 'MACD',
  series: SERIES_PRICE,
  calcParams: [12, 26, 9],
  figures: [
    {
      key: 'hist',
      title: 'Histogram: ',
      type: 'bar',
      baseValue: 0,
      styles: (data, _indicator, defaults) => {
        const cur = data.current.indicatorData?.hist
        if (cur == null) return {}
        const color = histColor(defaults, cur, data.prev.indicatorData?.hist)
        // 'fill' is PolygonType.Fill's runtime value; importing the enum
        // itself crashes under vitest (see shared.ts's SERIES_* comment for
        // the same class of klinecharts-packaging issue), so this is typed
        // through, not imported.
        return { style: 'fill' as IndicatorFigureStyle['style'], color, borderColor: color }
      } 
    },
    { key: 'dif', title: 'MACD: ', type: 'line' },
    { key: 'dea', title: 'Signal: ', type: 'line' }
  ],
  calc: calcScMacd
}
