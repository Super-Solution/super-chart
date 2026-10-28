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

// More TradingView drawing tools: flag marker, Gann square, and curved lines
// (quadratic-bezier "curve" and a 3-point "arc"). Part of SUPer-Chart (Apache-2.0).

import { OverlayTemplate, Coordinate } from 'klinecharts'

import { hitPath } from './hitPath'

// Flag marker planted at a bar.
export const flag: OverlayTemplate = {
  name: 'flag',
  totalStep: 2,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  // The flag is the chart's polygon default: the accent.
  createPointFigures: ({ coordinates }) => {
    if (coordinates.length < 1) return []
    const { x, y } = coordinates[0]
    const top = y - 22
    return [
      { type: 'line', ignoreEvent: true, attrs: { coordinates: [{ x, y }, { x, y: top }] } },
      { type: 'polygon', attrs: { coordinates: [{ x, y: top }, { x: x + 15, y: top + 4 }, { x, y: top + 8 }] }, styles: { style: 'fill' } },
    ]
  },
}

// Gann square — the box, both diagonals, and the mid cross.
export const gannSquare: OverlayTemplate = {
  name: 'gannSquare',
  totalStep: 3,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  // Fill: the chart's accent at 10% (src/extension/accent.ts).
  createPointFigures: ({ coordinates }) => {
    if (coordinates.length < 2) return []
    const c0 = coordinates[0], c1 = coordinates[1]
    const tl = { x: c0.x, y: c0.y }, tr = { x: c1.x, y: c0.y }, br = { x: c1.x, y: c1.y }, bl = { x: c0.x, y: c1.y }
    const mx = (c0.x + c1.x) / 2, my = (c0.y + c1.y) / 2
    return [
      // the filled box is what you click to select the square
      { type: 'polygon', attrs: { coordinates: [tl, tr, br, bl] }, styles: { style: 'fill' } },
      {
        type: 'line',
        ignoreEvent: true,
        attrs: [
          { coordinates: [tl, tr] }, { coordinates: [tr, br] }, { coordinates: [br, bl] }, { coordinates: [bl, tl] },
          { coordinates: [tl, br] }, { coordinates: [tr, bl] },
          { coordinates: [{ x: mx, y: c0.y }, { x: mx, y: c1.y }] }, { coordinates: [{ x: c0.x, y: my }, { x: c1.x, y: my }] },
        ],
      },
    ]
  },
}

// Quadratic bezier sampler.
function bezier(p0: Coordinate, ctrl: Coordinate, p2: Coordinate, n = 40): Coordinate[] {
  const pts: Coordinate[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n, mt = 1 - t
    pts.push({ x: mt * mt * p0.x + 2 * mt * t * ctrl.x + t * t * p2.x, y: mt * mt * p0.y + 2 * mt * t * ctrl.y + t * t * p2.y })
  }
  return pts
}

// Curve — quadratic bezier with p1 as the control handle.
export const curve: OverlayTemplate = {
  name: 'curve',
  totalStep: 4,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  createPointFigures: ({ coordinates }) => {
    if (coordinates.length < 2) return []
    if (coordinates.length < 3) return [{ type: 'line', attrs: { coordinates: [coordinates[0], coordinates[1]] } }]
    const path = bezier(coordinates[0], coordinates[1], coordinates[2])
    return [{ type: 'line', ignoreEvent: true, attrs: { coordinates: path } }, hitPath(path)]
  },
}

// Arc — a curved line that passes THROUGH all three points (control derived so the
// bezier hits p1 at its midpoint). Avoids fragile circumcircle math.
export const arc: OverlayTemplate = {
  name: 'arc',
  totalStep: 4,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  createPointFigures: ({ coordinates }) => {
    if (coordinates.length < 2) return []
    if (coordinates.length < 3) return [{ type: 'line', attrs: { coordinates: [coordinates[0], coordinates[1]] } }]
    const [p0, p1, p2] = coordinates
    const ctrl = { x: 2 * p1.x - (p0.x + p2.x) / 2, y: 2 * p1.y - (p0.y + p2.y) / 2 }
    const path = bezier(p0, ctrl, p2)
    return [{ type: 'line', ignoreEvent: true, attrs: { coordinates: path } }, hitPath(path)]
  },
}
