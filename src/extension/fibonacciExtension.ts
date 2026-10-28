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

import { type OverlayTemplate, type LineAttrs, type TextAttrs } from 'klinecharts'

import { EXTENSION_LEVELS, readLevels } from './fibLevels'

import { strokeHitTolerance } from '../drawing-editor/geometry'
import { hitPathWithin } from './hitPath'

const fibonacciExtension: OverlayTemplate = {
  name: 'fibonacciExtension',
  totalStep: 4,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  createPointFigures: ({ coordinates, overlay, precision, yAxis, defaultStyles }) => {
    const fbLines: LineAttrs[] = []
    const texts: TextAttrs[] = []
    if (coordinates.length > 2) {
      const points = overlay.points
      // @ts-expect-error
      const valueDif = points[1].value - points[0].value
      const yDif = coordinates[1].y - coordinates[0].y
      // SC-179: TradingView's trend-based defaults (0% through 424%, 161.8%
      // included) — the old fixed [0..1] set never drew an extension target
      // above 100%. extendData.levels overrides it when the host/editor set one.
      const { levels: percents } = readLevels(overlay, EXTENSION_LEVELS)
      const textX = coordinates[2].x > coordinates[1].x ? coordinates[1].x : coordinates[2].x
      const v2 = points[2].value ?? 0
      percents.forEach(percent => {
        const price = v2 + valueDif * percent
        // Value space (SC-116), same reasoning as fibonacciSegment.ts.
        const y = yAxis !== null && yAxis !== undefined ? yAxis.convertToPixel(price) : coordinates[2].y + yDif * percent
        fbLines.push({ coordinates: [{ x: coordinates[1].x, y }, { x: coordinates[2].x, y }] })
        texts.push({
          x: textX,
          y,
          text: `${price.toFixed(precision.price)} (${(percent * 100).toFixed(1)}%)`,
          baseline: 'bottom'
        })
      })
    }
    // SC-100: klinecharts' own line hit test reaches only ~2px, and on 9.1.1
    // tests each line's infinite extension rather than the drawn segment.
    const tolerance = strokeHitTolerance(overlay.styles?.line?.size ?? defaultStyles?.line?.size)
    return [
      {
        type: 'line',
        attrs: { coordinates },
        styles: { style: 'dashed' }
      },
      {
        type: 'line',
        attrs: fbLines
      },
      {
        type: 'text',
        ignoreEvent: true,
        attrs: texts
      },
      hitPathWithin(tolerance, coordinates, ...fbLines.map(l => l.coordinates))
    ]
  }
}

export default fibonacciExtension
