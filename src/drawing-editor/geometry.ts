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

// Geometry for the drawing editor: keeping the floating toolbar and its popovers
// inside the chart, choosing where the toolbar first appears, clipping lines to a
// rect, and a bounded hit test for polylines (used by the extension overlays'
// invisible hit paths). Pure — no DOM. Part of SUPer-Chart (Apache-2.0).

export interface Point2 {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** A straight piece of line, from one end to the other. */
export type Segment = readonly [Point2, Point2]

/** What the toolbar keeps clear of when it first opens: the selected drawing. */
export interface ToolbarAvoid {
  /** Around the drawing's points and the click that selected it; null when unknown. */
  rect: Rect | null
  /** Lines it draws beyond its points (see drawnLines). */
  lines: readonly Segment[]
}

/** Top-left position clamped so a box of `size` stays inside `bounds` (left/top win when it cannot fit). */
export function clampPosition (pos: Point2, size: Size, bounds: Rect): Point2 {
  const maxX = bounds.x + Math.max(0, bounds.width - size.width)
  const maxY = bounds.y + Math.max(0, bounds.height - size.height)
  const x = Number.isFinite(pos.x) ? pos.x : bounds.x
  const y = Number.isFinite(pos.y) ? pos.y : bounds.y
  return {
    x: Math.round(Math.min(maxX, Math.max(bounds.x, x))),
    y: Math.round(Math.min(maxY, Math.max(bounds.y, y)))
  }
}

export function overlapArea (a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

export function rectsIntersect (a: Rect, b: Rect): boolean {
  return overlapArea(a, b) > 0
}

/** Smallest rect containing every finite point, or null when there are none. */
export function boundsOfPoints (points: ReadonlyArray<Partial<Point2>>): Rect | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  points.forEach(p => {
    if (typeof p.x === 'number' && typeof p.y === 'number' && Number.isFinite(p.x) && Number.isFinite(p.y)) {
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x)
      maxY = Math.max(maxY, p.y)
    }
  })
  if (!Number.isFinite(minX)) {
    return null
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

export function inflateRect (r: Rect, d: number): Rect {
  return { x: r.x - d, y: r.y - d, width: r.width + 2 * d, height: r.height + 2 * d }
}

export function unionRect (a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y }
}

/**
 * The part of the line a + t·(b − a), t in [from, to], that lies inside `rect`
 * (Liang–Barsky), or null when none does. [0, 1] is the segment a–b, [0, ∞) the
 * ray from a through b, (−∞, ∞) the whole line.
 */
export function clipToRect (a: Point2, b: Point2, rect: Rect, from = 0, to = 1): Segment | null {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const x0 = Math.min(rect.x, rect.x + rect.width)
  const x1 = Math.max(rect.x, rect.x + rect.width)
  const y0 = Math.min(rect.y, rect.y + rect.height)
  const y1 = Math.max(rect.y, rect.y + rect.height)
  let t0 = from
  let t1 = to
  const edges: Array<[number, number]> = [[-dx, a.x - x0], [dx, x1 - a.x], [-dy, a.y - y0], [dy, y1 - a.y]]
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) {
        return null
      }
      continue
    }
    const r = q / p
    if (p < 0) {
      if (r > t1) {
        return null
      }
      t0 = Math.max(t0, r)
    } else {
      if (r < t0) {
        return null
      }
      t1 = Math.min(t1, r)
    }
  }
  // An unbounded "line" through a single point has no direction to clip.
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t0 > t1) {
    return null
  }
  return [{ x: a.x + t0 * dx, y: a.y + t0 * dy }, { x: a.x + t1 * dx, y: a.y + t1 * dy }]
}

/** True when the segment touches the rect. */
export function segmentHitsRect (segment: Segment, rect: Rect): boolean {
  return clipToRect(segment[0], segment[1], rect) !== null
}

export interface PlacementOptions {
  /** Gap to the chart edges. */
  margin?: number
  /** Extra room kept free at the top (the chart's OHLC legend row). */
  topInset?: number
  /**
   * Lines the drawing extends across the chart beyond its own points (a
   * horizontal line, a ray, a pitchfork's prongs: see drawnLines), which the
   * toolbar should not cover either.
   */
  avoidLines?: readonly Segment[]
  /** Clearance kept around avoidLines. Default 8. */
  linePad?: number
}

/**
 * Where the toolbar first appears: near the top-centre of the chart. When that
 * would cover the selected drawing (`avoid`, and any `avoidLines`), try the top
 * corners, then the bottom; if every spot covers some of it, take the one that
 * covers the least (a crossing line counts as covering the whole toolbar).
 */
export function defaultToolbarPosition (bounds: Rect, size: Size, avoid: Rect | null, options: PlacementOptions = {}): Point2 {
  const margin = options.margin ?? 8
  const top = bounds.y + (options.topInset ?? 0) + margin
  const bottom = bounds.y + bounds.height - size.height - margin * 4
  const center = bounds.x + (bounds.width - size.width) / 2
  const left = bounds.x + margin
  const right = bounds.x + bounds.width - size.width - margin
  const candidates: Point2[] = [
    { x: center, y: top }, { x: left, y: top }, { x: right, y: top },
    { x: center, y: bottom }, { x: left, y: bottom }, { x: right, y: bottom }
  ].map(p => clampPosition(p, size, bounds))
  const lines = options.avoidLines ?? []
  if (avoid === null && lines.length === 0) {
    return candidates[0]
  }
  const pad = options.linePad ?? 8
  const cost = (c: Point2): number => {
    const box = { x: c.x, y: c.y, width: size.width, height: size.height }
    const crossings = lines.filter(line => segmentHitsRect(line, inflateRect(box, pad))).length
    return (avoid === null ? 0 : overlapArea(box, avoid)) + crossings * size.width * size.height
  }
  let best = candidates[0]
  let bestCost = Infinity
  for (const c of candidates) {
    const k = cost(c)
    if (k === 0) {
      return c
    }
    if (k < bestCost) {
      best = c
      bestCost = k
    }
  }
  return best
}

/**
 * Left edge for a popover `width` px wide opened from an anchor spanning
 * [anchor.left, anchor.right]: under the anchor's left edge ('start') or right
 * edge ('end'), moved just enough to stay inside [bounds.x, bounds.x +
 * bounds.width]. When it is wider than the bounds, the left edge wins.
 */
export function popoverLeft (anchor: { left: number, right: number }, width: number, bounds: { x: number, width: number }, align: 'start' | 'end' = 'start'): number {
  const preferred = align === 'start' ? anchor.left : anchor.right - width
  const max = bounds.x + bounds.width - width
  return Math.round(Math.max(bounds.x, Math.min(max, preferred)))
}

/** How close (px) a click must land to a thin line to hit it. */
export const MIN_HIT_TOLERANCE = 4

/**
 * Hit tolerance for a stroke `size` px wide: anywhere on the visible stroke
 * (half its width, plus a pixel of anti-aliasing), never less than
 * MIN_HIT_TOLERANCE. A 12 px highlighter band is clickable across its width.
 */
export function strokeHitTolerance (size: unknown): number {
  if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) {
    return MIN_HIT_TOLERANCE
  }
  return Math.max(MIN_HIT_TOLERANCE, size / 2 + 1)
}

/** Distance from p to the segment a–b (bounded, unlike klinecharts 9.1.1's line test). */
export function distanceToSegment (p: Point2, a: Point2, b: Point2): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** True when p lies within `tolerance` px of any segment of the polyline. */
export function isNearPolyline (p: Point2, coordinates: readonly Point2[], tolerance: number): boolean {
  if (coordinates.length === 1) {
    return Math.hypot(p.x - coordinates[0].x, p.y - coordinates[0].y) <= tolerance
  }
  for (let i = 1; i < coordinates.length; i++) {
    if (distanceToSegment(p, coordinates[i - 1], coordinates[i]) <= tolerance) {
      return true
    }
  }
  return false
}

/** True when p is inside the axis-aligned rect (edges included). */
export function isInRect (p: Point2, r: Rect): boolean {
  const x0 = Math.min(r.x, r.x + r.width)
  const x1 = Math.max(r.x, r.x + r.width)
  const y0 = Math.min(r.y, r.y + r.height)
  const y1 = Math.max(r.y, r.y + r.height)
  return p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1
}
