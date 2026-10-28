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

// An invisible, clickable path. Several extension overlays draw their lines with
// ignoreEvent (so they could never be clicked, selected or edited once placed).
// They now add one of these along their main lines instead of making the visible
// 'line' figure clickable, because klinecharts 9.1.1 hit-tests a line against its
// INFINITE extension: a 40-segment curve would then catch clicks all over the
// pane. This figure draws nothing and hit-tests the actual segments.
// Part of SUPer-Chart (Apache-2.0).

import { registerFigure, Coordinate, OverlayFigure } from 'klinecharts'

import { isNearPolyline, MIN_HIT_TOLERANCE } from '../drawing-editor/geometry'

export const HIT_PATH_FIGURE = 'superChartHitPath'

interface HitPathAttrs {
  coordinates: Coordinate[]
  /** How close (px) a click must land to the path; MIN_HIT_TOLERANCE when absent. */
  tolerance?: number
}

/** Register the figure with klinecharts. Called by registerExtensions() (see
 *  ./register), never at import: importing a module must not touch the shared
 *  klinecharts registry (the lite entry, SSR and Node imports rely on that). */
export function registerHitPathFigure (): void {
  registerFigure<HitPathAttrs | HitPathAttrs[]>({
    name: HIT_PATH_FIGURE,
    checkEventOn: (coordinate: Coordinate, attrs: HitPathAttrs | HitPathAttrs[]) =>
      ([] as HitPathAttrs[]).concat(attrs).some(a => Array.isArray(a?.coordinates) &&
        isNearPolyline(coordinate, a.coordinates, typeof a.tolerance === 'number' ? a.tolerance : MIN_HIT_TOLERANCE)),
    draw: () => {}
  })
}

/** A clickable (invisible) figure along one or more polylines, for thin lines. */
export function hitPath (...paths: Coordinate[][]): OverlayFigure {
  return { type: HIT_PATH_FIGURE, attrs: paths.map(coordinates => ({ coordinates })) }
}

/** Like hitPath, for a stroke that is wider than a thin line (see strokeHitTolerance). */
export function hitPathWithin (tolerance: number, ...paths: Coordinate[][]): OverlayFigure {
  return { type: HIT_PATH_FIGURE, attrs: paths.map(coordinates => ({ coordinates, tolerance })) }
}
