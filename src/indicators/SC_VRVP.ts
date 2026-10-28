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
 * SC_VRVP (SC-171): Visible-Range Volume Profile, a candle-pane indicator (not
 * a drawing tool — it needs no anchor click, it recomputes from whatever is on
 * screen). Everything happens in `draw`, over `visibleRange`, using the same
 * pure `volumeProfile()` the two profile drawing tools use
 * (src/extension/volumeProfile.ts); `calc` does no work; a `regenerateFigures`
 * would not help since there is nothing to plot as ordinary line/bar figures.
 * Off by default (the adopted bare-chart defaults).
 *
 * Maintained by ZzyzxLabs. Part of SUPer-Chart (Apache-2.0).
 */
import type { IndicatorDrawParams, IndicatorTemplate } from 'klinecharts'
import { volumeProfile } from '../extension/volumeProfile'
import { SERIES_NORMAL } from './shared'

type Row = Record<string, never>

function drawVrvp (params: IndicatorDrawParams<Row>): boolean {
  const { ctx, kLineDataList, indicator, visibleRange, bounding, yAxis } = params
  const rows = Number(indicator.calcParams?.[0]) > 0 ? Math.round(Number(indicator.calcParams[0])) : 24
  const lo = Math.max(0, visibleRange.from)
  const hi = Math.min(kLineDataList.length - 1, visibleRange.to)
  if (hi <= lo) return false
  const bars = []
  for (let i = lo; i <= hi; i++) {
    const d = kLineDataList[i]
    bars.push({ high: d.high, low: d.low, volume: d.volume ?? 0 })
  }
  const profile = volumeProfile(bars, { rows })
  if (profile.rows.length === 0) return false
  const maxVol = profile.rows.reduce((m, r) => Math.max(m, r.volume), 0) || 1
  const maxWidth = bounding.width * 0.2
  ctx.save()
  for (const r of profile.rows) {
    if (r.volume <= 0) continue
    const yTop = yAxis.convertToPixel(r.priceHigh)
    const yBot = yAxis.convertToPixel(r.priceLow)
    const w = (r.volume / maxVol) * maxWidth
    const isPoc = r.priceLow <= profile.poc && profile.poc <= r.priceHigh
    ctx.fillStyle = isPoc ? 'rgba(126, 87, 194, 0.65)' : 'rgba(126, 87, 194, 0.32)'
    ctx.fillRect(0, Math.min(yTop, yBot), Math.max(1, w), Math.max(1, Math.abs(yBot - yTop) - 1))
  }
  const pocY = yAxis.convertToPixel(profile.poc)
  ctx.strokeStyle = 'rgba(126, 87, 194, 0.9)'
  ctx.setLineDash([4, 4])
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, pocY)
  ctx.lineTo(bounding.width, pocY)
  ctx.stroke()
  ctx.restore()
  return false
}

export const SC_VRVP: IndicatorTemplate<Row> = {
  name: 'SC_VRVP',
  shortName: 'VRVP',
  series: SERIES_NORMAL,
  calcParams: [24],
  figures: [],
  calc: (dataList) => dataList.map(() => ({})),
  draw: drawVrvp
}
