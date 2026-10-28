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

import { utils } from 'klinecharts'
import type { OverlayTemplate, LineAttrs } from 'klinecharts'

import { getDistance, getRotateCoordinate, getRayLine } from './utils'
import { strokeHitTolerance } from '../drawing-editor/geometry'
import { hitPathWithin } from './hitPath'

const fibonacciSpiral: OverlayTemplate = {
  name: 'fibonacciSpiral',
  totalStep: 3,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  createPointFigures: ({ coordinates, bounding, overlay, defaultStyles }) => {
    if (coordinates.length > 1) {
      const startRadius = getDistance(coordinates[0], coordinates[1]) / Math.sqrt(24)
      const flag = coordinates[1].x > coordinates[0].x ? 0 : 1
      const kb = utils.getLinearSlopeIntercept(coordinates[0], coordinates[1])
      let offsetAngle
      if (kb) {
        offsetAngle = Math.atan(kb[0]) + Math.PI * flag
      } else {
        if (coordinates[1].y > coordinates[0].y) {
          offsetAngle = Math.PI / 2
        } else {
          offsetAngle = Math.PI / 2 * 3
        }
      }
      const rotateCoordinate1 = getRotateCoordinate(
        { x: coordinates[0].x - startRadius, y: coordinates[0].y },
        coordinates[0],
        offsetAngle
      )
      const rotateCoordinate2 = getRotateCoordinate(
        { x: coordinates[0].x - startRadius, y: coordinates[0].y - startRadius },
        coordinates[0],
        offsetAngle
      )
      const arcs = [{
        ...rotateCoordinate1,
        r: startRadius,
        startAngle: offsetAngle,
        endAngle: offsetAngle + Math.PI / 2
      }, {
        ...rotateCoordinate2,
        r: startRadius * 2,
        startAngle: offsetAngle + Math.PI / 2,
        endAngle: offsetAngle + Math.PI
      }]
      let x = coordinates[0].x - startRadius
      let y = coordinates[0].y - startRadius
      for (let i = 2; i < 9; i++) {
        const r = arcs[i - 2].r + arcs[i - 1].r
        let startAngle = 0
        switch (i % 4) {
          case 0: {
            startAngle = offsetAngle
            x -= (arcs[i - 2].r)
            break
          }
          case 1: {
            startAngle = offsetAngle + Math.PI / 2
            y -= arcs[i - 2].r
            break
          }
          case 2: {
            startAngle = offsetAngle + Math.PI
            x += (arcs[i - 2].r)
            break
          }
          case 3: {
            startAngle = offsetAngle + Math.PI / 2 * 3
            y += arcs[i - 2].r
            break
          }
        }
        const endAngle = startAngle + Math.PI / 2
        const rotateCoordinate = getRotateCoordinate({ x, y }, coordinates[0], offsetAngle)
        arcs.push({
          ...rotateCoordinate,
          r,
          startAngle,
          endAngle
        })
      }
      // SC-100: the ray line's own hit test only reaches ~2px (and, on
      // 9.1.1, tests its infinite extension); a bounded, wider hit path
      // along the ray covers the visible line only.
      const rayLine = getRayLine(coordinates, bounding)
      const tolerance = strokeHitTolerance(overlay.styles?.line?.size ?? defaultStyles?.line?.size)
      return [
        {
          type: 'arc',
          attrs: arcs
        },
        {
          type: 'line',
          attrs: rayLine
        },
        hitPathWithin(tolerance, ...([] as LineAttrs[]).concat(rayLine).map(l => l.coordinates))
      ]
    }
    return []
  }
}

export default fibonacciSpiral
