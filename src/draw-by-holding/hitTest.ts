import { drawnLines } from '../drawing-editor/extent'
import { distanceToSegment, type Point2, type Rect, type Segment } from '../drawing-editor/geometry'

const cross = (a: Point2, b: Point2, p: Point2): number => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
function touches (a: Segment, b: Segment, tolerance: number): boolean {
  const ca = cross(a[0], a[1], b[0]); const cb = cross(a[0], a[1], b[1])
  const cc = cross(b[0], b[1], a[0]); const cd = cross(b[0], b[1], a[1])
  if (ca * cb < 0 && cc * cd < 0) return true
  return Math.min(distanceToSegment(a[0], b[0], b[1]), distanceToSegment(a[1], b[0], b[1]), distanceToSegment(b[0], a[0], a[1]), distanceToSegment(b[1], a[0], a[1])) <= tolerance
}

/** Conservative geometry for scribble erasing: require multiple stroke pieces to touch a visible drawing. */
export function scribbleHitsDrawing (stroke: readonly Point2[], name: string, points: readonly Point2[], pane: Rect, extendData?: unknown): boolean {
  if (stroke.length < 4 || points.length === 0 || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return false
  const lines: Segment[] = drawnLines(name, points, pane, extendData)
  if ((name === 'rect' || name === 'ellipse') && points.length >= 2) {
    const [a, b] = points
    const cx = (a.x + b.x) / 2; const cy = (a.y + b.y) / 2
    const rx = Math.abs(a.x - b.x) / 2; const ry = Math.abs(a.y - b.y) / 2
    const outline = name === 'rect'
      ? [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }, a]
      : Array.from({ length: 49 }, (_, i) => ({ x: cx + rx * Math.cos(i * Math.PI / 24), y: cy + ry * Math.sin(i * Math.PI / 24) }))
    for (let i = 1; i < outline.length; i++) lines.push([outline[i - 1], outline[i]])
  } else if (lines.length === 0 && ['brush', 'highlighter', 'segment', 'arrow', 'horizontalSegment', 'verticalSegment'].includes(name)) {
    for (let i = 1; i < points.length; i++) lines.push([points[i - 1], points[i]])
  }
  // Single-anchor labels/images and unknown area tools are intentionally not erased.
  let hits = 0
  for (let i = 1; i < stroke.length; i++) {
    if (lines.some(line => touches([stroke[i - 1], stroke[i]], line, 6))) hits++
    if (hits >= 3) return true
  }
  return false
}
