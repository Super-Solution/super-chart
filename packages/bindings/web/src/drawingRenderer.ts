import type { DrawingBounds, DrawingGeometry } from '@supersolutions/super-chart-core'
import type { DrawingImageRenderer } from './drawingMedia'
import { colors, CANVAS_LABEL_FONT, type ThemeName } from './tokens'

export interface DrawingRenderOptions {
  /** Picks the default colours: your drawings are ink; selection shows handles, never a new colour. */
  theme?: ThemeName
  color?: string
  selectedColor?: string
  fillColor?: string
  /** Zero keeps only outlines; selection still targets the complete shape. */
  fillOpacity?: number
  handleFill?: string
  font?: string
  lineWidth?: number
  handleRadius?: number
  bounds?: DrawingBounds
  formatPrice?: (price: number) => string
  imageRenderer?: DrawingImageRenderer
  onInvalidate?: () => void
}

/**
 * Trace a pointer path as one smooth curve: quadratic segments through the midpoints of consecutive samples, with the
 * samples themselves as control points. The curve never overshoots the input, so a brush stroke follows the hand
 * without the corners that a polyline of raw pointer samples shows. Two points stay a straight line.
 */
export function traceSmooth (ctx: Pick<CanvasRenderingContext2D, 'moveTo' | 'lineTo' | 'quadraticCurveTo'>, points: ReadonlyArray<{ readonly x: number, readonly y: number }>): void {
  if (points.length === 0) return
  ctx.moveTo(points[0].x, points[0].y)
  if (points.length < 3) { for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y); return }
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1]
    ctx.quadraticCurveTo(a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2)
  }
  const last = points[points.length - 1]
  ctx.lineTo(last.x, last.y)
}

/** Paint already-projected primitives in logical pixels; retained anchors remain untouched. */
export function paintDrawings (
  ctx: CanvasRenderingContext2D,
  geometries: readonly DrawingGeometry[],
  selectedId: string | null,
  options: DrawingRenderOptions = {}
): void {
  const lineWidth = options.lineWidth !== undefined && Number.isFinite(options.lineWidth) && options.lineWidth > 0 ? options.lineWidth : 1.5
  const radius = options.handleRadius !== undefined && Number.isFinite(options.handleRadius) && options.handleRadius > 0 ? options.handleRadius : 4
  const fillOpacity = options.fillOpacity !== undefined && Number.isFinite(options.fillOpacity) ? Math.max(0, Math.min(1, options.fillOpacity)) : 0.1
  ctx.save()
  try {
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'
    const bounds = options.bounds
    if (bounds !== undefined) {
      if (![bounds.left, bounds.right, bounds.top, bounds.bottom].every(Number.isFinite) || bounds.left >= bounds.right || bounds.top >= bounds.bottom) return
      ctx.beginPath(); ctx.rect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top); ctx.clip()
    }
    ctx.lineWidth = lineWidth; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.setLineDash([])
    const theme = colors(options.theme)
    const font = options.font ?? CANVAS_LABEL_FONT, handleFill = options.handleFill ?? theme.surface
    ctx.font = font; ctx.textBaseline = 'bottom'
    for (const geometry of geometries) {
      const selected = geometry.id === selectedId
      const color = selected ? options.selectedColor ?? options.color ?? theme.ink : options.color ?? theme.ink
      ctx.strokeStyle = color
      for (const primitive of geometry.primitives) {
        if (primitive.kind === 'image') {
          const status = options.imageRenderer?.paint(ctx, primitive.source, primitive.bounds, primitive.clip, options.onInvalidate)
          if (options.imageRenderer === undefined || status === 'unavailable') {
            ctx.save()
            try {
              const box = primitive.bounds, clip = primitive.clip
              ctx.beginPath(); ctx.rect(clip.left, clip.top, clip.right - clip.left, clip.bottom - clip.top); ctx.clip()
              ctx.strokeRect(box.left, box.top, box.right - box.left, box.bottom - box.top)
              ctx.fillStyle = color; ctx.font = font; ctx.textAlign = 'left'; ctx.textBaseline = 'top'
              ctx.fillText('Image unavailable', box.left + 4, box.top + 4, Math.max(1, box.right - box.left - 8))
            } finally { ctx.restore() }
          }
        }
        else if (primitive.kind === 'stroke') {
          ctx.save()
          try {
            const clip = primitive.clip
            ctx.beginPath(); ctx.rect(clip.left, clip.top, clip.right - clip.left, clip.bottom - clip.top); ctx.clip()
            // A selected stroke sits on a soft halo of the same ink, so it reads as chosen without per-point handles.
            if (selected && primitive.opacity === 1) { ctx.lineWidth = primitive.width + 6; ctx.globalAlpha = 0.18; ctx.beginPath(); traceSmooth(ctx, primitive.points); ctx.stroke() }
            ctx.lineWidth = primitive.width; ctx.globalAlpha = primitive.opacity; ctx.beginPath()
            traceSmooth(ctx, primitive.points)
            ctx.stroke()
          } finally { ctx.restore() }
        }
      }
      for (const primitive of geometry.primitives) {
        if (primitive.kind !== 'rect' && primitive.kind !== 'polygon') continue
        ctx.fillStyle = options.fillColor ?? color; ctx.globalAlpha = fillOpacity
        if (primitive.kind === 'rect') ctx.fillRect(primitive.from.x, primitive.from.y, primitive.to.x - primitive.from.x, primitive.to.y - primitive.from.y)
        else {
          ctx.beginPath()
          primitive.points.forEach((point, index) => { if (index === 0) ctx.moveTo(point.x, point.y); else ctx.lineTo(point.x, point.y) })
          ctx.closePath(); ctx.fill()
        }
      }
      for (const primitive of geometry.primitives) {
        if (primitive.kind !== 'ellipse') continue
        ctx.save()
        try {
          const clip = primitive.clip
          ctx.beginPath(); ctx.rect(clip.left, clip.top, clip.right - clip.left, clip.bottom - clip.top); ctx.clip()
          ctx.beginPath(); ctx.ellipse(primitive.center.x, primitive.center.y, primitive.radiusX, primitive.radiusY, 0, 0, Math.PI * 2)
          ctx.fillStyle = options.fillColor ?? color; ctx.globalAlpha = fillOpacity; ctx.fill()
          ctx.globalAlpha = 1; ctx.stroke()
        } finally { ctx.restore() }
      }
      ctx.globalAlpha = 1; ctx.beginPath()
      for (const primitive of geometry.primitives) {
        if (primitive.kind !== 'line') continue
        ctx.moveTo(primitive.from.x, primitive.from.y); ctx.lineTo(primitive.to.x, primitive.to.y)
      }
      ctx.stroke(); ctx.fillStyle = color
      for (const primitive of geometry.primitives) {
        if (primitive.kind === 'label') {
          ctx.save()
          try {
            const box = primitive.bounds, clip = primitive.clip
            ctx.beginPath(); ctx.rect(clip.left, clip.top, clip.right - clip.left, clip.bottom - clip.top); ctx.clip()
            if (primitive.boxed !== false) {
              ctx.fillStyle = handleFill; ctx.globalAlpha = 0.92
              ctx.fillRect(box.left, box.top, box.right - box.left, box.bottom - box.top)
              ctx.globalAlpha = 1; ctx.strokeRect(box.left, box.top, box.right - box.left, box.bottom - box.top)
            }
            ctx.beginPath(); ctx.rect(box.left, box.top, box.right - box.left, box.bottom - box.top); ctx.clip()
            ctx.fillStyle = color; ctx.font = font; ctx.textAlign = 'left'; ctx.textBaseline = 'top'
            const lines = primitive.price === undefined ? primitive.lines : [options.formatPrice?.(primitive.price) ?? String(primitive.price)]
            lines.forEach((text, index) => ctx.fillText(text, box.left + 6, box.top + 4 + index * 16, box.right - box.left - 12))
          } finally { ctx.restore() }
          continue
        }
        if (primitive.kind !== 'text') continue
        ctx.textAlign = primitive.align
        const text = primitive.price === undefined ? primitive.text : `${primitive.text}  ${options.formatPrice?.(primitive.price) ?? String(primitive.price)}`
        ctx.fillText(text, primitive.position.x, primitive.position.y - 3)
      }
      if (!selected || geometry.locked) continue
      // Round handles on the canvas colour with an ink edge: selection never recolours the drawing.
      ctx.fillStyle = handleFill; ctx.lineWidth = 1.5
      ctx.beginPath()
      for (const handle of geometry.handles) {
        ctx.moveTo(handle.point.x + radius, handle.point.y); ctx.arc(handle.point.x, handle.point.y, radius, 0, Math.PI * 2)
      }
      ctx.fill(); ctx.stroke(); ctx.lineWidth = lineWidth
    }
  } finally { ctx.restore() }
}
