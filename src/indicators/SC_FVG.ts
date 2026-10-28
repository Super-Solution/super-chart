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
 * SC_FVG (SC-NEXT #6, Smart Money Concepts): Fair Value Gaps, a candle-pane
 * indicator built the same way as SC_ORDER_BLOCKS/SC_VRVP — `calc` is a
 * no-op, `draw` recomputes over a small window around `visibleRange` every
 * frame using the pure `detectFairValueGaps()`
 * (extension/fairValueGaps.ts). No calcParams: the 3-candle imbalance
 * definition has no free parameters.
 *
 * "Filled" is checked only using bars inside that same window, so a gap can
 * briefly still show as open for a couple of frames after the bar that fills
 * it scrolls into view from the right edge of a *wider* window than what was
 * scanned last frame — it self-corrects as soon as that bar is inside
 * [visibleRange.from - 2, visibleRange.to]. This is the same bounded-window
 * trade-off VRVP/Order Blocks make for large-dataset performance.
 *
 * Maintained by ZzyzxLabs. Part of SUPer-Chart (Apache-2.0).
 */
import type { IndicatorDrawParams, IndicatorTemplate } from 'klinecharts'
import { detectFairValueGaps } from '../extension/fairValueGaps'
import { SERIES_NORMAL } from './shared'

type Row = Record<string, never>

function drawFvg (params: IndicatorDrawParams<Row>): boolean {
  const { ctx, kLineDataList, visibleRange, xAxis, yAxis, defaultStyles } = params
  const lo = Math.max(0, visibleRange.from - 2)
  const hi = Math.min(kLineDataList.length - 1, visibleRange.to)
  if (hi - lo < 2) return false
  const window = kLineDataList.slice(lo, hi + 1)
  const gaps = detectFairValueGaps(window)
  if (gaps.length === 0) return false
  const upColor = defaultStyles.bars[0].upColor
  const downColor = defaultStyles.bars[0].downColor
  const rightEdgePixel = xAxis.convertToPixel(hi)
  ctx.save()
  for (const gap of gaps) {
    const absIndex = gap.index + lo
    const absFilledIndex = gap.filledAtIndex !== null ? gap.filledAtIndex + lo : null
    const x0 = xAxis.convertToPixel(absIndex)
    const x1 = absFilledIndex !== null ? xAxis.convertToPixel(absFilledIndex) : rightEdgePixel
    const y0 = yAxis.convertToPixel(gap.top)
    const y1 = yAxis.convertToPixel(gap.bottom)
    ctx.globalAlpha = gap.filled ? 0.08 : 0.22
    ctx.fillStyle = gap.direction === 'bullish' ? upColor : downColor
    ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.max(1, Math.abs(x1 - x0)), Math.max(1, Math.abs(y1 - y0)))
  }
  ctx.restore()
  return false
}

export const SC_FVG: IndicatorTemplate<Row> = {
  name: 'SC_FVG',
  shortName: 'FVG',
  series: SERIES_NORMAL,
  calcParams: [],
  figures: [],
  calc: (dataList) => dataList.map(() => ({})),
  draw: drawFvg
}
