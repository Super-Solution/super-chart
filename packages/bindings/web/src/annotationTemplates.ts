import type { EngineAnnotationTone } from './annotations'

/**
 * Annotation templates: the owned equivalent of an upstream "register overlay" call.
 *
 * A template is a pure function from projected anchor points to a short list of figures in pixel
 * space. The annotation layer owns everything else: validation of the host's specs, projection,
 * clipping to the price pane, painting (shapes under the person's drawings, words above them),
 * theme colours, the axis price tags and the bounds on host resources. A template never touches a
 * canvas, so a template that throws, returns garbage or returns too much only loses its own
 * annotation, never the chart.
 */
export interface AnnotationPoint { readonly x: number, readonly y: number }
export interface AnnotationBounds { readonly left: number, readonly right: number, readonly top: number, readonly bottom: number }
/** One anchor after projection: the host's own time and price, plus where they landed on the pane. */
export interface ProjectedAnchor { readonly time: number, readonly price: number, readonly x: number, readonly y: number }
export type AnnotationParams = Readonly<Record<string, number | string | boolean>>

interface FigureStyle {
  /** Any CSS colour. Default: the annotation's own colour. A malformed value falls back to it. */
  readonly color?: string
  /** A theme colour (up, down, violet, muted) when `color` is not given, so figures follow light and dark. */
  readonly tone?: EngineAnnotationTone
  /** CSS pixels, 0.5 to 8. Default 1.5. */
  readonly width?: number
  /** Dash pattern in CSS pixels (up to 4 entries), or `'solid'`. Default: the annotation dash, so host marks never pass for the person's drawings. */
  readonly dash?: readonly number[] | 'solid'
}
export interface AnnotationLineFigure extends FigureStyle {
  readonly type: 'line'
  readonly from: AnnotationPoint
  readonly to: AnnotationPoint
  /** Continue past `to` (`right`), or past both ends (`both`), up to the pane edge. */
  readonly extend?: 'none' | 'right' | 'both'
}
export interface AnnotationPolylineFigure extends FigureStyle {
  readonly type: 'polyline'
  readonly points: readonly AnnotationPoint[]
  readonly closed?: boolean
  /** 0 to 1: a translucent fill of the (closed) outline. Default 0. */
  readonly fillOpacity?: number
  /** Draw the outline. Default true. */
  readonly stroke?: boolean
}
export interface AnnotationRectFigure extends FigureStyle {
  readonly type: 'rect'
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly fillOpacity?: number
  readonly stroke?: boolean
}
export interface AnnotationMarkerFigure extends FigureStyle {
  readonly type: 'marker'
  readonly x: number
  readonly y: number
  readonly shape?: 'diamond' | 'circle' | 'triangle-up' | 'triangle-down'
  /** Half-size in CSS pixels, 2 to 16. Default 4.5. */
  readonly size?: number
}
export interface AnnotationTextFigure {
  readonly type: 'text'
  readonly x: number
  readonly y: number
  readonly text: string
  /** Where `x` sits against the text. Default `left`. */
  readonly align?: 'left' | 'center' | 'right'
  readonly color?: string
}
export type AnnotationFigure = AnnotationLineFigure | AnnotationPolylineFigure | AnnotationRectFigure | AnnotationMarkerFigure | AnnotationTextFigure

export interface AnnotationTemplateInput {
  /** The anchors the template asked for, in the order the host wrote them. */
  readonly anchors: readonly ProjectedAnchor[]
  readonly bounds: AnnotationBounds
  readonly params: AnnotationParams
  /** The host's label for the annotation, if it gave one. */
  readonly text: string | undefined
  readonly tone: EngineAnnotationTone
  /** The annotation's resolved colour (the host's `color`, else the tone's). */
  readonly color: string
  /** Pixel position of any time and price on this pane, honouring the active price scale; null when unprojectable. */
  readonly project: (time: number, price: number) => AnnotationPoint | null
  /** The price in the symbol's own precision, as the axis shows it. */
  readonly formatPrice: (price: number) => string
}
export interface AnnotationTemplate {
  /** The `kind` a spec uses to select this template. Lowercase letters, digits and `-`, up to 48 characters. */
  readonly name: string
  /** How many anchors the template consumes, 1 to 8. Extra anchors in a spec are ignored. */
  readonly anchors: number
  /** Which anchors get an exact price tag on the price axis. Default none: a template names its own prices. */
  readonly axisTags?: readonly number[]
  /** Called on every projection. Pure; must finish quickly and must not retain `input`. */
  readonly create: (input: AnnotationTemplateInput) => readonly AnnotationFigure[]
}

/** Bounds a template's output so one annotation cannot exhaust the canvas. */
export const ANNOTATION_TEMPLATE_LIMITS = Object.freeze({ figures: 128, polylinePoints: 256, textLength: 128, anchors: 8, nameLength: 48, params: 16, paramKeyLength: 32, paramStringLength: 128 })
export const ANNOTATION_TEMPLATE_NAME = /^[a-z][a-z0-9-]*$/

function paramText (params: AnnotationParams, key: string, fallback: string): string {
  const value = params[key]
  return typeof value === 'string' ? value : fallback
}
function paramFlag (params: AnnotationParams, key: string, fallback: boolean): boolean {
  const value = params[key]
  return typeof value === 'boolean' ? value : fallback
}
function extendOf (value: string, fallback: 'none' | 'right' | 'both'): 'none' | 'right' | 'both' {
  return value === 'none' || value === 'right' || value === 'both' ? value : fallback
}

const trend = (name: string, defaultExtend: 'none' | 'right' | 'both'): AnnotationTemplate => ({
  name,
  anchors: 2,
  axisTags: [0, 1],
  create: input => {
    const [a, b] = input.anchors
    const figures: AnnotationFigure[] = [
      { type: 'line', from: a, to: b, extend: extendOf(paramText(input.params, 'extend', defaultExtend), defaultExtend) },
      { type: 'marker', x: a.x, y: a.y, shape: 'circle', size: 3 },
      { type: 'marker', x: b.x, y: b.y, shape: 'circle', size: 3 }
    ]
    if (input.text !== undefined && input.text !== '') figures.push({ type: 'text', x: b.x + 8, y: b.y - 10, text: input.text })
    return figures
  }
})

/** The classic retracement levels. A spec overrides them with `params.levels`, a comma-separated list of ratios. */
export const DEFAULT_FIBONACCI_LEVELS = Object.freeze([0, 0.236, 0.382, 0.5, 0.618, 0.786, 1])
function fibonacciLevels (params: AnnotationParams): readonly number[] {
  const raw = params.levels
  if (typeof raw !== 'string') return DEFAULT_FIBONACCI_LEVELS
  const levels = raw.split(',').map(item => Number(item.trim())).filter(Number.isFinite).filter(level => Math.abs(level) <= 20).slice(0, 24)
  return levels.length > 0 ? levels : DEFAULT_FIBONACCI_LEVELS
}
const fibonacci: AnnotationTemplate = {
  name: 'fibonacci',
  anchors: 2,
  create: input => {
    const [a, b] = input.anchors
    // Like the Fibonacci drawing tool: level 0 sits at the second anchor (where the move ended) and level 1 at the first (where it began),
    // so a retracement of a leg anchored start-then-end reads 0.382 as a 38.2% pullback from the end.
    const left = Math.min(a.x, b.x), right = Math.max(a.x, b.x)
    const extendRight = paramFlag(input.params, 'extend', false)
    const edge = extendRight ? input.bounds.right : right
    const figures: AnnotationFigure[] = [{ type: 'line', from: a, to: b, dash: [2, 3], width: 1 }]
    const showPrice = paramFlag(input.params, 'prices', true)
    for (const level of fibonacciLevels(input.params)) {
      const price = b.price + (a.price - b.price) * level
      const projected = input.project(a.time, price)
      if (projected === null) continue
      figures.push({ type: 'line', from: { x: left, y: projected.y }, to: { x: edge, y: projected.y }, width: level === 0 || level === 1 ? 1.5 : 1 })
      figures.push({ type: 'text', x: left + 4, y: projected.y - 8, text: showPrice ? `${level} · ${input.formatPrice(price)}` : String(level) })
    }
    if (input.text !== undefined && input.text !== '') figures.push({ type: 'text', x: right - 4, y: Math.min(a.y, b.y) - 18, text: input.text, align: 'right' })
    return figures
  }
}

/**
 * A trade plan: entry at anchor 0, target at anchor 1, stop at anchor 2. The first two anchors set where
 * it starts and ends; the stop's time is ignored. A long has its target above the entry, a short below;
 * a stop on the wrong side of the entry draws nothing but a note, so a typo never looks like a plan.
 */
const plan: AnnotationTemplate = {
  name: 'plan',
  anchors: 3,
  axisTags: [0, 1, 2],
  create: input => {
    const [entry, target, stop] = input.anchors
    const left = Math.min(entry.x, target.x), right = Math.max(entry.x, target.x), width = right - left
    const long = target.price > entry.price
    const valid = target.price !== entry.price && (long ? stop.price < entry.price : stop.price > entry.price)
    if (!valid) return [{ type: 'text', x: entry.x + 6, y: entry.y - 10, text: 'Invalid plan: the stop must sit opposite the target' }]
    if (width < 1) return [{ type: 'text', x: entry.x + 6, y: entry.y - 10, text: 'Invalid plan: entry and target need different times' }]
    const win = Math.abs(target.price - entry.price), risk = Math.abs(entry.price - stop.price)
    const percent = (price: number): string => `${price >= entry.price ? '+' : '-'}${(Math.abs(price - entry.price) / Math.abs(entry.price) * 100).toFixed(2)}%`
    const ratio = risk > 0 ? win / risk : Infinity
    const figures: AnnotationFigure[] = [
      { type: 'rect', x: left, y: Math.min(entry.y, target.y), width, height: Math.abs(target.y - entry.y), fillOpacity: 0.14, stroke: false, tone: long ? 'bull' : 'bear' },
      { type: 'rect', x: left, y: Math.min(entry.y, stop.y), width, height: Math.abs(stop.y - entry.y), fillOpacity: 0.14, stroke: false, tone: long ? 'bear' : 'bull' },
      { type: 'line', from: { x: left, y: entry.y }, to: { x: right, y: entry.y }, dash: 'solid' },
      { type: 'line', from: { x: left, y: target.y }, to: { x: right, y: target.y }, dash: [3, 3], width: 1 },
      { type: 'line', from: { x: left, y: stop.y }, to: { x: right, y: stop.y }, dash: [3, 3], width: 1 },
      { type: 'text', x: left + 6, y: target.y + (long ? 10 : -10), text: `Target ${input.formatPrice(target.price)} (${percent(target.price)})` },
      { type: 'text', x: left + 6, y: stop.y + (long ? -10 : 10), text: `Stop ${input.formatPrice(stop.price)} (${percent(stop.price)})` },
      { type: 'text', x: left + 6, y: entry.y + (long ? 10 : -10), text: `${input.text ?? (long ? 'Long' : 'Short')} · R:R ${Number.isFinite(ratio) ? ratio.toFixed(2) : '∞'}` }
    ]
    return figures
  }
}

/** The templates every annotation layer starts with, next to its built-in `level`, `zone` and `marker`. */
export const BUILT_IN_ANNOTATION_TEMPLATES: readonly AnnotationTemplate[] = Object.freeze([trend('trend', 'none'), trend('ray', 'right'), fibonacci, plan])
