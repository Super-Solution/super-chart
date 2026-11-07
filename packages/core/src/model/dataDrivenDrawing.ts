import type { MarketBar } from '../types'
import { volumeProfile, type VolumeProfileResult } from '../analysis/volumeProfile'
import type { Drawing, DrawingBounds, DrawingContext, DrawingGeometrySink, DrawingPoint, DrawingProjector } from './drawings'

export const DATA_DRIVEN_DRAWING_TYPES = Object.freeze([
  'regression-trend', 'position-long', 'position-short', 'anchored-vwap',
  'fixed-range-volume-profile', 'anchored-volume-profile'
] as const)
export type DataDrivenDrawingType = typeof DATA_DRIVEN_DRAWING_TYPES[number]
export type DataDrivenDrawingStatus = 'ready' | 'empty' | 'missing-volume' | 'invalid-data' | 'too-wide' | 'invalid-position' | 'unprojectable' | 'unavailable-history'
export interface DataDrivenDrawingResult {
  readonly type: DataDrivenDrawingType
  readonly status: DataDrivenDrawingStatus
  readonly fromIndex?: number
  readonly toIndex?: number
  readonly missingVolumeBars?: number
  readonly statistics?: Readonly<{
    /** Raw price per bar index, not price per elapsed second. */
    slope?: number
    /** Fitted close at the first selected bar. */
    intercept?: number
    /** Population RMS residual in raw price units; channel width is ±2σ. */
    standardDeviation?: number
    /** Absolute target distance / stop distance; excludes fees, size and leverage. */
    rewardRiskRatio?: number
    /** Signed raw-price change relative to |entry|, not leveraged trade P&L. */
    targetChangePercent?: number
    stopChangePercent?: number
    /** Unconverted feed volume units. No turnover/quote-unit substitution. */
    totalVolume?: number
    poc?: number
    valueAreaHigh?: number
    valueAreaLow?: number
  }>
}
export const DATA_DRIVEN_DRAWING_LIMITS = Object.freeze({ rangeBars: 100_000, visibleVwapBars: 8192, cachedCells: 1_000_000, cacheEntries: 64 })

interface Calculation {
  readonly result: DataDrivenDrawingResult
  readonly vwap?: Float64Array
  readonly profile?: VolumeProfileResult
}
interface CachedValue { value: Calculation | null, readonly cells: number }
interface CacheEntry {
  readonly revision: unknown
  readonly length: number
  readonly firstTimestamp: number
  readonly lastTimestamp: number
  readonly values: Map<string, CachedValue>
}
// Keys disappear with their raw series. Reuse by resolved range, not transient
// drawing preview identity. The bounded LRU never retains market history.
const cache = new WeakMap<readonly MarketBar[], CacheEntry>()
const retained = new Set<CachedValue>()
let retainedCells = 0
function remember (value: Calculation): CachedValue {
  const item = { value, cells: value.vwap?.length ?? (value.profile?.rows.length ?? 1) * 3 }
  retained.add(item); retainedCells += item.cells
  while (retainedCells > DATA_DRIVEN_DRAWING_LIMITS.cachedCells || retained.size > DATA_DRIVEN_DRAWING_LIMITS.cacheEntries) {
    const oldest = retained.values().next().value as CachedValue
    retained.delete(oldest); retainedCells -= oldest.cells; oldest.value = null
  }
  return item
}
function result (type: DataDrivenDrawingType, status: DataDrivenDrawingStatus, fields: Omit<DataDrivenDrawingResult, 'type' | 'status'> = {}): DataDrivenDrawingResult {
  return Object.freeze({ ...fields, type, status, ...(fields.statistics === undefined ? {} : { statistics: Object.freeze(fields.statistics) }) })
}
function finitePoint (value: DrawingPoint | null): value is DrawingPoint {
  return value !== null && Number.isFinite(value.x) && Number.isFinite(value.y)
}
function within (point: DrawingPoint, bounds: DrawingBounds): boolean {
  return point.x >= bounds.left && point.x <= bounds.right && point.y >= bounds.top && point.y <= bounds.bottom
}
function floorIndex (bars: readonly MarketBar[], timestamp: number): number {
  let low = 0, high = bars.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (bars[middle].timestamp <= timestamp) low = middle + 1
    else high = middle
  }
  return low - 1
}
function validBar (bar: MarketBar, previous: number): boolean {
  return Number.isFinite(bar.timestamp) && Math.abs(bar.timestamp) <= 8.64e15 && bar.timestamp > previous &&
    [bar.open, bar.high, bar.low, bar.close].every(Number.isFinite) &&
    bar.high >= Math.max(bar.open, bar.close, bar.low) && bar.low <= Math.min(bar.open, bar.close)
}
function sum (values: Iterable<number>): number {
  let total = 0, compensation = 0
  for (const value of values) {
    const next = value - compensation, updated = total + next
    compensation = (updated - total) - next; total = updated
  }
  return total
}

function calculate (type: DataDrivenDrawingType, bars: readonly MarketBar[], from: number, to: number): Calculation {
  const range = { fromIndex: from, toIndex: to }, count = to - from + 1
  if (count > DATA_DRIVEN_DRAWING_LIMITS.rangeBars) return { result: result(type, 'too-wide', range) }
  if (count < (type === 'anchored-vwap' ? 1 : 2)) return { result: result(type, 'empty', range) }
  let missingVolumeBars = 0
  for (let i = from; i <= to; i++) {
    const bar = bars[i]
    if (!validBar(bar, i === 0 ? -Infinity : bars[i - 1].timestamp)) return { result: result(type, 'invalid-data', range) }
    if (type !== 'regression-trend' && (typeof bar.volume !== 'number' || !Number.isFinite(bar.volume) || bar.volume < 0)) missingVolumeBars++
  }
  if (missingVolumeBars > 0) return { result: result(type, 'missing-volume', { ...range, missingVolumeBars }) }
  if (type === 'regression-trend') {
    // Center x and y before the least-squares sum to avoid subtracting two large
    // n*sum terms. Residual sigma is population RMS, matching the original tool.
    const center = (count - 1) / 2
    let mean = 0
    for (let i = from; i <= to; i++) mean += (bars[i].close - mean) / (i - from + 1)
    function * products (): Iterable<number> {
      for (let i = from; i <= to; i++) yield (i - from - center) * (bars[i].close - mean)
    }
    const slope = sum(products()) / (count * (count * count - 1) / 12), intercept = mean - slope * center
    let residualNorm = 0
    for (let i = from; i <= to; i++) residualNorm = Math.hypot(residualNorm, bars[i].close - (intercept + slope * (i - from)))
    const standardDeviation = residualNorm / Math.sqrt(count)
    if (![slope, intercept, standardDeviation].every(Number.isFinite)) return { result: result(type, 'invalid-data', range) }
    return { result: result(type, 'ready', { ...range, statistics: { slope, intercept, standardDeviation } }) }
  }
  if (type === 'anchored-vwap') {
    const values = new Float64Array(count)
    let totalVolume = 0, volumeCompensation = 0, mean = 0
    for (let i = from; i <= to; i++) {
      const bar = bars[i], volume = bar.volume!, next = volume - volumeCompensation, updated = totalVolume + next
      volumeCompensation = (updated - totalVolume) - next
      if (!Number.isFinite(updated)) return { result: result(type, 'invalid-data', range) }
      if (volume > 0) {
        const typical = bar.high / 3 + bar.low / 3 + bar.close / 3
        // Running weighted mean avoids price*volume overflow. Volume remains in
        // the feed's original units; neither turnover nor unit volume is invented.
        mean = totalVolume === 0 ? typical : mean * (totalVolume / updated) + typical * (volume / updated)
      }
      totalVolume = updated
      values[i - from] = totalVolume > 0 ? mean : NaN
      if (totalVolume > 0 && !Number.isFinite(mean)) return { result: result(type, 'invalid-data', range) }
    }
    return { result: result(type, totalVolume > 0 ? 'ready' : 'empty', { ...range, statistics: { totalVolume } }), vwap: values }
  }
  const selected = bars.slice(from, to + 1).map(bar => ({ low: bar.low, high: bar.high, volume: bar.volume! }))
  const profile = volumeProfile(selected, { rows: 24, valueArea: 0.7 })
  const totalVolume = sum(selected.map(bar => bar.volume))
  if (!Number.isFinite(totalVolume) || ![profile.poc, profile.vah, profile.val, profile.pmin, profile.pmax].every(Number.isFinite) ||
      profile.rows.some(row => ![row.priceLow, row.priceHigh, row.volume].every(Number.isFinite))) return { result: result(type, 'invalid-data', range) }
  return {
    result: result(type, totalVolume > 0 ? 'ready' : 'empty', {
      ...range,
      statistics: {
        totalVolume, poc: profile.poc, valueAreaHigh: profile.vah, valueAreaLow: profile.val
      }
    }),
    profile
  }
}

function calculation (type: DataDrivenDrawingType, context: DrawingContext, from: number, to: number): Calculation {
  const bars = context.bars, previous = cache.get(bars), key = `${type}:${from}:${to}`
  const reusable = context.revision !== undefined && previous !== undefined && Object.is(previous.revision, context.revision) &&
    previous.length === bars.length && previous.firstTimestamp === bars[0].timestamp && previous.lastTimestamp === bars[bars.length - 1].timestamp
  const holder = reusable ? previous.values.get(key) : undefined
  if (holder !== undefined && holder.value !== null) {
    retained.delete(holder); retained.add(holder)
    return holder.value
  }
  const computed = calculate(type, bars, from, to)
  if (context.revision !== undefined) {
    const entry = reusable ? previous : {
      revision: context.revision,
      length: bars.length,
      firstTimestamp: bars[0].timestamp,
      lastTimestamp: bars[bars.length - 1].timestamp,
      values: new Map<string, CachedValue>()
    }
    entry.values.set(key, remember(computed))
    if (entry.values.size > DATA_DRIVEN_DRAWING_LIMITS.cacheEntries) entry.values.delete(entry.values.keys().next().value as string)
    cache.set(bars, entry)
  }
  return computed
}

function position (value: Drawing, type: DataDrivenDrawingType, project: DrawingProjector, bounds: DrawingBounds, sink: DrawingGeometrySink): DataDrivenDrawingResult {
  if (value.anchors.length !== 3) return result(type, 'invalid-position')
  const [entry, target, stop] = value.anchors.map(anchor => anchor.price), long = type === 'position-long'
  if (![entry, target, stop].every(Number.isFinite) || (long ? !(target > entry && stop < entry) : !(target < entry && stop > entry))) return result(type, 'invalid-position')
  const rewardRiskRatio = Math.abs(target - entry) / Math.abs(entry - stop)
  if (!Number.isFinite(rewardRiskRatio)) return result(type, 'invalid-position')
  const percentage = (price: number): number | undefined => {
    const number = (price - entry) / Math.abs(entry) * 100
    return entry !== 0 && Number.isFinite(number) ? number : undefined
  }
  const targetChangePercent = percentage(target), stopChangePercent = percentage(stop)
  const statistics = { rewardRiskRatio, ...(targetChangePercent === undefined ? {} : { targetChangePercent }), ...(stopChangePercent === undefined ? {} : { stopChangePercent }) }
  const points = value.anchors.map(anchor => project(anchor.timestamp, anchor.price))
  if (!points.every(finitePoint)) return result(type, 'unprojectable', { statistics })
  const left = Math.min(...points.map(point => point.x)), right = Math.max(...points.map(point => point.x))
  for (const next of [points[1], points[2]]) sink.polygon([{ x: left, y: points[0].y }, { x: right, y: points[0].y }, { x: right, y: next.y }, { x: left, y: next.y }])
  for (const point of points) sink.line({ x: left, y: point.y }, { x: right, y: point.y })
  const caption = (point: DrawingPoint, text: string, price?: number): void => {
    const place = { x: Math.max(bounds.left + 4, Math.min(bounds.right - 4, left / 2 + right / 2)), y: point.y }
    if (within(place, bounds)) sink.text(place, text, price, 'center')
  }
  const percent = (number: number | undefined): string => number === undefined ? '' : ` ${number >= 0 ? '+' : ''}${number.toFixed(2)}%`
  caption(points[0], `${long ? 'Long' : 'Short'} R/R ${rewardRiskRatio.toFixed(2)}`)
  caption(points[1], `Target${percent(targetChangePercent)}`, target)
  caption(points[2], `Stop${percent(stopChangePercent)}`, stop)
  return result(type, 'ready', { statistics })
}

/**
 * Raw revealed OHLCV only, including when the renderer displays Heikin Ashi.
 * Anchors resolve to their containing loaded bar; an anchor outside supplied
 * history is unavailable, never clamped to a different/future bar. Profile
 * volume is distributed proportionally across each candle's low/high range;
 * it is not order-book activity or actual volume traded at each price.
 *
 * A revision must change for ANY edit in supplied data. Without it no numeric
 * cache is reused. Visible range bounds only VWAP projection, not its sums.
 * The sink clips finite primitives and shares normal drawing hit geometry.
 */
export function projectDataDrivenDrawing (
  value: Drawing, project: DrawingProjector, bounds: DrawingBounds,
  context: DrawingContext | undefined, sink: DrawingGeometrySink
): DataDrivenDrawingResult | null {
  const type = value.type as DataDrivenDrawingType
  if (!DATA_DRIVEN_DRAWING_TYPES.includes(type)) return null
  if (type === 'position-long' || type === 'position-short') return position(value, type, project, bounds, sink)
  const bars = context?.bars
  if (context === undefined || bars === undefined || bars.length === 0) return result(type, 'unavailable-history')
  const count = type === 'regression-trend' || type === 'fixed-range-volume-profile' ? 2 : 1
  if (value.anchors.length !== count || value.anchors.some(anchor => !Number.isFinite(anchor.timestamp))) return result(type, 'invalid-data')
  const timestamps = value.anchors.map(anchor => anchor.timestamp)
  if (timestamps.some(timestamp => timestamp < bars[0].timestamp || timestamp > bars[bars.length - 1].timestamp)) return result(type, 'unavailable-history')
  const indices = timestamps.map(timestamp => floorIndex(bars, timestamp)), from = Math.min(...indices)
  const to = count === 2 ? Math.max(...indices) : bars.length - 1
  if (from < 0 || to < from) return result(type, 'unavailable-history')
  const computed = calculation(type, context, from, to), analysis = computed.result
  if (analysis.status !== 'ready') return analysis
  let projected = false
  const line = (a: DrawingPoint | null, b: DrawingPoint | null): void => {
    if (finitePoint(a) && finitePoint(b)) { sink.line(a, b); projected = true }
  }
  if (computed.vwap !== undefined) {
    const visible = context.visibleRange ?? [from, to]
    if (visible.length !== 2 || !visible.every(Number.isFinite)) return result(type, 'invalid-data')
    const first = Math.max(from, Math.floor(Math.min(...visible)) - 1), last = Math.min(to, Math.ceil(Math.max(...visible)) + 1)
    if (last - first + 1 > DATA_DRIVEN_DRAWING_LIMITS.visibleVwapBars) return result(type, 'too-wide', analysis)
    for (let i = first + 1; i <= last; i++) {
      const before = computed.vwap[i - from - 1], current = computed.vwap[i - from]
      if (Number.isFinite(before) && Number.isFinite(current)) line(project(bars[i - 1].timestamp, before), project(bars[i].timestamp, current))
    }
  } else if (type === 'regression-trend') {
    const stats = analysis.statistics!, first = stats.intercept!, last = first + stats.slope! * (to - from)
    for (const deviation of [0, 2 * stats.standardDeviation!, -2 * stats.standardDeviation!]) {
      if (Number.isFinite(first + deviation) && Number.isFinite(last + deviation)) line(project(bars[from].timestamp, first + deviation), project(bars[to].timestamp, last + deviation))
    }
  } else if (computed.profile !== undefined) {
    const profile = computed.profile, x0 = project(value.anchors[0].timestamp, profile.poc)
    const x1 = count === 2 ? project(value.anchors[1].timestamp, profile.poc) : null
    if (!finitePoint(x0) || (count === 2 && !finitePoint(x1))) return result(type, 'unprojectable', analysis)
    const left = x1 === null ? x0.x : Math.min(x0.x, x1.x), width = x1 === null ? 120 : Math.abs(x1.x - x0.x)
    const maximum = profile.rows.reduce((max, row) => Math.max(max, row.volume), 0)
    if (!(maximum > 0)) return result(type, 'invalid-data', analysis)
    for (const row of profile.rows) {
      if (row.volume <= 0) continue
      const low = project(bars[from].timestamp, row.priceLow), high = project(bars[from].timestamp, row.priceHigh)
      if (!finitePoint(low) || !finitePoint(high)) continue
      const center = low.y / 2 + high.y / 2, half = Math.max(0.5, Math.abs(high.y / 2 - low.y / 2) * 0.84)
      const right = left + (row.volume / maximum) * width * (count === 2 ? 0.95 : 1)
      if (![center, half, right].every(Number.isFinite)) continue
      sink.polygon([{ x: left, y: center - half }, { x: right, y: center - half }, { x: right, y: center + half }, { x: left, y: center + half }]); projected = true
    }
    const poc = project(bars[from].timestamp, profile.poc)
    if (finitePoint(poc)) line({ x: left, y: poc.y }, { x: left + width, y: poc.y })
  }
  return projected ? analysis : result(type, 'unprojectable', analysis)
}
