import type { DrawingAnchor, DrawingBounds, DrawingPoint, DrawingProjector } from './drawings'

export type FreehandTool = 'brush' | 'highlighter'
export interface FreehandDrawing {
  readonly id: string
  readonly type: FreehandTool
  readonly anchors: readonly DrawingAnchor[]
  readonly locked: boolean
  readonly hidden: boolean
  readonly strokeWidth?: number
}
export interface FreehandPrimitive {
  readonly kind: 'stroke'
  readonly points: readonly DrawingPoint[]
  readonly width: number
  readonly opacity: number
  readonly clip: DrawingBounds
}
export const MAX_FREEHAND_POINTS = 2048

/** Timestamp/price paths use the current financial projection, never retained screen pixels. */
export function projectFreehandDrawing (drawing: { readonly type: string, readonly anchors: readonly DrawingAnchor[], readonly hidden: boolean, readonly strokeWidth?: number }, project: DrawingProjector, bounds: DrawingBounds): FreehandPrimitive | null {
  if ((drawing.type !== 'brush' && drawing.type !== 'highlighter') || drawing.hidden || drawing.anchors.length < 2 || drawing.anchors.length > MAX_FREEHAND_POINTS) return null
  const points: DrawingPoint[] = []
  for (const anchor of drawing.anchors) {
    const point = project(anchor.timestamp, anchor.price)
    if (point === null || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null
    points.push(Object.freeze({ ...point }))
  }
  return Object.freeze({ kind: 'stroke', points: Object.freeze(points), width: drawing.strokeWidth ?? (drawing.type === 'highlighter' ? 16 : 2), opacity: drawing.type === 'highlighter' ? 0.24 : 1, clip: Object.freeze({ ...bounds }) })
}
