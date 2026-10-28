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

/**
 * Reference levels for bounded oscillators (SC-172): RSI 70/30, Stochastic-family
 * 80/20, %B 0/1. Drawn with the indicator's own `draw` callback (present in both
 * klinecharts 9.7.2 and 9.8.12) so they never depend on overlays or a second
 * indicator instance, and `draw` returns false so the series lines still paint
 * on top. The pixel math is a pure function (levelSegments) so it is testable
 * without a canvas; buildLevelsDraw adapts it to klinecharts' IndicatorDrawCallback.
 *
 * Maintained by ZzyzxLabs. Part of SUPer-Chart (Apache-2.0).
 */

export interface LevelLine {
  value: number
  label?: string
}

/** Reference levels per SC_ template name. Anything absent draws none. */
export const INDICATOR_LEVELS: Readonly<Record<string, readonly LevelLine[]>> = {
  SC_RSI: [{ value: 70, label: '70' }, { value: 30, label: '30' }],
  SC_STOCH: [{ value: 80, label: '80' }, { value: 20, label: '20' }],
  SC_STOCHRSI: [{ value: 80, label: '80' }, { value: 20, label: '20' }],
  SC_BBP: [{ value: 1, label: '1' }, { value: 0, label: '0' }],
  SC_MFI: [{ value: 80, label: '80' }, { value: 20, label: '20' }]
}

export function levelsFor (name: string): readonly LevelLine[] {
  return INDICATOR_LEVELS[name] ?? []
}

export interface LevelSegment {
  value: number
  label?: string
  /** Device-pixel y of this level's line. */
  y: number
  x0: number
  x1: number
}

/** Pure pixel layout for a set of level lines spanning [x0, x1]. No canvas, no klinecharts. */
export function levelSegments (levels: readonly LevelLine[], toPixelY: (value: number) => number, x0: number, x1: number): LevelSegment[] {
  return levels.map(l => ({ value: l.value, label: l.label, y: toPixelY(l.value), x0, x1 }))
}

/** Minimal shape of what klinecharts' IndicatorDrawParams gives a draw callback (avoids importing klinecharts types into this pure module's public signature). */
export interface DrawLevelsParams {
  ctx: CanvasRenderingContext2D
  bounding: { width: number }
  yAxis: { convertToPixel: (value: number) => number }
}

/** Paints `levels` as dashed horizontal lines across the pane. Returns false (draw more on top). */
export function drawLevels (params: DrawLevelsParams, levels: readonly LevelLine[], color: string): boolean {
  if (levels.length === 0) return false
  const { ctx, bounding, yAxis } = params
  const segs = levelSegments(levels, v => yAxis.convertToPixel(v), 0, bounding.width)
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 1
  ctx.setLineDash([4, 4])
  for (const s of segs) {
    ctx.beginPath()
    ctx.moveTo(s.x0, s.y)
    ctx.lineTo(s.x1, s.y)
    ctx.stroke()
  }
  ctx.restore()
  return false
}

/** A ready-made draw callback for an SC_ template with levels in INDICATOR_LEVELS. */
export function createLevelsDraw (name: string, color = 'rgba(120, 130, 145, 0.55)'): (params: DrawLevelsParams) => boolean {
  const levels = levelsFor(name)
  if (levels.length === 0) return () => false
  return (params) => drawLevels(params, levels, color)
}
