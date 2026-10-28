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

// More TradingView drawing tools: Modified Schiff pitchfork, rotated rectangle,
// and a cubic-bezier double curve. Part of SUPer-Chart (Apache-2.0).

import { type OverlayTemplate, type Coordinate } from 'klinecharts'

import { hitPath } from './hitPath'
import { pitchforkFigures } from './pitchforkGeometry'

// Modified Schiff pitchfork — median origin at the full midpoint (time and
// price) of the handle and the first prong (SC-177: this used to shift only
// horizontally and hold the handle's own price level, which is neither
// Andrews' nor TradingView's Modified Schiff). Shared with pitchfork
// (tvTools.ts) and schiff (tvTools2.ts) via pitchforkGeometry.ts.
export const modifiedSchiff: OverlayTemplate = {
  name: 'modifiedSchiff',
  totalStep: 4,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  createPointFigures: ({ coordinates, bounding }) =>
    pitchforkFigures('modifiedSchiff', coordinates, bounding?.width ?? 800, bounding?.height ?? 600),
}

// Rotated rectangle — p0→p1 is one edge; p2 sets the perpendicular width.
export const rotatedRect: OverlayTemplate = {
  name: 'rotatedRect',
  totalStep: 4,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  // Fill: the chart's accent at 15% (src/extension/accent.ts).
  createPointFigures: ({ coordinates }) => {
    if (coordinates.length < 2) return []
    if (coordinates.length < 3) return [{ type: 'line', attrs: { coordinates: [coordinates[0], coordinates[1]] } }]
    const [p0, p1, p2] = coordinates
    const dx = p1.x - p0.x, dy = p1.y - p0.y
    const len = Math.hypot(dx, dy) || 1
    const px = -dy / len, py = dx / len
    const w = (p2.x - p1.x) * px + (p2.y - p1.y) * py
    const c2 = { x: p1.x + px * w, y: p1.y + py * w }
    const c3 = { x: p0.x + px * w, y: p0.y + py * w }
    return [{ type: 'polygon', attrs: { coordinates: [p0, p1, c2, c3] }, styles: { style: 'stroke_fill' } }]
  },
}

// Cubic-bezier double curve (S-curve): p0 start, p1/p2 controls, p3 end.
function cubic(p0: Coordinate, p1: Coordinate, p2: Coordinate, p3: Coordinate, n = 48): Coordinate[] {
  const pts: Coordinate[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n, mt = 1 - t
    pts.push({
      x: mt * mt * mt * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t * t * t * p3.x,
      y: mt * mt * mt * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t * t * t * p3.y,
    })
  }
  return pts
}
export const doubleCurve: OverlayTemplate = {
  name: 'doubleCurve',
  totalStep: 5,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  createPointFigures: ({ coordinates }) => {
    if (coordinates.length < 2) return []
    if (coordinates.length < 4) return [{ type: 'line', ignoreEvent: true, attrs: { coordinates } }]
    const path = cubic(coordinates[0], coordinates[1], coordinates[2], coordinates[3])
    return [{ type: 'line', ignoreEvent: true, attrs: { coordinates: path } }, hitPath(path)]
  },
}
