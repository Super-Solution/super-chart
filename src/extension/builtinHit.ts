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

// klinecharts' own line-drawing templates (the 13 rail tools that are not
// Super Chart's own overlays) hit-test at ~2px, and on some builds against
// each line's infinite extension rather than the drawn segment (SC-100). That
// code lives inside klinecharts (OverlayView, not exported) and is a peer
// dependency shared with host-created overlays and the wallet's raw
// LiveChart/TAChart — so it is never patched. Instead each of these 13 names
// is re-registered here with a wrapped createPointFigures that appends a
// wider, bounded hit path (see ./hitPath) ONLY for an instance in the
// drawing_tools group (a user drawing made from the rail); a host's own
// unlocked AI priceLine/segment/fibonacciLine, with no group, is untouched
// and keeps klinecharts' stock hit band.
//
// The peer range is klinecharts ^9.7.2 (see build-infra's SC-010), and both
// 9.7.2 and 9.8.12 export getOverlayClass/getSupportedOverlays/registerOverlay
// (verified against the installed 9.8.12: dist/index.esm.js exports all
// three). If an even older klinecharts is ever loaded and lacks
// getOverlayClass, this quietly does nothing for that name — a smaller hit
// band, not a crash.
//
// The e2e lifecycle-only leg loads klinecharts 9.1.1, which has neither
// getOverlayClass nor getSupportedOverlays. A named import (`import {
// getOverlayClass } from 'klinecharts'`) is validated by the ES module
// loader at link time, so importing a binding a real ESM build does not
// export is a hard SyntaxError there — the runtime `typeof x === 'function'`
// guard below never even runs, because the whole module fails to load.
// A namespace import sidesteps that: an absent property on the namespace
// object is simply `undefined` at property-access time, like any object.
//
// Part of SUPer-Chart (Apache-2.0).

import * as klinecharts from 'klinecharts'
import type { OverlayCreateFiguresCallback, OverlayFigure, OverlayTemplate } from 'klinecharts'
import { DRAWING_GROUP_ID } from '../drawing-editor/controller'
import { strokeHitTolerance } from '../drawing-editor/geometry'
import { hitPathWithin } from './hitPath'

const { getOverlayClass, getSupportedOverlays, registerOverlay } = klinecharts as {
  getOverlayClass?: (name: string) => (new () => OverlayTemplate) | null
  getSupportedOverlays?: () => string[]
  registerOverlay?: (template: OverlayTemplate) => void
}

/** The klinecharts-native line tools the drawing rail offers (built-in templates, not Super Chart's own). */
export const BUILTIN_LINE_TOOLS = [
  'horizontalStraightLine', 'horizontalRayLine', 'horizontalSegment',
  'verticalStraightLine', 'verticalRayLine', 'verticalSegment',
  'straightLine', 'rayLine', 'segment',
  'priceLine', 'priceChannelLine', 'parallelStraightLine', 'fibonacciLine'
] as const

let patched = false

/** Every coordinate array drawn by a plain (non-ignoreEvent) 'line' figure, for the hit path. */
function lineCoordinates (figures: OverlayFigure | OverlayFigure[]): Array<Parameters<typeof hitPathWithin>[1]> {
  const list = Array.isArray(figures) ? figures : [figures]
  const paths: Array<Parameters<typeof hitPathWithin>[1]> = []
  for (const figure of list) {
    if (figure.type !== 'line' || figure.ignoreEvent === true) {
      continue
    }
    const attrs = Array.isArray(figure.attrs) ? figure.attrs : [figure.attrs]
    for (const attr of attrs) {
      const coordinates = (attr as { coordinates?: unknown }).coordinates
      if (Array.isArray(coordinates) && coordinates.length > 1) {
        paths.push(coordinates as never)
      }
    }
  }
  return paths
}

/**
 * Wrap klinecharts' own line-drawing templates so a drawing-group instance
 * (only) gets a wider, correct hit test. Idempotent; safe to call from
 * registerExtensions() every time the module loads.
 */
export function patchBuiltinLineHitTest (): void {
  if (patched) {
    return
  }
  patched = true
  if (typeof getOverlayClass !== 'function' || typeof getSupportedOverlays !== 'function' || typeof registerOverlay !== 'function') {
    return
  }
  let supported: Set<string>
  try {
    supported = new Set(getSupportedOverlays())
  } catch {
    return
  }
  for (const name of BUILTIN_LINE_TOOLS) {
    if (!supported.has(name)) {
      continue
    }
    let original: OverlayTemplate | null = null
    try {
      const Ctor = getOverlayClass(name) as (new () => OverlayTemplate) | null
      if (typeof Ctor !== 'function') {
        continue
      }
      // The instance's own fields ARE the currently-registered template's
      // (OverlayImp's constructor copies every one of them from it), so this
      // is how to read the original template back out — getOverlayClass
      // returns the wrapping *class*, not the template object itself.
      original = new Ctor() as unknown as OverlayTemplate
    } catch {
      continue
    }
    const originalCreate = original.createPointFigures
    if (typeof originalCreate !== 'function') {
      continue
    }
    const wrapped: OverlayCreateFiguresCallback = ctx => {
      const figures = originalCreate.call(original, ctx) ?? []
      if (ctx.overlay.groupId !== DRAWING_GROUP_ID) {
        return figures
      }
      const paths = lineCoordinates(figures)
      if (paths.length === 0) {
        return figures
      }
      const tolerance = strokeHitTolerance(ctx.overlay.styles?.line?.size ?? ctx.defaultStyles?.line?.size)
      return ([] as OverlayFigure[]).concat(figures, hitPathWithin(tolerance, ...paths))
    }
    try {
      registerOverlay({
        name: original.name,
        totalStep: original.totalStep,
        needDefaultPointFigure: original.needDefaultPointFigure,
        needDefaultXAxisFigure: original.needDefaultXAxisFigure,
        needDefaultYAxisFigure: original.needDefaultYAxisFigure,
        createPointFigures: wrapped,
        createXAxisFigures: original.createXAxisFigures,
        createYAxisFigures: original.createYAxisFigures,
        performEventPressedMove: original.performEventPressedMove,
        performEventMoveForDrawing: original.performEventMoveForDrawing,
        onDrawStart: original.onDrawStart,
        onDrawing: original.onDrawing,
        onDrawEnd: original.onDrawEnd,
        onClick: original.onClick,
        onDoubleClick: original.onDoubleClick,
        onRightClick: original.onRightClick,
        onPressedMoveStart: original.onPressedMoveStart,
        onPressedMoving: original.onPressedMoving,
        onPressedMoveEnd: original.onPressedMoveEnd,
        onMouseEnter: original.onMouseEnter,
        onMouseLeave: original.onMouseLeave,
        onRemoved: original.onRemoved,
        onSelected: original.onSelected,
        onDeselected: original.onDeselected,
        styles: original.styles
      })
    } catch { /* leave klinecharts' own registration in place */ }
  }
}
