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

// One shared, pure geometry for the three TradingView pitchfork variants —
// Andrews' pitchfork, Schiff, and Modified Schiff — used by their overlay
// templates (tvTools.ts, tvTools2.ts, tvTools4.ts) AND the drawing editor's
// placement geometry (drawing-editor/extent.ts), so the two paths cannot
// drift apart the way Schiff's inline formula once did: it computed
// ((p0+mid)/2, (p0+mid)/2), the exact Andrews median (dir = (mid-p0)/2,
// collinear with Andrews' own mid-p0), so picking "Schiff Pitchfork" from the
// rail drew an Andrews fork with a shorter handle (SC-177).
//
// p0 is the handle, p1 and p2 are the two prong anchors.
// Part of SUPer-Chart (Apache-2.0).

import type { Coordinate, OverlayFigure } from 'klinecharts'
import { hitPath } from './hitPath'

export type PitchforkKind = 'pitchfork' | 'schiff' | 'modifiedSchiff'

export interface Pt {
  x: number
  y: number
}

/**
 * The median's starting point for each variant:
 *  - pitchfork (Andrews): the handle itself.
 *  - schiff: the handle's time (x), moved halfway in price (y) toward the
 *    first prong anchor.
 *  - modifiedSchiff: the full midpoint (time and price) of the handle and the
 *    first prong anchor.
 */
export function pitchforkOrigin (kind: PitchforkKind, p0: Pt, p1: Pt, p2: Pt): Pt {
  switch (kind) {
    case 'schiff':
      return { x: p0.x, y: (p0.y + p1.y) / 2 }
    case 'modifiedSchiff':
      return { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 }
    default:
      return { x: p0.x, y: p0.y }
  }
}

/** The median's direction (origin toward the p1/p2 midpoint); null when they coincide (nothing to draw). */
export function pitchforkDirection (origin: Pt, p1: Pt, p2: Pt): Pt | null {
  const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }
  const dir = { x: mid.x - origin.x, y: mid.y - origin.y }
  return dir.x === 0 && dir.y === 0 ? null : dir
}

/**
 * The three lines a finished fork draws: the near segment p1-p2, the median
 * from `origin`, and the two prongs through p1 and p2 — all parallel to the
 * median, extended `reach` px past their start. Null when the origin and the
 * p1/p2 midpoint coincide (degenerate placement).
 */
export function pitchforkProngs (kind: PitchforkKind, p0: Pt, p1: Pt, p2: Pt, reach: number): Array<[Pt, Pt]> | null {
  const origin = pitchforkOrigin(kind, p0, p1, p2)
  const dir = pitchforkDirection(origin, p1, p2)
  if (dir === null) {
    return null
  }
  const len = Math.hypot(dir.x, dir.y) || 1
  const scale = reach / len
  const ext = (from: Pt): Pt => ({ x: from.x + dir.x * scale, y: from.y + dir.y * scale })
  return [[p1, p2], [origin, ext(origin)], [p1, ext(p1)], [p2, ext(p2)]]
}

/**
 * The OverlayTemplate figures for a pitchfork variant, given its placed
 * coordinates (2 while the third prong is still being placed, 3 once
 * finished). Shared by tvTools.ts / tvTools2.ts / tvTools4.ts.
 */
export function pitchforkFigures (kind: PitchforkKind, coordinates: readonly Coordinate[], boundingWidth: number, boundingHeight: number): OverlayFigure[] {
  if (coordinates.length < 2) {
    return []
  }
  if (coordinates.length < 3) {
    return [{ type: 'line', attrs: { coordinates: [coordinates[0], coordinates[1]] } }]
  }
  const [p0, p1, p2] = coordinates
  const lines = pitchforkProngs(kind, p0, p1, p2, boundingWidth + boundingHeight)
  if (lines === null) {
    return []
  }
  return [
    { type: 'line', ignoreEvent: true, attrs: lines.map(coordinates => ({ coordinates })) },
    hitPath(...lines)
  ]
}
