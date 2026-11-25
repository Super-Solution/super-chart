// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Market-depth overlays that the host feeds with its own data: an order-book heatmap and a liquidation map.
 *
 * Super Chart does not fetch, store or invent this data. Order-book depth and liquidation levels come from exchanges
 * (or an aggregator) under the host's own terms, so the chart only defines the shape it accepts and draws it. Both
 * projections are pure: they read the frame and the data and return plain numbers a canvas (or anything else) can draw.
 * Bad input is reported in `status`, never drawn as if it were fine.
 */
import type { EngineFrame } from './frame'
import type { MarketOverlayRect } from './marketOverlays'
import type { MarketBar } from '../types'

/** One resting-liquidity level of an order book: price and the size resting there (any consistent unit). */
export type DepthLevel = readonly [price: number, size: number]
/** The order book at one moment. Bids and asks go in the same list; the heatmap does not tell them apart. */
export interface DepthSnapshot { readonly timestamp: number, readonly levels: readonly DepthLevel[] }

export type DepthOverlayStatus = 'off' | 'ready' | 'empty' | 'invalid-data'

export interface DepthHeatmapOptions {
  /** How size becomes brightness. `sqrt` (default) keeps thin liquidity visible next to walls; `linear` is literal. */
  intensity?: 'linear' | 'sqrt' | 'log'
  /** Share of the non-empty cells that may be brighter than full brightness, from 0.5 to 1. 0.98 means the top 2% saturate. @default 0.98 */
  clip?: number
  /** Most price rows, from 1 to 400. Rows are about 4 px tall and never fewer than 1 px. @default 120 */
  maxRows?: number
  /** Most time columns, from 1 to 1000. @default 300 */
  maxColumns?: number
  /** Snapshots older than this (milliseconds) are not carried forward into later columns. Default: carried until replaced. */
  maxAgeMs?: number
}

export interface DepthHeatmapFrame {
  readonly bounds: Readonly<{ left: number, right: number, top: number, bottom: number }>
  readonly columns: number
  readonly rows: number
  /** Row-major, row 0 at the top. 0 = nothing resting there, 1 = the clipped maximum. Length is `rows * columns`. */
  readonly intensity: Float32Array
  /** The size that reads as full brightness (after clipping). 0 when `status` is not `ready`. */
  readonly saturationSize: number
  /** Largest single cell, before clipping. */
  readonly peakSize: number
  /** Number of snapshots that fed at least one cell. */
  readonly snapshotsUsed: number
  readonly status: DepthOverlayStatus
}

/** Aggregated sorted levels of one snapshot, so a cell's total is two binary searches. Cached per snapshot object. */
interface Ladder { prices: Float64Array, running: Float64Array }
const ladders = new WeakMap<readonly DepthLevel[], Ladder | null>()

function ladderOf (levels: readonly DepthLevel[]): Ladder | null {
  const cached = ladders.get(levels)
  if (cached !== undefined) return cached
  let valid = true
  for (const level of levels) {
    if (!Array.isArray(level) || level.length < 2 || !Number.isFinite(level[0]) || !Number.isFinite(level[1]) || level[1] < 0) { valid = false; break }
  }
  let result: Ladder | null = null
  if (valid) {
    const sorted = [...levels].sort((a, b) => a[0] - b[0])
    const prices = new Float64Array(sorted.length), running = new Float64Array(sorted.length + 1)
    for (let i = 0; i < sorted.length; i++) { prices[i] = sorted[i][0]; running[i + 1] = running[i] + sorted[i][1] }
    result = { prices, running }
  }
  ladders.set(levels, result)
  return result
}
/** First index whose price is at least `price`. */
function lowerBound (prices: Float64Array, price: number): number {
  let lo = 0, hi = prices.length
  while (lo < hi) { const mid = (lo + hi) >> 1; if (prices[mid] < price) lo = mid + 1; else hi = mid }
  return lo
}
/** Total size of the levels with `low <= price < high`. Neighbouring rows share an edge, so no level counts twice. */
function sizeBetween (ladder: Ladder, low: number, high: number): number {
  const from = lowerBound(ladder.prices, low), to = lowerBound(ladder.prices, high)
  return to > from ? ladder.running[to] - ladder.running[from] : 0
}

function integerIn (value: number, min: number, max: number, label: string): number {
  if (!Number.isInteger(value) || value < min || value > max) throw new RangeError(`${label} must be an integer from ${min} to ${max}`)
  return value
}

function emptyHeatmap (bounds: DepthHeatmapFrame['bounds'], status: DepthOverlayStatus): DepthHeatmapFrame {
  return Object.freeze({ bounds, columns: 0, rows: 0, intensity: new Float32Array(0), saturationSize: 0, peakSize: 0, snapshotsUsed: 0, status })
}

/** Snapshots checked and sampled per column: more would only repeat the same shape at a growing cost. */
const SAMPLES_PER_COLUMN = 4
/** Non-empty cells looked at to find the clipping size; a sample is enough for a percentile. */
const CLIP_SAMPLE = 4096

/**
 * Order-book heatmap. The plot is cut into time columns (one per bar, fewer when bars are narrower than 3 px) and price
 * rows (about 4 px tall; the height follows the price scale, so a logarithmic scale stays right). A cell holds the most
 * liquidity that rested in its price band at any of up to four snapshots inside the column; a column with no snapshot
 * of its own carries the last earlier snapshot forward (up to `maxAgeMs`). Columns after the last bar stay empty.
 *
 * Snapshots must be in ascending time order and must not be changed after they are passed in (the sorted form of each is
 * cached against its `levels` array; replace the snapshot instead of editing it). A malformed level in a snapshot that
 * would be drawn (non-finite price, negative or non-finite size) makes the status `invalid-data` and draws nothing.
 */
export function projectDepthHeatmap (frame: EngineFrame, rawBars: readonly MarketBar[], snapshots: readonly DepthSnapshot[], options: DepthHeatmapOptions = {}): DepthHeatmapFrame {
  const g = frame.model.geometry
  const bounds = Object.freeze({ left: g.left, right: g.right, top: g.top, bottom: g.bottom })
  const intensity = options.intensity ?? 'sqrt'
  if (intensity !== 'linear' && intensity !== 'sqrt' && intensity !== 'log') throw new RangeError("Heatmap intensity must be 'linear', 'sqrt' or 'log'")
  const clip = options.clip ?? 0.98
  if (!Number.isFinite(clip) || clip < 0.5 || clip > 1) throw new RangeError('Heatmap clip must be from 0.5 to 1')
  const maxRows = integerIn(options.maxRows ?? 120, 1, 400, 'Heatmap rows')
  const maxColumns = integerIn(options.maxColumns ?? 300, 1, 1000, 'Heatmap columns')
  if (options.maxAgeMs !== undefined && !(Number.isFinite(options.maxAgeMs) && options.maxAgeMs > 0)) throw new RangeError('Heatmap maxAgeMs must be a positive finite number of milliseconds')
  if (rawBars.length === 0 || snapshots.length === 0 || !(g.right > g.left) || !(g.bottom > g.top)) return emptyHeatmap(bounds, 'empty')
  const view = frame.snapshot.viewport, span = view.i1 - view.i0
  if (!(span > 0)) return emptyHeatmap(bounds, 'empty')
  for (let i = 0; i < snapshots.length; i++) {
    if (!Number.isFinite(snapshots[i].timestamp) || (i > 0 && snapshots[i].timestamp < snapshots[i - 1].timestamp)) return emptyHeatmap(bounds, 'invalid-data')
  }
  const scale = frame.panes[0]?.scale
  if (scale === undefined) return emptyHeatmap(bounds, 'empty')
  const columns = Math.max(1, Math.min(maxColumns, Math.floor(g.plotWidth / 3), Math.ceil(span)))
  const rows = Math.max(1, Math.min(maxRows, Math.floor((g.bottom - g.top) / 4)))
  const cells = new Float32Array(rows * columns)
  // Time of a (fractional) bar index; past the last bar the final bar's length is repeated.
  const last = rawBars.length - 1
  const stepAfter = last > 0 ? rawBars[last].timestamp - rawBars[last - 1].timestamp : 60_000
  const timeAt = (index: number): number => {
    if (index <= 0) return rawBars[0].timestamp + index * (rawBars.length > 1 ? rawBars[1].timestamp - rawBars[0].timestamp : stepAfter)
    if (index >= last) return rawBars[last].timestamp + (index - last) * stepAfter
    const left = Math.floor(index), a = rawBars[left].timestamp, b = rawBars[left + 1].timestamp
    return a + (b - a) * (index - left)
  }
  // Price band of each row, from the pane's own scale.
  const rowHeight = (g.bottom - g.top) / rows
  const bandLow = new Float64Array(rows), bandHigh = new Float64Array(rows)
  for (let r = 0; r < rows; r++) {
    const a = scale.value(g.top + r * rowHeight), b = scale.value(g.top + (r + 1) * rowHeight)
    bandLow[r] = Math.min(a, b); bandHigh[r] = Math.max(a, b)
    if (!Number.isFinite(bandLow[r]) || !Number.isFinite(bandHigh[r])) return emptyHeatmap(bounds, 'empty')
  }
  const lastDataTime = timeAt(last + 1)
  // Index of the first snapshot strictly after `time`.
  const after = (time: number): number => {
    let lo = 0, hi = snapshots.length
    while (lo < hi) { const mid = (lo + hi) >> 1; if (snapshots[mid].timestamp <= time) lo = mid + 1; else hi = mid }
    return lo
  }
  const used = new Set<number>()
  let peak = 0
  for (let c = 0; c < columns; c++) {
    const startTime = timeAt(view.i0 + c * span / columns), endTime = timeAt(view.i0 + (c + 1) * span / columns)
    if (startTime >= lastDataTime || endTime <= rawBars[0].timestamp) continue
    const from = after(startTime), to = after(endTime) // snapshots inside (start, end]
    const picks: number[] = []
    if (to > from) {
      const count = Math.min(SAMPLES_PER_COLUMN, to - from)
      for (let k = 0; k < count; k++) picks.push(count === 1 ? to - 1 : from + Math.round(k * (to - from - 1) / (count - 1)))
    } else if (from > 0) {
      // Nothing inside the column: the last earlier snapshot still stands, unless it is too old to trust.
      const carried = from - 1
      if (options.maxAgeMs === undefined || endTime - snapshots[carried].timestamp <= options.maxAgeMs) picks.push(carried)
    }
    for (const pick of picks) {
      const ladder = ladderOf(snapshots[pick].levels)
      if (ladder === null) return emptyHeatmap(bounds, 'invalid-data')
      used.add(pick)
      for (let r = 0; r < rows; r++) {
        const size = sizeBetween(ladder, bandLow[r], bandHigh[r])
        const at = r * columns + c
        if (size > cells[at]) { cells[at] = size; if (size > peak) peak = size }
      }
    }
  }
  if (!(peak > 0)) return emptyHeatmap(bounds, 'empty')
  // The brightest `1 - clip` of the non-empty cells saturate, so one huge wall does not wash the rest out.
  const filled: number[] = []
  const stride = Math.max(1, Math.floor(cells.length / CLIP_SAMPLE))
  for (let i = 0; i < cells.length; i += stride) if (cells[i] > 0) filled.push(cells[i])
  filled.sort((a, b) => a - b)
  const saturation = filled.length === 0 ? peak : Math.max(filled[Math.min(filled.length - 1, Math.floor(clip * filled.length))], Number.MIN_VALUE)
  const out = new Float32Array(cells.length)
  const shape = (ratio: number): number => intensity === 'linear' ? ratio : intensity === 'sqrt' ? Math.sqrt(ratio) : Math.log1p(ratio * 99) / Math.log(100)
  for (let i = 0; i < cells.length; i++) if (cells[i] > 0) out[i] = shape(Math.min(1, cells[i] / saturation))
  return Object.freeze({ bounds, columns, rows, intensity: out, saturationSize: saturation, peakSize: peak, snapshotsUsed: used.size, status: 'ready' as const })
}

// ---------------------------------------------------------------------------------------------------------------------

/** Estimated liquidations that trigger when price reaches `price`: long positions closing (sells) and short positions closing (buys). */
export interface LiquidationLevel { readonly price: number, readonly long?: number, readonly short?: number }

export interface LiquidationMapOptions {
  /**
   * `false` (default): the estimated size at each price. `true`: the running total moving away from the last close, so a row
   * shows everything that would be liquidated if price travelled there (longs below the close, shorts above it).
   */
  cumulative?: boolean
  /** Most price rows, from 1 to 400; rows are about 4 px tall. @default 120 */
  maxRows?: number
  /** Fraction of plot width taken by the largest bar. @default 0.25 */
  widthFraction?: number
}

export interface LiquidationRow {
  readonly priceLow: number
  readonly priceHigh: number
  readonly long: number
  readonly short: number
  /** Bars grow left from the right edge of the plot; the short bar sits to the left of the long bar. Null when nothing there. */
  readonly longRect: MarketOverlayRect | null
  readonly shortRect: MarketOverlayRect | null
}
export interface LiquidationMapFrame {
  readonly bounds: Readonly<{ left: number, right: number, top: number, bottom: number }>
  readonly rows: readonly LiquidationRow[]
  /** The largest long + short of any row: the value that fills `widthFraction` of the plot. */
  readonly peak: number
  /** Last close, the point the cumulative view counts away from. */
  readonly referencePrice: number | null
  readonly referenceY: number | null
  readonly status: DepthOverlayStatus
}

/**
 * Liquidation map. Price rows (about 4 px tall, following the price scale) each sum the levels inside their band. In the
 * cumulative view longs are summed downward from the last close and shorts upward, and a level on the wrong side of the
 * close (a long above it) counts for nothing: it has already been triggered. Negative or non-finite sizes or prices make
 * the status `invalid-data`.
 */
export function projectLiquidationMap (frame: EngineFrame, rawBars: readonly MarketBar[], levels: readonly LiquidationLevel[], options: LiquidationMapOptions = {}): LiquidationMapFrame {
  const g = frame.model.geometry
  const bounds = Object.freeze({ left: g.left, right: g.right, top: g.top, bottom: g.bottom })
  const none = (status: DepthOverlayStatus): LiquidationMapFrame => Object.freeze({ bounds, rows: Object.freeze([]), peak: 0, referencePrice: null, referenceY: null, status })
  const maxRows = integerIn(options.maxRows ?? 120, 1, 400, 'Liquidation map rows')
  const widthFraction = options.widthFraction ?? 0.25
  if (!Number.isFinite(widthFraction) || widthFraction < 0 || widthFraction > 1) throw new RangeError('Liquidation map width must be between 0 and 1')
  if (levels.length === 0 || rawBars.length === 0 || !(g.right > g.left) || !(g.bottom > g.top)) return none('empty')
  const scale = frame.panes[0]?.scale
  if (scale === undefined) return none('empty')
  for (const level of levels) {
    const long = level.long ?? 0, short = level.short ?? 0
    if (!Number.isFinite(level.price) || !Number.isFinite(long) || !Number.isFinite(short) || long < 0 || short < 0) return none('invalid-data')
  }
  const reference = rawBars[rawBars.length - 1].close
  const cumulative = options.cumulative === true
  const rows = Math.max(1, Math.min(maxRows, Math.floor((g.bottom - g.top) / 4)))
  const rowHeight = (g.bottom - g.top) / rows
  const low = new Float64Array(rows), high = new Float64Array(rows), long = new Float64Array(rows), short = new Float64Array(rows)
  for (let r = 0; r < rows; r++) {
    const a = scale.value(g.top + r * rowHeight), b = scale.value(g.top + (r + 1) * rowHeight)
    low[r] = Math.min(a, b); high[r] = Math.max(a, b)
    if (!Number.isFinite(low[r]) || !Number.isFinite(high[r])) return none('empty')
  }
  const sorted = [...levels].sort((a, b) => a.price - b.price)
  // Levels above or below the visible rows still count in the cumulative view, so it starts from all of them.
  const prices = sorted.map(level => level.price)
  const find = (price: number): number => { let lo = 0, hi = prices.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (prices[mid] < price) lo = mid + 1; else hi = mid } return lo }
  if (!cumulative) {
    for (let r = 0; r < rows; r++) {
      for (let i = find(low[r]); i < sorted.length && sorted[i].price < high[r]; i++) { long[r] += sorted[i].long ?? 0; short[r] += sorted[i].short ?? 0 }
    }
  } else {
    // Long total at or below a price p (down from the close) and short total at or above it, from running sums over the sorted levels.
    const longRun = new Float64Array(sorted.length + 1), shortRun = new Float64Array(sorted.length + 1)
    for (let i = 0; i < sorted.length; i++) { longRun[i + 1] = longRun[i] + (sorted[i].long ?? 0); shortRun[i + 1] = shortRun[i] + (sorted[i].short ?? 0) }
    const closeAt = find(reference)
    for (let r = 0; r < rows; r++) {
      // Row's far edge from the close: longs count from the close down to the row's lower edge; shorts up to its upper edge.
      if (low[r] < reference) long[r] = longRun[closeAt] - longRun[Math.min(closeAt, find(low[r]))]
      if (high[r] > reference) short[r] = shortRun[Math.min(sorted.length, find(high[r]))] - shortRun[Math.min(closeAt, sorted.length)]
    }
  }
  let peak = 0
  for (let r = 0; r < rows; r++) peak = Math.max(peak, long[r] + short[r])
  if (!(peak > 0)) return none('empty')
  const projected: LiquidationRow[] = []
  const width = g.plotWidth * widthFraction
  for (let r = 0; r < rows; r++) {
    const top = g.top + r * rowHeight, height = Math.max(1, rowHeight - 0.5)
    const longWidth = long[r] / peak * width, shortWidth = short[r] / peak * width
    projected.push(Object.freeze({
      priceLow: low[r], priceHigh: high[r], long: long[r], short: short[r],
      longRect: longWidth > 0 ? Object.freeze({ x: g.right - longWidth, y: top, width: longWidth, height }) : null,
      shortRect: shortWidth > 0 ? Object.freeze({ x: g.right - longWidth - shortWidth, y: top, width: shortWidth, height }) : null
    }))
  }
  const referenceY = scale.y(reference)
  return Object.freeze({ bounds, rows: Object.freeze(projected), peak, referencePrice: reference, referenceY: Number.isFinite(referenceY) && referenceY >= g.top && referenceY <= g.bottom ? referenceY : null, status: 'ready' as const })
}
