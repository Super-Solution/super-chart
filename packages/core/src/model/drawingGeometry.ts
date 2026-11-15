// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright 2026 SUPER SOLUTION LABS INC
/** Geometry for the drawing tools that need more than a segment or a rectangle.
 * Price-based levels are projected from prices; curves, spirals and Gann angles are built in screen space.
 * Every builder receives the projected anchors and paints through a sink. */
import type { Drawing, DrawingPoint, DrawingProjector, DrawingBounds, DrawingContext, DrawingGeometrySink } from './drawings'

type Point = DrawingPoint

/** Retracement levels, from the first anchor (0) to the second (1). */
const RETRACEMENTS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]
/** Fan ratios, from the full span down to nothing. */
const FAN_RATIOS = [1, 0.75, 0.618, 0.5, 0.382, 0.25, 0]
const ARC_RATIOS = [0.382, 0.5, 0.618, 1]
const TIME_ZONE_STEPS = [0, 1, 2, 3, 5, 8, 13, 21, 34]
/** Gann angles as rise over run: 1x8, 1x4, 1x3, 1x2, 1x1, 2x1, 3x1, 4x1, 8x1. */
const GANN_ANGLES = [1 / 8, 1 / 4, 1 / 3, 1 / 2, 1, 2, 3, 4, 8]
const TAU = Math.PI * 2
const QUARTER = Math.PI / 2

interface Frame {
  readonly drawing: Drawing
  readonly points: readonly Point[]
  readonly project: DrawingProjector
  readonly bounds: DrawingBounds
  readonly context: DrawingContext | undefined
  readonly sink: DrawingGeometrySink
}

const isFinitePoint = (point: Point | null): point is Point => point !== null && Number.isFinite(point.x) && Number.isFinite(point.y)
const between = (p: Point, q: Point): Point => ({ x: p.x / 2 + q.x / 2, y: p.y / 2 + q.y / 2 })
const distance = (p: Point, q: Point): number => Math.hypot(q.x - p.x, q.y - p.y)
const along = (p: Point, q: Point, t: number): Point => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t })

/** Draw consecutive segments through the points. */
function polyline (sink: DrawingGeometrySink, points: readonly Point[]): void {
  for (let i = 1; i < points.length; i++) sink.line(points[i - 1], points[i])
}

/** Linear interpolation error is bounded by max |second derivative| / (8 * steps²).
 * Screen-space curvature reduces work for small curves and preserves detail when zoomed. */
function curveSegments (controls: readonly Point[]): number {
  const degree = controls.length - 1
  let secondDerivative = 0
  for (let i = 2; i < controls.length; i++) {
    const a = controls[i - 2], b = controls[i - 1], c = controls[i]
    secondDerivative = Math.max(secondDerivative, degree * (degree - 1) * Math.hypot(a.x - 2 * b.x + c.x, a.y - 2 * b.y + c.y))
  }
  return Math.max(1, Math.min(1024, Math.ceil(Math.sqrt(secondDerivative / (8 * 0.35)))))
}

/** Sample a Bézier curve with de Casteljau's recurrence at screen-dependent density. */
function bezier (sink: DrawingGeometrySink, controls: readonly Point[]): void {
  const steps = curveSegments(controls)
  let previous = controls[0]
  for (let step = 1; step <= steps; step++) {
    const t = step / steps
    let level = controls
    while (level.length > 1) level = level.slice(1).map((next, i) => along(level[i], next, t))
    sink.line(previous, level[0]); previous = level[0]
  }
}

/** Draw the circular arc from `from` to `to` (radians) as a polyline whose density grows with the radius. */
function arc (sink: DrawingGeometrySink, center: Point, radius: number, from: number, to: number): void {
  if (![center.x, center.y, radius, from, to].every(Number.isFinite) || radius <= 0) return
  const steps = Math.max(16, Math.min(512, Math.ceil(Math.abs(to - from) * Math.sqrt(radius / 0.5))))
  const at = (angle: number): Point => ({ x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) })
  let previous = at(from)
  for (let step = 1; step <= steps; step++) {
    const next = at(from + (to - from) * step / steps)
    sink.line(previous, next); previous = next
  }
}

function arrowHead (sink: DrawingGeometrySink, from: Point, to: Point): void {
  const length = distance(from, to)
  if (!(length > 0) || !Number.isFinite(length)) return
  const ux = (to.x - from.x) / length, uy = (to.y - from.y) / length, size = Math.min(10, length / 3)
  sink.line(from, to)
  for (const side of [1, -1]) sink.line(to, { x: to.x - ux * size + side * uy * size / 2, y: to.y - uy * size - side * ux * size / 2 })
}

/** Fractional bar index of a timestamp: it follows the loaded bars through prepends and irregular history,
 * and extrapolates with the interval at the nearest edge. */
function barIndex (timestamp: number, context: DrawingContext | undefined): number | null {
  const bars = context?.bars
  if (bars === undefined || bars.length < 2) return null
  let low = 0, high = bars.length - 1
  while (low + 1 < high) {
    const probe = (low + high) >>> 1
    if (bars[probe].timestamp <= timestamp) low = probe; else high = probe
  }
  if (timestamp >= bars[bars.length - 1].timestamp) { low = bars.length - 2; high = bars.length - 1 }
  const span = bars[high].timestamp - bars[low].timestamp
  return span > 0 ? low + (timestamp - bars[low].timestamp) / span : null
}

/** Whole bars between two anchors, or null when the loaded bars cannot place them. */
function barSpan ({ drawing, context }: Frame): number | null {
  const first = barIndex(drawing.anchors[0].timestamp, context), last = barIndex(drawing.anchors[1].timestamp, context)
  return first === null || last === null ? null : Math.abs(Math.round(last - first))
}

type Builder = (frame: Frame) => void

function signalArrow (direction: 1 | -1): Builder {
  return ({ points: [a], sink }) => {
    // The anchored point is the tip; the shaft extends below (up arrow) or above (down arrow).
    const at = (dx: number, dy: number): Point => ({ x: a.x + dx, y: a.y + direction * dy })
    sink.polygon([at(0, 0), at(-7, 9), at(-3, 9), at(-3, 20), at(3, 20), at(3, 9), at(7, 9)])
  }
}

function waves (labels: readonly string[] | null, harmonic: boolean): Builder {
  return ({ points, sink }) => {
    polyline(sink, points)
    points.forEach((point, index) => sink.text(point, `(${labels?.[index] ?? index})`))
    if (labels !== null) for (let i = 2; i < points.length; i++) sink.line(points[i - 2], points[i])
    if (harmonic) { sink.polygon([points[0], points[1], points[2]]); sink.polygon([points[2], points[3], points[4]]) }
  }
}

function gannGrid (subdivided: boolean): Builder {
  return ({ points: [a, b], sink }) => {
    sink.polygon([a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }])
    sink.line(a, b); sink.line({ x: a.x, y: b.y }, { x: b.x, y: a.y })
    if (subdivided) {
      const center = between(a, b)
      sink.line({ x: center.x, y: a.y }, { x: center.x, y: b.y }); sink.line({ x: a.x, y: center.y }, { x: b.x, y: center.y })
      return
    }
    for (const share of [0.25, 0.5]) {
      sink.line(a, { x: b.x, y: b.y - (b.y - a.y) * share })
      sink.line({ x: a.x, y: b.y }, { x: b.x, y: a.y + (b.y - a.y) * share })
    }
    for (const share of [0.236, 0.5]) {
      sink.line(a, { x: a.x + (b.x - a.x) * share, y: b.y })
      sink.line({ x: a.x, y: b.y }, { x: a.x + (b.x - a.x) * share, y: a.y })
    }
  }
}

/** Golden spiral: quarter circles whose radii follow 1, 2, 3, 5, 8, ... laid out on a square spiral. */
function goldenSpiral ({ points: [a, b], sink }: Frame): void {
  const unit = distance(a, b) / Math.sqrt(24), heading = Math.atan2(b.y - a.y, b.x - a.x)
  if (!(unit > 0) || !Number.isFinite(unit)) return
  const place = (x: number, y: number): Point => ({
    x: a.x + x * Math.cos(heading) - y * Math.sin(heading),
    y: a.y + x * Math.sin(heading) + y * Math.cos(heading)
  })
  const radii = [unit, unit * 2]
  let cx = -unit, cy = -unit
  arc(sink, place(-unit, 0), unit, heading, heading + QUARTER)
  arc(sink, place(cx, cy), radii[1], heading + QUARTER, heading + Math.PI)
  // After the first two squares each center steps back by the radius two squares earlier, turning a quarter each time.
  const steps: ReadonlyArray<readonly [number, number]> = [[-1, 0], [0, -1], [1, 0], [0, 1]]
  for (let i = 2; i < 9; i++) {
    radii.push(radii[i - 2] + radii[i - 1])
    const [sx, sy] = steps[i % 4]
    cx += sx * radii[i - 2]; cy += sy * radii[i - 2]
    const start = heading + (i % 4) * QUARTER
    arc(sink, place(cx, cy), radii[i], start, start + QUARTER)
  }
  sink.line(a, b, true)
}

const BUILDERS: Readonly<Partial<Record<Drawing['type'], Builder>>> = {
  'arrow-up': signalArrow(1),
  'arrow-down': signalArrow(-1),
  'price-line': ({ drawing, points: [a], bounds, sink }) => {
    sink.line(a, { x: bounds.right, y: a.y })
    sink.text({ x: bounds.right - 3, y: a.y }, '', drawing.anchors[0].price, 'right')
  },
  flag: ({ points: [a], sink }) => {
    sink.line(a, { x: a.x, y: a.y - 22 })
    sink.polygon([{ x: a.x, y: a.y - 22 }, { x: a.x + 15, y: a.y - 18 }, { x: a.x, y: a.y - 14 }])
  },
  pin: ({ points: [a], sink }) => {
    sink.polygon([a, { x: a.x - 7, y: a.y - 15 }, { x: a.x + 7, y: a.y - 15 }])
    arc(sink, { x: a.x, y: a.y - 18 }, 8, 0, TAU)
  },
  // The second anchor is the control point of a quadratic curve.
  curve: ({ points: [a, b, c], sink }) => bezier(sink, [a, b, c]),
  // The second anchor lies on the arc: the control point is chosen so the quadratic passes through it at t = 1/2.
  arc: ({ points: [a, b, c], sink }) => bezier(sink, [a, { x: 2 * b.x - (a.x + c.x) / 2, y: 2 * b.y - (a.y + c.y) / 2 }, c]),
  'double-curve': ({ points: [a, b, c, d], sink }) => bezier(sink, [a, b, c, d]),
  'disjoint-channel': ({ points: [a, b, c], sink }) => sink.polygon([a, b, { x: c.x + b.x - a.x, y: c.y + b.y - a.y }, c]),
  'rotated-rectangle': ({ points: [a, b, c], sink }) => {
    const length = distance(a, b)
    if (!(length > 0)) { sink.line(a, c); return }
    const nx = -(b.y - a.y) / length, ny = (b.x - a.x) / length, width = (c.x - b.x) * nx + (c.y - b.y) * ny
    sink.polygon([a, b, { x: b.x + nx * width, y: b.y + ny * width }, { x: a.x + nx * width, y: a.y + ny * width }])
  },
  'fibonacci-line': ({ drawing: { anchors: [from, to] }, project, bounds, sink }) => {
    for (const level of RETRACEMENTS) {
      const price = to.price * (1 - level) + from.price * level
      const point = project(from.timestamp, price)
      if (!isFinitePoint(point) || !Number.isFinite(price)) continue
      sink.line({ x: bounds.left, y: point.y }, { x: bounds.right, y: point.y })
      sink.text({ x: bounds.right - 3, y: point.y }, `${Math.round(level * 1000) / 10}%`, price, 'right')
    }
  },
  'fibonacci-circle': ({ points: [a, b], sink }) => {
    const radius = distance(a, b)
    for (const level of RETRACEMENTS.slice(1)) {
      arc(sink, a, radius * level, 0, TAU)
      sink.text({ x: a.x, y: a.y + radius * level }, `${level * 100}%`)
    }
  },
  'fibonacci-spiral': goldenSpiral,
  'fibonacci-fan': ({ points: [a, b], sink }) => {
    for (const ratio of FAN_RATIOS) {
      const x = b.x - (b.x - a.x) * ratio, y = b.y - (b.y - a.y) * ratio
      sink.line({ x, y: a.y }, { x, y: b.y }); sink.line({ x: a.x, y }, { x: b.x, y })
      sink.line(a, { x, y: b.y }, true); sink.line(a, { x: b.x, y }, true)
      sink.text({ x, y: a.y }, String(ratio)); sink.text({ x: a.x, y }, String(ratio), undefined, 'left')
    }
  },
  'fibonacci-time-zone': ({ points: [a, b], bounds, sink }) => {
    for (const step of TIME_ZONE_STEPS) {
      const x = a.x + (b.x - a.x) * step
      sink.line({ x, y: bounds.top }, { x, y: bounds.bottom }); sink.text({ x, y: bounds.top + 16 }, String(step))
    }
  },
  'fibonacci-arcs': ({ points: [a, b], sink }) => {
    const radius = distance(a, b), right = b.x >= a.x, down = b.y >= a.y
    sink.line(a, b)
    // Each arc sweeps the quadrant that faces the second anchor.
    const from = right ? 0 : Math.PI
    const to = down ? QUARTER : right ? -QUARTER : Math.PI * 1.5
    for (const ratio of ARC_RATIOS) arc(sink, a, radius * ratio, from, to)
  },
  'gann-fan': ({ points: [a, b], sink }) => {
    for (const angle of GANN_ANGLES) sink.line(a, { x: b.x, y: a.y + (b.y - a.y) * angle }, true)
  },
  'gann-square': gannGrid(true),
  'gann-box': gannGrid(false),
  xabcd: waves(['X', 'A', 'B', 'C', 'D'], true),
  abcd: waves(['A', 'B', 'C', 'D'], false),
  'three-waves': waves(null, false),
  'five-waves': waves(null, false),
  'eight-waves': waves(null, false),
  'any-waves': waves(null, false),
  'time-range': frame => {
    const bars = barSpan(frame)
    if (bars !== null) frame.sink.text(between(frame.points[0], frame.points[1]), `${bars} bars`)
  },
  'price-time-range': frame => measure(frame, true),
  forecast: frame => measure(frame, false),
  note: ({ drawing, points: [a], sink }) => sink.label(a, drawing.text ?? ''),
  callout: ({ drawing, points: [a, b], sink }) => { sink.line(a, b); sink.label(b, drawing.text ?? '') },
  signpost: ({ drawing, points: [a], sink }) => {
    const top = { x: a.x, y: a.y - 26 }
    sink.line(a, top); sink.label(top, drawing.text ?? '')
  }
}

/** Price/time box (`boxed`) or forecast arrow with the percentage move between the two anchors. */
function measure (frame: Frame, boxed: boolean): void {
  const { drawing: { anchors: [from, to] }, points: [a, b], sink } = frame
  if (boxed) sink.polygon([a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }]); else arrowHead(sink, a, b)
  const delta = to.price - from.price, percent = delta / Math.abs(from.price) * 100
  if (!Number.isFinite(delta)) return
  let text = Number.isFinite(percent) ? `${percent >= 0 ? '+' : ''}${percent.toFixed(2)}%` : 'Percentage unavailable'
  if (boxed) {
    const bars = barSpan(frame)
    if (bars !== null) text += ` · ${bars} bars`
    text += ' · Δ'
  }
  if (boxed) sink.text(between(a, b), text, delta); else sink.text(b, text)
}

export function projectAdditionalDrawing (
  value: Drawing, points: readonly DrawingPoint[], project: DrawingProjector,
  bounds: DrawingBounds, context: DrawingContext | undefined, sink: DrawingGeometrySink
): void {
  BUILDERS[value.type]?.({ drawing: value, points, project, bounds, context, sink })
}
