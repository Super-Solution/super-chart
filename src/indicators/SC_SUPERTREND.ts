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
 * SC_SUPERTREND (SC-169): TradingView's ta.supertrend. The line changes side
 * (upper/lower band) on a trend flip, so a single flat-coloured line figure
 * would either connect the flip with a diagonal (klinecharts 9.1.1, which does
 * not break a line at a null value) or leave an unwanted gap on 9.8.12 (which
 * does) — neither is right, and neither can be a *coloured* two-tone line
 * anyway (a 'line' figure takes one colour). `draw` paints it as coloured
 * per-trend runs instead and returns true (no default line drawing); the
 * `figures` entry stays only for the legend/tooltip value.
 *
 * Maintained by ZzyzxLabs. Part of SUPer-Chart (Apache-2.0).
 */
import type { IndicatorDrawParams, IndicatorTemplate, KLineData } from 'klinecharts'
import { supertrend } from '../ta'
import { ohlcv, SERIES_PRICE } from './shared'

interface Row { line: number, trend: number }

export function calcScSupertrend (dataList: KLineData[], indicator?: { calcParams?: unknown[] }): Row[] {
  const p = indicator?.calcParams ?? [10, 3]
  const len = Number(p[0]) > 0 ? Number(p[0]) : 10
  const factor = Number(p[1]) > 0 ? Number(p[1]) : 3
  const { high, low, close } = ohlcv(dataList)
  const { line, trend } = supertrend(high, low, close, len, factor)
  return dataList.map((_, i) => (line[i] == null || trend[i] == null ? {} : { line: line[i] as number, trend: trend[i] as number }) as Row)
}

function drawSupertrend (params: IndicatorDrawParams<Row>): boolean {
  const { ctx, indicator, visibleRange, xAxis, yAxis, defaultStyles } = params
  const result = indicator.result
  const upColor = defaultStyles.bars[0].upColor
  const downColor = defaultStyles.bars[0].downColor
  ctx.save()
  ctx.lineWidth = 1.5
  let drawing = false
  let lastTrend: number | undefined
  const from = Math.max(0, visibleRange.from - 1)
  const to = Math.min(result.length - 1, visibleRange.to + 1)
  for (let i = from; i <= to; i++) {
    const row = result[i]
    if (row?.line == null || row.trend == null) { if (drawing) { ctx.stroke(); drawing = false } continue }
    const x = xAxis.convertToPixel(i)
    const y = yAxis.convertToPixel(row.line)
    if (!drawing || row.trend !== lastTrend) {
      if (drawing) ctx.stroke()
      ctx.strokeStyle = row.trend > 0 ? upColor : downColor
      ctx.beginPath()
      ctx.moveTo(x, y)
      drawing = true
    } else {
      ctx.lineTo(x, y)
    }
    lastTrend = row.trend
  }
  if (drawing) ctx.stroke()
  ctx.restore()
  return true
}

export const SC_SUPERTREND: IndicatorTemplate<Row> = {
  name: 'SC_SUPERTREND',
  shortName: 'SuperTrend',
  series: SERIES_PRICE,
  precision: 2,
  calcParams: [10, 3],
  figures: [{ key: 'line', title: 'SuperTrend: ', type: 'line' }],
  calc: calcScSupertrend,
  draw: drawSupertrend
}
