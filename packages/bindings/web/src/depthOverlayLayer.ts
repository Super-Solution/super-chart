// SPDX-License-Identifier: GPL-3.0-or-later
import {
  projectDepthHeatmap, projectLiquidationMap,
  type DepthHeatmapFrame, type DepthHeatmapOptions, type DepthSnapshot, type LiquidationLevel, type LiquidationMapFrame, type LiquidationMapOptions
} from '@supersolutions/super-chart-core'
import type { EngineLayer } from './layer'
import { colors, CANVAS_LABEL_FONT, type ThemeName } from './tokens'

/**
 * Order-book heatmap and liquidation map as engine layers. They draw data the host passes in (`setSnapshots`, `setLevels`);
 * Super Chart fetches nothing. After new data, call `chart.requestPaint()`: the layer recomputes on the next paint.
 * Layers paint above the candles, so both are translucent.
 */

export interface DepthOverlayRenderOptions {
  /** Picks the default colours for labels and the liquidation bars. */
  theme?: ThemeName
  up?: string
  down?: string
}

/** Viridis, which keeps its order of brightness for the common forms of colour-vision deficiency. */
const RAMP: ReadonlyArray<readonly [number, number, number]> = [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]]
const LOOKUP = (() => {
  const table = new Uint8ClampedArray(256 * 4)
  for (let i = 0; i < 256; i++) {
    const position = i / 255 * (RAMP.length - 1), k = Math.min(RAMP.length - 2, Math.floor(position)), f = position - k
    for (let c = 0; c < 3; c++) table[i * 4 + c] = RAMP[k][c] + (RAMP[k + 1][c] - RAMP[k][c]) * f
    // Faint cells stay faint so the candles underneath remain readable; strong cells reach about 80 % opacity.
    table[i * 4 + 3] = i === 0 ? 0 : Math.min(204, 20 + i * 0.75)
  }
  return table
})()

function note (context: CanvasRenderingContext2D, text: string, bounds: DepthHeatmapFrame['bounds'], theme: ThemeName | undefined): void {
  context.save()
  try {
    context.font = CANVAS_LABEL_FONT; context.textAlign = 'left'; context.textBaseline = 'bottom'; context.fillStyle = colors(theme).inkMuted
    context.fillText(text, bounds.left + 6, bounds.bottom - 6, Math.max(1, bounds.right - bounds.left - 12))
  } finally { context.restore() }
}

/** The heatmap is drawn as a small image (one pixel per cell) scaled up over the plot, so a frame costs one draw call. */
function paintHeatmap (context: CanvasRenderingContext2D, frame: DepthHeatmapFrame): void {
  const { bounds, columns, rows, intensity } = frame
  const canvas = context.canvas as HTMLCanvasElement | undefined
  const doc = canvas?.ownerDocument
  if (doc === undefined || columns === 0 || rows === 0) return
  const image = doc.createElement('canvas')
  image.width = columns; image.height = rows
  const target = image.getContext('2d')
  if (target === null) return
  const pixels = target.createImageData(columns, rows)
  for (let i = 0; i < intensity.length; i++) {
    const level = Math.max(0, Math.min(255, Math.round(intensity[i] * 255)))
    pixels.data.set(LOOKUP.subarray(level * 4, level * 4 + 4), i * 4)
  }
  target.putImageData(pixels, 0, 0)
  context.save()
  try {
    context.beginPath(); context.rect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top); context.clip()
    context.imageSmoothingEnabled = false
    context.drawImage(image, bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top)
  } finally { context.restore() }
}

export function createDepthHeatmapLayer (
  options: DepthHeatmapOptions = {}, render: DepthOverlayRenderOptions = {}
): EngineLayer & { setSnapshots: (snapshots: readonly DepthSnapshot[]) => void, getSnapshot: () => DepthHeatmapFrame | null } {
  const settings = { ...options }
  let snapshots: readonly DepthSnapshot[] = []
  let revision = 0, computedFor: { frame: unknown, revision: number } | null = null
  let latest: { frame: Parameters<EngineLayer['update']>[0], bars: Parameters<EngineLayer['update']>[1] } | null = null
  let projected: DepthHeatmapFrame | null = null
  const project = (): DepthHeatmapFrame | null => {
    if (latest === null) return null
    if (computedFor === null || computedFor.frame !== latest.frame || computedFor.revision !== revision) {
      projected = projectDepthHeatmap(latest.frame, latest.bars, snapshots, settings)
      computedFor = { frame: latest.frame, revision }
    }
    return projected
  }
  return {
    setSnapshots: next => { snapshots = next; revision++ },
    update: (frame, bars) => { latest = { frame, bars } },
    paint: context => {
      const result = project()
      if (result === null) return
      if (result.status === 'ready') paintHeatmap(context, result)
      else if (result.status === 'invalid-data') note(context, 'Depth data invalid: not drawn', result.bounds, render.theme)
    },
    getSnapshot: () => project(),
    dispose: () => { latest = null; projected = null; computedFor = null; snapshots = [] }
  }
}

function paintLiquidations (context: CanvasRenderingContext2D, frame: LiquidationMapFrame, render: DepthOverlayRenderOptions): void {
  const theme = colors(render.theme), bounds = frame.bounds
  const longColor = render.down ?? theme.down, shortColor = render.up ?? theme.up
  context.save()
  try {
    context.beginPath(); context.rect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top); context.clip()
    context.globalAlpha = 0.6
    context.fillStyle = longColor
    for (const row of frame.rows) if (row.longRect !== null) context.fillRect(row.longRect.x, row.longRect.y, row.longRect.width, row.longRect.height)
    context.fillStyle = shortColor
    for (const row of frame.rows) if (row.shortRect !== null) context.fillRect(row.shortRect.x, row.shortRect.y, row.shortRect.width, row.shortRect.height)
    context.globalAlpha = 1
    if (frame.referenceY !== null) {
      context.strokeStyle = theme.inkMuted; context.lineWidth = 1; context.setLineDash([2, 4])
      context.beginPath(); context.moveTo(bounds.left, Math.round(frame.referenceY) + 0.5); context.lineTo(bounds.right, Math.round(frame.referenceY) + 0.5); context.stroke()
      context.setLineDash([])
    }
    context.font = CANVAS_LABEL_FONT; context.textAlign = 'right'; context.textBaseline = 'top'
    context.fillStyle = shortColor; context.fillText('Short liquidations', bounds.right - 6, bounds.top + 6)
    context.fillStyle = longColor; context.fillText('Long liquidations', bounds.right - 6, bounds.top + 22)
  } finally { context.restore() }
}

export function createLiquidationMapLayer (
  options: LiquidationMapOptions = {}, render: DepthOverlayRenderOptions = {}
): EngineLayer & { setLevels: (levels: readonly LiquidationLevel[]) => void, getSnapshot: () => LiquidationMapFrame | null } {
  const settings = { ...options }
  let levels: readonly LiquidationLevel[] = []
  let revision = 0, computedFor: { frame: unknown, revision: number } | null = null
  let latest: { frame: Parameters<EngineLayer['update']>[0], bars: Parameters<EngineLayer['update']>[1] } | null = null
  let projected: LiquidationMapFrame | null = null
  const project = (): LiquidationMapFrame | null => {
    if (latest === null) return null
    if (computedFor === null || computedFor.frame !== latest.frame || computedFor.revision !== revision) {
      projected = projectLiquidationMap(latest.frame, latest.bars, levels, settings)
      computedFor = { frame: latest.frame, revision }
    }
    return projected
  }
  return {
    setLevels: next => { levels = next; revision++ },
    update: (frame, bars) => { latest = { frame, bars } },
    paint: context => {
      const result = project()
      if (result === null) return
      if (result.status === 'ready') paintLiquidations(context, result, render)
      else if (result.status === 'invalid-data') note(context, 'Liquidation data invalid: not drawn', result.bounds, render.theme)
    },
    getSnapshot: () => project(),
    dispose: () => { latest = null; projected = null; computedFor = null; levels = [] }
  }
}
