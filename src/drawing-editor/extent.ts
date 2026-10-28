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

// The lines a drawing draws BEYOND its own anchor points: a horizontal line runs
// across the whole pane from one click, a ray runs to the pane's edge, a
// pitchfork's prongs run off the chart. The toolbar's first placement avoids the
// bounds of the anchor points; for these tools that is not the drawing, so it
// also avoids these lines. Each case mirrors the geometry of the tool's
// createPointFigures (klinecharts 9.1.1 built-ins, and src/extension for the
// rest). Tools not listed here stay within their points' bounds (or close enough
// for placement). Pure — no DOM. Part of SUPer-Chart (Apache-2.0).

import { clipToRect, type Point2, type Rect, type Segment } from './geometry'
import { pitchforkDirection, pitchforkOrigin, type PitchforkKind } from '../extension/pitchforkGeometry'
import { EXTENSION_LEVELS, readLevels, RETRACEMENT_LEVELS } from '../extension/fibLevels'

const LINE: [number, number] = [-Infinity, Infinity]
const RAY: [number, number] = [0, Infinity]
const SEGMENT: [number, number] = [0, 1]

/** src/extension/tvTools2.ts fibonacciTimeZone multiples. */
const FIB_TIME_ZONES = [0, 1, 2, 3, 5, 8, 13, 21, 34]
/** src/extension/tvTools2.ts gannFan angles and length. */
const GANN_RATIOS = [1 / 8, 1 / 4, 1 / 3, 1 / 2, 1, 2, 3, 4, 8]
const GANN_SCALE = 6
/** src/extension/fibonacciSpeedResistanceFan.ts levels. */
const SPEED_FAN_LEVELS = [1, 0.75, 0.618, 0.5, 0.382, 0.25, 0]

const finite = (p: Point2 | undefined): p is Point2 => p !== undefined && Number.isFinite(p.x) && Number.isFinite(p.y)

/**
 * The drawn lines of `name` that extend past its points, clipped to `pane`.
 * `points` are the overlay's points in pixels, in the same coordinates as
 * `pane`. `extendData` is the overlay's own extendData: only fibonacciSegment
 * and fibonacciExtension read it (SC-179's per-drawing `levels`), to catch a
 * level outside [0, 1] — such as a 161.8% extension target — that would
 * otherwise sit outside the two-point bounding box the caller already avoids,
 * so the toolbar could open right on top of it.
 */
export function drawnLines (name: string, points: readonly Point2[], pane: Rect, extendData?: unknown): Segment[] {
  const out: Segment[] = []
  const add = (a: Point2, b: Point2, [from, to]: [number, number]): void => {
    const s = clipToRect(a, b, pane, from, to)
    if (s !== null) {
      out.push(s)
    }
  }
  const [p0, p1, p2] = points
  const across = (y: number): void => { add({ x: pane.x, y }, { x: pane.x + 1, y }, LINE) }
  const down = (x: number): void => { add({ x, y: pane.y }, { x, y: pane.y + 1 }, LINE) }

  switch (name) {
    case 'horizontalStraightLine':
      if (finite(p0)) across(p0.y)
      break
    case 'priceLine':
      if (finite(p0)) add(p0, { x: p0.x + 1, y: p0.y }, RAY)
      break
    case 'horizontalRayLine':
      // to the right when the second point is right of the first, else to the left
      if (finite(p0)) add(p0, { x: p0.x + (finite(p1) && p0.x < p1.x ? 1 : -1), y: p0.y }, RAY)
      break
    case 'verticalStraightLine':
      if (finite(p0)) down(p0.x)
      break
    case 'verticalRayLine':
      // down when the second point is below the first, else up
      if (finite(p0) && finite(p1)) add(p0, { x: p0.x, y: p0.y + (p0.y < p1.y ? 1 : -1) }, RAY)
      break
    case 'straightLine':
      if (finite(p0) && finite(p1)) add(p0, p1, LINE)
      break
    case 'rayLine':
      if (finite(p0) && finite(p1)) add(p0, p1, RAY)
      break
    case 'parallelStraightLine':
    case 'priceChannelLine': {
      if (!finite(p0) || !finite(p1)) break
      const dir = { x: p1.x - p0.x, y: p1.y - p0.y }
      const through = (p: Point2): void => { add(p, { x: p.x + dir.x, y: p.y + dir.y }, LINE) }
      through(p0)
      if (finite(p2)) {
        through(p2)
        if (name === 'priceChannelLine') {
          // klinecharts adds a third line mirroring p2's across the first one
          const len2 = dir.x * dir.x + dir.y * dir.y
          if (len2 > 0) {
            const t = ((p2.x - p0.x) * dir.x + (p2.y - p0.y) * dir.y) / len2
            const foot = { x: p0.x + t * dir.x, y: p0.y + t * dir.y }
            through({ x: 2 * foot.x - p2.x, y: 2 * foot.y - p2.y })
          }
        }
      }
      break
    }
    case 'fibonacciLine':
    case 'SC_fibonacciLine':
      if (finite(p0) && finite(p1)) readLevels({ extendData }, RETRACEMENT_LEVELS).levels.forEach(level => { across(p1.y + (p0.y - p1.y) * level) })
      break
    case 'fibonacciSegment':
      // Bounded to the tool's own x-span (unlike fibonacciLine's full-pane
      // lines): only a level outside [0, 1] falls outside the two points'
      // bounding box, which the caller already avoids.
      if (finite(p0) && finite(p1)) {
        readLevels({ extendData }, RETRACEMENT_LEVELS).levels.filter(level => level < 0 || level > 1).forEach(level => {
          add({ x: p0.x, y: p1.y + (p0.y - p1.y) * level }, { x: p1.x, y: p1.y + (p0.y - p1.y) * level }, SEGMENT)
        })
      }
      break
    case 'fibonacciExtension':
      if (finite(p0) && finite(p1) && finite(p2)) {
        readLevels({ extendData }, EXTENSION_LEVELS).levels.filter(level => level < 0 || level > 1).forEach(level => {
          const y = p2.y + (p1.y - p0.y) * level
          add({ x: p1.x, y }, { x: p2.x, y }, SEGMENT)
        })
      }
      break
    case 'fibonacciTimeZone':
      if (finite(p0) && finite(p1) && p1.x !== p0.x) FIB_TIME_ZONES.forEach(f => { down(p0.x + (p1.x - p0.x) * f) })
      break
    case 'pitchfork':
    case 'schiff':
    case 'modifiedSchiff': {
      if (!finite(p0) || !finite(p1) || !finite(p2)) break
      const origin = pitchforkOrigin(name as PitchforkKind, p0, p1, p2)
      const dir = pitchforkDirection(origin, p1, p2)
      if (dir === null) break
      ;[origin, p1, p2].forEach(from => { add(from, { x: from.x + dir.x, y: from.y + dir.y }, RAY) })
      break
    }
    case 'gannFan': {
      if (!finite(p0) || !finite(p1)) break
      const dx = p1.x - p0.x
      const dy = p1.y - p0.y
      GANN_RATIOS.forEach(r => { add(p0, { x: p0.x + dx * GANN_SCALE, y: p0.y + dy * r * GANN_SCALE }, SEGMENT) })
      break
    }
    case 'fibonacciSpeedResistanceFan': {
      if (!finite(p0) || !finite(p1)) break
      const dx = p1.x - p0.x
      const dy = p1.y - p0.y
      SPEED_FAN_LEVELS.forEach(level => {
        add(p0, { x: p1.x - dx * level, y: p1.y }, RAY)
        add(p0, { x: p1.x, y: p1.y - dy * level }, RAY)
      })
      break
    }
  }
  return out
}
