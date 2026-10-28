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

// Renders the six chart types klinecharts has no native CandleType for
// (SC-NEXT #2: Volume Bars, Columns, High-Low, Step Line, HLC Area, Baseline)
// as one overlay on the candle pane, following the exact pattern
// anchoredVWAP/fixedRangeVolumeProfile already use (src/extension/volumeTools.ts):
// xAxis/yAxis.convertToPixel per visible bar, 'line'/'polygon' figures. Unlike
// those, this overlay is never placed by the user — ChartProComponent creates
// it directly with `chart.createOverlay` (never through the drawing editor,
// so `editor.track()` never sees its id — the same way src/canvas/countdown.ts's
// bar-close tag stays out of getDrawings()/the object tree), and keeps it in
// sync with the chosen chart type via `attachCustomSeriesOverlay`.
//
// The native candle is not removed — its colours are made fully transparent
// (src/charttypes/hiddenCandleStyles) while its type stays a real CandleType,
// so the price axis keeps auto-scaling from the true bar high/low exactly as
// it does for Candle/Bars, and switching into/out of one of these types never
// jumps the visible price range the way switching to 'area' (close-only
// range) would.
//
// Part of SUPer-Chart (Apache-2.0).

import { klineList, type AxisParams } from '../extension/dataAccess'
import {
  baselineSegments, columnExtents, highLowExtents, hlcAreaPoints, interpolatedClose,
  stepLinePoints, volumeIntensities, type Bar
} from './geometry'
import { toHeikinAshi } from '../data/heikinAshi'

export const CUSTOM_SERIES_OVERLAY_NAME = 'scCustomSeries'
/** Reserved groupId, same convention as countdown.ts's COUNTDOWN_GROUP_ID: never listed as a user drawing. */
export const CUSTOM_SERIES_GROUP_ID = '__sc_custom_series'

// 'line_markers' does not hide the candle (see theme/engine.ts's hiddenCandleStyles:
// it keeps the native 'area' line/close-range axis exactly like 'line' does)
// — this overlay only adds the per-point markers a plain area/line type has
// no native support for (CandleAreaPointStyle is a single last-price dot,
// not a marker at every point). The other seven hide the native candle.
//
// 'heikin_ashi' draws its own candle bodies here (toHeikinAshi over the FULL
// dataList, transformed at PAINT time only) rather than feeding transformed
// OHLC into the engine's own dataset (chart.applyNewData/updateData, owned by
// the heavily-tested realtime loader in src/data/loader.ts). That keeps the
// real prices the engine stores untouched for every other feature that reads
// them — precision, drawing tools, the future order-block/FVG overlays — so
// switching into and out of Heikin Ashi is purely a view change, never a data
// mutation a host or another chart feature could be surprised by.
export const CUSTOM_SERIES_KINDS = ['volume_bars', 'columns', 'high_low', 'step_line', 'hlc_area', 'baseline', 'line_markers', 'heikin_ashi'] as const
export type CustomSeriesKind = typeof CUSTOM_SERIES_KINDS[number]

/** The subset of CUSTOM_SERIES_KINDS whose native candle must be hidden (transparent) rather than left as a visible area line. */
export function hidesNativeCandle (kind: CustomSeriesKind): boolean {
  return kind !== 'line_markers'
}

export function isCustomSeriesKind (value: string): value is CustomSeriesKind {
  return (CUSTOM_SERIES_KINDS as readonly string[]).includes(value)
}

interface Figure { type: string, attrs: unknown, styles?: unknown, ignoreEvent?: boolean }
interface OverlayFiguresParams extends AxisParams {
  overlay: { extendData?: unknown }
  bounding: { width: number, height: number }
}

const UP_COLOR = '#26A69A'
const DOWN_COLOR = '#EF5350'
const NEUTRAL_COLOR = '#787B86'

/** The visible bar range (+1 bar of padding either side), clamped to the data length — same idea as volumeTools.ts's local helper, kept separate per file by this codebase's convention. */
function visibleIndexRange (params: OverlayFiguresParams, dataLength: number): [number, number] | null {
  const { xAxis, bounding } = params
  if (xAxis === null || xAxis === undefined || dataLength === 0) return null
  try {
    const a = xAxis.convertFromPixel(0)
    const b = xAxis.convertFromPixel(bounding.width)
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null
    const from = Math.max(0, Math.floor(Math.min(a, b)) - 1)
    const to = Math.min(dataLength - 1, Math.ceil(Math.max(a, b)) + 1)
    return from <= to ? [from, to] : null
  } catch {
    return null
  }
}

function toXY (params: OverlayFiguresParams, index: number, value: number): { x: number, y: number } | null {
  const { xAxis, yAxis } = params
  if (xAxis === null || xAxis === undefined || yAxis === null || yAxis === undefined) return null
  try {
    const x = xAxis.convertToPixel(index)
    const y = yAxis.convertToPixel(value)
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
  } catch {
    return null
  }
}

function lineFigure (coordinates: Array<{ x: number, y: number }>, color: string, size = 1.5, dashed = false): Figure | null {
  if (coordinates.length < 2) return null
  return { type: 'line', ignoreEvent: true, attrs: { coordinates }, styles: { color, size, style: dashed ? 'dashed' : 'solid' } }
}

function fillFigure (coordinates: Array<{ x: number, y: number }>, color: string): Figure | null {
  if (coordinates.length < 3) return null
  return { type: 'polygon', ignoreEvent: true, attrs: { coordinates }, styles: { style: 'fill', color } }
}

const HALF_BODY_FRACTION = 0.35 // fraction of one bar's pixel width, for column/wick thickness

function barPixelWidth (params: OverlayFiguresParams): number {
  const a = toXY(params, 0, 0)
  const b = toXY(params, 1, 0)
  if (a === null || b === null) return 6
  return Math.max(1, Math.abs(b.x - a.x))
}

function drawColumns (params: OverlayFiguresParams, bars: readonly Bar[], range: [number, number]): Figure[] {
  const half = barPixelWidth(params) * HALF_BODY_FRACTION
  const figs: Figure[] = []
  for (const c of columnExtents(bars).slice(range[0], range[1] + 1)) {
    const top = toXY(params, c.index, Math.max(c.from, c.to))
    const bot = toXY(params, c.index, Math.min(c.from, c.to))
    if (top === null || bot === null) continue
    const color = c.up ? UP_COLOR : DOWN_COLOR
    const y0 = Math.min(top.y, bot.y)
    const y1 = Math.max(top.y, bot.y)
    const x = top.x
    const fig = fillFigure([{ x: x - half, y: y0 }, { x: x + half, y: y0 }, { x: x + half, y: y1 }, { x: x - half, y: y1 }], color)
    if (fig !== null) figs.push(fig)
  }
  return figs
}

function drawHighLow (params: OverlayFiguresParams, bars: readonly Bar[], range: [number, number]): Figure[] {
  const figs: Figure[] = []
  for (const e of highLowExtents(bars).slice(range[0], range[1] + 1)) {
    const top = toXY(params, e.index, e.high)
    const bot = toXY(params, e.index, e.low)
    const fig = top !== null && bot !== null ? lineFigure([top, bot], e.up ? UP_COLOR : DOWN_COLOR, 2) : null
    if (fig !== null) figs.push(fig)
  }
  return figs
}

function drawVolumeBars (params: OverlayFiguresParams, bars: readonly Bar[], range: [number, number]): Figure[] {
  const half = barPixelWidth(params) * HALF_BODY_FRACTION
  const intensities = volumeIntensities(bars)
  const figs: Figure[] = []
  const extents = highLowExtents(bars)
  for (let i = range[0]; i <= range[1]; i++) {
    const e = extents[i]
    if (e === undefined) continue
    const top = toXY(params, e.index, e.high)
    const bot = toXY(params, e.index, e.low)
    if (top === null || bot === null) continue
    const alpha = 0.25 + 0.65 * intensities[i]
    const base = e.up ? '38,166,154' : '239,83,80'
    const openClose = toXY(params, e.index, bars[i].open)
    const closeAt = toXY(params, e.index, bars[i].close)
    figs.push({ type: 'line', ignoreEvent: true, attrs: { coordinates: [top, bot] }, styles: { color: `rgba(${base},${alpha.toFixed(2)})`, size: 2 } })
    if (openClose !== null) figs.push({ type: 'line', ignoreEvent: true, attrs: { coordinates: [{ x: top.x - half, y: openClose.y }, top] }, styles: { color: `rgba(${base},${alpha.toFixed(2)})`, size: 2 } })
    if (closeAt !== null) figs.push({ type: 'line', ignoreEvent: true, attrs: { coordinates: [bot, { x: top.x + half, y: closeAt.y }] }, styles: { color: `rgba(${base},${alpha.toFixed(2)})`, size: 2 } })
  }
  return figs
}

function drawStepOrHlc (params: OverlayFiguresParams, points: ReadonlyArray<{ index: number, value: number }>, fill: boolean): Figure[] {
  const coords = points.map(p => toXY(params, p.index, p.value)).filter((p): p is { x: number, y: number } => p !== null)
  if (coords.length < 2) return []
  const figs: Figure[] = []
  if (fill) {
    const bottom = params.bounding.height
    const area = [{ x: coords[0].x, y: bottom }, ...coords, { x: coords[coords.length - 1].x, y: bottom }]
    const f = fillFigure(area, 'rgba(90, 130, 220, 0.18)')
    if (f !== null) figs.push(f)
  }
  const line = lineFigure(coords, '#5A82DC', 1.75)
  if (line !== null) figs.push(line)
  return figs
}

function drawHeikinAshi (params: OverlayFiguresParams, bars: readonly Bar[], range: [number, number]): Figure[] {
  // bars are really klinecharts KLineData (klineList casts to the local Bar
  // shape, which omits timestamp since most of this file's geometry never
  // needs it) — toHeikinAshi only reads open/high/low/close and passes
  // timestamp through untouched, so the cast is safe.
  const ha = toHeikinAshi(bars as unknown as Array<Bar & { timestamp: number }>)
  const half = barPixelWidth(params) * HALF_BODY_FRACTION
  const figs: Figure[] = []
  for (let i = range[0]; i <= range[1]; i++) {
    const b = ha[i]
    if (b === undefined) continue
    const up = b.close >= b.open
    const color = up ? UP_COLOR : DOWN_COLOR
    const top = toXY(params, i, b.high)
    const bot = toXY(params, i, b.low)
    const openY = toXY(params, i, b.open)
    const closeY = toXY(params, i, b.close)
    if (top === null || bot === null || openY === null || closeY === null) continue
    const wick = lineFigure([top, bot], color, 1)
    if (wick !== null) figs.push(wick)
    const bodyTop = Math.min(openY.y, closeY.y)
    const bodyBottom = Math.max(openY.y, closeY.y, bodyTop + 1) // a doji still paints a visible sliver, not a zero-height rect
    const body = fillFigure([
      { x: top.x - half, y: bodyTop }, { x: top.x + half, y: bodyTop },
      { x: top.x + half, y: bodyBottom }, { x: top.x - half, y: bodyBottom }
    ], color)
    if (body !== null) figs.push(body)
  }
  return figs
}

function drawLineMarkers (params: OverlayFiguresParams, bars: readonly Bar[], range: [number, number]): Figure[] {
  const figs: Figure[] = []
  for (let i = range[0]; i <= range[1]; i++) {
    const p = toXY(params, i, bars[i].close)
    if (p === null) continue
    figs.push({ type: 'circle', ignoreEvent: true, attrs: { x: p.x, y: p.y, r: 2.5 }, styles: { style: 'fill', color: '#5A82DC' } })
  }
  return figs
}

function drawBaseline (params: OverlayFiguresParams, bars: readonly Bar[], range: [number, number], baselineValue: number): Figure[] {
  const segments = baselineSegments(bars, baselineValue)
  const bottom = params.bounding.height
  const figs: Figure[] = []
  const baseLine = toXY(params, 0, baselineValue)
  for (const seg of segments) {
    if (seg.to < range[0] || seg.from > range[1]) continue
    const from = Math.max(seg.from, range[0])
    const to = Math.min(seg.to, range[1])
    const coords: Array<{ x: number, y: number }> = []
    for (let i = from; i <= to; i++) {
      const p = toXY(params, i, bars[i].close)
      if (p !== null) coords.push(p)
    }
    if (coords.length === 0) continue
    // Extend the fill to the baseline's own y (not the pane bottom), so
    // above/below segments read as a ribbon around the baseline, not two
    // histograms dropping to the axis floor.
    const baseY = baseLine?.y ?? bottom
    const area = [{ x: coords[0].x, y: baseY }, ...coords, { x: coords[coords.length - 1].x, y: baseY }]
    const color = seg.above ? 'rgba(38,166,154,0.22)' : 'rgba(239,83,80,0.22)'
    const f = fillFigure(area, color)
    if (f !== null) figs.push(f)
    const line = lineFigure(coords, seg.above ? UP_COLOR : DOWN_COLOR, 1.75)
    if (line !== null) figs.push(line)
  }
  if (baseLine !== null) {
    const dashed = lineFigure([{ x: 0, y: baseLine.y }, { x: params.bounding.width, y: baseLine.y }], NEUTRAL_COLOR, 1, true)
    if (dashed !== null) figs.push(dashed)
  }
  return figs
}

export interface CustomSeriesExtendData {
  kind: CustomSeriesKind
  /** Only used by 'baseline'; the visible range's first close by default (ChartProComponent computes it). */
  baseline?: number
}

export interface CustomSeriesOverlayTemplate {
  name: string
  needDefaultPointFigure: boolean
  needDefaultXAxisFigure: boolean
  needDefaultYAxisFigure: boolean
  lock: boolean
  createPointFigures: (rawParams: unknown) => Figure[]
}

/** Pure factory: the overlay template object, kept separate from registration so the drawing logic is testable without touching klinecharts' registry. */
export function buildCustomSeriesOverlayTemplate (): CustomSeriesOverlayTemplate {
  return {
    name: CUSTOM_SERIES_OVERLAY_NAME,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    lock: true,
    createPointFigures: (rawParams: unknown): Figure[] => {
      const params = rawParams as OverlayFiguresParams
      const data = klineList(params) as Bar[]
      const extendData = params.overlay.extendData as Partial<CustomSeriesExtendData> | undefined
      if (data.length === 0 || extendData?.kind === undefined) return []
      const range = visibleIndexRange(params, data.length)
      if (range === null) return []
      switch (extendData.kind) {
        case 'columns': return drawColumns(params, data, range)
        case 'high_low': return drawHighLow(params, data, range)
        case 'volume_bars': return drawVolumeBars(params, data, range)
        case 'step_line': return drawStepOrHlc(params, stepLinePoints(data.slice(range[0], range[1] + 1)).map(p => ({ index: p.index + range[0], value: p.value })), false)
        case 'hlc_area': return drawStepOrHlc(params, hlcAreaPoints(data.slice(range[0], range[1] + 1)).map(p => ({ index: p.index + range[0], value: p.value })), true)
        case 'baseline': {
          const baseline = extendData.baseline ?? interpolatedClose(data, range[0], 0)
          return drawBaseline(params, data, range, baseline)
        }
        case 'line_markers': return drawLineMarkers(params, data, range)
        case 'heikin_ashi': return drawHeikinAshi(params, data, range)
        default: return []
      }
    }
  }
}

let registered = false

export function registerCustomSeriesOverlay (registerOverlay: (template: ReturnType<typeof buildCustomSeriesOverlayTemplate>) => void): void {
  if (registered) return
  registered = true
  registerOverlay(buildCustomSeriesOverlayTemplate())
}

/** Test-only: lets a spec re-arm registration (mirrors countdown.ts's _resetCountdownRegistrationForTest). */
export function _resetCustomSeriesRegistrationForTest (): void {
  registered = false
}

export interface CustomSeriesChart {
  createOverlay: (value: unknown, paneId?: string) => unknown
  overrideOverlay: (override: { id: string, extendData: CustomSeriesExtendData }) => void
  removeOverlay: (remove?: unknown) => void
  getDataList: () => Bar[]
}

export interface AttachedCustomSeriesOverlay {
  /** Re-reads getKind() and creates/updates/removes the overlay accordingly. ChartProComponent calls this from a createEffect(on(chartType, ...)). */
  refresh: () => void
  dispose: () => void
}

/**
 * Keeps the overlay's presence and its `kind` in sync with `getKind()`
 * (ChartProComponent's chartType signal, mapped through isCustomSeriesKind):
 * null means "not one of these eight types" and removes the overlay; any
 * kind creates it on first use and just overrides `extendData` on later
 * changes, so switching between e.g. Columns and Step Line never tears down
 * and recreates a fresh overlay id. Does NOT poll or subscribe to chart
 * actions itself — `createPointFigures` is called by klinecharts' own
 * repaint (every pan/zoom/data-update frame already), so once the overlay
 * exists no further `refresh()` is needed for it to track new bars or a
 * changed visible range; `refresh()` is for the two things that do not
 * already trigger a klinecharts repaint on their own: `getKind()` changing,
 * and a host wiping every overlay (the onRemoved hook below).
 */
export function attachCustomSeriesOverlay (chart: CustomSeriesChart, options: { getKind: () => CustomSeriesKind | null, registerOverlay: Parameters<typeof registerCustomSeriesOverlay>[0] }): AttachedCustomSeriesOverlay {
  registerCustomSeriesOverlay(options.registerOverlay)
  let id: string | null = null
  let disposed = false
  let removingIntentionally = false

  const removeOverlayById = (): void => {
    if (id === null) return
    removingIntentionally = true
    try {
      chart.removeOverlay({ id })
    } finally {
      removingIntentionally = false
    }
    id = null
  }

  const ensureOverlay = (): string | null => {
    if (id !== null) return id
    const created = chart.createOverlay({
      name: CUSTOM_SERIES_OVERLAY_NAME,
      groupId: CUSTOM_SERIES_GROUP_ID,
      lock: true,
      points: [{ timestamp: 0 }],
      onRemoved: () => {
        if (!removingIntentionally && !disposed) {
          id = null
          queueMicrotask(refresh)
        }
        return true
      }
    }, 'candle_pane')
    id = typeof created === 'string' ? created : (Array.isArray(created) && typeof created[0] === 'string' ? created[0] : null)
    return id
  }

  const refresh = (): void => {
    if (disposed) return
    const kind = options.getKind()
    if (kind === null) {
      removeOverlayById()
      return
    }
    const oid = ensureOverlay()
    if (oid === null) return
    chart.overrideOverlay({ id: oid, extendData: { kind } })
  }
  refresh()

  return {
    refresh,
    dispose: () => {
      if (disposed) return
      disposed = true
      removeOverlayById()
    }
  }
}
