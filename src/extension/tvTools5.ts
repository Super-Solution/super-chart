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

// Remaining TradingView tools that are pure geometry: pin marker, forecast line,
// disjoint channel, Fibonacci speed/resistance arcs. Part of SUPer-Chart (Apache-2.0).

import { OverlayTemplate, Coordinate } from 'klinecharts'

import { hitPath } from './hitPath'
import { INK } from '../theme/tokens'

// Location pin planted at a bar.
export const pin: OverlayTemplate = {
  name: 'pin',
  totalStep: 2,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  // pin colour on the overlay's styles so the drawing editor can change it
  styles: { polygon: { color: '#ef5350' }, circle: { color: '#ef5350' } },
  createPointFigures: ({ coordinates }) => {
    if (coordinates.length < 1) return []
    const { x, y } = coordinates[0]
    return [
      { type: 'polygon', ignoreEvent: true, attrs: { coordinates: [{ x, y }, { x: x - 7, y: y - 15 }, { x: x + 7, y: y - 15 }] }, styles: { style: 'fill' } },
      { type: 'circle', attrs: { x, y: y - 18, r: 8 }, styles: { style: 'fill' } },
      { type: 'circle', ignoreEvent: true, attrs: { x, y: y - 18, r: 3 }, styles: { style: 'fill', color: '#ffffff' } },
    ]
  },
}

// Forecast — a projected path with the projected % (the 2nd point may sit in the
// future; klinecharts extrapolates it into the right-side gap).
export const forecast: OverlayTemplate = {
  name: 'forecast',
  totalStep: 3,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  createPointFigures: ({ overlay, coordinates }) => {
    if (coordinates.length < 2) return []
    const v0 = overlay.points[0]?.value ?? 0
    const v1 = overlay.points[1]?.value ?? 0
    const pct = v0 ? ((v1 - v0) / v0) * 100 : 0
    const up = v1 >= v0
    return [
      { type: 'line', ignoreEvent: true, attrs: { coordinates: [coordinates[0], coordinates[1]] }, styles: { color: up ? '#26a69a' : '#ef5350', size: 2, style: 'dashed' } },
      hitPath([coordinates[0], coordinates[1]]),
      { type: 'text', ignoreEvent: true, attrs: { x: coordinates[1].x, y: coordinates[1].y, text: `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`, align: 'left', baseline: 'middle' }, styles: { color: INK, size: 11, paddingLeft: 5, paddingRight: 5, paddingTop: 3, paddingBottom: 3, borderRadius: 2, backgroundColor: up ? 'rgba(38, 166, 154, 0.92)' : 'rgba(239, 83, 80, 0.92)' } },
    ]
  },
}

// Disjoint channel — main line p0→p1, a parallel line through p2.
export const disjointChannel: OverlayTemplate = {
  name: 'disjointChannel',
  totalStep: 4,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  // Fill: the chart's accent at 10% (src/extension/accent.ts).
  createPointFigures: ({ coordinates }) => {
    if (coordinates.length < 2) return []
    if (coordinates.length < 3) return [{ type: 'line', attrs: { coordinates: [coordinates[0], coordinates[1]] } }]
    const [p0, p1, p2] = coordinates
    const dx = p1.x - p0.x, dy = p1.y - p0.y
    const p3 = { x: p2.x + dx, y: p2.y + dy }
    return [
      // the filled channel is what you click to select it
      { type: 'polygon', attrs: { coordinates: [p0, p1, p3, p2] }, styles: { style: 'fill' } },
      { type: 'line', ignoreEvent: true, attrs: [{ coordinates: [p0, p1] }, { coordinates: [p2, p3] }] },
    ]
  },
}

// Fibonacci speed/resistance arcs — quarter-circle arcs at fib radii from p0.
const FIB_ARC = [0.382, 0.5, 0.618, 1]
export const fibonacciSpeedResistanceArc: OverlayTemplate = {
  name: 'fibonacciSpeedResistanceArc',
  totalStep: 3,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  createPointFigures: ({ coordinates }) => {
    if (coordinates.length < 2) return []
    const c0 = coordinates[0], c1 = coordinates[1]
    const R = Math.hypot(c1.x - c0.x, c1.y - c0.y)
    if (R < 1) return []
    const dirX = c1.x >= c0.x ? 1 : -1
    const dirY = c1.y >= c0.y ? 1 : -1
    const figs: unknown[] = [{ type: 'line', ignoreEvent: true, attrs: { coordinates: [c0, c1] } }]
    const paths: Coordinate[][] = [[c0, c1]]
    for (const r of FIB_ARC) {
      const rr = R * r
      const pts: Coordinate[] = []
      for (let i = 0; i <= 24; i++) { const a = (i / 24) * (Math.PI / 2); pts.push({ x: c0.x + dirX * rr * Math.cos(a), y: c0.y + dirY * rr * Math.sin(a) }) }
      figs.push({ type: 'line', ignoreEvent: true, attrs: { coordinates: pts }, styles: { style: 'dashed' } })
      paths.push(pts)
    }
    figs.push(hitPath(...paths))
    return figs as ReturnType<NonNullable<OverlayTemplate['createPointFigures']>>
  },
}
