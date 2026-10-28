/** Stroke geometry is measured in CSS pixels, independent of chart data/zoom. */
export interface Point { x: number; y: number }

export interface DrawingCandidate {
  kind: 'trend' | 'ray' | 'horizontal' | 'vertical' | 'rectangle' | 'ellipse' | 'fibonacci' | 'path' | 'arrow'
  tool: string
  points: Point[]
  label: string
}

export interface Recognition {
  /** Best match first. Ambiguous strokes retain alternatives for Tab. */
  candidates: DrawingCandidate[]
  /** Only a geometric hint; deletion still requires the caller's target hit test. */
  scribble: boolean
}

const MAX_SAMPLES = 512
const MAX_PATH_POINTS = 128
const MAX_COORDINATE = 1e7
const TOOLS = {
  trend: 'segment',
  ray: 'rayLine',
  horizontal: 'horizontalStraightLine',
  vertical: 'verticalStraightLine',
  rectangle: 'rect',
  ellipse: 'ellipse',
  fibonacci: 'fibonacciLine',
  path: 'brush',
  arrow: 'arrow'
} as const
const LABELS = {
  trend: 'Trend line',
  ray: 'Ray',
  horizontal: 'Horizontal line',
  vertical: 'Vertical line',
  rectangle: 'Rectangle',
  ellipse: 'Ellipse',
  fibonacci: 'Fibonacci retracement',
  path: 'Path',
  arrow: 'Arrow'
} as const
type Kind = DrawingCandidate['kind']
interface RankedCandidate { candidate: DrawingCandidate; score: number }
interface Bounds { left: number; top: number; width: number; height: number; diagonal: number }

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

function length(points: readonly Point[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) total += distance(points[i - 1], points[i])
  return total
}

function bounds(points: readonly Point[]): Bounds {
  let left = points[0].x, right = left, top = points[0].y, bottom = top
  for (const p of points) {
    left = Math.min(left, p.x); right = Math.max(right, p.x)
    top = Math.min(top, p.y); bottom = Math.max(bottom, p.y)
  }
  const width = right - left, height = bottom - top
  return { left, top, width, height, diagonal: Math.hypot(width, height) }
}

function pointDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y
  const squared = dx * dx + dy * dy
  if (squared === 0) return distance(p, a)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / squared))
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy)
}

/** Iterative Douglas-Peucker: endpoints/corners survive without recursive stacks. */
function simplify(points: readonly Point[], tolerance: number): Point[] {
  if (points.length < 3) return points.map(p => ({ ...p }))
  const keep = new Set<number>([0, points.length - 1])
  const pending: Array<[number, number]> = [[0, points.length - 1]]
  while (pending.length > 0) {
    const range = pending.pop()
    if (range === undefined) break
    const [first, last] = range
    let furthest = tolerance, index = -1
    for (let i = first + 1; i < last; i++) {
      const d = pointDistance(points[i], points[first], points[last])
      if (d > furthest) { furthest = d; index = i }
    }
    if (index >= 0) {
      keep.add(index)
      pending.push([first, index], [index, last])
    }
  }
  return Array.from(keep).sort((a, b) => a - b).map(i => ({ ...points[i] }))
}

function removeCollinear(points: readonly Point[], tolerance: number): Point[] {
  const result: Point[] = []
  for (const p of points) {
    result.push(p)
    while (result.length >= 3) {
      const n = result.length
      if (pointDistance(result[n - 2], result[n - 3], result[n - 1]) > tolerance) break
      result.splice(n - 2, 1)
    }
  }
  return result
}

/** Equal arc-length samples prevent pauses/dense pointer events biasing a fit. */
function resample(points: readonly Point[], count: number): Point[] {
  const total = length(points), step = total / (count - 1)
  const result: Point[] = [{ ...points[0] }]
  let segment = 1, travelled = 0
  for (let i = 1; i < count - 1; i++) {
    const target = i * step
    while (segment < points.length - 1 && travelled + distance(points[segment - 1], points[segment]) < target) {
      travelled += distance(points[segment - 1], points[segment]); segment++
    }
    const a = points[segment - 1], b = points[segment], d = distance(a, b)
    const t = d === 0 ? 0 : Math.max(0, Math.min(1, (target - travelled) / d))
    result.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
  }
  result.push({ ...points[points.length - 1] })
  return result
}

function reversals(points: readonly Point[], axis: 'x' | 'y', threshold: number): number {
  let previous = 0, count = 0
  for (let i = 1; i < points.length; i++) {
    const delta = points[i][axis] - points[i - 1][axis]
    if (Math.abs(delta) < threshold) continue
    const sign = Math.sign(delta)
    if (previous !== 0 && sign !== previous) count++
    previous = sign
  }
  return count
}

function sharpTurns(points: readonly Point[], threshold: number): number {
  let count = 0
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1], b = points[i], c = points[i + 1]
    const incoming = distance(a, b), outgoing = distance(b, c)
    if (incoming < threshold || outgoing < threshold) continue
    const cosine = ((b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y)) / (incoming * outgoing)
    if (cosine < -0.4) count++
  }
  return count
}

function cross(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

function crossings(points: readonly Point[]): number {
  let count = 0
  for (let i = 1; i < points.length; i++) {
    for (let j = i + 2; j < points.length; j++) {
      const a = points[i - 1], b = points[i], c = points[j - 1], d = points[j]
      // Proper intersections only: a retraced edge/shared endpoint is not a crossing.
      if (cross(a, b, c) * cross(a, b, d) < -1 && cross(c, d, a) * cross(c, d, b) < -1) {
        count++
        if (count >= 12) return count
      }
    }
  }
  return count
}

function isScribble(points: readonly Point[], box: Bounds, total: number): boolean {
  if (points.length < 8 || Math.min(box.width, box.height) < 16 || total < 4 * box.diagonal) return false
  if (distance(points[0], points[points.length - 1]) > box.diagonal * 0.7) return false
  const threshold = Math.max(5, box.diagonal * 0.04)
  const turns = sharpTurns(points, threshold)
  const backtracks = Math.max(reversals(points, 'x', threshold), reversals(points, 'y', threshold))
  if (turns < 4 || backtracks < 4) return false
  if (crossings(points) >= 5) return true
  // Non-crossing scratch marks need many more long, sharp passes than a usual path.
  return backtracks >= 7 && turns >= 6 && total >= 6 * box.diagonal &&
    distance(points[0], points[points.length - 1]) <= box.diagonal * 0.6
}

function arrowTip(points: readonly Point[]): Point | null {
  const start = points[0]
  for (let i = 1; i < points.length - 1; i++) {
    const tip = points[i], shaft = distance(start, tip)
    if (shaft < 32 || length(points.slice(0, i + 1)) > shaft * 1.1) continue
    if (points.slice(0, i + 1).some(p => pointDistance(p, start, tip) > Math.max(3, shaft * 0.06))) continue
    const dx = (tip.x - start.x) / shaft, dy = (tip.y - start.y) / shaft
    let left = false, right = false, compact = true
    for (const p of points.slice(i + 1)) {
      if (distance(p, tip) > shaft * 0.32) { compact = false; break }
      const behind = (tip.x - p.x) * dx + (tip.y - p.y) * dy
      const side = (p.x - tip.x) * dy - (p.y - tip.y) * dx
      if (behind < Math.max(5, shaft * 0.07) || behind > shaft * 0.3) continue
      if (side > Math.max(5, shaft * 0.04)) left = true
      if (side < -Math.max(5, shaft * 0.04)) right = true
    }
    // A short backward hook is the single-stroke arrow shorthand. Two wings
    // also work, but a perpendicular corner or retraced shaft is not a hook.
    if (compact && (left || right)) return { ...tip }
  }
  return null
}

function isThreeSidedBox(points: readonly Point[], box: Bounds): boolean {
  if (points.length !== 4 || Math.min(box.width, box.height) < 20) return false
  const vectors = points.slice(1).map((p, i) => ({ x: p.x - points[i].x, y: p.y - points[i].y }))
  const sizes = vectors.map(p => Math.hypot(p.x, p.y))
  if (sizes.some(size => size < Math.max(10, box.diagonal * 0.12))) return false
  const cosine = (a: number, b: number): number => (vectors[a].x * vectors[b].x + vectors[a].y * vectors[b].y) / (sizes[a] * sizes[b])
  // Three sides of an open box: two opposing swing legs joined by one side.
  return cosine(0, 2) < -0.75 && Math.abs(cosine(0, 1)) < 0.35 && Math.abs(cosine(1, 2)) < 0.35
}

function swingAnchors(points: readonly Point[], box: Bounds): Point[] {
  const start = points[0], end = points[points.length - 1]
  const rightward = end.x >= start.x
  const firstY = points[1].y - start.y
  const downward = firstY === 0 ? end.y >= start.y : firstY > 0
  return [
    { x: box.left + (rightward ? 0 : box.width), y: box.top + (downward ? 0 : box.height) },
    { x: box.left + (rightward ? box.width : 0), y: box.top + (downward ? box.height : 0) }
  ]
}

function isStaircase(points: readonly Point[], box: Bounds): boolean {
  const start = points[0], end = points[points.length - 1]
  if (Math.min(box.width, box.height) < 20 || Math.abs(end.x - start.x) < box.width * 0.7 ||
      Math.abs(end.y - start.y) < box.height * 0.5) return false
  const threshold = Math.max(5, box.diagonal * 0.035)
  // A retracement zigzag advances in time while changing price direction.
  if (reversals(points, 'x', threshold) === 0 && reversals(points, 'y', threshold) >= 3) return true
  let horizontal = 0, vertical = 0, previous = '', switches = 0
  for (let i = 1; i < points.length; i++) {
    const dx = Math.abs(points[i].x - points[i - 1].x), dy = Math.abs(points[i].y - points[i - 1].y)
    let axis = ''
    if (dx >= threshold && dy <= dx * 0.25) { horizontal++; axis = 'x' }
    if (dy >= threshold && dx <= dy * 0.25) { vertical++; axis = 'y' }
    if (axis !== '') {
      if (previous !== '' && previous !== axis) switches++
      previous = axis
    }
  }
  return horizontal >= 2 && vertical >= 2 && switches >= 3 &&
    reversals(points, 'x', threshold) === 0 && reversals(points, 'y', threshold) === 0
}

/**
 * Pure deterministic recognition. Invalid/huge coordinates are discarded; the
 * work and emitted paths are bounded. Tiny movements never create a drawing.
 * A line cannot disambiguate segment/ray/arrow/fib, so they remain alternatives.
 */
export function recognizeStroke(input: readonly Point[]): Recognition {
  const points: Point[] = []
  let invalid = false
  const step = Math.max(1, Math.ceil(input.length / MAX_SAMPLES))
  for (let i = 0; i < input.length; i += step) {
    const p = input[i]
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > MAX_COORDINATE || Math.abs(p.y) > MAX_COORDINATE) {
      invalid = true; continue
    }
    if (points.length === 0 || distance(points[points.length - 1], p) >= 0.5) points.push({ ...p })
  }
  // Preserve the final pointer position even when input was decimated.
  const lastInput = input[input.length - 1]
  if (lastInput !== undefined && Number.isFinite(lastInput.x) && Number.isFinite(lastInput.y) &&
      Math.abs(lastInput.x) <= MAX_COORDINATE && Math.abs(lastInput.y) <= MAX_COORDINATE &&
      (points.length === 0 || distance(points[points.length - 1], lastInput) >= 0.5)) points.push({ ...lastInput })
  if (points.length < 2) return { candidates: [], scribble: false }
  const box = bounds(points), total = length(points)
  if (box.diagonal < 8 || total < 10) return { candidates: [], scribble: false }
  const start = points[0], end = points[points.length - 1], chord = distance(start, end)
  const corners = simplify(points, Math.max(2, box.diagonal * 0.012))
  const boxTolerance = Math.max(3, box.diagonal * 0.035)
  const boxCorners = removeCollinear(simplify(points, boxTolerance), boxTolerance)
  const sampled = resample(points, 64)
  const ranked: RankedCandidate[] = []
  const add = (kind: Kind, anchors: Point[], score: number): void => {
    ranked.push({ candidate: { kind, tool: TOOLS[kind], points: anchors.map(p => ({ ...p })), label: LABELS[kind] }, score })
  }

  const closed = chord <= Math.max(10, box.diagonal * 0.18) && total >= 2 * box.diagonal
  if (closed && Math.min(box.width, box.height) >= 16) {
    const cx = box.left + box.width / 2, cy = box.top + box.height / 2
    let rectangleError = 0, ellipseError = 0
    const cornerDistances = [Infinity, Infinity, Infinity, Infinity]
    for (const p of sampled) {
      const x = (p.x - cx) / (box.width / 2), y = (p.y - cy) / (box.height / 2)
      rectangleError += Math.min(Math.abs(Math.abs(x) - 1), Math.abs(Math.abs(y) - 1))
      ellipseError += Math.abs(Math.hypot(x, y) - 1)
      for (let i = 0; i < 4; i++) {
        cornerDistances[i] = Math.min(cornerDistances[i], Math.hypot(x - (i < 2 ? -1 : 1), y - (i % 2 === 0 ? -1 : 1)))
      }
    }
    rectangleError /= sampled.length; ellipseError /= sampled.length
    const anchors = [{ x: box.left, y: box.top }, { x: box.left + box.width, y: box.top + box.height }]
    if (rectangleError < 0.16 && cornerDistances.every(d => d < 0.4)) add('rectangle', anchors, rectangleError)
    if (ellipseError < 0.2) add('ellipse', anchors, ellipseError)
  }

  const tip = arrowTip(corners)
  if (tip !== null) add('arrow', [start, tip], 0.02)
  const straight = chord >= 10 && total <= chord * 1.18 &&
    sampled.every(p => pointDistance(p, start, end) <= Math.max(3, chord * 0.065))
  if (straight) {
    const dx = Math.abs(end.x - start.x), dy = Math.abs(end.y - start.y)
    if (dy <= Math.max(4, dx * 0.1)) add('horizontal', [{ x: start.x, y: sampled.reduce((sum, p) => sum + p.y, 0) / sampled.length }], 0.01)
    if (dx <= Math.max(4, dy * 0.1)) add('vertical', [{ x: sampled.reduce((sum, p) => sum + p.x, 0) / sampled.length, y: start.y }], 0.01)
    add('trend', [start, end], 0.1)
    add('ray', [start, end], 0.2)
    if (tip === null) add('arrow', [start, end], 0.3)
    if (dx >= 8 && dy >= 8) add('fibonacci', [start, end], 0.4)
  } else if (isThreeSidedBox(boxCorners, box)) {
    add('fibonacci', swingAnchors(boxCorners, box), 0.05)
    add('trend', [start, end], 0.5)
  } else if (isStaircase(corners, box)) {
    add('fibonacci', [start, end], 0.05)
    add('trend', [start, end], 0.5)
  }

  let path = simplify(points, Math.max(1.25, Math.min(3, box.diagonal * 0.008)))
  if (path.length > MAX_PATH_POINTS) path = resample(path, MAX_PATH_POINTS)
  add('path', path, 1)
  ranked.sort((a, b) => a.score - b.score)
  return { candidates: ranked.map(row => row.candidate), scribble: !invalid && isScribble(corners, box, total) }
}
