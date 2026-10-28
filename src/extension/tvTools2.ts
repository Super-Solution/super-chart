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

// More TradingView drawing tools: Fibonacci time zones, Gann fan, and the Schiff
// pitchfork variant. All pure-geometry line overlays. Part of SUPer-Chart (Apache-2.0).

import { type OverlayTemplate, type Coordinate, type LineType } from 'klinecharts'

import { hitPath } from './hitPath'
import { pitchforkFigures } from './pitchforkGeometry'

// Fibonacci time zones — vertical lines at fib multiples of the base span.
const FIBS = [0, 1, 2, 3, 5, 8, 13, 21, 34]
export const fibonacciTimeZone: OverlayTemplate = {
  name: 'fibonacciTimeZone',
  totalStep: 3,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  // dashed by default, on the overlay's styles so the drawing editor can change it
  styles: { line: { style: 'dashed' as LineType } },
  createPointFigures: ({ coordinates, bounding }) => {
    if (coordinates.length < 2) return []
    const d = coordinates[1].x - coordinates[0].x
    const h = bounding?.height ?? 600
    if (d === 0) return []
    const lines = FIBS.map((f): Coordinate[] => [{ x: coordinates[0].x + d * f, y: 0 }, { x: coordinates[0].x + d * f, y: h }])
    return [
      {
        type: 'line',
        ignoreEvent: true,
        attrs: lines.map(coordinates => ({ coordinates })),
      },
      hitPath(...lines),
    ]
  },
}

// Gann fan — lines from the origin at Gann angles derived from the 1x1 (p0→p1).
const GANN = [1 / 8, 1 / 4, 1 / 3, 1 / 2, 1, 2, 3, 4, 8]
export const gannFan: OverlayTemplate = {
  name: 'gannFan',
  totalStep: 3,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  createPointFigures: ({ coordinates }) => {
    if (coordinates.length < 2) return []
    const c0 = coordinates[0]
    const dx = coordinates[1].x - c0.x
    const dy = coordinates[1].y - c0.y
    const scale = 6
    const lines = GANN.map((r): Coordinate[] => [c0, { x: c0.x + dx * scale, y: c0.y + dy * r * scale }])
    return [
      {
        type: 'line',
        ignoreEvent: true,
        attrs: lines.map(coordinates => ({ coordinates })),
      },
      hitPath(...lines),
    ]
  },
}

// Schiff pitchfork — like Andrews' but the median starts at the handle's own
// time, halfway in price toward the first prong (SC-177: this used to compute
// the exact Andrews median instead, via pitchforkGeometry.ts, shared with
// pitchfork (tvTools.ts) and modifiedSchiff (tvTools4.ts).
export const schiff: OverlayTemplate = {
  name: 'schiff',
  totalStep: 4,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  createPointFigures: ({ coordinates, bounding }) =>
    pitchforkFigures('schiff', coordinates, bounding?.width ?? 800, bounding?.height ?? 600),
}
