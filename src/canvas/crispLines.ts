/**
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at

 * http://www.apache.org/licenses/LICENSE-2.0

 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Crisp grid / crosshair / last-price lines at non-integer devicePixelRatio
// (SC-044): klinecharts draws every axis-aligned 1px line the same way at
// every DPR, so on 125%/150% Windows scaling (DPR 1.25/1.5) the line falls
// between device pixels and comes out as two half-lit rows instead of one
// solid one. This overrides the 'line' figure to snap a 2-point horizontal or
// vertical segment to whole device pixels; everything else (diagonals,
// smoothed indicator lines, multi-point drawings) is drawn exactly as
// klinecharts' own exported `utils.drawLine` draws it — unchanged.
//
// Opt-in (`enableCrispLines()`) and global: klinecharts' figure registry is
// one registry for the whole page, so this affects every chart on it,
// including a host's own raw klinecharts instance. Documented as such; not
// enabled by import side effect.
//
// Part of SUPer-Chart (Apache-2.0).

import { registerFigure, utils } from 'klinecharts'
import type { LineAttrs } from 'klinecharts'

// klinecharts' LineType.Dashed is the string 'dashed' (index.d.ts): spelled
// out so the pure `drawCrispLine` below needs no runtime klinecharts value —
// under vitest's node environment, `import { LineType } from 'klinecharts'`
// resolves to the package's CJS build, whose named exports (enums, `utils`)
// come back undefined through Node's CJS/ESM interop (only the default
// export is reliable there). The real bundle (Vite, browser) has no such
// problem; `enableCrispLines()` below still imports `registerFigure`/`utils`
// directly, since it only ever runs there.
const DASHED = 'dashed'

export interface Coordinate2D { x: number, y: number }

export type LineOrientation = 'horizontal' | 'vertical'

/** A 2×2 affine transform, shaped like `CanvasRenderingContext2D.getTransform()`'s DOMMatrix (a,b,c,d,e,f). */
export interface Transform2D { a: number, b: number, c: number, d: number, e: number, f: number }

export const IDENTITY_TRANSFORM: Transform2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

/** 'vertical'/'horizontal' for an exactly axis-aligned 2-point segment; null for anything else (a point, a diagonal, a polyline). */
export function axisAlignedOrientation (coordinates: readonly Coordinate2D[]): LineOrientation | null {
  if (coordinates.length !== 2) {
    return null
  }
  const [p0, p1] = coordinates
  if (p0.x === p1.x && p0.y !== p1.y) {
    return 'vertical'
  }
  if (p0.y === p1.y && p0.x !== p1.x) {
    return 'horizontal'
  }
  return null
}

/** No rotation or skew: each axis can be snapped independently. */
export function isAxisAlignedTransform (t: Transform2D): boolean {
  return t.b === 0 && t.c === 0
}

export interface Snap { center: number, width: number }

/**
 * The device-pixel stroke width and centre for a line whose constant logical
 * coordinate is `value`, on an axis scaled by `scale` and translated by
 * `translate` (i.e. device = value * scale + translate). An odd device width
 * centres on a half pixel (crisp with a 1px stroke); an even width centres on
 * a whole pixel (crisp with a 2px stroke, e.g. Retina).
 */
export function snapCoordinate (value: number, scale: number, translate: number, size: number): Snap {
  const width = Math.max(1, Math.round(size * Math.abs(scale)))
  const device = value * scale + translate
  const center = width % 2 === 1 ? Math.floor(device) + 0.5 : Math.round(device)
  return { center, width }
}

export interface LineStyleLike {
  style?: string
  size?: number
  color?: string
  dashedValue?: number[]
  smooth?: boolean
}

/** The subset of CanvasRenderingContext2D this figure draws with. */
export type CrispCtx = Pick<CanvasRenderingContext2D, 'save' | 'restore' | 'setTransform' | 'beginPath' | 'closePath' | 'moveTo' | 'lineTo' | 'stroke' | 'setLineDash' | 'lineWidth' | 'strokeStyle'>

export type LineDraw = (ctx: CrispCtx, attrs: LineAttrs | LineAttrs[], styles: LineStyleLike) => void

/**
 * The 'line' figure's draw, given the canvas transform explicitly (so it is
 * testable without a real canvas). Segments that are not an axis-aligned
 * 2-point line, or whose transform has rotation/skew, are handed to
 * `fallback` (klinecharts' own `utils.drawLine`) unchanged; snapped segments
 * are drawn in their own pass, in device space, with the transform reset.
 */
export function drawCrispLine (ctx: CrispCtx, attrs: LineAttrs | LineAttrs[], styles: LineStyleLike, transform: Transform2D, fallback: LineDraw): void {
  const entries = Array.isArray(attrs) ? attrs : [attrs]
  const axisAligned = isAxisAlignedTransform(transform)
  const rest: LineAttrs[] = []
  const snapped: Array<{ orientation: LineOrientation, coordinates: Coordinate2D[] }> = []
  for (const entry of entries) {
    const orientation = axisAligned ? axisAlignedOrientation(entry.coordinates) : null
    if (orientation !== null) {
      snapped.push({ orientation, coordinates: entry.coordinates })
    } else {
      rest.push(entry)
    }
  }
  if (rest.length > 0) {
    fallback(ctx, rest, styles)
  }
  if (snapped.length === 0) {
    return
  }
  const size = styles.size ?? 1
  const dashed = styles.style === DASHED
  const dashValues = styles.dashedValue ?? [2, 2]
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.strokeStyle = styles.color ?? 'currentColor'
  for (const { orientation, coordinates } of snapped) {
    const perpScale = orientation === 'vertical' ? transform.a : transform.d
    const alongScale = orientation === 'vertical' ? transform.d : transform.a
    const snap = orientation === 'vertical'
      ? snapCoordinate(coordinates[0].x, transform.a, transform.e, size)
      : snapCoordinate(coordinates[0].y, transform.d, transform.f, size)
    ctx.lineWidth = snap.width
    ctx.setLineDash(dashed ? dashValues.map(v => v * Math.abs(alongScale)) : [])
    ctx.beginPath()
    if (orientation === 'vertical') {
      const y0 = coordinates[0].y * transform.d + transform.f
      const y1 = coordinates[1].y * transform.d + transform.f
      ctx.moveTo(snap.center, y0)
      ctx.lineTo(snap.center, y1)
    } else {
      const x0 = coordinates[0].x * transform.a + transform.e
      const x1 = coordinates[1].x * transform.a + transform.e
      ctx.moveTo(x0, snap.center)
      ctx.lineTo(x1, snap.center)
    }
    ctx.stroke()
    ctx.closePath()
    void perpScale // documents intent: perpScale sizes the stroke, alongScale sizes the dash pattern.
  }
  ctx.restore()
}

let enabled = false

/**
 * Register the crisp 'line' figure globally (idempotent). klinecharts has one
 * figure registry for the whole page: call this once, before creating a
 * chart, and it affects every klinecharts chart there (documented — it is not
 * scoped to one Super Chart instance). `KLineChartPro` calls it unless the
 * host passes `crispLines: false`; a host driving raw klinecharts can call it
 * directly.
 */
export function enableCrispLines (): void {
  if (enabled) {
    return
  }
  enabled = true
  registerFigure<LineAttrs | LineAttrs[], LineStyleLike>({
    name: 'line',
    checkEventOn: (coordinate, attrs) => utils.checkCoordinateOnLine(coordinate, attrs),
    draw: (ctx, attrs, styles) => {
      let transform: Transform2D = IDENTITY_TRANSFORM
      try {
        const getTransform = (ctx as unknown as { getTransform?: () => Transform2D }).getTransform
        if (typeof getTransform === 'function') {
          transform = getTransform.call(ctx)
        }
      } catch {
        transform = IDENTITY_TRANSFORM
      }
      drawCrispLine(ctx as unknown as CrispCtx, attrs, styles, transform, (c, a, s) => { utils.drawLine(c as CanvasRenderingContext2D, a, s as never) })
    }
  })
}

/** Test-only: lets a spec re-arm registration. Not part of the public API. */
export function _resetCrispLinesForTest (): void {
  enabled = false
}
