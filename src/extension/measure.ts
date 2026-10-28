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

// TradingView "Measure" tools — price range, date range, and date+price range.
// Each is a two-point box that annotates the move: price delta + %, and/or the
// number of bars spanned. Part of SUPer-Chart (Apache-2.0).

import { type OverlayTemplate, type Coordinate } from 'klinecharts'

import { withAlpha } from '../drawing-editor/color'
import { inkOn } from '../theme/ink'
import { INK } from '../theme/tokens'
import { drawingAccent } from './accent'
import { drawingLabel } from './labels'
import { barIndexOf } from './barIndexOf'
import { type AxisParams, klineList } from './dataAccess'

const GREEN = 'rgba(38, 166, 154, 0.16)'
const RED = 'rgba(239, 83, 80, 0.16)'

// The box is clickable, so a finished measurement can be selected and edited.
function box(c0: Coordinate, c1: Coordinate, color: string) {
  return {
    type: 'polygon',
    attrs: { coordinates: [{ x: c0.x, y: c0.y }, { x: c1.x, y: c0.y }, { x: c1.x, y: c1.y }, { x: c0.x, y: c1.y }] },
    styles: { style: 'fill', color },
  }
}

// Labels: on the chart's accent (opaque) with white or dark ink, whichever
// reads better on it; dark ink on the green/red badges (white there was
// 2.7-3.2:1). No family: the theme's overlay font.
function label(x: number, y: number, text: string, bg: string, color = inkOn(bg)) {
  return {
    type: 'text',
    ignoreEvent: true,
    attrs: { x, y, text, align: 'center', baseline: 'middle' },
    styles: { color, size: 12, paddingLeft: 6, paddingRight: 6, paddingTop: 4, paddingBottom: 4, borderRadius: 2, backgroundColor: bg },
  }
}

const val = (overlay: { points: Array<{ value?: number; dataIndex?: number }> }, i: number): number => overlay.points[i]?.value ?? 0

/**
 * Bars between the two points, resolved from their timestamps (SC-161) — a
 * stale `dataIndex` used to read the wrong count once older bars were
 * prepended (loadMore). Null when neither point has a usable timestamp or
 * dataIndex (never for a real drawing; only for a host-built overlay with
 * neither field set).
 */
function barsBetween (params: AxisParams & { overlay: { points: Array<{ value?: number; dataIndex?: number; timestamp?: number }> } }): number | null {
  const data = klineList(params)
  const a = barIndexOf(params.overlay.points[0] ?? {}, data)
  const b = barIndexOf(params.overlay.points[1] ?? {}, data)
  return a === null || b === null ? null : Math.abs(Math.round(a - b))
}

export const priceRange: OverlayTemplate = {
  name: 'priceRange',
  totalStep: 3,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  createPointFigures: ({ overlay, coordinates, precision, defaultStyles }) => {
    if (coordinates.length < 2) return []
    const c0 = coordinates[0], c1 = coordinates[1]
    const d = val(overlay, 1) - val(overlay, 0)
    const pct = val(overlay, 0) ? (d / val(overlay, 0)) * 100 : 0
    const midX = (c0.x + c1.x) / 2
    return [
      box(c0, c1, d >= 0 ? GREEN : RED),
      { type: 'line', ignoreEvent: true, attrs: { coordinates: [{ x: midX, y: c0.y }, { x: midX, y: c1.y }] } },
      label(midX, (c0.y + c1.y) / 2, `${d >= 0 ? '+' : ''}${d.toFixed(precision.price)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)`, drawingAccent(defaultStyles)),
    ]
  },
}

export const dateRange: OverlayTemplate = {
  name: 'dateRange',
  totalStep: 3,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  createPointFigures: (params) => {
    const { coordinates, defaultStyles } = params
    if (coordinates.length < 2) return []
    const c0 = coordinates[0], c1 = coordinates[1]
    const bars = barsBetween(params)
    const midY = (c0.y + c1.y) / 2
    const accent = drawingAccent(defaultStyles)
    return [
      box(c0, c1, withAlpha(accent, 0.14)),
      { type: 'line', ignoreEvent: true, attrs: { coordinates: [{ x: c0.x, y: midY }, { x: c1.x, y: midY }] } },
      label((c0.x + c1.x) / 2, midY, bars === null ? '' : drawingLabel('drawing_bars', { count: bars }), accent),
    ]
  },
}

export const priceDateRange: OverlayTemplate = {
  name: 'priceDateRange',
  totalStep: 3,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  createPointFigures: (params) => {
    const { overlay, coordinates, precision } = params
    if (coordinates.length < 2) return []
    const c0 = coordinates[0], c1 = coordinates[1]
    const d = val(overlay, 1) - val(overlay, 0)
    const pct = val(overlay, 0) ? (d / val(overlay, 0)) * 100 : 0
    const bars = barsBetween(params)
    return [
      box(c0, c1, d >= 0 ? GREEN : RED),
      label((c0.x + c1.x) / 2, (c0.y + c1.y) / 2, `${d >= 0 ? '+' : ''}${d.toFixed(precision.price)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)${bars === null ? '' : ` · ${drawingLabel('drawing_bars', { count: bars })}`}`, d >= 0 ? 'rgba(38, 166, 154, 0.92)' : 'rgba(239, 83, 80, 0.92)', INK),
    ]
  },
}
