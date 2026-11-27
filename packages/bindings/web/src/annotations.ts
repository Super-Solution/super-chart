import type { EngineFrame } from '@supersolutions/super-chart-core'
import type { EngineLayer } from './layer'
import { axisStrip, derivePrecision, ENGINE_RENDER_THEMES } from '@supersolutions/super-chart-core'
import { colors, CANVAS_FONT, CANVAS_LABEL_FONT, type ThemeName } from './tokens'
import {
  ANNOTATION_TEMPLATE_LIMITS, ANNOTATION_TEMPLATE_NAME, BUILT_IN_ANNOTATION_TEMPLATES,
  type AnnotationFigure, type AnnotationParams, type AnnotationTemplate
} from './annotationTemplates'
export type {
  AnnotationFigure, AnnotationLineFigure, AnnotationMarkerFigure, AnnotationParams, AnnotationPoint, AnnotationPolylineFigure,
  AnnotationRectFigure, AnnotationTemplate, AnnotationTemplateInput, AnnotationTextFigure, ProjectedAnchor
} from './annotationTemplates'
export { ANNOTATION_TEMPLATE_LIMITS, BUILT_IN_ANNOTATION_TEMPLATES, DEFAULT_FIBONACCI_LEVELS } from './annotationTemplates'
export { attachAnnotationIntents, ANNOTATION_INTENT_REACH } from './annotationIntents'
export type { AnnotationIntentEvent } from './annotationIntents'

export type EngineAnnotationTone = 'bull' | 'bear' | 'neutral' | 'accent'
/** The kinds the layer paints itself. Any other `kind` names a template: the built-in `trend`, `ray`, `fibonacci`, `plan`, or one the host registers. */
export type EngineAnnotationKind = 'level' | 'zone' | 'marker'
export type EngineAnnotationTheme = ThemeName
export interface EngineAnnotationAnchor { readonly time: number, readonly price?: number }
export interface EngineAnnotationSpec {
  readonly key: string
  readonly kind: EngineAnnotationKind | (string & Record<never, never>)
  readonly anchors: readonly EngineAnnotationAnchor[]
  readonly text?: string
  readonly tone?: EngineAnnotationTone
  readonly color?: string
  /** Options for a template (for example `{ extend: 'right' }` on a `trend`). Scalar values only. */
  readonly params?: AnnotationParams
  /**
   * A `level` the person may drag up or down. The chart never moves it: dragging only reports intent through
   * `attachAnnotationIntents`, and the host decides (validates, sends an order, then calls `setAnnotations`).
   */
  readonly draggable?: boolean
}
export type EngineAnnotationRejectCode = 'bad_anchor' | 'out_of_range' | 'unknown_kind' | 'duplicate_key' | 'bad_key' | 'bad_style' | 'symbol_mismatch'
export interface EngineAnnotationRejection { readonly key: string, readonly code: EngineAnnotationRejectCode }
export interface EngineSetAnnotationsResult {
  readonly applied: readonly string[]
  readonly rejected: readonly EngineAnnotationRejection[]
}
export interface EngineAnnotationBounds { readonly left: number, readonly right: number, readonly top: number, readonly bottom: number }
export interface EngineAnnotationPoint { readonly x: number, readonly y: number }
export interface EngineAnnotationRectangle { readonly x: number, readonly y: number, readonly width: number, readonly height: number }
export interface EngineProjectedAnnotation {
  readonly id: string
  readonly layer: string
  readonly spec: EngineAnnotationSpec
  readonly color: string
  readonly status: 'visible' | 'offscreen' | 'unprojectable' | 'no-data'
  readonly point?: EngineAnnotationPoint
  readonly rect?: EngineAnnotationRectangle
  /** For a template kind: the figures its template produced for this frame, in pixel space. */
  readonly figures?: readonly AnnotationFigure[]
}
export interface EngineAnnotationSnapshot {
  readonly version: number
  readonly symbol: string | null
  readonly bounds: EngineAnnotationBounds | null
  readonly annotations: readonly EngineProjectedAnnotation[]
}
/** A stretch of time, and optionally of price, that the chart can mark without a stored annotation. Times are milliseconds. */
export interface EngineAnnotationRange { readonly from: number, readonly to: number, readonly low?: number, readonly high?: number }
/** Where an annotation sits and whether the current view shows it. Prices are present when every anchor has one. */
export interface EngineAnnotationSpan extends EngineAnnotationRange { readonly status: EngineProjectedAnnotation['status'] }
export interface EngineAnnotationsOptions {
  /** Use a stable market identity, including venue/network when tickers collide. */
  symbol: string | null
  theme?: EngineAnnotationTheme
  font?: string
  /** Decimals for the exact price tags on the axis (the symbol's precision). Default: derived from the bars. */
  pricePrecision?: number
  /** Request a paint only: changed annotations reuse the latest frame geometry. */
  onChange?: () => void
}

/** Explicit host-resource bounds. Exceeding a document bound leaves its previous contents intact. */
export const ENGINE_ANNOTATION_LIMITS = Object.freeze({ scopes: 16, layersPerScope: 32, entriesPerLayer: 1024, entriesPerScope: 2048, keyLength: 128, symbolLength: 256, textLength: 2048, colorLength: 128 })
const EMPTY_SPECS: readonly EngineAnnotationSpec[] = Object.freeze([])
const KINDS: readonly string[] = ['level', 'zone', 'marker']
const TONES: readonly EngineAnnotationTone[] = ['bull', 'bear', 'neutral', 'accent']
type Layers = Map<string, readonly EngineAnnotationSpec[]>

function named (value: unknown, limit: number, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > limit) throw new TypeError(`Invalid annotation ${name}`)
  return value
}
function scope (value: unknown): string | null {
  return value === null ? null : named(value, ENGINE_ANNOTATION_LIMITS.symbolLength, 'symbol')
}
function theme (value: unknown): EngineAnnotationTheme {
  if (typeof value !== 'string' || !(ENGINE_RENDER_THEMES as readonly string[]).includes(value)) throw new TypeError('Invalid annotation theme')
  return value as EngineAnnotationTheme
}
function annotationId (layer: string, key: string): string {
  // Escape each part separately; a colon in a host key cannot collide with another layer.
  return `sc:ann:${encodeURIComponent(layer)}:${encodeURIComponent(key)}`
}
function copiedParams (value: unknown): AnnotationParams | null | undefined {
  if (value === undefined) return undefined
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length > ANNOTATION_TEMPLATE_LIMITS.params) return null
  const copy: Record<string, number | string | boolean> = {}
  for (const [key, item] of entries) {
    if (key.length === 0 || key.length > ANNOTATION_TEMPLATE_LIMITS.paramKeyLength || key === '__proto__') return null
    if (typeof item === 'number' ? !Number.isFinite(item) : typeof item === 'string' ? item.length > ANNOTATION_TEMPLATE_LIMITS.paramStringLength : typeof item !== 'boolean') return null
    copy[key] = item as number | string | boolean
  }
  return Object.freeze(copy)
}
function sameParams (a: AnnotationParams | undefined, b: AnnotationParams | undefined): boolean {
  if (a === undefined || b === undefined) return a === b
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every(key => a[key] === b[key])
}
function copiedSpec (value: EngineAnnotationSpec, templates: ReadonlyMap<string, AnnotationTemplate>): { spec: EngineAnnotationSpec } | { code: EngineAnnotationRejectCode } {
  if (value === null || typeof value !== 'object') return { code: 'bad_anchor' }
  if (typeof value.key !== 'string' || value.key.trim().length === 0 || value.key.length > ENGINE_ANNOTATION_LIMITS.keyLength) return { code: 'bad_key' }
  const template = KINDS.includes(value.kind) ? undefined : templates.get(value.kind)
  if (template === undefined && !KINDS.includes(value.kind)) return { code: 'unknown_kind' }
  const count = template !== undefined ? template.anchors : value.kind === 'zone' ? 2 : 1
  if (!Array.isArray(value.anchors) || value.anchors.length < count) return { code: 'bad_anchor' }
  const anchors: EngineAnnotationAnchor[] = []
  for (let i = 0; i < count; i++) {
    const anchor = value.anchors[i]
    if (anchor === null || typeof anchor !== 'object' || typeof anchor.time !== 'number' || !Number.isFinite(anchor.time) || typeof anchor.price !== 'number') return { code: 'bad_anchor' }
    if (Math.abs(anchor.time) > 8.64e15 || !Number.isFinite(anchor.price)) return { code: 'out_of_range' }
    anchors.push(Object.freeze({ time: anchor.time, price: anchor.price }))
  }
  if (count === 2 && anchors[0].time === anchors[1].time && anchors[0].price === anchors[1].price) return { code: 'out_of_range' }
  const params = copiedParams(value.params)
  if (params === null) return { code: 'bad_style' }
  if (value.draggable !== undefined && (typeof value.draggable !== 'boolean' || (value.draggable && value.kind !== 'level'))) return { code: 'bad_style' }
  if ((value.text !== undefined && (typeof value.text !== 'string' || value.text.length > ENGINE_ANNOTATION_LIMITS.textLength)) ||
      (value.tone !== undefined && !TONES.includes(value.tone)) ||
      (value.color !== undefined && (typeof value.color !== 'string' || value.color.trim().length === 0 || value.color.length > ENGINE_ANNOTATION_LIMITS.colorLength))) return { code: 'bad_style' }
  return {
    spec: Object.freeze({
      key: value.key,
      kind: value.kind,
      anchors: Object.freeze(anchors),
      ...(value.text !== undefined ? { text: value.text } : {}),
      ...(value.tone !== undefined ? { tone: value.tone } : {}),
      ...(value.color !== undefined ? { color: value.color } : {}),
      ...(params !== undefined ? { params } : {}),
      ...(value.draggable === true ? { draggable: true } : {})
    })
  }
}
function sameSpec (a: EngineAnnotationSpec, b: EngineAnnotationSpec): boolean {
  return a.key === b.key && a.kind === b.kind && a.text === b.text && a.tone === b.tone && a.color === b.color && sameParams(a.params, b.params) && a.draggable === b.draggable &&
    a.anchors.length === b.anchors.length && a.anchors.every((anchor, i) => anchor.time === b.anchors[i].time && anchor.price === b.anchors[i].price)
}
function resolveColor (spec: EngineAnnotationSpec, currentTheme: EngineAnnotationTheme): string {
  if (spec.color !== undefined) return spec.color
  const palette = colors(currentTheme)
  return spec.tone === 'bull' ? palette.up : spec.tone === 'bear' ? palette.down : spec.tone === 'accent' ? palette.violet : palette.inkMuted
}
/** A zone's translucent band; candles stay readable through it. */
function zoneFill (spec: EngineAnnotationSpec, currentTheme: EngineAnnotationTheme): string {
  const palette = colors(currentTheme)
  return spec.tone === 'bull' ? palette.upZone : spec.tone === 'bear' ? palette.downZone : spec.tone === 'accent' ? palette.violetZone : palette.inkWash
}
function diamond (context: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  context.beginPath(); context.moveTo(x, y - r); context.lineTo(x + r, y); context.lineTo(x, y + r); context.lineTo(x - r, y); context.closePath(); context.fill()
}
const EMPTY_PARAMS: AnnotationParams = Object.freeze({})
const finiteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) < 1e7
const pointOk = (point: unknown): boolean => point !== null && typeof point === 'object' && finiteNumber((point as { x?: unknown }).x) && finiteNumber((point as { y?: unknown }).y)
/** Copies what a template returned and drops what cannot be painted. Null when the whole return is unusable. */
function sanitizeFigures (raw: unknown): readonly AnnotationFigure[] | null {
  if (!Array.isArray(raw) || raw.length > ANNOTATION_TEMPLATE_LIMITS.figures) return null
  const out: AnnotationFigure[] = []
  const tones: readonly unknown[] = TONES
  for (const item of raw as unknown[]) {
    if (item === null || typeof item !== 'object') continue
    const figure = item as Record<string, unknown>
    const style = {
      ...(typeof figure.color === 'string' && figure.color.length > 0 && figure.color.length <= ENGINE_ANNOTATION_LIMITS.colorLength ? { color: figure.color } : {}),
      ...(tones.includes(figure.tone) ? { tone: figure.tone as EngineAnnotationTone } : {}),
      ...(typeof figure.width === 'number' && figure.width >= 0.5 && figure.width <= 8 ? { width: figure.width } : {}),
      ...(figure.dash === 'solid' ? { dash: 'solid' as const } : Array.isArray(figure.dash) && figure.dash.length <= 4 && figure.dash.every(part => typeof part === 'number' && part >= 0 && part <= 64) ? { dash: Object.freeze([...figure.dash] as number[]) } : {})
    }
    const fill = typeof figure.fillOpacity === 'number' && figure.fillOpacity >= 0 && figure.fillOpacity <= 1 ? { fillOpacity: figure.fillOpacity } : {}
    const stroke = figure.stroke === false ? { stroke: false } : {}
    if (figure.type === 'line' && pointOk(figure.from) && pointOk(figure.to)) {
      const from = figure.from as { x: number, y: number }, to = figure.to as { x: number, y: number }
      out.push(Object.freeze({ type: 'line', from: Object.freeze({ x: from.x, y: from.y }), to: Object.freeze({ x: to.x, y: to.y }), ...(figure.extend === 'right' || figure.extend === 'both' ? { extend: figure.extend } : {}), ...style }))
    } else if (figure.type === 'rect' && [figure.x, figure.y, figure.width, figure.height].every(finiteNumber) && (figure.width as number) >= 0 && (figure.height as number) >= 0) {
      out.push(Object.freeze({ type: 'rect', x: figure.x as number, y: figure.y as number, width: figure.width as number, height: figure.height as number, ...fill, ...stroke, ...style }))
    } else if (figure.type === 'polyline' && Array.isArray(figure.points) && figure.points.length >= 2 && figure.points.length <= ANNOTATION_TEMPLATE_LIMITS.polylinePoints && figure.points.every(pointOk)) {
      out.push(Object.freeze({ type: 'polyline', points: Object.freeze((figure.points as Array<{ x: number, y: number }>).map(point => Object.freeze({ x: point.x, y: point.y }))), ...(figure.closed === true ? { closed: true } : {}), ...fill, ...stroke, ...style }))
    } else if (figure.type === 'marker' && finiteNumber(figure.x) && finiteNumber(figure.y)) {
      const shapes: readonly unknown[] = ['diamond', 'circle', 'triangle-up', 'triangle-down']
      out.push(Object.freeze({ type: 'marker', x: figure.x, y: figure.y, ...(shapes.includes(figure.shape) ? { shape: figure.shape as 'diamond' } : {}), ...(typeof figure.size === 'number' && figure.size >= 2 && figure.size <= 16 ? { size: figure.size } : {}), ...style }))
    } else if (figure.type === 'text' && finiteNumber(figure.x) && finiteNumber(figure.y) && typeof figure.text === 'string' && figure.text.length > 0) {
      out.push(Object.freeze({ type: 'text', x: figure.x, y: figure.y, text: figure.text.slice(0, ANNOTATION_TEMPLATE_LIMITS.textLength), ...(figure.align === 'right' || figure.align === 'center' ? { align: figure.align } : {}), ...(typeof figure.color === 'string' && figure.color.length > 0 && figure.color.length <= ENGINE_ANNOTATION_LIMITS.colorLength ? { color: figure.color } : {}) }))
    }
  }
  return Object.freeze(out)
}
function figureTouches (figure: AnnotationFigure, bounds: EngineAnnotationBounds): boolean {
  if (figure.type === 'line') {
    if (figure.extend !== undefined) return true
    return Math.max(figure.from.x, figure.to.x) >= bounds.left && Math.min(figure.from.x, figure.to.x) <= bounds.right && Math.max(figure.from.y, figure.to.y) >= bounds.top && Math.min(figure.from.y, figure.to.y) <= bounds.bottom
  }
  if (figure.type === 'rect') return figure.x + figure.width >= bounds.left && figure.x <= bounds.right && figure.y + figure.height >= bounds.top && figure.y <= bounds.bottom
  if (figure.type === 'polyline') {
    const xs = figure.points.map(point => point.x), ys = figure.points.map(point => point.y)
    return Math.max(...xs) >= bounds.left && Math.min(...xs) <= bounds.right && Math.max(...ys) >= bounds.top && Math.min(...ys) <= bounds.bottom
  }
  return figure.x >= bounds.left && figure.x <= bounds.right && figure.y >= bounds.top && figure.y <= bounds.bottom
}
function result (applied: string[], rejected: EngineAnnotationRejection[]): EngineSetAnnotationsResult {
  return Object.freeze({ applied: Object.freeze(applied), rejected: Object.freeze(rejected.map(item => Object.freeze(item))) })
}

/**
 * Host/AI annotations are retained separately from user drawings and never enter
 * their selection or undo history. Layer replacement is keyed and scope-local.
 * Malformed individual entries are rejected; as in the existing annotation API,
 * only accepted keys remain after replacement. Duplicate keys keep the first.
 *
 * Time anchors interpolate on the engine's loaded category timeline, including
 * explicit times outside loaded history. Lines span the price pane; zones and
 * markers are clipped there. They do not expand the candle/indicator price scale.
 * This is an owned annotation contract, not arbitrary upstream overlay support.
 */
export class EngineAnnotations implements EngineLayer {
  private readonly scopes = new Map<string, Layers>()
  private readonly templates = new Map<string, AnnotationTemplate>(BUILT_IN_ANNOTATION_TEMPLATES.map(template => [template.name, template]))
  private readonly onChange: (() => void) | undefined
  private readonly font: string
  private pricePrecision: number | undefined
  private symbol: string | null
  private currentTheme: EngineAnnotationTheme
  private frame: EngineFrame | null = null
  private ghost: { id: string, price: number } | null = null
  private emphasis: { keys: ReadonlySet<string>, layer: string | undefined } | null = null
  private range: EngineAnnotationRange | null = null
  private version = 0
  private disposed = false
  private snapshot: EngineAnnotationSnapshot

  constructor (options: EngineAnnotationsOptions) {
    this.symbol = scope(options.symbol)
    this.currentTheme = theme(options.theme ?? 'dark')
    this.font = options.font === undefined ? CANVAS_LABEL_FONT : named(options.font, 256, 'font')
    if (options.pricePrecision !== undefined && !(Number.isInteger(options.pricePrecision) && options.pricePrecision >= 0 && options.pricePrecision <= 20)) throw new RangeError('Annotation price precision must be an integer from 0 to 20')
    this.pricePrecision = options.pricePrecision
    this.onChange = options.onChange
    this.snapshot = Object.freeze({ version: 0, symbol: this.symbol, bounds: null, annotations: Object.freeze([]) })
  }

  /** Null hides all annotations during async loading. A new scope needs a fresh frame. */
  setScope (symbol: string | null): void {
    this.assertLive()
    const next = scope(symbol)
    if (next === this.symbol) return
    this.symbol = next; this.frame = null; this.changed()
  }

  /** Decimals for the exact price tags; undefined derives them from the loaded bars again. */
  setPricePrecision (value: number | undefined): void {
    this.assertLive()
    if (value !== undefined && !(Number.isInteger(value) && value >= 0 && value <= 20)) throw new RangeError('Annotation price precision must be an integer from 0 to 20')
    if (value === this.pricePrecision) return
    this.pricePrecision = value; this.changed()
  }

  setTheme (value: EngineAnnotationTheme): void {
    this.assertLive()
    const next = theme(value)
    if (next === this.currentTheme) return
    this.currentTheme = next; this.changed()
  }

  /**
   * Adds a template kind to this layer, the owned equivalent of registering an upstream overlay.
   * Returns a function that removes it again: specs already stored under that kind stay, project as
   * `unprojectable` and paint nothing until the kind is registered again. Names are per layer, may not
   * reuse `level`, `zone`, `marker` or a template already registered, and never reach another layer.
   * Anything that can call `setAnnotations` on this layer (including a chat plugin's agent) can select it.
   */
  registerTemplate (template: AnnotationTemplate): () => void {
    this.assertLive()
    if (template === null || typeof template !== 'object') throw new TypeError('Annotation template must be an object')
    const { name, anchors, create, axisTags } = template
    if (typeof name !== 'string' || name.length > ANNOTATION_TEMPLATE_LIMITS.nameLength || !ANNOTATION_TEMPLATE_NAME.test(name)) throw new TypeError('Annotation template name must be lowercase letters, digits and "-" starting with a letter, up to 48 characters')
    if (KINDS.includes(name)) throw new RangeError(`Annotation kind "${name}" is built in`)
    if (this.templates.has(name)) throw new RangeError(`Annotation template "${name}" is already registered`)
    if (!Number.isInteger(anchors) || anchors < 1 || anchors > ANNOTATION_TEMPLATE_LIMITS.anchors) throw new RangeError('Annotation template anchors must be an integer from 1 to 8')
    if (typeof create !== 'function') throw new TypeError('Annotation template needs a create function')
    if (axisTags !== undefined && (!Array.isArray(axisTags) || axisTags.some(index => !Number.isInteger(index) || index < 0 || index >= anchors))) throw new RangeError('Annotation template axisTags must be anchor indices')
    const stored = Object.freeze({ name, anchors, create, ...(axisTags !== undefined ? { axisTags: Object.freeze([...axisTags]) } : {}) })
    this.templates.set(name, stored); this.changed()
    return () => { if (this.templates.get(name) === stored) { this.templates.delete(name); if (!this.disposed) this.changed() } }
  }

  /** Every kind this layer accepts: the three it paints itself, then each template by name. */
  listKinds (): readonly string[] { return Object.freeze([...KINDS, ...this.templates.keys()]) }

  setAnnotations (layer: string, specs: readonly EngineAnnotationSpec[], options: { symbol?: string } = {}): EngineSetAnnotationsResult {
    this.assertLive()
    named(layer, ENGINE_ANNOTATION_LIMITS.keyLength, 'layer')
    if (!Array.isArray(specs) || specs.length > ENGINE_ANNOTATION_LIMITS.entriesPerLayer) throw new RangeError('Annotation layer document exceeds its bound')
    const requested = options.symbol === undefined ? this.symbol : scope(options.symbol)
    const keyOf = (spec: EngineAnnotationSpec): string => spec !== null && typeof spec === 'object' && typeof spec.key === 'string' ? spec.key : ''
    if (this.symbol === null || requested !== this.symbol) return result([], specs.map(spec => ({ key: keyOf(spec), code: 'symbol_mismatch' })))
    const priorLayers = this.scopes.get(this.symbol)
    const old = priorLayers?.get(layer) ?? EMPTY_SPECS
    const priorByKey = new Map(old.map(spec => [spec.key, spec]))
    const seen = new Set<string>(), next: EngineAnnotationSpec[] = [], applied: string[] = [], rejected: EngineAnnotationRejection[] = []
    for (const value of specs) {
      const key = keyOf(value)
      if (seen.has(key)) { rejected.push({ key, code: 'duplicate_key' }); continue }
      seen.add(key)
      const copied = copiedSpec(value, this.templates)
      if ('code' in copied) { rejected.push({ key, code: copied.code }); continue }
      const previous = priorByKey.get(key)
      next.push(previous !== undefined && sameSpec(previous, copied.spec) ? previous : copied.spec)
      applied.push(annotationId(layer, key))
    }
    if (old.length === next.length && old.every((spec, i) => spec === next[i])) return result(applied, rejected)
    if (next.length > 0) {
      if (priorLayers === undefined && this.scopes.size >= ENGINE_ANNOTATION_LIMITS.scopes) throw new RangeError('Annotation scope limit reached; clear an unused scope')
      if (!priorLayers?.has(layer) && (priorLayers?.size ?? 0) >= ENGINE_ANNOTATION_LIMITS.layersPerScope) throw new RangeError('Annotation layer limit reached')
      let count = next.length
      for (const [name, entries] of priorLayers ?? []) if (name !== layer) count += entries.length
      if (count > ENGINE_ANNOTATION_LIMITS.entriesPerScope) throw new RangeError('Annotation scope entry limit reached')
      const layers = priorLayers ?? new Map<string, readonly EngineAnnotationSpec[]>()
      layers.set(layer, Object.freeze(next)); this.scopes.set(this.symbol, layers)
    } else if (priorLayers !== undefined) {
      priorLayers.delete(layer)
      if (priorLayers.size === 0) this.scopes.delete(this.symbol)
    }
    this.changed()
    return result(applied, rejected)
  }

  getAnnotations (layer?: string): readonly EngineAnnotationSpec[] {
    if (layer !== undefined) named(layer, ENGINE_ANNOTATION_LIMITS.keyLength, 'layer')
    const layers = this.symbol === null ? undefined : this.scopes.get(this.symbol)
    return layer === undefined ? Object.freeze([...(layers?.values() ?? [])].flat()) : layers?.get(layer) ?? EMPTY_SPECS
  }

  clearAnnotations (layer: string): void {
    this.assertLive(); named(layer, ENGINE_ANNOTATION_LIMITS.keyLength, 'layer')
    const layers = this.symbol === null ? undefined : this.scopes.get(this.symbol)
    if (layers === undefined || !layers.delete(layer)) return
    if (layers.size === 0) this.scopes.delete(this.symbol!)
    this.changed()
  }

  /** Releases retained layers for one symbol without evicting any other symbol. */
  clearScope (symbol: string | null = this.symbol): void {
    this.assertLive()
    const key = scope(symbol)
    if (key === null || !this.scopes.delete(key)) return
    if (key === this.symbol) this.changed()
  }

  readonly getSnapshot = (): EngineAnnotationSnapshot => this.snapshot

  update (frame: EngineFrame): void {
    if (this.disposed) return
    this.frame = this.symbol === null ? null : frame
    this.project()
  }

  /** Shapes on the main canvas: bands, dashed lines and markers. Their words come later, above every line. */
  paint (context: CanvasRenderingContext2D): void {
    const { bounds, annotations } = this.snapshot
    if (this.disposed || bounds === null || !annotations.some(item => item.status === 'visible')) return
    context.save()
    try {
      context.globalCompositeOperation = 'source-over'; context.globalAlpha = 1
      context.beginPath(); context.rect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top); context.clip()
      context.lineWidth = 1.5
      for (const annotation of annotations) {
        if (annotation.status !== 'visible') continue
        this.applyTone(context, annotation)
        const emphasised = this.isEmphasised(annotation)
        if (emphasised) { context.shadowColor = colors(this.currentTheme).violet; context.shadowBlur = 10; context.lineWidth = 3 }
        // The assistant's marks are dashed, so they never pass for the person's own drawings.
        context.setLineDash([4, 3])
        if (annotation.figures !== undefined) {
          this.paintFigures(context, annotation, bounds, emphasised)
        } else if (annotation.spec.kind === 'level' && annotation.point !== undefined) {
          const y = Math.round(annotation.point.y) + 0.5
          context.beginPath(); context.moveTo(bounds.left, y); context.lineTo(bounds.right, y); context.stroke()
        } else if (annotation.spec.kind === 'zone' && annotation.rect !== undefined) {
          const rect = annotation.rect
          if (annotation.spec.color === undefined) context.fillStyle = zoneFill(annotation.spec, this.currentTheme)
          else context.globalAlpha = 0.12
          context.fillRect(rect.x, rect.y, rect.width, rect.height); context.globalAlpha = 1
          context.lineWidth = 1; context.strokeRect(Math.round(rect.x) + 0.5, Math.round(rect.y) + 0.5, Math.round(rect.width), Math.round(rect.height)); context.lineWidth = 1.5
        } else if (annotation.point !== undefined) {
          context.fillStyle = context.strokeStyle; diamond(context, annotation.point.x, annotation.point.y, emphasised ? 7 : 4.5)
        }
        if (emphasised) { context.shadowBlur = 0; context.shadowColor = 'transparent'; context.lineWidth = 1.5 }
      }
      this.paintRange(context, bounds)
      const ghost = this.ghost, source = ghost === null ? undefined : annotations.find(item => item.id === ghost.id)
      if (ghost !== null && source !== undefined) {
        const projected = this.frame?.project(source.spec.anchors[0].time, ghost.price)
        if (projected != null && Number.isFinite(projected.y)) {
          this.applyTone(context, source); context.globalAlpha = 0.9; context.setLineDash([2, 3]); context.lineWidth = 1.5
          const y = Math.round(projected.y) + 0.5
          context.beginPath(); context.moveTo(bounds.left, y); context.lineTo(bounds.right, y); context.stroke()
        }
      }
    } finally { context.restore() }
  }

  /** The shaded stretch a sentence points at, over the marks and under their words. */
  private paintRange (context: CanvasRenderingContext2D, bounds: EngineAnnotationBounds): void {
    const range = this.range, frame = this.frame
    if (range === null || frame === null) return
    const anchorPrice = range.high ?? frame.snapshot.bars[frame.snapshot.bars.length - 1]?.close
    if (anchorPrice === undefined) return
    const a = frame.project(range.from, anchorPrice), b = frame.project(range.to, range.low ?? anchorPrice)
    if (a === null || b === null || ![a.x, a.y, b.x, b.y].every(Number.isFinite)) return
    const left = Math.max(bounds.left, Math.min(a.x, b.x)), right = Math.min(bounds.right, Math.max(a.x, b.x))
    const top = range.low === undefined ? bounds.top : Math.max(bounds.top, Math.min(a.y, b.y))
    const bottom = range.low === undefined ? bounds.bottom : Math.min(bounds.bottom, Math.max(a.y, b.y))
    if (right < left || bottom < top) return
    const color = colors(this.currentTheme).violet
    context.save()
    try {
      context.fillStyle = color; context.strokeStyle = color; context.setLineDash([]); context.shadowColor = color; context.shadowBlur = 8
      context.globalAlpha = 0.14; context.fillRect(left, top, Math.max(1, right - left), bottom - top)
      context.globalAlpha = 0.9; context.lineWidth = 1.5; context.strokeRect(Math.round(left) + 0.5, Math.round(top) + 0.5, Math.max(1, Math.round(right - left)), Math.round(bottom - top))
    } finally { context.restore() }
  }

  /**
   * Words on the drawing canvas, after the person's drawings, so no line ever crosses them:
   * the label chips, and each level's and zone edge's exact price on the axis.
   */
  paintLabels (context: CanvasRenderingContext2D): void {
    const { bounds, annotations } = this.snapshot
    if (this.disposed || bounds === null || !annotations.some(item => item.status === 'visible')) return
    const palette = colors(this.currentTheme)
    const tags: Array<{ y: number, price: number, color: string }> = []
    context.save()
    try {
      context.globalCompositeOperation = 'source-over'; context.globalAlpha = 1
      context.beginPath(); context.rect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top); context.clip()
      context.font = this.font; context.textAlign = 'left'; context.textBaseline = 'middle'; context.setLineDash([])
      for (const annotation of annotations) {
        if (annotation.status !== 'visible') continue
        const tone = this.applyTone(context, annotation)
        if (annotation.figures !== undefined) {
          this.paintFigureText(context, annotation, bounds, palette)
          for (const index of this.templates.get(annotation.spec.kind)?.axisTags ?? []) {
            const point = annotation.spec.anchors[index], projected = point === undefined ? null : this.frame?.project(point.time, point.price!)
            if (point !== undefined && projected != null && Number.isFinite(projected.y)) tags.push({ y: projected.y, price: point.price!, color: tone })
          }
          continue
        }
        if (annotation.spec.kind !== 'marker') {
          for (const point of annotation.spec.kind === 'zone' ? annotation.spec.anchors : annotation.spec.anchors.slice(0, 1)) {
            const price = point.price
            if (price === undefined) continue
            const projected = this.frame?.project(point.time, price)
            if (projected != null && Number.isFinite(projected.y)) tags.push({ y: projected.y, price, color: tone })
          }
        }
        // A label never sits over a price other than the one it names: it is centred on its
        // line, inside or centred on its band, or level with its marker.
        let anchor: { x: number, y: number, side: 'left' | 'right' } | null = null
        if (annotation.spec.kind === 'level' && annotation.point !== undefined) {
          // Left end, so the newest bars on the right stay uncovered; the line runs into the chip.
          anchor = { x: bounds.left + 8, y: Math.round(annotation.point.y) + 0.5, side: 'left' }
        } else if (annotation.spec.kind === 'zone' && annotation.rect !== undefined) {
          anchor = { x: annotation.rect.x + 6, y: annotation.rect.y + annotation.rect.height / 2, side: 'left' }
        } else if (annotation.point !== undefined) {
          anchor = { x: annotation.point.x - 10, y: annotation.point.y, side: 'right' }
        }
        const text = annotation.spec.text
        if (anchor === null || text === undefined || text === '') continue
        // Label chip: violet tint, the assistant's diamond, ink text.
        const width = Math.min(Math.max(1, bounds.right - bounds.left - 8), context.measureText(text).width + 27)
        let left = anchor.side === 'right' ? anchor.x - width : anchor.x
        let top = anchor.y - 9
        if (left < bounds.left + 4 && anchor.side === 'right' && annotation.spec.kind === 'marker') left = anchor.x + 20
        const rect = annotation.spec.kind === 'zone' ? annotation.rect : undefined
        if (rect !== undefined) {
          // Inside the band's top-left when it fits. Otherwise beside the band, left first, centred
          // on its height: at the band's own prices, and never covering the band it names.
          if (width <= rect.width - 12 && rect.height >= 30) top = rect.y + 6
          else left = rect.x - width - 6 >= bounds.left + 4 ? rect.x - width - 6 : rect.x + rect.width + 6
        }
        left = Math.max(bounds.left + 4, Math.min(left, bounds.right - width - 4))
        top = Math.max(bounds.top + 2, Math.min(top, bounds.bottom - 20))
        context.fillStyle = palette.violetTint; context.fillRect(left, top, width, 18)
        if (this.isEmphasised(annotation)) { context.strokeStyle = tone; context.lineWidth = 1.5; context.strokeRect(left + 0.5, top + 0.5, width - 1, 17) }
        context.fillStyle = palette.violet; diamond(context, left + 10, top + 9, 3)
        context.fillStyle = palette.ink; context.fillText(text, left + 19, top + 9.5, width - 25)
      }
    } finally { context.restore() }
    // Each level's price and each zone's top and bottom on the price axis. A tag sits at its
    // exact y; when that spot is taken (the last-price tag, another mark) it moves the least
    // distance needed and a connector runs from the tag to the exact price at the plot edge.
    const strip = this.frame === null ? null : axisStrip(this.frame.model.geometry)
    if (tags.length === 0 || strip === null || strip.width < 36) return
    const bars = this.frame?.snapshot.bars ?? []
    const digits = this.pricePrecision ?? derivePrecision(bars)
    const taken: number[] = []
    const lastBar = bars[bars.length - 1]
    if (lastBar !== undefined && this.frame !== null) {
      const lastY = Math.round(this.frame.model.y(lastBar.close))
      if (Number.isFinite(lastY) && lastY >= bounds.top && lastY <= bounds.bottom) taken.push(lastY)
    }
    // Tags keep 25px apart, so each can clear the axis 15px either side of itself: a grid price
    // label is then fully hidden rather than half covered, and the last-price tag is never touched.
    const free = (y: number): boolean => taken.every(other => Math.abs(other - y) >= 25)
    const placed: Array<{ tag: typeof tags[number], y: number, exact: number }> = []
    for (const tag of [...tags].sort((a, b) => a.y - b.y)) {
      if (tag.y < bounds.top || tag.y > bounds.bottom) continue
      const exact = Math.round(tag.y)
      let y = exact
      for (let step = 1; !free(y) && step <= 400; step++) {
        if (free(exact + step) && exact + step <= bounds.bottom) { y = exact + step; break }
        if (free(exact - step) && exact - step >= bounds.top) { y = exact - step; break }
      }
      taken.push(y); placed.push({ tag, y, exact })
    }
    context.save()
    try {
      context.font = CANVAS_FONT; context.textAlign = strip.align; context.textBaseline = 'middle'; context.setLineDash([]); context.lineWidth = 1
      context.fillStyle = palette.surface
      // `into` points from the strip toward the plot, so the connector leans the same way on either side.
      const into = strip.side === 'right' ? -1 : 1
      for (const { y } of placed) context.fillRect(strip.from, y - 15, strip.width, 30)
      for (const { tag, y, exact } of placed) {
        context.fillStyle = palette.surface; context.fillRect(strip.from + 2, y - 9, strip.width - 4, 18)
        context.strokeStyle = tag.color; context.strokeRect(strip.from + 2.5, y - 8.5, strip.width - 5, 17)
        if (y !== exact) {
          context.beginPath(); context.moveTo(strip.inner - into * 2, y); context.lineTo(strip.inner + into * 4, exact + 0.5); context.stroke()
        }
        context.fillStyle = tag.color; context.fillText(tag.price.toFixed(digits), strip.textX, y, Math.max(1, strip.width - 10))
      }
    } finally { context.restore() }
  }

  /** Sets the mark's tone on fill and stroke; a malformed host colour falls back to the tone, never another mark's. */
  private applyTone (context: CanvasRenderingContext2D, annotation: EngineProjectedAnnotation): string {
    // Canvas rejects unsupported CSS colors by keeping its previous value: reset to the tone first.
    const fallback = resolveColor({ ...annotation.spec, color: undefined }, this.currentTheme)
    context.fillStyle = fallback; context.strokeStyle = fallback
    context.fillStyle = annotation.color; context.strokeStyle = annotation.color
    context.globalAlpha = 1
    return String(context.strokeStyle)
  }

  dispose (): void {
    if (this.disposed) return
    this.disposed = true; this.scopes.clear(); this.frame = null; this.symbol = null
    this.project()
  }

  /**
   * Draws the marks with these keys bolder and with a glow, so a sentence can point at them. `layer` limits it to one layer;
   * without it a key matches in every layer. Pass null to return to normal. It never changes a spec.
   */
  setEmphasis (keys: readonly string[] | null, layer?: string): void {
    this.assertLive()
    if (layer !== undefined) named(layer, ENGINE_ANNOTATION_LIMITS.keyLength, 'layer')
    const next = keys === null || keys.length === 0 ? null : { keys: new Set(keys.slice(0, ENGINE_ANNOTATION_LIMITS.entriesPerScope).filter(key => typeof key === 'string')), layer }
    const same = next === null ? this.emphasis === null : this.emphasis !== null && this.emphasis.layer === next.layer && this.emphasis.keys.size === next.keys.size && [...next.keys].every(key => this.emphasis?.keys.has(key) === true)
    if (same) return
    this.emphasis = next; this.onChange?.()
  }

  /** Shades a stretch of time (and of price, when `low` and `high` are given) without storing an annotation. Pass null to remove it. */
  setRangeHighlight (range: EngineAnnotationRange | null): void {
    this.assertLive()
    if (range !== null && !(Number.isFinite(range.from) && Number.isFinite(range.to) && range.from <= range.to && (range.low === undefined) === (range.high === undefined) && (range.low === undefined || (Number.isFinite(range.low) && Number.isFinite(range.high!) && range.low <= range.high!)))) throw new RangeError('Invalid annotation range')
    const same = range === null ? this.range === null : this.range !== null && this.range.from === range.from && this.range.to === range.to && this.range.low === range.low && this.range.high === range.high
    if (same) return
    this.range = range === null ? null : Object.freeze({ ...range }); this.onChange?.()
  }

  /** Where the mark with this key sits in time and price, and whether the current view shows it; null when there is no such mark. */
  getAnnotationSpan (key: string, layer?: string): EngineAnnotationSpan | null {
    if (this.disposed) return null
    const found = this.snapshot.annotations.find(item => item.spec.key === key && (layer === undefined || item.layer === layer))
    if (found === undefined) return null
    const times = found.spec.anchors.map(anchor => anchor.time)
    const prices = found.spec.anchors.map(anchor => anchor.price).filter((price): price is number => price !== undefined)
    const span = { from: Math.min(...times), to: Math.max(...times), status: found.status }
    return Object.freeze(prices.length === found.spec.anchors.length ? { ...span, low: Math.min(...prices), high: Math.max(...prices) } : span)
  }

  private isEmphasised (annotation: EngineProjectedAnnotation): boolean {
    const emphasis = this.emphasis
    return emphasis !== null && emphasis.keys.has(annotation.spec.key) && (emphasis.layer === undefined || emphasis.layer === annotation.layer)
  }

  /** The nearest visible draggable level within `tolerance` px of `y`, for pointer code that turns a drag into intent. */
  hitTestDraggable (y: number, tolerance = 6): { readonly id: string, readonly layer: string, readonly key: string, readonly price: number, readonly time: number } | null {
    if (this.disposed || !Number.isFinite(y)) return null
    let best: { id: string, layer: string, key: string, price: number, time: number } | null = null, distance = tolerance
    for (const item of this.snapshot.annotations) {
      if (item.status !== 'visible' || item.spec.draggable !== true || item.point === undefined) continue
      const gap = Math.abs(item.point.y - y)
      if (gap <= distance) { distance = gap; best = { id: item.id, layer: item.layer, key: item.spec.key, price: item.spec.anchors[0].price!, time: item.spec.anchors[0].time } }
    }
    return best === null ? null : Object.freeze(best)
  }

  /** The price at a pane y position under the current scale, or null before a frame exists. */
  priceAt (y: number): number | null {
    const frame = this.frame, bounds = this.snapshot.bounds
    if (this.disposed || frame === null || bounds === null || !Number.isFinite(y)) return null
    const anchor = frame.unproject(bounds.left, Math.max(bounds.top, Math.min(bounds.bottom, y)))
    return anchor !== null && Number.isFinite(anchor.price) ? anchor.price : null
  }

  /** Paints a ghost of a draggable level at `price` while the host decides; pass null to remove it. Never changes the spec. */
  setGhost (id: string | null, price?: number): void {
    this.assertLive()
    const next = id === null || price === undefined || !Number.isFinite(price) ? null : { id, price }
    if (this.ghost?.id === next?.id && this.ghost?.price === next?.price) return
    this.ghost = next; this.onChange?.()
  }

  private projectTemplate (frame: EngineFrame, bounds: EngineAnnotationBounds, base: Omit<EngineProjectedAnnotation, 'status'>, spec: EngineAnnotationSpec): EngineProjectedAnnotation {
    const template = this.templates.get(spec.kind)
    const fail = (): EngineProjectedAnnotation => Object.freeze({ ...base, status: 'unprojectable' })
    if (template === undefined) return fail()
    const finite = (point: { x: number, y: number } | null | undefined): point is { x: number, y: number } => point != null && Number.isFinite(point.x) && Number.isFinite(point.y)
    const anchors = []
    for (let i = 0; i < template.anchors; i++) {
      const anchor = spec.anchors[i], projected = frame.project(anchor.time, anchor.price!)
      if (!finite(projected)) return fail()
      anchors.push(Object.freeze({ time: anchor.time, price: anchor.price!, x: projected.x, y: projected.y }))
    }
    const digits = this.pricePrecision ?? derivePrecision(frame.snapshot.bars)
    let figures: readonly AnnotationFigure[] | null
    try {
      figures = sanitizeFigures(template.create({
        anchors: Object.freeze(anchors),
        bounds,
        params: spec.params ?? EMPTY_PARAMS,
        text: spec.text,
        tone: spec.tone ?? 'neutral',
        color: base.color,
        project: (time, price) => { const point = frame.project(time, price); return finite(point) ? { x: point.x, y: point.y } : null },
        formatPrice: price => price.toFixed(digits)
      }))
    } catch { return fail() }
    if (figures === null) return fail()
    const visible = figures.some(figure => figureTouches(figure, bounds))
    return Object.freeze({ ...base, status: visible ? 'visible' : 'offscreen', ...(visible ? { figures } : {}) })
  }

  private paintFigures (context: CanvasRenderingContext2D, annotation: EngineProjectedAnnotation, bounds: EngineAnnotationBounds, emphasised = false): void {
    for (const figure of annotation.figures ?? []) {
      if (figure.type === 'text') continue
      this.figureColor(context, figure.color, figure.tone, annotation)
      context.setLineDash(figure.dash === undefined ? [4, 3] : figure.dash === 'solid' ? [] : [...figure.dash]); context.lineWidth = (figure.width ?? 1.5) + (emphasised ? 1.5 : 0)
      if (figure.type === 'line') {
        let { from, to } = figure
        const dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy)
        if (length === 0) continue
        const reach = 2 * Math.hypot(bounds.right - bounds.left, bounds.bottom - bounds.top) / length
        if (figure.extend === 'right' || figure.extend === 'both') to = { x: to.x + dx * reach, y: to.y + dy * reach }
        if (figure.extend === 'both') from = { x: from.x - dx * reach, y: from.y - dy * reach }
        context.beginPath(); context.moveTo(from.x, from.y); context.lineTo(to.x, to.y); context.stroke()
      } else if (figure.type === 'marker') {
        const size = figure.size ?? 4.5
        context.beginPath()
        if (figure.shape === 'circle') context.arc(figure.x, figure.y, size, 0, Math.PI * 2)
        else if (figure.shape === 'triangle-up') { context.moveTo(figure.x, figure.y - size); context.lineTo(figure.x + size, figure.y + size); context.lineTo(figure.x - size, figure.y + size); context.closePath() }
        else if (figure.shape === 'triangle-down') { context.moveTo(figure.x, figure.y + size); context.lineTo(figure.x + size, figure.y - size); context.lineTo(figure.x - size, figure.y - size); context.closePath() }
        else { context.moveTo(figure.x, figure.y - size); context.lineTo(figure.x + size, figure.y); context.lineTo(figure.x, figure.y + size); context.lineTo(figure.x - size, figure.y); context.closePath() }
        context.setLineDash([]); context.fill()
      } else {
        context.beginPath()
        if (figure.type === 'rect') context.rect(figure.x, figure.y, figure.width, figure.height)
        else {
          figure.points.forEach((point, index) => { if (index === 0) context.moveTo(point.x, point.y); else context.lineTo(point.x, point.y) })
          if (figure.closed === true || (figure.fillOpacity ?? 0) > 0) context.closePath()
        }
        if ((figure.fillOpacity ?? 0) > 0) { context.globalAlpha = figure.fillOpacity!; context.fill(); context.globalAlpha = 1 }
        if (figure.stroke !== false) context.stroke()
      }
    }
  }

  private paintFigureText (context: CanvasRenderingContext2D, annotation: EngineProjectedAnnotation, bounds: EngineAnnotationBounds, palette: ReturnType<typeof colors>): void {
    for (const figure of annotation.figures ?? []) {
      if (figure.type !== 'text') continue
      const tone = this.figureColor(context, figure.color, undefined, annotation)
      const width = Math.min(Math.max(1, bounds.right - bounds.left - 8), context.measureText(figure.text).width + 12)
      let left = figure.align === 'right' ? figure.x - width : figure.align === 'center' ? figure.x - width / 2 : figure.x
      left = Math.max(bounds.left + 4, Math.min(left, bounds.right - width - 4))
      const top = Math.max(bounds.top + 2, Math.min(figure.y - 8, bounds.bottom - 18))
      context.globalAlpha = 0.88; context.fillStyle = palette.surface; context.fillRect(left, top, width, 16); context.globalAlpha = 1
      context.lineWidth = 1; context.strokeStyle = tone; context.strokeRect(left + 0.5, top + 0.5, width - 1, 15)
      context.fillStyle = palette.ink; context.fillText(figure.text, left + 6, top + 8.5, width - 10)
    }
  }

  /** A figure's own colour or tone, else the annotation's; a malformed value keeps the annotation's colour. */
  private figureColor (context: CanvasRenderingContext2D, color: string | undefined, tone: EngineAnnotationTone | undefined, annotation: EngineProjectedAnnotation): string {
    const base = annotation.color
    context.fillStyle = base; context.strokeStyle = base
    const wanted = color ?? (tone !== undefined ? resolveColor({ ...annotation.spec, tone, color: undefined }, this.currentTheme) : undefined)
    if (wanted !== undefined) { context.fillStyle = wanted; context.strokeStyle = wanted }
    context.globalAlpha = 1
    return String(context.strokeStyle)
  }

  private assertLive (): void { if (this.disposed) throw new Error('Annotations have been disposed') }
  private changed (): void { this.project(); this.onChange?.() }
  private project (): void {
    const frame = this.frame, geometry = frame?.model.geometry
    const usable = geometry !== undefined && [geometry.left, geometry.right, geometry.top, geometry.bottom].every(Number.isFinite) && geometry.right > geometry.left && geometry.bottom > geometry.top
    const bounds = usable ? Object.freeze({ left: geometry.left, right: geometry.right, top: geometry.top, bottom: geometry.bottom }) : null
    const annotations: EngineProjectedAnnotation[] = []
    const layers = this.symbol === null ? undefined : this.scopes.get(this.symbol)
    for (const [layer, specs] of layers ?? []) { for (const spec of specs) {
      const base = { id: annotationId(layer, spec.key), layer, spec, color: resolveColor(spec, this.currentTheme) }
      if (frame === null || bounds === null || frame.snapshot.bars.length === 0) { annotations.push(Object.freeze({ ...base, status: 'no-data' })); continue }
      if (!KINDS.includes(spec.kind)) { annotations.push(this.projectTemplate(frame, bounds, base, spec)); continue }
      const a = frame.project(spec.anchors[0].time, spec.anchors[0].price!)
      const b = spec.kind === 'zone' ? frame.project(spec.anchors[1].time, spec.anchors[1].price!) : a
      if (a === null || b === null || ![a.x, a.y, b.x, b.y].every(Number.isFinite)) { annotations.push(Object.freeze({ ...base, status: 'unprojectable' })); continue }
      if (spec.kind === 'zone') {
        const left = Math.max(bounds.left, Math.min(a.x, b.x)), right = Math.min(bounds.right, Math.max(a.x, b.x))
        const top = Math.max(bounds.top, Math.min(a.y, b.y)), bottom = Math.min(bounds.bottom, Math.max(a.y, b.y))
        annotations.push(Object.freeze({
          ...base,
          status: right >= left && bottom >= top ? 'visible' : 'offscreen',
          ...(right >= left && bottom >= top ? { rect: Object.freeze({ x: left, y: top, width: right - left, height: bottom - top }) } : {})
        }))
      } else {
        const visible = a.y >= bounds.top && a.y <= bounds.bottom && (spec.kind === 'level' || (a.x >= bounds.left && a.x <= bounds.right))
        annotations.push(Object.freeze({ ...base, status: visible ? 'visible' : 'offscreen', ...(visible ? { point: Object.freeze({ x: a.x, y: a.y }) } : {}) }))
      }
    } }
    this.snapshot = Object.freeze({ version: ++this.version, symbol: this.symbol, bounds, annotations: Object.freeze(annotations) })
  }
}
