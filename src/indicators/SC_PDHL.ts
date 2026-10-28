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
 * SC_PDHL (SC-NEXT #6): previous day/week high-low, a candle-pane indicator.
 * `calc` is a no-op; `draw` calls the pure `previousRangeHighLow()`
 * (extension/previousRangeHighLow.ts) against the FULL `kLineDataList` (that
 * function only walks backward from the end until it leaves the current
 * period, then collects one more period — it never scans the whole array,
 * so this is cheap regardless of dataset size) and paints two dashed
 * reference lines using the same pixel geometry as
 * indicators/levels.ts's `levelSegments` (reused, not duplicated), plus a
 * short text label each — `levels.ts`'s own `drawLevels` deliberately draws
 * lines only (RSI/Stoch read their value off the pane's own axis ticks), but
 * a previous-day/week level needs its own label since the price axis has no
 * tick at exactly that value.
 *
 * The period boundary is always UTC (the crypto-market convention for "daily"
 * candles), independent of the clock widget's UTC/local display toggle
 * (canvas/clockWidget.ts) — the two are unrelated: this affects which bars
 * are grouped into "yesterday", the other only reformats a timestamp.
 *
 * Maintained by ZzyzxLabs. Part of SUPer-Chart (Apache-2.0).
 */
import type { IndicatorDrawParams, IndicatorTemplate } from 'klinecharts'
import { previousRangeHighLow, type RangePeriod } from '../extension/previousRangeHighLow'
import { levelSegments, type LevelLine } from './levels'
import { SERIES_NORMAL } from './shared'

type Row = Record<string, never>

const PDHL_COLOR = 'rgba(120, 130, 145, 0.75)'

function drawPdhl (params: IndicatorDrawParams<Row>): boolean {
  const { ctx, kLineDataList, indicator, bounding, yAxis } = params
  const period: RangePeriod = Number(indicator.calcParams?.[0]) === 1 ? 'week' : 'day'
  const result = previousRangeHighLow(kLineDataList, period, 'UTC')
  if (result === null) return false
  const levels: LevelLine[] = [
    { value: result.high, label: period === 'day' ? 'PDH' : 'PWH' },
    { value: result.low, label: period === 'day' ? 'PDL' : 'PWL' }
  ]
  const segs = levelSegments(levels, v => yAxis.convertToPixel(v), 0, bounding.width)
  ctx.save()
  ctx.strokeStyle = PDHL_COLOR
  ctx.fillStyle = PDHL_COLOR
  ctx.lineWidth = 1
  ctx.setLineDash([4, 4])
  ctx.font = '10px sans-serif'
  for (const s of segs) {
    ctx.beginPath()
    ctx.moveTo(s.x0, s.y)
    ctx.lineTo(s.x1, s.y)
    ctx.stroke()
    if (s.label !== undefined) ctx.fillText(s.label, s.x0 + 4, s.y - 3)
  }
  ctx.restore()
  return false
}

export const SC_PDHL: IndicatorTemplate<Row> = {
  name: 'SC_PDHL',
  shortName: 'Prev H/L',
  series: SERIES_NORMAL,
  calcParams: [0],
  figures: [],
  calc: (dataList) => dataList.map(() => ({})),
  draw: drawPdhl
}
