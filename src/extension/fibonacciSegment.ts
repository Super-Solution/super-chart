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

import { readLevels, RETRACEMENT_LEVELS } from './fibLevels'

import { strokeHitTolerance } from '../drawing-editor/geometry'
import { hitPathWithin } from './hitPath'

const fibonacciSegment: OverlayTemplate = {
  name: 'fibonacciSegment',
  totalStep: 3,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  createPointFigures: ({ coordinates, overlay, precision, yAxis, defaultStyles }) => {
    const lines: LineAttrs[] = []
    const texts: TextAttrs[] = []
    if (coordinates.length > 1) {
      const textX = coordinates[1].x > coordinates[0].x ? coordinates[0].x : coordinates[1].x
      // SC-179: extendData.levels, when the host/editor set one, else the
      // unchanged retracement defaults — every existing drawing keeps its look.
      const { levels: percents } = readLevels(overlay, RETRACEMENT_LEVELS)
      const yDif = coordinates[0].y - coordinates[1].y
      const points = overlay.points
      // @ts-expect-error
      const valueDif = points[0].value - points[1].value
      const v1 = points[1].value ?? 0
      percents.forEach(percent => {
        const price = v1 + valueDif * percent
        // Value space (SC-116): interpolating pixels linearly, as before, puts
        // a level off its own label on a log or percentage y-axis. yAxis is
        // only absent when a caller invokes this template directly with no
        // axis (e.g. a unit test), so the old pixel interpolation stays as
        // the fallback there.
        const y = yAxis !== null && yAxis !== undefined ? yAxis.convertToPixel(price) : coordinates[1].y + yDif * percent
        lines.push({ coordinates: [{ x: coordinates[0].x, y }, { x: coordinates[1].x, y }] })
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
        attrs: lines
      }, {
        type: 'text',
        ignoreEvent: true,
        attrs: texts
      },
      hitPathWithin(tolerance, ...lines.map(l => l.coordinates))
    ]
  }
}

export default fibonacciSegment
