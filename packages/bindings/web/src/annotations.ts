import type { EngineFrame } from '@supersolutions/super-chart-core'
import type { EngineLayer } from './layer'
import { derivePrecision } from '@supersolutions/super-chart-core'
import { colors, CANVAS_FONT, CANVAS_LABEL_FONT } from './tokens'

export type EngineAnnotationTone = 'bull' | 'bear' | 'neutral' | 'accent'
export type EngineAnnotationKind = 'level' | 'zone' | 'marker'
export type EngineAnnotationTheme = 'light' | 'dark'
export interface EngineAnnotationAnchor { readonly time: number, readonly price?: number }
export interface EngineAnnotationSpec {
  readonly key: string
  readonly kind: EngineAnnotationKind
  readonly anchors: readonly EngineAnnotationAnchor[]
  readonly text?: string
  readonly tone?: EngineAnnotationTone
  readonly color?: string
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
}
export interface EngineAnnotationSnapshot {
  readonly version: number
  readonly symbol: string | null
  readonly bounds: EngineAnnotationBounds | null
  readonly annotations: readonly EngineProjectedAnnotation[]
}
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
const KINDS: readonly EngineAnnotationKind[] = ['level', 'zone', 'marker']
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
  if (value !== 'light' && value !== 'dark') throw new TypeError('Invalid annotation theme')
  return value
}
function annotationId (layer: string, key: string): string {
  // Escape each part separately; a colon in a host key cannot collide with another layer.
  return `sc:ann:${encodeURIComponent(layer)}:${encodeURIComponent(key)}`
}
function copiedSpec (value: EngineAnnotationSpec): { spec: EngineAnnotationSpec } | { code: EngineAnnotationRejectCode } {
  if (value === null || typeof value !== 'object') return { code: 'bad_anchor' }
  if (typeof value.key !== 'string' || value.key.trim().length === 0 || value.key.length > ENGINE_ANNOTATION_LIMITS.keyLength) return { code: 'bad_key' }
  if (!KINDS.includes(value.kind)) return { code: 'unknown_kind' }
  const count = value.kind === 'zone' ? 2 : 1
  if (!Array.isArray(value.anchors) || value.anchors.length < count) return { code: 'bad_anchor' }
  const anchors: EngineAnnotationAnchor[] = []
  for (let i = 0; i < count; i++) {
    const anchor = value.anchors[i]
    if (anchor === null || typeof anchor !== 'object' || typeof anchor.time !== 'number' || !Number.isFinite(anchor.time) || typeof anchor.price !== 'number') return { code: 'bad_anchor' }
    if (Math.abs(anchor.time) > 8.64e15 || !Number.isFinite(anchor.price)) return { code: 'out_of_range' }
    anchors.push(Object.freeze({ time: anchor.time, price: anchor.price }))
  }
  if (count === 2 && anchors[0].time === anchors[1].time && anchors[0].price === anchors[1].price) return { code: 'out_of_range' }
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
      ...(value.color !== undefined ? { color: value.color } : {})
    })
  }
}
function sameSpec (a: EngineAnnotationSpec, b: EngineAnnotationSpec): boolean {
  return a.key === b.key && a.kind === b.kind && a.text === b.text && a.tone === b.tone && a.color === b.color &&
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
  private readonly onChange: (() => void) | undefined
  private readonly font: string
  private readonly pricePrecision: number | undefined
  private symbol: string | null
  private currentTheme: EngineAnnotationTheme
  private frame: EngineFrame | null = null
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

  setTheme (value: EngineAnnotationTheme): void {
    this.assertLive()
    const next = theme(value)
    if (next === this.currentTheme) return
    this.currentTheme = next; this.changed()
  }

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
      const copied = copiedSpec(value)
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
        // The assistant's marks are dashed, so they never pass for the person's own drawings.
        context.setLineDash([4, 3])
        if (annotation.spec.kind === 'level' && annotation.point !== undefined) {
          const y = Math.round(annotation.point.y) + 0.5
          context.beginPath(); context.moveTo(bounds.left, y); context.lineTo(bounds.right, y); context.stroke()
        } else if (annotation.spec.kind === 'zone' && annotation.rect !== undefined) {
          const rect = annotation.rect
          if (annotation.spec.color === undefined) context.fillStyle = zoneFill(annotation.spec, this.currentTheme)
          else context.globalAlpha = 0.12
          context.fillRect(rect.x, rect.y, rect.width, rect.height); context.globalAlpha = 1
          context.lineWidth = 1; context.strokeRect(Math.round(rect.x) + 0.5, Math.round(rect.y) + 0.5, Math.round(rect.width), Math.round(rect.height)); context.lineWidth = 1.5
        } else if (annotation.point !== undefined) {
          context.fillStyle = context.strokeStyle; diamond(context, annotation.point.x, annotation.point.y, 4.5)
        }
      }
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
        context.fillStyle = palette.violet; diamond(context, left + 10, top + 9, 3)
        context.fillStyle = palette.ink; context.fillText(text, left + 19, top + 9.5, width - 25)
      }
    } finally { context.restore() }
    // Each level's price and each zone's top and bottom on the price axis. A tag sits at its
    // exact y; when that spot is taken (the last-price tag, another mark) it moves the least
    // distance needed and a connector runs from the tag to the exact price at the plot edge.
    if (tags.length === 0 || bounds.left < 36) return
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
      context.font = CANVAS_FONT; context.textAlign = 'right'; context.textBaseline = 'middle'; context.setLineDash([]); context.lineWidth = 1
      context.fillStyle = palette.surface
      for (const { y } of placed) context.fillRect(0, y - 15, bounds.left, 30)
      for (const { tag, y, exact } of placed) {
        context.fillStyle = palette.surface; context.fillRect(2, y - 9, bounds.left - 4, 18)
        context.strokeStyle = tag.color; context.strokeRect(2.5, y - 8.5, bounds.left - 5, 17)
        if (y !== exact) {
          context.beginPath(); context.moveTo(bounds.left - 2, y); context.lineTo(bounds.left + 4, exact + 0.5); context.stroke()
        }
        context.fillStyle = tag.color; context.fillText(tag.price.toFixed(digits), bounds.left - 6, y, Math.max(1, bounds.left - 10))
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
