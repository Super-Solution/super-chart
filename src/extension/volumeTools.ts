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

// Data-driven TradingView tools: anchored VWAP, fixed-range volume profile,
// anchored volume profile, and a linear-regression trend channel. Each reads
// the chart's OHLCV in the anchored range via the dataAccess bridge, resolved
// per pane (SC-008) — not a module-global "the chart", which broke on any page
// with two SuperCharts. Each anchors on the bar its handle is actually drawn on
// (SC-161: from the point's timestamp, which survives loadMore prepending
// older bars; a stale `dataIndex` used to drift by exactly the page size).
//
// Perf (SC-007): recomputing the whole anchor-to-end range on every repaint
// made the crosshair heavier the more history sat behind the anchor (tens of
// thousands of pixel conversions per frame with a lot of loaded history).
// anchoredVWAP now keeps a running cumulative sum per overlay (rangeCache
// below) and converts only the bars actually on screen; the two profiles and
// the regression — which convert only a handful of points regardless of the
// range's length — cache their finished result and skip the O(n) scan
// whenever neither the data nor the anchors changed since the last frame.
//
// Part of SUPer-Chart (Apache-2.0).

import { type OverlayTemplate, type Coordinate } from 'klinecharts'
import { type AxisParams, klineList, toPixels } from './dataAccess'
import { barIndexOf } from './barIndexOf'
import { hitPath } from './hitPath'
import { volumeProfile } from './volumeProfile'

interface OverlayPoint { dataIndex?: number, timestamp?: number, value?: number }
interface Bar { timestamp: number, open: number, high: number, low: number, close: number, volume?: number }

const anchorsOf = (overlay: { points: readonly OverlayPoint[] }, data: readonly Bar[], count: number): Array<number | null> =>
  Array.from({ length: count }, (_, i) => barIndexOf(overlay.points[i] ?? {}, data))

// ---------------------------------------------------------------------------
// A tiny per-overlay cache shared by the profiles and the regression: they
// each convert only a handful of points, so the win is skipping the O(range)
// scan entirely when nothing that would change the result has changed.
// ---------------------------------------------------------------------------

interface RangeEntry<T> {
  dataRef: readonly Bar[]
  firstTimestamp: number
  lo: number
  hi: number
  /** The last bar's own OHLCV, when `hi` is the last loaded bar (a live tick changes this without changing `hi`). */
  lastBarKey: string
  value: T
}

const rangeCache = new WeakMap<object, RangeEntry<unknown>>()

function lastBarKey (data: readonly Bar[], hi: number): string {
  const b = data[hi]
  return b === undefined ? '' : `${b.timestamp},${b.open},${b.high},${b.low},${b.close},${b.volume ?? 0}`
}

/** Reuse the last result for this overlay when the range and its live edge are unchanged; otherwise recompute and cache. */
function cachedRange<T> (overlay: object, data: readonly Bar[], lo: number, hi: number, compute: () => T): T {
  const firstTimestamp = data[0]?.timestamp ?? 0
  const key = hi === data.length - 1 ? lastBarKey(data, hi) : ''
  const prev = rangeCache.get(overlay) as RangeEntry<T> | undefined
  if (prev !== undefined && prev.dataRef === data && prev.firstTimestamp === firstTimestamp && prev.lo === lo && prev.hi === hi && prev.lastBarKey === key) {
    return prev.value
  }
  const value = compute()
  rangeCache.set(overlay, { dataRef: data, firstTimestamp, lo, hi, lastBarKey: key, value })
  return value
}

// ---------------------------------------------------------------------------
// Anchored VWAP: a running cumulative (price*volume, volume) sum per overlay,
// covering every bar up to (but not including) the still-forming last bar —
// which is recomputed fresh each time since a live tick changes it in place.
// A prepend (loadMore) or a different anchor invalidates the cache outright;
// an append (a new bar closing) only extends it.
// ---------------------------------------------------------------------------

interface VwapEntry {
  dataRef: readonly Bar[]
  firstTimestamp: number
  anchor: number
  /** Cumulative pv/vol for bars [anchor, committedEnd], one entry per bar. */
  pv: number[]
  vol: number[]
  /** Last index covered by pv/vol — data.length - 2 (the bar before the live one), or anchor - 1 when too short. */
  committedEnd: number
}

const vwapCache = new WeakMap<object, VwapEntry>()

function typicalPrice (b: Bar): number {
  return (b.high + b.low + b.close) / 3
}

function vwapSums (overlay: object, data: readonly Bar[], anchor: number): VwapEntry {
  const firstTimestamp = data[0]?.timestamp ?? 0
  const committedEnd = data.length - 2
  const prev = vwapCache.get(overlay)
  const validBase = prev !== undefined && prev.dataRef === data && prev.firstTimestamp === firstTimestamp && prev.anchor === anchor
  if (validBase && prev.committedEnd === committedEnd) {
    return prev
  }
  const pv: number[] = []
  const vol: number[] = []
  let start = anchor
  let pvSum = 0
  let volSum = 0
  // Extend the previous run when only new bars were appended (an in-place
  // edit of the still-live last bar is never part of `pv`/`vol`, so this is
  // always safe): O(new bars) instead of O(anchor..end).
  if (validBase && prev.committedEnd < committedEnd && prev.committedEnd >= anchor - 1) {
    pv.push(...prev.pv)
    vol.push(...prev.vol)
    start = prev.committedEnd + 1
    pvSum = pv.length > 0 ? pv[pv.length - 1] : 0
    volSum = vol.length > 0 ? vol[vol.length - 1] : 0
  }
  for (let i = start; i <= committedEnd; i++) {
    const b = data[i]
    pvSum += typicalPrice(b) * (b.volume ?? 0)
    volSum += b.volume ?? 0
    pv.push(pvSum)
    vol.push(volSum)
  }
  const entry: VwapEntry = { dataRef: data, firstTimestamp, anchor, pv, vol, committedEnd }
  vwapCache.set(overlay, entry)
  return entry
}

/** VWAP value at bar `i` (i >= entry.anchor): O(1) from the cache, extended live for the still-forming last bar(s). */
function vwapAt (entry: VwapEntry, data: readonly Bar[], i: number): number | null {
  if (i < entry.anchor) {
    return null
  }
  if (i <= entry.committedEnd) {
    const idx = i - entry.anchor
    const v = entry.vol[idx]
    return v > 0 ? entry.pv[idx] / v : null
  }
  let pvSum = entry.committedEnd >= entry.anchor ? entry.pv[entry.committedEnd - entry.anchor] : 0
  let volSum = entry.committedEnd >= entry.anchor ? entry.vol[entry.committedEnd - entry.anchor] : 0
  for (let j = entry.committedEnd + 1; j <= i; j++) {
    const b = data[j]
    pvSum += typicalPrice(b) * (b.volume ?? 0)
    volSum += b.volume ?? 0
  }
  return volSum > 0 ? pvSum / volSum : null
}

/** The visible bar range (+1 bar of padding either side), clamped to [lo, data.length - 1]. */
function visibleBarRange (xAxis: AxisParams['xAxis'], boundingWidth: number, data: readonly Bar[], lo: number): [number, number] | null {
  if (xAxis === null || xAxis === undefined || data.length === 0) {
    return null
  }
  try {
    const a = xAxis.convertFromPixel(0)
    const b = xAxis.convertFromPixel(boundingWidth)
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      return null
    }
    const from = Math.max(lo, Math.floor(Math.min(a, b)) - 1)
    const to = Math.min(data.length - 1, Math.ceil(Math.max(a, b)) + 1)
    return from <= to ? [from, to] : null
  } catch {
    return null
  }
}

export const anchoredVWAP: OverlayTemplate = {
  name: 'anchoredVWAP',
  totalStep: 2,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  createPointFigures: (params) => {
    const { overlay, xAxis, yAxis, bounding } = params
    const data = klineList(params) as Bar[]
    const [anchor] = anchorsOf(overlay, data, 1)
    if (data.length === 0 || anchor === null || xAxis === null || xAxis === undefined || yAxis === null || yAxis === undefined) {
      return []
    }
    const lo = Math.max(0, anchor)
    if (lo > data.length - 1) {
      return []
    }
    const entry = vwapSums(overlay, data, lo)
    const range = visibleBarRange(xAxis, bounding?.width ?? 0, data, lo) ?? [lo, data.length - 1]
    const coordinates: Coordinate[] = []
    for (let i = range[0]; i <= range[1]; i++) {
      const value = vwapAt(entry, data, i)
      if (value === null) {
        continue
      }
      try {
        const x = xAxis.convertToPixel(i)
        const y = yAxis.convertToPixel(value)
        if (Number.isFinite(x) && Number.isFinite(y)) {
          coordinates.push({ x, y })
        }
      } catch { /* ignore */ }
    }
    if (coordinates.length < 2) {
      return []
    }
    return [{ type: 'line', ignoreEvent: true, attrs: { coordinates }, styles: { color: '#7e57c2', size: 2 } }, hitPath(coordinates)]
  }
}

// Fixed-range volume profile — volume binned by price across the anchored range
// (spread across every row a bar's [low, high] touches, not dropped into one
// "typical price" row — see ./volumeProfile.ts, SC-171), drawn as a horizontal
// histogram from the range's left edge, with a POC line.
export const fixedRangeVolumeProfile: OverlayTemplate = {
  name: 'fixedRangeVolumeProfile',
  totalStep: 3,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  createPointFigures: (params) => {
    const { overlay, coordinates } = params
    const data = klineList(params) as Bar[]
    const [a, b] = anchorsOf(overlay, data, 2)
    if (coordinates.length < 2 || data.length === 0 || a === null || b === null) return []
    const lo = Math.max(0, Math.min(a, b)), hi = Math.min(data.length - 1, Math.max(a, b))
    if (hi <= lo) return []
    const profile = cachedRange(overlay, data, lo, hi, () => {
      const bars = []
      for (let i = lo; i <= hi; i++) bars.push({ high: data[i].high, low: data[i].low, volume: data[i].volume ?? 0 })
      return volumeProfile(bars, { rows: BINS })
    })
    if (profile.rows.length === 0) return []
    const maxVol = profile.rows.reduce((m, r) => Math.max(m, r.volume), 0) || 1
    const edges = toPixels(params, [{ dataIndex: lo, value: profile.pmax }, { dataIndex: lo, value: profile.pmin }])
    if (edges.length < 2) return []
    const topY = edges[0].y, botY = edges[1].y
    const binH = (botY - topY) / profile.rows.length
    const leftX = Math.min(coordinates[0].x, coordinates[1].x)
    const boxW = Math.abs(coordinates[1].x - coordinates[0].x) || 120
    const figs: ReturnType<NonNullable<OverlayTemplate['createPointFigures']>> = []
    profile.rows.forEach((row, bi) => {
      if (row.volume <= 0) return
      const w = (row.volume / maxVol) * boxW * 0.95
      const yc = botY - (bi + 0.5) * binH
      const y0 = yc - Math.abs(binH) * 0.42, y1 = yc + Math.abs(binH) * 0.42
      // bins are clickable, so a finished profile can be selected and edited
      figs.push({
        type: 'polygon',
        attrs: { coordinates: [{ x: leftX, y: y0 }, { x: leftX + w, y: y0 }, { x: leftX + w, y: y1 }, { x: leftX, y: y1 }] },
        styles: { style: 'fill', color: 'rgba(126, 87, 194, 0.45)' }
      })
    })
    const pocEdge = toPixels(params, [{ dataIndex: lo, value: profile.poc }])
    if (pocEdge.length >= 1 && Number.isFinite(pocEdge[0].y)) {
      figs.push({ type: 'line', ignoreEvent: true, attrs: { coordinates: [{ x: leftX, y: pocEdge[0].y }, { x: leftX + boxW, y: pocEdge[0].y }] }, styles: { style: 'dashed', color: 'rgba(126, 87, 194, 0.9)', size: 1 } })
    }
    return figs
  }
}

const BINS = 24

// Anchored volume profile — like fixed-range, but from the anchor to the latest bar.
export const anchoredVolumeProfile: OverlayTemplate = {
  name: 'anchoredVolumeProfile',
  totalStep: 2,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  createPointFigures: (params) => {
    const { overlay, coordinates } = params
    const data = klineList(params) as Bar[]
    const [a] = anchorsOf(overlay, data, 1)
    if (coordinates.length < 1 || data.length === 0 || a === null) return []
    const lo = Math.max(0, a), hi = data.length - 1
    if (hi <= lo) return []
    const profile = cachedRange(overlay, data, lo, hi, () => {
      const bars = []
      for (let i = lo; i <= hi; i++) bars.push({ high: data[i].high, low: data[i].low, volume: data[i].volume ?? 0 })
      return volumeProfile(bars, { rows: BINS })
    })
    if (profile.rows.length === 0) return []
    const maxVol = profile.rows.reduce((m, r) => Math.max(m, r.volume), 0) || 1
    const edges = toPixels(params, [{ dataIndex: lo, value: profile.pmax }, { dataIndex: lo, value: profile.pmin }])
    if (edges.length < 2) return []
    const topY = edges[0].y, botY = edges[1].y
    const binH = (botY - topY) / profile.rows.length
    const leftX = coordinates[0].x
    const maxW = 120
    const figs: unknown[] = []
    profile.rows.forEach((row, bi) => {
      if (row.volume <= 0) return
      const w = (row.volume / maxVol) * maxW
      const yc = botY - (bi + 0.5) * binH
      const y0 = yc - Math.abs(binH) * 0.42, y1 = yc + Math.abs(binH) * 0.42
      figs.push({ type: 'polygon', attrs: { coordinates: [{ x: leftX, y: y0 }, { x: leftX + w, y: y0 }, { x: leftX + w, y: y1 }, { x: leftX, y: y1 }] }, styles: { style: 'fill', color: 'rgba(126, 87, 194, 0.45)' } })
    })
    const pocEdge = toPixels(params, [{ dataIndex: lo, value: profile.poc }])
    if (pocEdge.length >= 1 && Number.isFinite(pocEdge[0].y)) {
      figs.push({ type: 'line', ignoreEvent: true, attrs: { coordinates: [{ x: leftX, y: pocEdge[0].y }, { x: leftX + maxW, y: pocEdge[0].y }] }, styles: { style: 'dashed', color: 'rgba(126, 87, 194, 0.9)', size: 1 } })
    }
    return figs as ReturnType<NonNullable<OverlayTemplate['createPointFigures']>>
  }
}

function regressionOf (data: readonly Bar[], lo: number, hi: number): { slope: number, intercept: number, sd: number } {
  const n = hi - lo + 1
  let sx = 0, sy = 0, sxx = 0, sxy = 0
  for (let i = lo; i <= hi; i++) { const x = i - lo, y = data[i].close; sx += x; sy += y; sxx += x * x; sxy += x * y }
  const denom = n * sxx - sx * sx || 1
  const slope = (n * sxy - sx * sy) / denom
  const intercept = (sy - slope * sx) / n
  let dev = 0
  for (let i = lo; i <= hi; i++) { const fit = intercept + slope * (i - lo); dev += (data[i].close - fit) ** 2 }
  return { slope, intercept, sd: Math.sqrt(dev / n) }
}

// Linear-regression trend — least-squares line of closes over the range + a ±2σ channel,
// in the chart's drawing colour (overlay.line.color: the accent).
export const regressionTrend: OverlayTemplate = {
  name: 'regressionTrend',
  totalStep: 3,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  createPointFigures: (params) => {
    const { overlay } = params
    const data = klineList(params) as Bar[]
    const [a, b] = anchorsOf(overlay, data, 2)
    if (data.length === 0 || a === null || b === null) return []
    const lo = Math.max(0, Math.min(a, b)), hi = Math.min(data.length - 1, Math.max(a, b))
    if (hi <= lo) return []
    const { slope, intercept, sd } = cachedRange(overlay, data, lo, hi, () => regressionOf(data, lo, hi))
    const yAt = (i: number): number => intercept + slope * (i - lo)
    const mid = toPixels(params, [{ dataIndex: lo, value: yAt(lo) }, { dataIndex: hi, value: yAt(hi) }])
    const up = toPixels(params, [{ dataIndex: lo, value: yAt(lo) + 2 * sd }, { dataIndex: hi, value: yAt(hi) + 2 * sd }])
    const dn = toPixels(params, [{ dataIndex: lo, value: yAt(lo) - 2 * sd }, { dataIndex: hi, value: yAt(hi) - 2 * sd }])
    const figs: unknown[] = []
    if (mid.length === 2) figs.push({ type: 'line', ignoreEvent: true, attrs: { coordinates: mid }, styles: { size: 2 } }, hitPath(mid))
    if (up.length === 2) figs.push({ type: 'line', ignoreEvent: true, attrs: { coordinates: up }, styles: { size: 1, style: 'dashed' } })
    if (dn.length === 2) figs.push({ type: 'line', ignoreEvent: true, attrs: { coordinates: dn }, styles: { size: 1, style: 'dashed' } })
    return figs as ReturnType<NonNullable<OverlayTemplate['createPointFigures']>>
  }
}
