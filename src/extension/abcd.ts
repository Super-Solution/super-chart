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

import { OverlayTemplate, Coordinate } from 'klinecharts'

import { strokeHitTolerance } from '../drawing-editor/geometry'
import { hitPathWithin } from './hitPath'

const abcd: OverlayTemplate = {
  name: 'abcd',
  totalStep: 5,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  createPointFigures: ({ coordinates, overlay, defaultStyles }) => {
    let acLineCoordinates: Coordinate[] = []
    let bdLineCoordinates: Coordinate[] = []

    const tags = ['A', 'B', 'C', 'D']
    const texts = coordinates.map((coordinate, i) => ({
      ...coordinate,
      baseline: 'bottom',
      text: `(${tags[i]})`
    }))
    if (coordinates.length > 2) {
      acLineCoordinates = [coordinates[0], coordinates[2]]
      if (coordinates.length > 3) {
        bdLineCoordinates = [coordinates[1], coordinates[3]]
      }
    }
    // Wider, bounded hit test along every visible segment (SC-100): klinecharts'
    // own line hit test only reaches ~2px, and on 9.1.1 against the line's
    // infinite extension rather than the drawn segment.
    const tolerance = strokeHitTolerance(overlay.styles?.line?.size ?? defaultStyles?.line?.size)
    const hitPaths = [coordinates, acLineCoordinates, bdLineCoordinates].filter(c => c.length > 1)
    return [
      {
        type: 'line',
        attrs: { coordinates }
      },
      {
        type: 'line',
        attrs: [{ coordinates: acLineCoordinates }, { coordinates: bdLineCoordinates }],
        styles: { style: 'dashed' }
      },
      {
        type: 'text',
        ignoreEvent: true,
        attrs: texts
      },
      hitPathWithin(tolerance, ...hitPaths)
    ]
  }
}

export default abcd
