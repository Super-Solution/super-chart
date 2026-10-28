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
 * SC_ORDER_BLOCKS (SC-NEXT #6, Smart Money Concepts): a candle-pane indicator,
 * same shape as SC_VRVP — `calc` does no work, `draw` recomputes over a small
 * window around `visibleRange` (plus enough lookback/lookahead margin for the
 * detector itself, see extension/orderBlocks.ts) every frame, using the pure
 * `detectOrderBlocks()`. Bounding the window to roughly the visible range (not
 * the whole dataset) is what keeps this cheap at 60fps with a large dataset —
 * the same trade-off VRVP makes for its own visible-range scan.
 *
 * A block's box is drawn from its own candle out to the current right edge of
 * the visible range (there is no tracked "mitigated-at" index, only a
 * mitigated boolean — see extension/orderBlocks.ts's `OrderBlock`), and
 * mitigated blocks are drawn fainter and dashed rather than stopped exactly at
 * the bar that mitigated them. That is a deliberate simplification for this
 * first pass, not a bug: a full "stop the box at mitigation" rendering would
 * need the detector to also report the mitigating bar's index.
 *
 * Maintained by ZzyzxLabs. Part of SUPer-Chart (Apache-2.0).
 */
import type { IndicatorDrawParams, IndicatorTemplate } from 'klinecharts'
import { detectOrderBlocks } from '../extension/orderBlocks'
import { SERIES_NORMAL } from './shared'

type Row = Record<string, never>

function drawOrderBlocks (params: IndicatorDrawParams<Row>): boolean {
  const { ctx, kLineDataList, indicator, visibleRange, xAxis, yAxis, defaultStyles } = params
  const p = indicator.calcParams ?? []
  const swingLookback = Number(p[0]) > 0 ? Math.round(Number(p[0])) : 10
  const lookahead = Number(p[1]) > 0 ? Math.round(Number(p[1])) : 3
  const displacementFactor = Number(p[2]) >= 0 ? Number(p[2]) : 1.5
  const lo = Math.max(0, visibleRange.from - swingLookback - lookahead)
  const hi = Math.min(kLineDataList.length - 1, visibleRange.to + lookahead)
  if (hi <= lo) return false
  const window = kLineDataList.slice(lo, hi + 1)
  const blocks = detectOrderBlocks(window, { swingLookback, lookahead, displacementFactor })
  if (blocks.length === 0) return false
  const upColor = defaultStyles.bars[0].upColor
  const downColor = defaultStyles.bars[0].downColor
  const rightEdge = xAxis.convertToPixel(Math.min(kLineDataList.length - 1, visibleRange.to))
  ctx.save()
  ctx.lineWidth = 1
  for (const block of blocks) {
    const absIndex = block.index + lo
    const x0 = xAxis.convertToPixel(absIndex)
    const x1 = Math.max(x0 + 1, rightEdge)
    const y0 = yAxis.convertToPixel(block.high)
    const y1 = yAxis.convertToPixel(block.low)
    const top = Math.min(y0, y1)
    const height = Math.max(1, Math.abs(y1 - y0))
    const color = block.direction === 'bullish' ? upColor : downColor
    ctx.setLineDash(block.mitigated ? [3, 3] : [])
    ctx.globalAlpha = block.mitigated ? 0.06 : 0.16
    ctx.fillStyle = color
    ctx.fillRect(x0, top, x1 - x0, height)
    ctx.globalAlpha = block.mitigated ? 0.35 : 0.9
    ctx.strokeStyle = color
    ctx.strokeRect(x0, top, x1 - x0, height)
  }
  ctx.restore()
  return false
}

export const SC_ORDER_BLOCKS: IndicatorTemplate<Row> = {
  name: 'SC_ORDER_BLOCKS',
  shortName: 'Order Blocks',
  series: SERIES_NORMAL,
  calcParams: [10, 3, 1.5],
  figures: [],
  calc: (dataList) => dataList.map(() => ({})),
  draw: drawOrderBlocks
}
