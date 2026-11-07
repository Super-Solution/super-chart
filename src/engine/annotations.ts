import type { EngineFrame } from './frame'
import type { EngineLayer } from './layer'
import { CANVAS_PALETTE } from '../theme/tokens'

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
  const palette = CANVAS_PALETTE[currentTheme]
  return spec.tone === 'bull' ? palette.up : spec.tone === 'bear' ? palette.down : spec.tone === 'accent' ? palette.accent : palette.textSecond
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
  private symbol: string | null
  private currentTheme: EngineAnnotationTheme
  private frame: EngineFrame | null = null
  private version = 0
  private disposed = false
  private snapshot: EngineAnnotationSnapshot

  constructor (options: EngineAnnotationsOptions) {
    this.symbol = scope(options.symbol)
    this.currentTheme = theme(options.theme ?? 'dark')
    this.font = options.font === undefined ? '12px system-ui' : named(options.font, 256, 'font')
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

  paint (context: CanvasRenderingContext2D): void {
    const { bounds, annotations } = this.snapshot
    if (this.disposed || bounds === null || !annotations.some(item => item.status === 'visible')) return
    context.save()
    try {
      context.globalCompositeOperation = 'source-over'; context.globalAlpha = 1
      context.beginPath(); context.rect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top); context.clip()
      context.font = this.font; context.textAlign = 'left'; context.textBaseline = 'bottom'; context.lineWidth = 1
      for (const annotation of annotations) {
        if (annotation.status !== 'visible') continue
        // Canvas rejects unsupported CSS colors by keeping its previous value.
        // Reset first so a malformed host color can never inherit another layer's tone.
        const fallback = resolveColor({ ...annotation.spec, color: undefined }, this.currentTheme)
        context.fillStyle = fallback; context.strokeStyle = fallback
        context.fillStyle = annotation.color; context.strokeStyle = annotation.color
        context.globalAlpha = 1; context.setLineDash([])
        let labelX = bounds.left + 4, labelY = bounds.top + 16
        if (annotation.spec.kind === 'level' && annotation.point !== undefined) {
          context.setLineDash([5, 4]); context.beginPath(); context.moveTo(bounds.left, annotation.point.y); context.lineTo(bounds.right, annotation.point.y); context.stroke()
          labelY = Math.max(bounds.top + 16, annotation.point.y - 3)
        } else if (annotation.spec.kind === 'zone' && annotation.rect !== undefined) {
          const rect = annotation.rect
          context.globalAlpha = 0.14; context.fillRect(rect.x, rect.y, rect.width, rect.height)
          context.globalAlpha = 0.8; context.strokeRect(rect.x, rect.y, rect.width, rect.height); context.globalAlpha = 1
          labelX = rect.x + 4; labelY = Math.max(bounds.top + 16, rect.y + 16)
        } else if (annotation.point !== undefined) {
          const p = annotation.point
          context.beginPath(); context.moveTo(p.x, p.y - 4); context.lineTo(p.x + 4, p.y); context.lineTo(p.x, p.y + 4); context.lineTo(p.x - 4, p.y); context.closePath(); context.fill()
          labelX = p.x + 7; labelY = Math.max(bounds.top + 16, p.y - 6)
        }
        if (annotation.spec.text !== undefined && annotation.spec.text !== '') {
          const maxWidth = Math.max(1, bounds.right - bounds.left - 8)
          const width = Math.min(maxWidth, context.measureText(annotation.spec.text).width)
          labelX = Math.max(bounds.left + 4, Math.min(labelX, bounds.right - width - 4))
          context.fillText(annotation.spec.text, labelX, Math.min(bounds.bottom - 2, labelY), maxWidth)
        }
      }
    } finally { context.restore() }
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
