import type { DrawingPoint, DrawingType } from './drawings'

/**
 * Turns one hand-drawn stroke (pixel points) into the geometric drawing it was meant to be.
 *
 * Pure and deterministic: no DOM, no clock, no random numbers. It only ever proposes drawing types the
 * store already owns, with their pixel anchors in the order the type expects, so the caller unprojects them
 * and stores an ordinary drawing. It recognizes straight lines (trend, horizontal, vertical), rectangles,
 * ellipses, circles and triangles, and tells a scribble apart so the host can offer to erase. Everything
 * else is reported as unrecognized rather than guessed.
 */
export type RecognizedShape = 'trend-line' | 'horizontal-segment' | 'vertical-segment' | 'segment' | 'ray' | 'arrow' | 'rectangle' | 'ellipse' | 'circle' | 'triangle'

export interface ShapeCandidate {
  readonly type: Extract<DrawingType, RecognizedShape>
  /** Anchors in pixel space, in the order the drawing type expects. */
  readonly points: readonly DrawingPoint[]
  /** 0 to 1; how well the stroke fits, comparable across the candidates of one stroke. */
  readonly score: number
}
export type StrokeResult =
  | { readonly kind: 'shape', readonly candidates: readonly ShapeCandidate[] }
  | { readonly kind: 'scribble', readonly bounds: { readonly left: number, readonly top: number, readonly right: number, readonly bottom: number }, readonly path: readonly DrawingPoint[] }
  | { readonly kind: 'none', readonly reason: 'too-short' | 'unrecognized' }

export const SHAPE_RECOGNITION_LIMITS = Object.freeze({
  /** Longest stroke considered; longer ones are thinned first. */
  maxPoints: 2048,
  /** A stroke shorter than this many pixels (path length) is a tap, not a shape. */
  minLength: 24,
  /** Candidates below this score are never offered. */
  minScore: 0.62,
  /** Direction reversals that make a scribble. */
  scribbleReversals: 4
})

const SAMPLES = 64
const dist = (a: DrawingPoint, b: DrawingPoint): number => Math.hypot(a.x - b.x, a.y - b.y)
const clamp01 = (value: number): number => value < 0 ? 0 : value > 1 ? 1 : value

function clean (input: readonly DrawingPoint[]): DrawingPoint[] {
  const points: DrawingPoint[] = []
  const stride = Math.max(1, Math.ceil(input.length / SHAPE_RECOGNITION_LIMITS.maxPoints))
  for (let i = 0; i < input.length; i += stride) {
    const point = input[i]
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue
    const last = points[points.length - 1]
    if (last === undefined || dist(last, point) >= 0.5) points.push({ x: point.x, y: point.y })
  }
  const final = input[input.length - 1]
  if (final !== undefined && Number.isFinite(final.x) && Number.isFinite(final.y) && points.length > 0 && dist(points[points.length - 1], final) > 0) points.push({ x: final.x, y: final.y })
  return points
}
function pathLength (points: readonly DrawingPoint[]): number {
  let length = 0
  for (let i = 1; i < points.length; i++) length += dist(points[i - 1], points[i])
  return length
}
function resample (points: readonly DrawingPoint[], length: number): DrawingPoint[] {
  const step = length / (SAMPLES - 1), out: DrawingPoint[] = [points[0]]
  let carried = 0, previous = points[0]
  for (let i = 1; i < points.length; i++) {
    const current = points[i]
    let gap = dist(previous, current)
    while (carried + gap >= step && gap > 0) {
      const t = (step - carried) / gap
      const next = { x: previous.x + (current.x - previous.x) * t, y: previous.y + (current.y - previous.y) * t }
      out.push(next); previous = next; gap = dist(previous, current); carried = 0
      if (out.length >= SAMPLES) return out
    }
    carried += gap; previous = current
  }
  while (out.length < SAMPLES) out.push(points[points.length - 1])
  return out
}
/** Sign changes of the dominant-axis step over a thinned path: a back-and-forth scrub flips it many times. */
function reversals (points: readonly DrawingPoint[], size: number): number {
  const threshold = Math.max(3, size * 0.12)
  let count = 0, axisX = 0, axisY = 0, anchor = points[0], direction = 0
  for (const point of points) {
    const dx = point.x - anchor.x, dy = point.y - anchor.y
    if (Math.hypot(dx, dy) < threshold) continue
    // Reduce to the sign along the stroke's principal travel so a diagonal scrub still counts.
    if (axisX === 0 && axisY === 0) { const length = Math.hypot(dx, dy); axisX = dx / length; axisY = dy / length }
    const along = dx * axisX + dy * axisY, sign = along > 0 ? 1 : -1
    if (direction !== 0 && sign !== direction) count++
    direction = sign; anchor = point
  }
  return count
}
function simplify (points: readonly DrawingPoint[], epsilon: number): DrawingPoint[] {
  if (points.length < 3) return [...points]
  const first = points[0], last = points[points.length - 1]
  let index = -1, farthest = 0
  const dx = last.x - first.x, dy = last.y - first.y, length = Math.hypot(dx, dy)
  for (let i = 1; i < points.length - 1; i++) {
    const d = length === 0 ? dist(points[i], first) : Math.abs(dy * points[i].x - dx * points[i].y + last.x * first.y - last.y * first.x) / length
    if (d > farthest) { farthest = d; index = i }
  }
  if (index < 0 || farthest <= epsilon) return [first, last]
  const left = simplify(points.slice(0, index + 1), epsilon), right = simplify(points.slice(index), epsilon)
  return [...left.slice(0, -1), ...right]
}
function segmentDistance (p: DrawingPoint, a: DrawingPoint, b: DrawingPoint): number {
  const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy
  const t = length2 === 0 ? 0 : clamp01(((p.x - a.x) * dx + (p.y - a.y) * dy) / length2)
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}
/** Mean distance from the samples to a closed outline, as a fraction of `scale`; 0 is a perfect fit. */
function outlineError (samples: readonly DrawingPoint[], outline: readonly DrawingPoint[], scale: number): number {
  let total = 0
  for (const point of samples) {
    let best = Infinity
    for (let i = 0; i < outline.length; i++) best = Math.min(best, segmentDistance(point, outline[i], outline[(i + 1) % outline.length]))
    total += best
  }
  return total / samples.length / scale
}
/** How much of an outline the stroke actually visits: a half-drawn square must not pass for a square. */
function coverage (samples: readonly DrawingPoint[], outline: readonly DrawingPoint[], tolerance: number): number {
  const probes = 48
  let perimeter = 0
  for (let i = 0; i < outline.length; i++) perimeter += dist(outline[i], outline[(i + 1) % outline.length])
  if (perimeter === 0) return 0
  let hit = 0
  for (let k = 0; k < probes; k++) {
    let target = perimeter * k / probes, point = outline[0]
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i], b = outline[(i + 1) % outline.length], edge = dist(a, b)
      if (target <= edge || i === outline.length - 1) { const t = edge === 0 ? 0 : target / edge; point = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; break }
      target -= edge
    }
    if (samples.some(sample => dist(sample, point) <= tolerance)) hit++
  }
  return hit / probes
}

export function recognizeStroke (input: readonly DrawingPoint[]): StrokeResult {
  const points = clean(input)
  if (points.length < 3) return { kind: 'none', reason: 'too-short' }
  const length = pathLength(points)
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity
  for (const point of points) { left = Math.min(left, point.x); right = Math.max(right, point.x); top = Math.min(top, point.y); bottom = Math.max(bottom, point.y) }
  const width = right - left, height = bottom - top, diagonal = Math.hypot(width, height)
  if (length < SHAPE_RECOGNITION_LIMITS.minLength || diagonal < 12) return { kind: 'none', reason: 'too-short' }

  const samples = resample(points, length)
  // A scribble wanders back and forth over a small area; it is much longer than the box it fills.
  if (length / diagonal > 3.2 && reversals(samples, diagonal) >= SHAPE_RECOGNITION_LIMITS.scribbleReversals) {
    return { kind: 'scribble', bounds: { left, top, right, bottom }, path: Object.freeze(points) }
  }

  const start = points[0], end = points[points.length - 1]
  const chord = dist(start, end)
  const candidates: ShapeCandidate[] = []
  const add = (type: ShapeCandidate['type'], anchors: readonly DrawingPoint[], score: number): void => {
    if (score >= SHAPE_RECOGNITION_LIMITS.minScore) candidates.push({ type, points: Object.freeze(anchors.map(point => Object.freeze({ x: point.x, y: point.y }))), score })
  }

  // Closed outline: the pen returns near where it started.
  if (chord <= Math.max(10, diagonal * 0.3) && length > diagonal * 1.8) {
    const scale = Math.max(1, Math.min(width, height))
    const ratio = Math.max(width, height) / scale
    const box = [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }]
    if (scale >= 8) {
      const rectError = outlineError(samples, box, scale), rectCover = coverage(samples, box, Math.max(6, scale * 0.18))
      // A box has four corners the pen visited; a circle never gets that close to them.
      const cornersVisited = box.every(corner => samples.some(sample => dist(sample, corner) <= scale * 0.18))
      add('rectangle', [{ x: left, y: top }, { x: right, y: bottom }], clamp01(1 - rectError * 3) * clamp01(rectCover * 1.15) * (cornersVisited ? 1 : 0.5))
      const cx = (left + right) / 2, cy = (top + bottom) / 2, rx = width / 2, ry = height / 2
      let ellipseTotal = 0
      for (const sample of samples) ellipseTotal += Math.abs(Math.hypot((sample.x - cx) / rx, (sample.y - cy) / ry) - 1)
      const round = clamp01(1 - ellipseTotal / samples.length * 2.2)
      // A square-box bounding box that fits a rectangle just as well is a square, not a circle: roundness decides.
      // Near-equal sides: the person most likely meant a circle, so it leads and the ellipse follows.
      const nearlyRound = ratio < 1.12
      add('ellipse', [{ x: left, y: top }, { x: right, y: bottom }], nearlyRound ? round * 0.98 : round)
      if (ratio < 1.25) add('circle', [{ x: cx, y: cy }, { x: cx + (width + height) / 4, y: cy }], nearlyRound ? round : round * 0.96)
    }
    // Triangle: the simplified closed outline has three corners.
    const closed = [...samples.slice(0, -1)]
    const corners = simplify([...closed, closed[0]], diagonal * 0.12).slice(0, -1)
    if (corners.length === 3) {
      const area = Math.abs((corners[1].x - corners[0].x) * (corners[2].y - corners[0].y) - (corners[2].x - corners[0].x) * (corners[1].y - corners[0].y)) / 2
      if (area > diagonal * diagonal * 0.04) {
        const error = outlineError(samples, corners, Math.max(1, diagonal / 2)), cover = coverage(samples, corners, Math.max(6, diagonal * 0.07))
        add('triangle', corners, clamp01(1 - error * 3.2) * clamp01(cover * 1.1))
      }
    }
  } else if (chord > Math.max(16, length * 0.5)) {
    // Open and nearly straight: how far the samples stray from the chord, against its length.
    let deviation = 0
    for (const sample of samples) deviation = Math.max(deviation, segmentDistance(sample, start, end))
    const straight = clamp01(1 - deviation / chord * 4.5)
    const angle = Math.atan2(end.y - start.y, end.x - start.x) * 180 / Math.PI
    const flat = Math.min(Math.abs(angle), 180 - Math.abs(angle)), upright = Math.abs(90 - Math.abs(angle))
    const ordered = flat <= 4 ? 'horizontal-segment' as const : upright <= 4 ? 'vertical-segment' as const : null
    // A straightened stroke keeps the person's first point and snaps the other end onto the axis.
    const snapped = ordered === 'horizontal-segment' ? { x: end.x, y: start.y } : ordered === 'vertical-segment' ? { x: start.x, y: end.y } : end
    if (ordered !== null) add(ordered, [start, snapped], straight)
    add('trend-line', [start, end], straight * (ordered !== null ? 0.97 : 1))
    add('segment', [start, end], straight * 0.95)
    add('ray', [start, end], straight * 0.93)
    add('arrow', [start, end], straight * 0.91)
  }
  if (candidates.length === 0) return { kind: 'none', reason: 'unrecognized' }
  candidates.sort((a, b) => b.score - a.score)
  return { kind: 'shape', candidates: Object.freeze(candidates) }
}
