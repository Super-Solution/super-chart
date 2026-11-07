/** Owned geometry for the retained drawing catalog. Financial levels are
 * projected from prices; decorative curves and Gann angles use screen space.
 * Formulas preserve the repository's Apache-2.0 extension tools, without their
 * upstream figure/template interfaces. See LICENSE and NOTICE. */
import type { Drawing, DrawingPoint, DrawingProjector, DrawingBounds, DrawingContext, DrawingGeometrySink } from './drawings'

const FIB = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]
const FAN = [1, 0.75, 0.618, 0.5, 0.382, 0.25, 0]
const GANN = [1 / 8, 1 / 4, 1 / 3, 1 / 2, 1, 2, 3, 4, 8]
const finite = (point: DrawingPoint | null): point is DrawingPoint => point !== null && Number.isFinite(point.x) && Number.isFinite(point.y)

function path (points: readonly DrawingPoint[], sink: DrawingGeometrySink): void {
  for (let i = 1; i < points.length; i++) sink.line(points[i - 1], points[i])
}
function sampledArc (center: DrawingPoint, radius: number, start: number, end: number, sink: DrawingGeometrySink): void {
  if (![center.x, center.y, radius, start, end].every(Number.isFinite) || radius <= 0) return
  const segments = Math.max(16, Math.min(512, Math.ceil(Math.abs(end - start) * Math.sqrt(radius / 0.5))))
  let previous = { x: center.x + radius * Math.cos(start), y: center.y + radius * Math.sin(start) }
  for (let i = 1; i <= segments; i++) {
    const angle = start + (end - start) * i / segments
    const point = { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) }
    sink.line(previous, point); previous = point
  }
}

/** Continuous bar coordinate for measurements, matching timestamp ownership
 * across prepends and irregular history; extrapolation uses the edge interval. */
function barCoordinate (timestamp: number, context?: DrawingContext): number | null {
  const bars = context?.bars
  if (bars === undefined || bars.length < 2) return null
  let lo = 0, hi = bars.length - 1
  while (lo + 1 < hi) { const mid = (lo + hi) >>> 1; if (bars[mid].timestamp <= timestamp) lo = mid; else hi = mid }
  if (timestamp >= bars[bars.length - 1].timestamp) { lo = bars.length - 2; hi = bars.length - 1 }
  const span = bars[hi].timestamp - bars[lo].timestamp
  return span > 0 ? lo + (timestamp - bars[lo].timestamp) / span : null
}

export function projectAdditionalDrawing (
  value: Drawing, points: readonly DrawingPoint[], project: DrawingProjector,
  bounds: DrawingBounds, context: DrawingContext | undefined, sink: DrawingGeometrySink
): void {
  const [a, b, c, d] = points
  const line = sink.line, polygon = sink.polygon
  const mid = (p: DrawingPoint, q: DrawingPoint): DrawingPoint => ({ x: p.x / 2 + q.x / 2, y: p.y / 2 + q.y / 2 })
  const rect = (): void => polygon([a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }])
  const arrow = (from: DrawingPoint, to: DrawingPoint): void => {
    const length = Math.hypot(to.x - from.x, to.y - from.y)
    if (!(length > 0) || !Number.isFinite(length)) return
    const ux = (to.x - from.x) / length, uy = (to.y - from.y) / length, size = Math.min(10, length / 3)
    line(from, to)
    line(to, { x: to.x - ux * size + uy * size / 2, y: to.y - uy * size - ux * size / 2 })
    line(to, { x: to.x - ux * size - uy * size / 2, y: to.y - uy * size + ux * size / 2 })
  }
  switch (value.type) {
    case 'arrow-up': case 'arrow-down': {
      // Arrow tip is the anchored point; its shaft sits below/above respectively.
      const dir = value.type === 'arrow-up' ? 1 : -1
      polygon([{ x: a.x, y: a.y }, { x: a.x - 7, y: a.y + dir * 9 }, { x: a.x - 3, y: a.y + dir * 9 },
        { x: a.x - 3, y: a.y + dir * 20 }, { x: a.x + 3, y: a.y + dir * 20 },
        { x: a.x + 3, y: a.y + dir * 9 }, { x: a.x + 7, y: a.y + dir * 9 }]); break
    }
    case 'price-line': line(a, { x: bounds.right, y: a.y }); sink.text({ x: bounds.right - 3, y: a.y }, '', value.anchors[0].price, 'right'); break
    case 'flag': line(a, { x: a.x, y: a.y - 22 }); polygon([{ x: a.x, y: a.y - 22 }, { x: a.x + 15, y: a.y - 18 }, { x: a.x, y: a.y - 14 }]); break
    case 'pin': polygon([a, { x: a.x - 7, y: a.y - 15 }, { x: a.x + 7, y: a.y - 15 }]); sampledArc({ x: a.x, y: a.y - 18 }, 8, 0, Math.PI * 2, sink); break
    case 'curve': case 'arc': {
      const control = value.type === 'curve' ? b : { x: 2 * b.x - (a.x + c.x) / 2, y: 2 * b.y - (a.y + c.y) / 2 }
      let previous = a
      for (let i = 1; i <= 64; i++) {
        const t = i / 64, u = 1 - t
        const next = { x: u * u * a.x + 2 * u * t * control.x + t * t * c.x, y: u * u * a.y + 2 * u * t * control.y + t * t * c.y }
        line(previous, next); previous = next
      }
      break
    }
    case 'double-curve': {
      let previous = a
      for (let i = 1; i <= 96; i++) {
        const t = i / 96, u = 1 - t
        const next = {
          x: u ** 3 * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t ** 3 * d.x,
          y: u ** 3 * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t ** 3 * d.y
        }
        line(previous, next); previous = next
      }
      break
    }
    case 'disjoint-channel': polygon([a, b, { x: c.x + b.x - a.x, y: c.y + b.y - a.y }, c]); break
    case 'rotated-rectangle': {
      const length = Math.hypot(b.x - a.x, b.y - a.y)
      if (!(length > 0)) { line(a, c); break }
      const nx = -(b.y - a.y) / length, ny = (b.x - a.x) / length, width = (c.x - b.x) * nx + (c.y - b.y) * ny
      polygon([a, b, { x: b.x + nx * width, y: b.y + ny * width }, { x: a.x + nx * width, y: a.y + ny * width }]); break
    }
    case 'fibonacci-line': {
      for (const level of FIB) {
        const price = value.anchors[1].price * (1 - level) + value.anchors[0].price * level
        const point = project(value.anchors[0].timestamp, price)
        if (!finite(point) || !Number.isFinite(price)) continue
        line({ x: bounds.left, y: point.y }, { x: bounds.right, y: point.y })
        sink.text({ x: bounds.right - 3, y: point.y }, `${Math.round(level * 1000) / 10}%`, price, 'right')
      }
      break
    }
    case 'fibonacci-circle': {
      const radius = Math.hypot(b.x - a.x, b.y - a.y)
      for (const level of FIB.slice(1)) { sampledArc(a, radius * level, 0, Math.PI * 2, sink); sink.text({ x: a.x, y: a.y + radius * level }, `${level * 100}%`) }
      break
    }
    case 'fibonacci-spiral': {
      const initial = Math.hypot(b.x - a.x, b.y - a.y) / Math.sqrt(24), angle = Math.atan2(b.y - a.y, b.x - a.x)
      if (!(initial > 0) || !Number.isFinite(initial)) break
      const rotate = (x: number, y: number): DrawingPoint => ({ x: a.x + x * Math.cos(angle) - y * Math.sin(angle), y: a.y + x * Math.sin(angle) + y * Math.cos(angle) })
      const radii = [initial, initial * 2]; let x = -initial, y = -initial
      sampledArc(rotate(-initial, 0), initial, angle, angle + Math.PI / 2, sink)
      sampledArc(rotate(x, y), initial * 2, angle + Math.PI / 2, angle + Math.PI, sink)
      for (let i = 2; i < 9; i++) {
        const radius = radii[i - 2] + radii[i - 1]; radii.push(radius)
        if (i % 4 === 0) x -= radii[i - 2]
        else if (i % 4 === 1) y -= radii[i - 2]
        else if (i % 4 === 2) x += radii[i - 2]
        else y += radii[i - 2]
        const start = angle + (i % 4) * Math.PI / 2
        sampledArc(rotate(x, y), radius, start, start + Math.PI / 2, sink)
      }
      line(a, b, true); break
    }
    case 'fibonacci-fan': {
      for (const level of FAN) {
        const x = b.x - (b.x - a.x) * level, y = b.y - (b.y - a.y) * level
        line({ x, y: a.y }, { x, y: b.y }); line({ x: a.x, y }, { x: b.x, y })
        line(a, { x, y: b.y }, true); line(a, { x: b.x, y }, true)
        sink.text({ x, y: a.y }, String(level)); sink.text({ x: a.x, y }, String(level), undefined, 'left')
      }
      break
    }
    case 'fibonacci-time-zone': {
      for (const factor of [0, 1, 2, 3, 5, 8, 13, 21, 34]) {
        const x = a.x + (b.x - a.x) * factor
        line({ x, y: bounds.top }, { x, y: bounds.bottom }); sink.text({ x, y: bounds.top + 16 }, String(factor))
      }
      break
    }
    case 'fibonacci-arcs': {
      const radius = Math.hypot(b.x - a.x, b.y - a.y), sx = b.x >= a.x ? 1 : -1, sy = b.y >= a.y ? 1 : -1
      line(a, b)
      for (const level of [0.382, 0.5, 0.618, 1]) {
        const start = sx > 0 ? 0 : Math.PI, end = sy > 0 ? Math.PI / 2 : sx > 0 ? -Math.PI / 2 : Math.PI * 1.5
        sampledArc(a, radius * level, start, end, sink)
      }
      break
    }
    case 'gann-fan': for (const ratio of GANN) line(a, { x: b.x, y: a.y + (b.y - a.y) * ratio }, true); break
    case 'gann-square': case 'gann-box': {
      rect(); line(a, b); line({ x: a.x, y: b.y }, { x: b.x, y: a.y })
      if (value.type === 'gann-square') {
        const m = mid(a, b); line({ x: m.x, y: a.y }, { x: m.x, y: b.y }); line({ x: a.x, y: m.y }, { x: b.x, y: m.y })
      } else {
        for (const factor of [0.25, 0.5]) {
          line(a, { x: b.x, y: b.y - (b.y - a.y) * factor })
          line({ x: a.x, y: b.y }, { x: b.x, y: a.y + (b.y - a.y) * factor })
        }
        for (const factor of [0.236, 0.5]) {
          line(a, { x: a.x + (b.x - a.x) * factor, y: b.y })
          line({ x: a.x, y: b.y }, { x: a.x + (b.x - a.x) * factor, y: a.y })
        }
      }
      break
    }
    case 'xabcd': case 'abcd': case 'three-waves': case 'five-waves': case 'eight-waves': case 'any-waves': {
      path(points, sink)
      const letters = value.type === 'xabcd' ? ['X', 'A', 'B', 'C', 'D'] : value.type === 'abcd' ? ['A', 'B', 'C', 'D'] : null
      points.forEach((point, index) => sink.text(point, `(${letters?.[index] ?? index})`))
      if (letters !== null) for (let i = 2; i < points.length; i++) line(points[i - 2], points[i])
      if (value.type === 'xabcd') { polygon([a, b, c]); polygon([c, d, points[4]]) }
      break
    }
    case 'time-range': {
      const first = barCoordinate(value.anchors[0].timestamp, context), last = barCoordinate(value.anchors[1].timestamp, context)
      if (first !== null && last !== null) sink.text(mid(a, b), `${Math.abs(Math.round(last - first))} bars`)
      break
    }
    case 'price-time-range': case 'forecast': {
      if (value.type === 'price-time-range') rect(); else arrow(a, b)
      const delta = value.anchors[1].price - value.anchors[0].price, percent = delta / Math.abs(value.anchors[0].price) * 100
      if (!Number.isFinite(delta)) break
      let text = Number.isFinite(percent) ? `${percent >= 0 ? '+' : ''}${percent.toFixed(2)}%` : 'Percentage unavailable'
      if (value.type === 'price-time-range') {
        const first = barCoordinate(value.anchors[0].timestamp, context), last = barCoordinate(value.anchors[1].timestamp, context)
        if (first !== null && last !== null) text += ` · ${Math.abs(Math.round(last - first))} bars`
        text += ' · Δ'
      }
      sink.text(value.type === 'forecast' ? b : mid(a, b), text, value.type === 'forecast' ? undefined : delta)
      break
    }
    case 'note': sink.label(a, value.text ?? ''); break
    case 'callout': line(a, b); sink.label(b, value.text ?? ''); break
    case 'signpost': { const position = { x: a.x, y: a.y - 26 }; line(a, position); sink.label(position, value.text ?? ''); break }
  }
}
