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

import { OverlayTemplate } from 'klinecharts'

import { strokeHitTolerance } from '../drawing-editor/geometry'
import { hitPathWithin } from './hitPath'

const threeWaves: OverlayTemplate = {
  name: 'threeWaves',
  totalStep: 5,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  createPointFigures: ({ coordinates, overlay, defaultStyles }) => {
    const texts = coordinates.map((coordinate, i) => ({
      ...coordinate,
      text: `(${i})`,
      baseline: 'bottom'
    }))
    // SC-100: klinecharts' own line hit test reaches only ~2px, and on
    // 9.1.1 tests the line's infinite extension rather than the drawn path.
    const tolerance = strokeHitTolerance(overlay.styles?.line?.size ?? defaultStyles?.line?.size)
    return [
      {
        type: 'line',
        attrs: { coordinates }
      },
      {
        type: 'text',
        ignoreEvent: true,
        attrs: texts
      },
      hitPathWithin(tolerance, coordinates)
    ]
  }
}

export default threeWaves
