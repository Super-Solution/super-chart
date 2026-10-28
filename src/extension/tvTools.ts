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

// More TradingView drawing tools implemented as klinecharts overlays:
// up/down arrow markers, ellipse, and an Andrews pitchfork.
// Part of SUPer-Chart (Apache-2.0).

import { type OverlayTemplate, type Coordinate } from 'klinecharts'

import { pitchforkFigures } from './pitchforkGeometry'

// Single-point arrow markers (signal up / down at a bar).
function arrowMarker(name: string, dir: 1 | -1, color: string): OverlayTemplate {
  return {
    name,
    totalStep: 2,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    styles: { polygon: { color } },
    createPointFigures: ({ coordinates }) => {
      if (coordinates.length < 1) return []
      const { x, y } = coordinates[0]
      const t = y + dir * 2 // tip just off the bar
      const b = y + dir * 20
      return [
        {
          type: 'polygon',
          attrs: {
            coordinates: [
              { x, y: t },
              { x: x - 7, y: t + dir * 9 },
              { x: x - 3, y: t + dir * 9 },
              { x: x - 3, y: b },
              { x: x + 3, y: b },
              { x: x + 3, y: t + dir * 9 },
              { x: x + 7, y: t + dir * 9 },
            ],
          },
          // colour comes from styles.polygon so the drawing editor can change it
          styles: { style: 'fill' },
        },
      ]
    },
  }
}

export const arrowUp = arrowMarker('arrowUp', -1, '#26a69a')
export const arrowDown = arrowMarker('arrowDown', 1, '#ef5350')

// Two-point ellipse (bounding box), approximated by a smooth polygon.
export const ellipse: OverlayTemplate = {
  name: 'ellipse',
  totalStep: 3,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  // Fill: the chart's accent at 15% (src/extension/accent.ts).
  createPointFigures: ({ coordinates }) => {
    if (coordinates.length < 2) return []
    const c0 = coordinates[0], c1 = coordinates[1]
    const cx = (c0.x + c1.x) / 2
    const cy = (c0.y + c1.y) / 2
    const rx = Math.abs(c1.x - c0.x) / 2
    const ry = Math.abs(c1.y - c0.y) / 2
    const pts: Coordinate[] = []
    const N = 48
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2
      pts.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) })
    }
    return [{ type: 'polygon', attrs: { coordinates: pts }, styles: { style: 'stroke_fill' } }]
  },
}

// Andrews pitchfork: handle p0 + two prongs p1/p2. Median through the p1-p2
// midpoint; two parallel lines through p1 and p2. Lines extended across the
// pane. Geometry shared with schiff (tvTools2.ts) and modifiedSchiff
// (tvTools4.ts) via pitchforkGeometry.ts (SC-177): the three forks differ only
// in where the median starts.
export const pitchfork: OverlayTemplate = {
  name: 'pitchfork',
  totalStep: 4,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  createPointFigures: ({ coordinates, bounding }) =>
    pitchforkFigures('pitchfork', coordinates, bounding?.width ?? 800, bounding?.height ?? 600),
}
