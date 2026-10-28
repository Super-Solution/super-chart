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

// Freehand brush + highlighter. These are drawn by the host's freehand capture
// (drag to collect points), then created as a multi-point smoothed polyline so
// they pan/zoom with the chart. Part of SUPer-Chart (Apache-2.0).

import { OverlayTemplate } from 'klinecharts'

import { strokeHitTolerance } from '../drawing-editor/geometry'
import { hitPathWithin } from './hitPath'

function makeBrush(name: string, size: number, color?: string): OverlayTemplate {
  return {
    name,
    // A single "step" — the host supplies all points up front via createOverlay.
    totalStep: 2,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    // Colour and width live on the overlay's styles (not the figure's) so the
    // drawing editor can change them per stroke. The brush has no colour of its
    // own: it draws in the chart's drawing default (overlay.line.color), the
    // accent, like klinecharts' own lines.
    styles: { line: color === undefined ? { size } : { color, size } },
    createPointFigures: ({ overlay, coordinates }) => {
      if (coordinates.length < 2) return []
      // The stroke is clicked through a bounded hit path: klinecharts 9.1.1 would
      // hit-test every short segment against its infinite extension. It is as
      // wide as the visible stroke, so the highlighter's band is clickable across.
      const tolerance = strokeHitTolerance(overlay.styles?.line?.size ?? size)
      return [
        { type: 'line', ignoreEvent: true, attrs: { coordinates }, styles: { smooth: true } },
        hitPathWithin(tolerance, coordinates),
      ]
    },
  }
}

export const brush = makeBrush('brush', 2)
export const highlighter = makeBrush('highlighter', 12, 'rgba(255, 202, 40, 0.35)')
