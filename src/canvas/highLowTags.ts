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

// Visible-range High/Low price-axis tags (SC-NEXT #3, tread.fi's 9.png): two
// small pill labels pinned to the y-axis at the highest high / lowest low of
// whatever is currently on screen, exactly like the existing bar-close
// countdown (src/canvas/countdown.ts) — one locked, click-through y-axis
// overlay whose label position is pushed in from the outside, filtered out of
// every host-facing drawing listing because it is never registered with the
// drawing editor (see customSeriesOverlay.ts's file comment for why that is
// enough on its own).
//
// The overlay carries the two PRICES; the template turns them into pixels
// with the live price axis in the same paint as the candles, so a tag always
// sits exactly on its price. (Until 2026-09-28 the tags eased a pixel y
// computed before the pan: while the axis rescaled every frame they drifted
// off their price, and the per-frame overlay update of that tween also kept a
// repaint queued at the moment a pane changed size — see
// src/canvas/frameLoop.ts for what that did to the drawings layer.) The
// overlay is only updated when the visible high/low or its label actually
// changes. `visibleHighLow` is the pure part; `attachHighLowTags` is the thin
// wiring, driven by klinecharts' own actions (subscribeAction).
//
// Part of SUPer-Chart (Apache-2.0).

export interface HighLowBar { high: number, low: number }

export interface VisibleHighLow { high: number, low: number, highIndex: number, lowIndex: number }

/** The highest high / lowest low over `dataList[from..to]` (inclusive), or null for an empty/out-of-range window. */
export function visibleHighLow (dataList: readonly HighLowBar[], from: number, to: number): VisibleHighLow | null {
  const lo = Math.max(0, Math.floor(from))
  const hi = Math.min(dataList.length - 1, Math.floor(to))
  if (hi < lo) return null
  let high = -Infinity, low = Infinity, highIndex = lo, lowIndex = lo
  for (let i = lo; i <= hi; i++) {
    const bar = dataList[i]
    if (!Number.isFinite(bar.high) || !Number.isFinite(bar.low)) continue
    if (bar.high > high) { high = bar.high; highIndex = i }
    if (bar.low < low) { low = bar.low; lowIndex = i }
  }
  if (!Number.isFinite(high) || !Number.isFinite(low)) return null
  return { high, low, highIndex, lowIndex }
}

export const HIGH_LOW_OVERLAY_NAME = 'scHighLowTags'
export const HIGH_LOW_GROUP_ID = '__sc_high_low_tags'

export interface HighLowExtendData {
  /** The visible range's highest high and lowest low (prices); the template places them with the live axis. */
  high?: number
  low?: number
  /** A fixed pixel y per tag, for a caller without prices; ignored when `high`/`low` are set. */
  highY?: number
  lowY?: number
  highText: string
  lowText: string
  /**
   * Optional override for BOTH tags' background colour. Left unset in normal
   * operation (attachHighLowTags never sets it) so each tag falls through to
   * its own directional default in the template below (green-ish for the
   * high tag, red-ish for the low tag) — this field exists only for a host
   * that wants one flat colour on both. Must stay optional: an earlier bug
   * here defaulted it to `''` (an always-truthy-for-`??` empty string), which
   * silently broke both tags to invisible white-text-on-white-background —
   * caught visually, not by a unit test (`buildHighLowOverlayTemplate` is
   * pure and correctly falls back on `undefined`; only a caller passing `''`
   * defeats it), which is why it is called out here.
   */
  color?: string
}

interface OverlayFigureLike { type: string, ignoreEvent?: boolean, attrs: unknown, styles?: unknown }
interface CreateYAxisFiguresParams { overlay: { extendData: unknown }, bounding: { width: number }, yAxis?: { convertToPixel: (value: number) => number } | null }

export type RegisterOverlayFn = (template: {
  name: string
  needDefaultPointFigure: boolean
  needDefaultXAxisFigure: boolean
  needDefaultYAxisFigure: boolean
  createPointFigures: () => OverlayFigureLike[]
  createYAxisFigures: (params: CreateYAxisFiguresParams) => OverlayFigureLike[]
}) => void

function tag (y: number, text: string, color: string, width: number): OverlayFigureLike {
  return {
    type: 'text',
    ignoreEvent: true,
    attrs: { x: width - 4, y, text, align: 'right', baseline: 'middle' },
    styles: {
      color: '#FFFFFF',
      size: 11,
      // No `family`: klinecharts' createFont() concatenates it verbatim into
      // the canvas `ctx.font` string ('${weight} ${size}px ${family}') with
      // no CSS cascade behind it, so the keyword 'inherit' is not a valid
      // font-family token there — the assignment is silently ignored and the
      // canvas keeps whatever font a previous draw call left it at. Omitting
      // the key falls through to klinecharts' own default ('Helvetica Neue'),
      // the same font every other unstyled figure in this engine gets.
      weight: 'normal',
      paddingLeft: 5,
      paddingRight: 5,
      paddingTop: 2,
      paddingBottom: 2,
      borderRadius: 3,
      borderSize: 0,
      backgroundColor: color
    }
  }
}

export function buildHighLowOverlayTemplate (): Parameters<RegisterOverlayFn>[0] {
  return {
    name: HIGH_LOW_OVERLAY_NAME,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: () => [],
    createYAxisFigures: ({ overlay, bounding, yAxis }) => {
      const data = overlay.extendData as Partial<HighLowExtendData> | undefined
      if (data === undefined) return []
      const toY = (value: number | undefined, fixed: number | undefined): number | null => {
        if (typeof value === 'number' && Number.isFinite(value) && yAxis !== null && yAxis !== undefined) {
          const y = yAxis.convertToPixel(value)
          return Number.isFinite(y) ? y : null
        }
        return typeof fixed === 'number' && Number.isFinite(fixed) ? fixed : null
      }
      const highY = toY(data.high, data.highY)
      const lowY = toY(data.low, data.lowY)
      if (highY === null || lowY === null) return []
      return [
        tag(highY, data.highText ?? '', data.color ?? '#26A69A', bounding.width),
        tag(lowY, data.lowText ?? '', data.color ?? '#EF5350', bounding.width)
      ]
    }
  }
}

let registered = false

export function registerHighLowOverlay (registerOverlay: RegisterOverlayFn): void {
  if (registered) return
  registered = true
  registerOverlay(buildHighLowOverlayTemplate())
}

export function _resetHighLowRegistrationForTest (): void {
  registered = false
}

export interface HighLowChart {
  getDataList: () => HighLowBar[]
  getVisibleRange: () => { from: number, to: number }
  createOverlay: (value: unknown, paneId?: string) => unknown
  overrideOverlay: (override: { id: string, extendData: HighLowExtendData }) => void
  removeOverlay: (remove?: unknown) => void
  subscribeAction: (type: string, callback: () => void) => void
  unsubscribeAction: (type: string, callback: () => void) => void
}

export interface AttachHighLowTagsOptions {
  enabled?: () => boolean
  registerOverlay: RegisterOverlayFn
  formatPrice: (value: number) => string
  actionTypes: readonly string[]
}

/** Mounts the two tags on `chart`; returns a dispose function. Mirrors attachBarCountdown's lifecycle (lazy create, onRemoved re-create-on-next-refresh). */
export function attachHighLowTags (chart: HighLowChart, options: AttachHighLowTagsOptions): () => void {
  registerHighLowOverlay(options.registerOverlay)
  let id: string | null = null
  let disposed = false
  let removingIntentionally = false
  // What the overlay shows now, so an action that changes nothing on the tags
  // (almost every frame of a pan) costs no overlay update.
  let shown: HighLowExtendData | null = null

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
      name: HIGH_LOW_OVERLAY_NAME,
      groupId: HIGH_LOW_GROUP_ID,
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
    const active = options.enabled?.() ?? true
    const range = chart.getVisibleRange()
    const hl = active ? visibleHighLow(chart.getDataList(), range.from, range.to) : null
    if (hl === null) {
      removeOverlayById()
      shown = null
      return
    }
    const highText = options.formatPrice(hl.high)
    const lowText = options.formatPrice(hl.low)
    if (id !== null && shown !== null && shown.high === hl.high && shown.low === hl.low && shown.highText === highText && shown.lowText === lowText) {
      return
    }
    const oid = ensureOverlay()
    if (oid === null) return
    shown = { high: hl.high, low: hl.low, highText, lowText }
    chart.overrideOverlay({ id: oid, extendData: shown })
  }

  options.actionTypes.forEach(type => { chart.subscribeAction(type, refresh) })
  refresh()

  return () => {
    if (disposed) return
    disposed = true
    options.actionTypes.forEach(type => { chart.unsubscribeAction(type, refresh) })
    removeOverlayById()
  }
}
