/** Retained user drawings. No renderer, DOM, feed, or upstream chart dependency. */
import type { MarketBar } from '../core/types'
import { projectAdditionalDrawing } from './drawingGeometry'
import { projectDataDrivenDrawing, DATA_DRIVEN_DRAWING_TYPES } from './dataDrivenDrawing'
import type { DataDrivenDrawingResult } from './dataDrivenDrawing'
import { validateDrawingImage } from './drawingMedia'
import { projectFreehandDrawing } from './freehandDrawing'

export const DRAWING_TYPES = Object.freeze([
  'horizontal', 'vertical', 'horizontal-ray', 'segment', 'ray', 'trend-line', 'arrow',
  'rectangle', 'ellipse', 'circle', 'price-range', 'time-range', 'fibonacci',
  'horizontal-segment', 'vertical-segment', 'vertical-ray', 'parallel-channel', 'price-channel',
  'pitchfork', 'schiff-pitchfork', 'modified-schiff-pitchfork', 'fibonacci-extension',
  'triangle', 'parallelogram', 'text', 'price-label',
  'arrow-up', 'arrow-down', 'price-line', 'curve', 'arc', 'double-curve', 'flag',
  'regression-trend', 'disjoint-channel', 'rotated-rectangle', 'fibonacci-line', 'fibonacci-circle',
  'fibonacci-spiral', 'fibonacci-fan', 'fibonacci-time-zone', 'gann-box', 'gann-fan', 'gann-square', 'fibonacci-arcs',
  'xabcd', 'abcd', 'three-waves', 'five-waves', 'eight-waves', 'any-waves', 'position-long', 'position-short',
  'price-time-range', 'forecast', 'note', 'callout', 'signpost', 'pin', 'image',
  'anchored-vwap', 'fixed-range-volume-profile', 'anchored-volume-profile', 'brush', 'highlighter'
] as const)
export type DrawingType = typeof DRAWING_TYPES[number]
export interface DrawingAnchor { readonly timestamp: number, readonly price: number }
export interface Drawing {
  readonly id: string
  readonly type: DrawingType
  readonly anchors: readonly DrawingAnchor[]
  readonly locked: boolean
  readonly hidden: boolean
  /** Plain text only; present exclusively on text drawings. */
  readonly text?: string
  readonly image?: string
  readonly strokeWidth?: number
}
export interface DrawingInput {
  id: string
  type: DrawingType
  anchors: readonly DrawingAnchor[]
  locked?: boolean
  hidden?: boolean
  text?: string
  image?: string
  strokeWidth?: number
}
export interface DrawingPatch { anchors?: readonly DrawingAnchor[], locked?: boolean, hidden?: boolean, text?: string, image?: string, strokeWidth?: number }
export interface DrawingPoint { readonly x: number, readonly y: number }
export interface DrawingBounds { readonly left: number, readonly top: number, readonly right: number, readonly bottom: number }
export type DrawingProjector = (timestamp: number, price: number) => DrawingPoint | null
export interface DrawingContext { readonly bars: readonly MarketBar[], readonly revision?: unknown, readonly visibleRange?: readonly [number, number] }
export interface DrawingGeometrySink {
  line: (from: DrawingPoint, to: DrawingPoint, ray?: boolean, full?: boolean) => void
  polygon: (points: readonly DrawingPoint[]) => void
  text: (position: DrawingPoint, text: string, price?: number, align?: 'left' | 'right' | 'center') => void
  label: (position: DrawingPoint, text: string, price?: number, boxed?: boolean) => void
}
export type DrawingPrimitive =
  | { readonly kind: 'line', readonly from: DrawingPoint, readonly to: DrawingPoint }
  /** A clipped fill only. Separate line primitives carry the original rectangle's visible edges. */
  | { readonly kind: 'rect', readonly from: DrawingPoint, readonly to: DrawingPoint }
  | { readonly kind: 'ellipse', readonly center: DrawingPoint, readonly radiusX: number, readonly radiusY: number, readonly clip: DrawingBounds }
  /** Filled, clipped polygon. Original boundary segments remain separate primitives. */
  | { readonly kind: 'polygon', readonly points: readonly DrawingPoint[] }
  /** Explicit paint and hit rectangle, distinct from unselectable measurement captions. */
  | { readonly kind: 'label', readonly bounds: DrawingBounds, readonly clip: DrawingBounds, readonly lines: readonly string[], readonly price?: number, readonly boxed?: boolean }
  | { readonly kind: 'stroke', readonly points: readonly DrawingPoint[], readonly width: number, readonly opacity: number, readonly clip: DrawingBounds }
  | { readonly kind: 'image', readonly source: string, readonly bounds: DrawingBounds, readonly clip: DrawingBounds }
  | { readonly kind: 'text', readonly position: DrawingPoint, readonly text: string, readonly price?: number, readonly align: 'left' | 'right' | 'center' }
export interface DrawingHandle { readonly anchorIndex: number, readonly point: DrawingPoint }
export interface DrawingGeometry {
  readonly id: string
  readonly type: DrawingType
  readonly locked: boolean
  readonly primitives: readonly DrawingPrimitive[]
  readonly handles: readonly DrawingHandle[]
  readonly analysis?: DataDrivenDrawingResult
}
export interface DrawingHit { readonly id: string, readonly anchorIndex: number | null, readonly distance: number }
export interface DrawingSnapshot {
  readonly drawings: readonly Drawing[]
  readonly selectedId: string | null
  readonly canUndo: boolean
  readonly canRedo: boolean
}

const LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const
const EXTENSION_LEVELS = [...LEVELS, 1.618, 2.618, 3.618, 4.236] as const
const MAX_DRAWINGS = 1000
const MAX_JSON_LENGTH = 8 * 1024 * 1024
const DATE_LIMIT = 8.64e15

function record (value: unknown, keys: readonly string[], name: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`Invalid ${name}`)
  const object = value as Record<string, unknown>
  if (Object.keys(object).some(key => !keys.includes(key))) throw new TypeError(`Unknown ${name} property`)
  return object
}
function flag (value: unknown, name: string): boolean {
  if (value === undefined) return false
  if (typeof value !== 'boolean') throw new TypeError(`Invalid drawing ${name}`)
  return value
}
export function drawingUsesText (type: DrawingType): boolean { return type === 'text' || type === 'note' || type === 'callout' || type === 'signpost' }
export function drawingAnchorCount (type: DrawingType): number {
  switch (type) {
    case 'horizontal': case 'vertical': case 'horizontal-ray': case 'text': case 'price-label':
    case 'arrow-up': case 'arrow-down': case 'price-line': case 'flag': case 'note': case 'signpost': case 'pin':
    case 'anchored-vwap': case 'anchored-volume-profile': return 1
    case 'parallel-channel': case 'price-channel': case 'pitchfork': case 'schiff-pitchfork':
    case 'modified-schiff-pitchfork': case 'fibonacci-extension': case 'triangle': case 'parallelogram':
    case 'curve': case 'arc': case 'disjoint-channel': case 'rotated-rectangle':
    case 'position-long': case 'position-short': return 3
    case 'double-curve': case 'abcd': case 'three-waves': return 4
    case 'xabcd': return 5
    case 'five-waves': return 6
    case 'eight-waves': return 9
    default: return 2
  }
}
function anchors (value: unknown, type: DrawingType): readonly DrawingAnchor[] {
  const count = drawingAnchorCount(type)
  const variable = type === 'brush' || type === 'highlighter' || type === 'any-waves'
  if (!Array.isArray(value) || (variable ? value.length < 2 || value.length > (type === 'any-waves' ? 256 : 2048) : value.length !== count)) throw new TypeError(`${type} requires ${variable ? 'a bounded path of at least 2' : count} anchors`)
  const result = value.map(item => {
    const point = record(item, ['timestamp', 'price'], 'drawing anchor')
    if (typeof point.timestamp !== 'number' || !Number.isFinite(point.timestamp) || Math.abs(point.timestamp) > DATE_LIMIT ||
        typeof point.price !== 'number' || !Number.isFinite(point.price)) throw new TypeError('Invalid drawing anchor coordinates')
    return { timestamp: point.timestamp, price: point.price }
  })
  // Constrained axes are canonical in retained data as well as painted handles.
  if (type === 'horizontal-segment') result[1].price = result[0].price
  if (type === 'vertical-segment' || type === 'vertical-ray') result[1].timestamp = result[0].timestamp
  return Object.freeze(result.map(point => Object.freeze(point)))
}
function drawing (value: unknown): Drawing {
  const input = record(value, ['id', 'type', 'anchors', 'locked', 'hidden', 'text', 'image', 'strokeWidth'], 'drawing')
  if (typeof input.id !== 'string' || input.id.trim() === '' || input.id.length > 128) throw new TypeError('Invalid drawing id')
  if (!DRAWING_TYPES.includes(input.type as DrawingType)) throw new TypeError('Invalid drawing type')
  const type = input.type as DrawingType
  const content: { text?: string, image?: string, strokeWidth?: number } = {}
  if (drawingUsesText(type)) {
    if (typeof input.text !== 'string' || input.text.trim() === '' || input.text.length > 512 ||
        input.text.split('\n').length > 8 || Array.from(input.text).some(character => {
      const code = character.charCodeAt(0)
      return (code < 32 && code !== 9 && code !== 10) || code === 127
    })) throw new TypeError('Drawing text must contain 1–512 plain characters in at most 8 lines')
    content.text = input.text
  } else if (input.text !== undefined) throw new TypeError('Only text drawings accept text')
  if (type === 'image') content.image = validateDrawingImage(input.image)
  else if (input.image !== undefined) throw new TypeError('Only image drawings accept image data')
  if (input.strokeWidth !== undefined) {
    if ((type !== 'brush' && type !== 'highlighter') || typeof input.strokeWidth !== 'number' || !Number.isFinite(input.strokeWidth) || input.strokeWidth < 1 || input.strokeWidth > 64) throw new TypeError('Invalid freehand stroke width')
    content.strokeWidth = input.strokeWidth
  }
  return Object.freeze({ id: input.id, type, anchors: anchors(input.anchors, type), locked: flag(input.locked, 'locked'), hidden: flag(input.hidden, 'hidden'), ...content })
}
function same (a: Drawing, b: Drawing): boolean {
  return a.id === b.id && a.type === b.type && a.locked === b.locked && a.hidden === b.hidden && a.text === b.text && a.image === b.image && a.strokeWidth === b.strokeWidth &&
    a.anchors.length === b.anchors.length && a.anchors.every((point, i) => point.timestamp === b.anchors[i].timestamp && point.price === b.anchors[i].price)
}
function finitePoint (point: DrawingPoint | null): point is DrawingPoint {
  return point !== null && Number.isFinite(point.x) && Number.isFinite(point.y)
}
function inside (point: DrawingPoint, bounds: DrawingBounds): boolean {
  return point.x >= bounds.left && point.x <= bounds.right && point.y >= bounds.top && point.y <= bounds.bottom
}
function validBounds (bounds: DrawingBounds): void {
  if (![bounds.left, bounds.top, bounds.right, bounds.bottom].every(Number.isFinite) || bounds.left >= bounds.right || bounds.top >= bounds.bottom) {
    throw new RangeError('Drawing bounds must be finite and have positive size')
  }
}

/** Parametric clipping also handles rays without creating enormous far-away endpoints. */
function clipLine (from: DrawingPoint, to: DrawingPoint, bounds: DrawingBounds, ray = false, full = false): DrawingPrimitive | null {
  const dx = to.x - from.x, dy = to.y - from.y
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null
  if (dx === 0 && dy === 0) return inside(from, bounds) ? { kind: 'line', from, to } : null
  let low = full ? -Infinity : 0, high = ray || full ? Infinity : 1
  const limits: Array<readonly [number, number]> = [
    [-dx, from.x - bounds.left], [dx, bounds.right - from.x],
    [-dy, from.y - bounds.top], [dy, bounds.bottom - from.y]
  ]
  for (const [direction, distance] of limits) {
    if (direction === 0) { if (distance < 0) return null; continue }
    const ratio = distance / direction
    if (direction < 0) low = Math.max(low, ratio)
    else high = Math.min(high, ratio)
    if (low > high) return null
  }
  const start = { x: from.x + low * dx, y: from.y + low * dy }
  const end = { x: from.x + high * dx, y: from.y + high * dy }
  return finitePoint(start) && finitePoint(end) ? { kind: 'line', from: start, to: end } : null
}

/** Convex clipping keeps fills and their hit regions inside the actual plot. */
function clipPolygon (points: readonly DrawingPoint[], bounds: DrawingBounds): DrawingPoint[] {
  let result = [...points]
  for (const [axis, edge, lower] of [['x', bounds.left, true], ['x', bounds.right, false], ['y', bounds.top, true], ['y', bounds.bottom, false]] as const) {
    const input = result; result = []
    if (input.length === 0) break
    let previous = input[input.length - 1], previousInside = lower ? previous[axis] >= edge : previous[axis] <= edge
    for (const point of input) {
      const pointInside = lower ? point[axis] >= edge : point[axis] <= edge
      if (pointInside !== previousInside) {
        const ratio = (edge - previous[axis]) / (point[axis] - previous[axis])
        const crossing = { x: previous.x * (1 - ratio) + point.x * ratio, y: previous.y * (1 - ratio) + point.y * ratio }
        if (finitePoint(crossing)) result.push(crossing)
      }
      if (pointInside) result.push(point)
      previous = point; previousInside = pointInside
    }
  }
  return result
}

/** Projection never edits retained anchors or history. Hosts may call it after any data/layout change. */
export function projectDrawing (value: Drawing, project: DrawingProjector, bounds: DrawingBounds, context?: DrawingContext): DrawingGeometry | null {
  validBounds(bounds)
  if (value.hidden) return null
  const projected = value.anchors.map(anchor => project(anchor.timestamp, anchor.price))
  if (!projected.every(finitePoint) && !(DATA_DRIVEN_DRAWING_TYPES as readonly string[]).includes(value.type)) return null
  // Timestamp-only analysis can be valid even when its unused anchor price is
  // not representable on a logarithmic scale. The helper projects actual data.
  const points = projected.map(point => finitePoint(point) ? point : { x: NaN, y: NaN })
  const a = points[0]
  if (value.type === 'horizontal-segment') points[1] = { x: points[1].x, y: a.y }
  if (value.type === 'vertical-segment' || value.type === 'vertical-ray') points[1] = { x: a.x, y: points[1].y }
  const b = points[1], c = points[2]
  const primitives: DrawingPrimitive[] = []
  const line = (from: DrawingPoint, to: DrawingPoint, ray = false, full = false): void => {
    const primitive = clipLine(from, to, bounds, ray, full)
    if (primitive !== null) primitives.push(primitive)
  }
  const arrowHead = (from: DrawingPoint, to: DrawingPoint): void => {
    const dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy)
    if (!inside(to, bounds) || !Number.isFinite(length) || length === 0) return
    const size = Math.min(10, length * 0.35), ux = dx / length, uy = dy / length
    line({ x: to.x - ux * size + uy * size * 0.5, y: to.y - uy * size - ux * size * 0.5 }, to)
    line({ x: to.x - ux * size - uy * size * 0.5, y: to.y - uy * size + ux * size * 0.5 }, to)
  }
  const rectangle = (): void => {
    const left = Math.min(a.x, b.x), right = Math.max(a.x, b.x), top = Math.min(a.y, b.y), bottom = Math.max(a.y, b.y)
    const clipped = { left: Math.max(left, bounds.left), right: Math.min(right, bounds.right), top: Math.max(top, bounds.top), bottom: Math.min(bottom, bounds.bottom) }
    if (clipped.left < clipped.right && clipped.top < clipped.bottom) primitives.push({ kind: 'rect', from: { x: clipped.left, y: clipped.top }, to: { x: clipped.right, y: clipped.bottom } })
    line({ x: left, y: top }, { x: right, y: top }); line({ x: right, y: top }, { x: right, y: bottom })
    line({ x: right, y: bottom }, { x: left, y: bottom }); line({ x: left, y: bottom }, { x: left, y: top })
  }
  const polygon = (vertices: readonly DrawingPoint[]): void => {
    if (!vertices.every(finitePoint)) return
    const clipped = clipPolygon(vertices, bounds)
    if (clipped.length > 2) primitives.push({ kind: 'polygon', points: clipped })
    for (let i = 0; i < vertices.length; i++) line(vertices[i], vertices[(i + 1) % vertices.length])
  }
  const label = (position: DrawingPoint, text: string, price?: number, boxed = true): void => {
    if (!inside(position, bounds)) return
    const lines: string[] = []
    for (const part of text.split('\n')) {
      const characters = Array.from(part)
      if (characters.length === 0) lines.push('')
      for (let offset = 0; offset < characters.length; offset += 32) lines.push(characters.slice(offset, offset + 32).join(''))
    }
    const visibleLines = lines.slice(0, 24)
    const width = price === undefined ? Math.max(32, Math.min(260, Math.max(...visibleLines.map(item => Array.from(item).length)) * 8 + 12)) : 150
    const box = { left: position.x, top: position.y, right: position.x + width, bottom: position.y + visibleLines.length * 16 + 8 }
    primitives.push({ kind: 'label', bounds: box, clip: { ...bounds }, lines: visibleLines, price, boxed })
  }
  const measurement = (text: string, price?: number): void => {
    if (primitives.length === 0) return
    const position = { x: Math.min(bounds.right - 4, Math.max(a.x, b.x)), y: Math.max(bounds.top + 16, Math.min(a.y, b.y)) }
    if (inside(position, bounds)) primitives.push({ kind: 'text', position, text, price, align: 'right' })
  }
  switch (value.type) {
    case 'horizontal': line({ x: bounds.left, y: a.y }, { x: bounds.right, y: a.y }); break
    case 'vertical': line({ x: a.x, y: bounds.top }, { x: a.x, y: bounds.bottom }); break
    case 'horizontal-ray': if (a.x <= bounds.right) line(a, { x: bounds.right, y: a.y }); break
    case 'segment': case 'horizontal-segment': case 'vertical-segment': line(a, b); break
    case 'vertical-ray': line(a, b, true); break
    case 'ray': line(a, b, true); break
    case 'trend-line': line(a, b, false, true); break
    case 'arrow': line(a, b); arrowHead(a, b); break
    case 'rectangle': rectangle(); break
    case 'triangle': polygon([a, b, c]); break
    case 'parallelogram': polygon([a, b, c, { x: a.x + c.x - b.x, y: a.y + c.y - b.y }]); break
    case 'parallel-channel': case 'price-channel': {
      // Parallel: A/B are one boundary, C the other. Price: A/B are the
      // center, C one boundary; the opposite boundary is reflected about A/B.
      const direction = { x: b.x - a.x, y: b.y - a.y }
      if (!finitePoint(direction) || (direction.x === 0 && direction.y === 0)) break
      const end = (point: DrawingPoint): DrawingPoint => ({ x: point.x + direction.x, y: point.y + direction.y })
      line(a, b, false, true); line(c, end(c), false, true)
      if (value.type === 'price-channel') {
        const opposite = { x: 2 * a.x - c.x, y: 2 * a.y - c.y }
        line(opposite, end(opposite), false, true)
      } else {
        const middle = { x: a.x / 2 + c.x / 2, y: a.y / 2 + c.y / 2 }
        line(middle, end(middle), false, true)
      }
      break
    }
    case 'pitchfork': case 'schiff-pitchfork': case 'modified-schiff-pitchfork': {
      const origin = value.type === 'pitchfork' ? a : {
        x: value.type === 'schiff-pitchfork' ? a.x : a.x / 2 + b.x / 2,
        y: a.y / 2 + b.y / 2
      }
      const middle = { x: b.x / 2 + c.x / 2, y: b.y / 2 + c.y / 2 }
      const dx = middle.x - origin.x, dy = middle.y - origin.y
      line(b, c)
      if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) break
      for (const start of [origin, b, c]) line(start, { x: start.x + dx, y: start.y + dy }, true)
      break
    }
    case 'text': label(a, value.text ?? '', undefined, false); break
    case 'price-label': label(a, '', value.anchors[0].price); break
    case 'ellipse': case 'circle': {
      const center = value.type === 'circle' ? a : { x: a.x / 2 + b.x / 2, y: a.y / 2 + b.y / 2 }
      const radiusX = value.type === 'circle' ? Math.hypot(b.x - a.x, b.y - a.y) : Math.abs(b.x / 2 - a.x / 2)
      const radiusY = value.type === 'circle' ? radiusX : Math.abs(b.y / 2 - a.y / 2)
      if (![radiusX, radiusY].every(Number.isFinite)) break
      if (radiusX === 0 || radiusY === 0) { line(a, b); break }
      if (center.x + radiusX < bounds.left || center.x - radiusX > bounds.right || center.y + radiusY < bounds.top || center.y - radiusY > bounds.bottom) break
      primitives.push({ kind: 'ellipse', center, radiusX, radiusY, clip: { ...bounds } })
      break
    }
    case 'price-range': {
      rectangle()
      const start = { x: a.x / 2 + b.x / 2, y: a.y }, end = { x: start.x, y: b.y }
      line(start, end); arrowHead(start, end); arrowHead(end, start)
      const delta = value.anchors[1].price - value.anchors[0].price
      if (!Number.isFinite(delta)) break
      const percent = delta / Math.abs(value.anchors[0].price) * 100
      measurement(Number.isFinite(percent) ? `${percent >= 0 ? '+' : ''}${percent.toFixed(2)}% · Δ` : 'Δ', delta)
      break
    }
    case 'time-range': {
      rectangle()
      const start = { x: a.x, y: a.y / 2 + b.y / 2 }, end = { x: b.x, y: start.y }
      line(start, end); arrowHead(start, end); arrowHead(end, start)
      const duration = Math.abs(value.anchors[1].timestamp - value.anchors[0].timestamp)
      const [unit, divisor]: [string, number] = duration >= 86400000 ? ['d', 86400000] : duration >= 3600000 ? ['h', 3600000]
        : duration >= 60000 ? ['m', 60000] : duration >= 1000 ? ['s', 1000] : ['ms', 1]
      measurement(`${Number((duration / divisor).toFixed(2))} ${unit}`)
      break
    }
    case 'fibonacci': case 'fibonacci-extension': {
      const first = value.anchors[0], second = value.anchors[1]
      const extension = value.type === 'fibonacci-extension', third = value.anchors[2]
      if (extension) { line(a, b); line(b, c) }
      for (const level of extension ? EXTENSION_LEVELS : LEVELS) {
        const price = extension ? third.price + (second.price - first.price) * level : second.price * (1 - level) + first.price * level
        const start = project(extension ? second.timestamp : first.timestamp, price), end = project(extension ? third.timestamp : second.timestamp, price)
        if (!Number.isFinite(price) || !finitePoint(start) || !finitePoint(end)) continue
        const primitive = clipLine(start, end, bounds)
        if (primitive === null || primitive.kind !== 'line') continue
        primitives.push(primitive)
        const right = primitive.from.x > primitive.to.x ? primitive.from : primitive.to
        primitives.push({ kind: 'text', position: right, text: `${Math.round(level * 1000) / 10}%`, price, align: 'right' })
      }
      break
    }
  }
  const sink: DrawingGeometrySink = {
    line,
    polygon,
    label,
    text: (position, text, price, align = 'center') => {
      if (finitePoint(position) && inside(position, bounds)) primitives.push({ kind: 'text', position, text, price, align })
    }
  }
  projectAdditionalDrawing(value, points, project, bounds, context, sink)
  const analysis = projectDataDrivenDrawing(value, project, bounds, context, sink) ?? undefined
  if (value.type === 'brush' || value.type === 'highlighter') {
    const stroke = projectFreehandDrawing(value, project, bounds)
    if (stroke !== null) primitives.push(stroke)
  }
  if (value.type === 'image' && value.image !== undefined) {
    const box = { left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), right: Math.max(a.x, b.x), bottom: Math.max(a.y, b.y) }
    if (box.left < bounds.right && box.right > bounds.left && box.top < bounds.bottom && box.bottom > bounds.top && box.left < box.right && box.top < box.bottom) primitives.push({ kind: 'image', source: value.image, bounds: box, clip: { ...bounds } })
  }
  const handles = value.locked ? [] : points.flatMap((point, anchorIndex) => inside(point, bounds) ? [{ point, anchorIndex }] : [])
  return { id: value.id, type: value.type, locked: value.locked, primitives, handles, ...(analysis === undefined ? {} : { analysis }) }
}

function lineDistance (point: DrawingPoint, from: DrawingPoint, to: DrawingPoint): number {
  const dx = to.x - from.x, dy = to.y - from.y, square = dx * dx + dy * dy
  const ratio = square === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / square))
  return Math.hypot(point.x - (from.x + ratio * dx), point.y - (from.y + ratio * dy))
}

/** Distance to the filled ellipse. Solve its closest boundary point only for outside hits. */
function ellipseDistance (point: DrawingPoint, ellipse: Extract<DrawingPrimitive, { kind: 'ellipse' }>): number {
  if (!inside(point, ellipse.clip)) return Infinity
  const x = Math.abs(point.x - ellipse.center.x), y = Math.abs(point.y - ellipse.center.y)
  const scale = Math.max(ellipse.radiusX, ellipse.radiusY, x, y, 1)
  const a = ellipse.radiusX / scale, b = ellipse.radiusY / scale, u = x / scale, v = y / scale
  if (Math.hypot(u / a, v / b) <= 1) return 0
  const aa = a * a, bb = b * b
  if (aa === 0 || bb === 0) return Infinity
  let low = 0, high = Math.hypot(a * u, b * v)
  for (let i = 0; i < 48; i++) {
    const mid = (low + high) / 2
    if (Math.hypot(a * u / (mid + aa), b * v / (mid + bb)) > 1) low = mid
    else high = mid
  }
  const t = (low + high) / 2
  return Math.hypot(u - aa * u / (t + aa), v - bb * v / (t + bb)) * scale
}

function polygonDistance (point: DrawingPoint, vertices: readonly DrawingPoint[]): number {
  let enclosed = false, distance = Infinity
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const a = vertices[i], b = vertices[j]
    distance = Math.min(distance, lineDistance(point, a, b))
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) enclosed = !enclosed
  }
  return enclosed ? 0 : distance
}

/** Only selected handles are interactive. Text labels have no arbitrary font-size hit boxes. */
export function hitTestDrawingGeometry (
  geometries: readonly DrawingGeometry[], selectedId: string | null, point: DrawingPoint, tolerance = 6
): DrawingHit | null {
  if (!finitePoint(point) || !Number.isFinite(tolerance) || tolerance < 0) return null
  const selected = geometries.find(item => item.id === selectedId)
  if (selected !== undefined) {
    for (const handle of selected.handles) {
      const distance = Math.hypot(point.x - handle.point.x, point.y - handle.point.y)
      if (distance <= tolerance) return { id: selected.id, anchorIndex: handle.anchorIndex, distance }
    }
  }
  for (let i = geometries.length - 1; i >= 0; i--) {
    const geometry = geometries[i]
    for (const primitive of geometry.primitives) {
      if (primitive.kind === 'text') continue
      const distance = primitive.kind === 'stroke' ? inside(point, primitive.clip)
        ? Math.max(0, primitive.points.reduce((best, p, i) => i === 0 ? best : Math.min(best, lineDistance(point, primitive.points[i - 1], p)), Infinity) - primitive.width / 2) : Infinity
        : primitive.kind === 'polygon' ? polygonDistance(point, primitive.points)
          : primitive.kind === 'label' || primitive.kind === 'image' ? inside(point, primitive.clip)
            ? Math.hypot(Math.max(primitive.bounds.left - point.x, 0, point.x - primitive.bounds.right), Math.max(primitive.bounds.top - point.y, 0, point.y - primitive.bounds.bottom)) : Infinity
            : primitive.kind === 'ellipse' ? ellipseDistance(point, primitive)
              : primitive.kind === 'line' ? lineDistance(point, primitive.from, primitive.to)
                : Math.hypot(Math.max(primitive.from.x - point.x, 0, point.x - primitive.to.x), Math.max(primitive.from.y - point.y, 0, point.y - primitive.to.y))
      if (distance <= tolerance) return { id: geometry.id, anchorIndex: null, distance }
    }
  }
  return null
}

/** Immutable drawing snapshots share unchanged entries; bounded undo contains user edits only. */
export class DrawingStore {
  private drawings: readonly Drawing[] = Object.freeze([])
  private selectedId: string | null = null
  private past: Array<readonly Drawing[]> = []
  private future: Array<readonly Drawing[]> = []
  private readonly listeners = new Set<() => void>()
  private readonly historyLimit: number
  private snapshot: DrawingSnapshot = Object.freeze({ drawings: this.drawings, selectedId: null, canUndo: false, canRedo: false })

  constructor (options: { historyLimit?: number } = {}) {
    const limit = options.historyLimit ?? 50
    if (!Number.isInteger(limit) || limit < 0 || limit > 200) throw new RangeError('Drawing history limit must be between 0 and 200')
    this.historyLimit = limit
  }

  readonly getSnapshot = (): DrawingSnapshot => this.snapshot
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  add (input: DrawingInput): Drawing {
    const value = drawing(input)
    if (this.drawings.length >= MAX_DRAWINGS) throw new RangeError('Drawing limit reached')
    if (this.drawings.some(item => item.id === value.id)) throw new TypeError('Duplicate drawing id')
    this.commit([...this.drawings, value])
    return value
  }

  /** Locked anchors are unchanged until explicitly unlocked. Visibility remains editable. */
  update (id: string, patch: DrawingPatch): boolean {
    const fields = record(patch, ['anchors', 'locked', 'hidden', 'text', 'image', 'strokeWidth'], 'drawing patch')
    const index = this.drawings.findIndex(item => item.id === id)
    if (index < 0) return false
    const current = this.drawings[index]
    const value = drawing({ ...current, ...fields })
    if (current.locked && (fields.anchors !== undefined || fields.text !== undefined || fields.image !== undefined || fields.strokeWidth !== undefined)) return false
    if (same(current, value)) return false
    const next = this.drawings.slice(); next[index] = value
    this.commit(next)
    return true
  }

  remove (id: string): boolean {
    const value = this.drawings.find(item => item.id === id)
    if (value === undefined || value.locked) return false
    this.commit(this.drawings.filter(item => item.id !== id))
    return true
  }

  clear (): boolean {
    const next = this.drawings.filter(item => item.locked)
    if (next.length === this.drawings.length) return false
    this.commit(next)
    return true
  }

  select (id: string | null): boolean {
    if (id !== null && !this.drawings.some(item => item.id === id && !item.hidden)) return false
    if (id === this.selectedId) return false
    this.selectedId = id; this.publish()
    return true
  }

  undo (): boolean {
    const previous = this.past.pop()
    if (previous === undefined) return false
    this.future.push(this.drawings); this.drawings = previous; this.publish()
    return true
  }

  redo (): boolean {
    const next = this.future.pop()
    if (next === undefined) return false
    this.past.push(this.drawings); this.drawings = next; this.publish()
    return true
  }

  exportJson (): string { return JSON.stringify({ version: 1, drawings: this.drawings }) }

  /** Complete validation precedes changes. Layout restoration clears history unless explicitly a user edit. */
  importJson (json: string, options: { recordHistory?: boolean } = {}): void {
    if (typeof json !== 'string' || json.length > MAX_JSON_LENGTH) throw new TypeError('Invalid drawing document size')
    const document = record(JSON.parse(json), ['version', 'drawings'], 'drawing document')
    if (document.version !== 1 || !Array.isArray(document.drawings) || document.drawings.length > MAX_DRAWINGS) throw new TypeError('Invalid drawing document')
    const next = document.drawings.map(drawing), ids = new Set(next.map(item => item.id))
    if (ids.size !== next.length) throw new TypeError('Duplicate drawing id')
    const changed = next.length !== this.drawings.length || next.some((item, i) => !same(item, this.drawings[i]))
    if (options.recordHistory === true) {
      if (changed) this.commit(next)
    } else {
      this.past = []; this.future = []; this.drawings = Object.freeze(next); this.publish()
    }
  }

  geometry (project: DrawingProjector, bounds: DrawingBounds, context?: DrawingContext): DrawingGeometry[] {
    validBounds(bounds)
    const result: DrawingGeometry[] = []
    for (const value of this.drawings) {
      const geometry = projectDrawing(value, project, bounds, context)
      if (geometry !== null) result.push(geometry)
    }
    return result
  }

  hitTest (point: DrawingPoint, project: DrawingProjector, bounds: DrawingBounds, tolerance = 6, context?: DrawingContext): DrawingHit | null {
    return hitTestDrawingGeometry(this.geometry(project, bounds, context), this.selectedId, point, tolerance)
  }

  private commit (next: readonly Drawing[]): void {
    if (JSON.stringify({ version: 1, drawings: next }).length > MAX_JSON_LENGTH) throw new RangeError('Drawing document size limit reached')
    if (this.historyLimit > 0) {
      this.past.push(this.drawings)
      if (this.past.length > this.historyLimit) this.past.shift()
    }
    this.future = []; this.drawings = Object.freeze(next); this.publish()
  }

  private publish (): void {
    if (!this.drawings.some(item => item.id === this.selectedId && !item.hidden)) this.selectedId = null
    this.snapshot = Object.freeze({ drawings: this.drawings, selectedId: this.selectedId, canUndo: this.past.length > 0, canRedo: this.future.length > 0 })
    for (const listener of [...this.listeners]) {
      try { listener() } catch (error) { console.warn('[super-chart] Drawing observer failed', error) }
    }
  }
}
