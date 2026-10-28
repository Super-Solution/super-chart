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

// A tiny bridge so data-driven overlays (volume profile, anchored VWAP,
// regression) can read the chart's OHLCV list and convert (dataIndex, value)
// to pixels — resolved PER CALL from the params klinecharts itself hands
// createPointFigures, never from a module-global "the chart" (SC-008).
//
// A single shared `chartRef` used to break as soon as a second SuperChart
// mounted on the same page (each one overwrote it, so every tool read
// whichever chart mounted last) and went permanently blank once that chart
// unmounted (dispose() nulled the ref for every chart). xAxis/yAxis are not
// shared: klinecharts hands each overlay its own pane's axes, and
// `axis.getParent().getChart()` recovers that pane's Chart. Those two calls
// are not in the public v9 .d.ts (only Axis.convertToPixel/convertFromPixel
// are), so every access here is feature-detected and wrapped in try/catch —
// on a klinecharts build without them these helpers degrade to "no data"
// instead of throwing.
//
// Part of SUPer-Chart (Apache-2.0).

import { type KLineData, type Chart, type Nullable, type Coordinate, type XAxis, type YAxis } from 'klinecharts'

/** What every data-driven overlay's createPointFigures already receives. */
export interface AxisParams {
  /** A future klinecharts may pass the chart directly; preferred when present. */
  chart?: Nullable<Chart>
  xAxis?: Nullable<XAxis>
  yAxis?: Nullable<YAxis>
}

interface PrivatePane { getChart?: () => unknown }
interface PrivateAxis { getParent?: () => PrivatePane | null | undefined }

/** The Chart these axis params belong to, or null when it cannot be resolved. */
export function chartOf (params: AxisParams): Nullable<Chart> {
  if (params.chart !== null && params.chart !== undefined) {
    return params.chart
  }
  const axis = (params.xAxis ?? params.yAxis) as unknown as PrivateAxis | null | undefined
  if (axis === null || axis === undefined) {
    return null
  }
  try {
    if (typeof axis.getParent !== 'function') {
      return null
    }
    const pane = axis.getParent()
    if (pane === null || pane === undefined || typeof pane.getChart !== 'function') {
      return null
    }
    return (pane.getChart() as Chart | undefined) ?? null
  } catch {
    return null
  }
}

/** The OHLCV list of the chart these params belong to; [] when it cannot be resolved. */
export function klineList (params: AxisParams): KLineData[] {
  try {
    return chartOf(params)?.getDataList() ?? []
  } catch {
    return []
  }
}

/**
 * (dataIndex, value) pairs to pixel coordinates, via the axes klinecharts
 * already handed this overlay for this pane (no paneId lookup needed, and
 * correct on any pane, not only 'candle_pane'). Points that fail to convert
 * are dropped, so the result may be shorter than the input.
 */
export function toPixels (params: AxisParams, points: ReadonlyArray<{ dataIndex: number, value: number }>): Coordinate[] {
  const { xAxis, yAxis } = params
  if (xAxis === null || xAxis === undefined || yAxis === null || yAxis === undefined || points.length === 0) {
    return []
  }
  const out: Coordinate[] = []
  points.forEach(p => {
    try {
      const x = xAxis.convertToPixel(p.dataIndex)
      const y = yAxis.convertToPixel(p.value)
      if (Number.isFinite(x) && Number.isFinite(y)) {
        out.push({ x, y })
      }
    } catch { /* ignore: an axis without a resolvable chart yet */ }
  })
  return out
}
