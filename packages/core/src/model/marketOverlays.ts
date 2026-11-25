import type { MarketBar } from '../types'
import { volumeProfile } from '../analysis/volumeProfile'
import { detectFairValueGaps } from '../analysis/fairValueGaps'
import { detectOrderBlocks } from '../analysis/orderBlocks'
import type { EngineFrame } from './frame'

/** Existing zone detectors inspect later candles; cap their quadratic scan explicitly. */
export const MARKET_ZONE_SCAN_LIMIT = 5000
/** A fixed-range profile counts every bar of its range on each paint; refuse a range that would stall the page. */
export const MARKET_PROFILE_RANGE_LIMIT = 50_000
/** Sessions drawn at once; more means the view is zoomed out too far to read them. */
export const MARKET_PROFILE_SESSION_LIMIT = 60

export interface MarketOverlayOptions {
  volumeProfile?: boolean | {
    /**
     * `visible`: one profile of the bars in view, hanging from the left edge of the plot. `session`: one profile per
     * calendar day (in `timeZone`) that shows in the view, each hanging from the start of its own day and using
     * all of that day's bars even when part of the day is off screen. `range`: one profile of the bars from
     * `range.from` to `range.to`. @default 'visible'
     */
    mode?: 'visible' | 'session' | 'range'
    /** Equal price bins, from 1 to 200. @default 24 */
    rows?: number
    /** Fraction of reported volume included in the value area. @default 0.7 */
    valueArea?: number
    /**
     * Fraction of the profile's own width (the plot for `visible`, the day or the range otherwise) occupied by the
     * largest bin. @default 0.2 for `visible`, 0.7 for `session` and `range`
     */
    widthFraction?: number
    /** `session` only: IANA time zone that decides where a day starts. @default 'UTC' */
    timeZone?: string
    /** `range` only: inclusive timestamps of the first and last bar to include (milliseconds). */
    range?: { from: number, to: number }
  }
  fairValueGaps?: boolean
  orderBlocks?: boolean | {
    /** Prior candles defining the swing, from 1 to 1000. @default 10 */
    swingLookback?: number
    /** Received candles allowed to confirm a break, from 1 to 1000. @default 3 */
    lookahead?: number
    displacementFactor?: number
  }
}

export type MarketOverlayStatus = 'off' | 'ready' | 'empty' | 'missing-volume' | 'too-wide' | 'invalid-data'
export interface MarketOverlayRect { readonly x: number, readonly y: number, readonly width: number, readonly height: number }
export interface MarketProfileRow {
  readonly priceLow: number
  readonly priceHigh: number
  readonly volume: number
  readonly pointOfControl: boolean
  readonly inValueArea: boolean
  /** Null when the price scale cannot project this bin or it is outside the plot. */
  readonly rect: MarketOverlayRect | null
}
export interface MarketVolumeProfile {
  readonly rows: readonly MarketProfileRow[]
  readonly totalVolume: number
  /** Missing/negative/nonfinite volume contributes zero, never invented activity. */
  readonly missingVolumeBars: number
  readonly poc: number
  readonly vah: number
  readonly val: number
  readonly pocY: number | null
  readonly vahY: number | null
  readonly valY: number | null
  /** Raw index of the first and last bar the profile counts. */
  readonly startIndex: number
  readonly endIndex: number
  /** Where the histogram and its POC / value-area lines are drawn, clipped to the plot. */
  readonly span: Readonly<{ left: number, right: number }>
}
export interface MarketSessionProfile {
  readonly startIndex: number
  readonly endIndex: number
  readonly profile: MarketVolumeProfile
}
export interface MarketZone {
  readonly kind: 'fair-value-gap' | 'order-block'
  readonly direction: 'bullish' | 'bearish'
  readonly status: 'open' | 'filled' | 'mitigated'
  readonly startIndex: number
  readonly endIndex: number
  readonly confirmedAtIndex: number
  readonly top: number
  readonly bottom: number
  readonly rect: MarketOverlayRect
}
export interface MarketOverlayFrame {
  readonly bounds: Readonly<{ left: number, right: number, top: number, bottom: number }>
  /** The profile of `visible` and `range` mode; null in `session` mode. */
  readonly profile: MarketVolumeProfile | null
  /** The per-day profiles of `session` mode; empty otherwise. */
  readonly sessionProfiles: readonly MarketSessionProfile[]
  readonly zones: readonly MarketZone[]
  readonly status: Readonly<{ volumeProfile: MarketOverlayStatus, fairValueGaps: MarketOverlayStatus, orderBlocks: MarketOverlayStatus }>
}

function integer (value: number, max: number, label: string): number {
  if (!Number.isInteger(value) || value < 1 || value > max) throw new RangeError(`${label} must be an integer from 1 to ${max}`)
  return value
}
function fraction (value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError(`${label} must be between 0 and 1`)
  return value
}
function validBars (bars: readonly MarketBar[]): boolean {
  return bars.every(bar => Number.isFinite(bar.timestamp) && Number.isFinite(bar.open) && Number.isFinite(bar.close) &&
    Number.isFinite(bar.high) && Number.isFinite(bar.low) && bar.high >= bar.low)
}
function clippedRect (bounds: MarketOverlayFrame['bounds'], x0: number, y0: number, x1: number, y1: number): MarketOverlayRect | null {
  if (![x0, y0, x1, y1].every(Number.isFinite)) return null
  const left = Math.min(x0, x1), top = Math.min(y0, y1)
  const x = Math.max(bounds.left, left), y = Math.max(bounds.top, top)
  const right = Math.min(bounds.right, Math.max(left + 1, x0, x1))
  const bottom = Math.min(bounds.bottom, Math.max(top + 1, y0, y1))
  return right > x && bottom > y ? Object.freeze({ x, y, width: right - x, height: bottom - y }) : null
}

/**
 * Pure, raw-OHLC projection, including in Heikin Ashi display mode. Volume is
 * distributed uniformly across each candle's price range, not actual trades
 * at each price. Missing volume is reported and contributes zero.
 *
 * FVG uses A/C separation and requires a later single candle to cover the
 * entire gap. Its scan starts two candles before the viewport and stops at
 * the visible right edge. Older gaps and fills outside that window are not
 * tracked. OB preserves the owned heuristic: an opposite candle followed by
 * a displacement breaking a prior swing. It does not infer order-book orders
 * or suppress superseded candidates. Its scan includes lookback/lookahead
 * margins, so already-received candles just right of the viewport may confirm
 * or mitigate a block. Mitigation means a later close inside the zone; its
 * rectangle continues to the viewport edge, because no mitigation index is
 * tracked by the detector. Replay callers must supply only revealed bars.
 *
 * No full-history scans or mutable calculation state. Zone scans beyond the
 * explicit limit return `too-wide`, never a silently truncated result.
 * Inputs must be the raw history corresponding to this frame's snapshot.
 */
export function projectMarketOverlays (
  frame: EngineFrame, rawBars: readonly MarketBar[], options: MarketOverlayOptions = {}
): MarketOverlayFrame {
  const g = frame.model.geometry
  const bounds = Object.freeze({ left: g.left, right: g.right, top: g.top, bottom: g.bottom })
  const status: { volumeProfile: MarketOverlayStatus, fairValueGaps: MarketOverlayStatus, orderBlocks: MarketOverlayStatus } = {
    volumeProfile: options.volumeProfile ? 'empty' : 'off',
    fairValueGaps: options.fairValueGaps ? 'empty' : 'off',
    orderBlocks: options.orderBlocks ? 'empty' : 'off'
  }
  const zones: MarketZone[] = []
  let profile: MarketVolumeProfile | null = null
  let sessionProfiles: readonly MarketSessionProfile[] = []
  const finish = (): MarketOverlayFrame => Object.freeze({ bounds, profile, sessionProfiles: Object.freeze(sessionProfiles), zones: Object.freeze(zones), status: Object.freeze(status) })
  if (rawBars.length === 0 || frame.snapshot.bars.length === 0 || !(g.right > g.left) || !(g.bottom > g.top)) return finish()
  const from = Math.max(0, Math.floor(frame.snapshot.viewport.i0))
  const to = Math.min(rawBars.length - 1, Math.ceil(frame.snapshot.viewport.i1))
  if (to < from) return finish()
  const priceY = (price: number): number | null => {
    const y = frame.model.y(price)
    return Number.isFinite(y) && y >= bounds.top && y <= bounds.bottom ? y : null
  }
  const zoneRect = (start: number, end: number, top: number, bottom: number): MarketOverlayRect | null => {
    const a = frame.project(rawBars[start].timestamp, top), b = frame.project(rawBars[end].timestamp, bottom)
    return a === null || b === null ? null : clippedRect(bounds, a.x, a.y, b.x, b.y)
  }
  if (options.volumeProfile) {
    const settings = typeof options.volumeProfile === 'object' ? options.volumeProfile : {}
    const mode = settings.mode ?? 'visible'
    if (mode !== 'visible' && mode !== 'session' && mode !== 'range') throw new RangeError("Volume profile mode must be 'visible', 'session' or 'range'")
    const rows = integer(settings.rows ?? 24, 200, 'Volume profile rows')
    const valueArea = fraction(settings.valueArea ?? 0.7, 'Volume profile value area')
    const widthFraction = fraction(settings.widthFraction ?? (mode === 'visible' ? 0.2 : 0.7), 'Volume profile width')
    const span = frame.snapshot.viewport.i1 - frame.snapshot.viewport.i0
    const xOf = (index: number): number => span <= 0 ? g.left + g.plotWidth / 2 : g.left + (index - frame.snapshot.viewport.i0) / span * g.plotWidth
    const slot = span <= 0 ? g.plotWidth : g.plotWidth / span
    /** One profile of `first..last` (raw indices), its histogram hanging from the left edge of `x0..x1`. */
    const build = (first: number, last: number, x0: number, x1: number): { status: MarketOverlayStatus, profile: MarketVolumeProfile | null } => {
      const sub = rawBars.slice(first, last + 1)
      let missing = 0
      const bars = sub.map(bar => {
        const known = typeof bar.volume === 'number' && Number.isFinite(bar.volume) && bar.volume >= 0
        if (!known) missing++
        return { high: bar.high, low: bar.low, volume: known ? bar.volume! : 0 }
      })
      if (!validBars(sub)) return { status: 'invalid-data', profile: null }
      const value = volumeProfile(bars, { rows, valueArea })
      const total = bars.reduce((sum, bar) => sum + bar.volume, 0)
      const maxVolume = value.rows.reduce((max, row) => Math.max(max, row.volume), 0)
      if (!Number.isFinite(total) || value.rows.some(row => !Number.isFinite(row.volume) || !Number.isFinite(row.priceLow) || !Number.isFinite(row.priceHigh))) return { status: 'invalid-data', profile: null }
      if (missing === bars.length) return { status: 'missing-volume', profile: null }
      if (!(total > 0)) return { status: 'empty', profile: null }
      if (!(maxVolume > 0)) return { status: 'invalid-data', profile: null }
      const left = Math.max(bounds.left, x0), right = Math.min(bounds.right, x1)
      const width = Math.max(0, right - left)
      const projectedRows = value.rows.map(row => Object.freeze({
        ...row,
        pointOfControl: row.priceLow <= value.poc && value.poc <= row.priceHigh,
        inValueArea: row.priceLow >= value.val && row.priceHigh <= value.vah,
        rect: row.volume > 0 && widthFraction > 0 && width > 0 ? clippedRect(bounds, left, frame.model.y(row.priceHigh),
          left + row.volume / maxVolume * width * widthFraction, frame.model.y(row.priceLow)) : null
      }))
      return {
        status: 'ready',
        profile: Object.freeze({
          rows: Object.freeze(projectedRows),
          totalVolume: total,
          missingVolumeBars: missing,
          poc: value.poc, vah: value.vah, val: value.val,
          pocY: priceY(value.poc), vahY: priceY(value.vah), valY: priceY(value.val),
          startIndex: first, endIndex: last,
          span: Object.freeze({ left, right })
        })
      }
    }
    if (mode === 'visible') {
      const result = build(from, to, g.left, g.right)
      status.volumeProfile = result.status; profile = result.profile
    } else if (mode === 'range') {
      const range = settings.range
      if (range === undefined || !Number.isFinite(range.from) || !Number.isFinite(range.to) || range.from > range.to) throw new RangeError('Volume profile range needs finite from and to timestamps, from not after to')
      // Bars are ascending: binary search for the first bar at or after `from` and the last at or before `to`.
      let lo = 0, hi = rawBars.length
      while (lo < hi) { const mid = (lo + hi) >> 1; if (rawBars[mid].timestamp < range.from) lo = mid + 1; else hi = mid }
      const first = lo
      lo = first; hi = rawBars.length
      while (lo < hi) { const mid = (lo + hi) >> 1; if (rawBars[mid].timestamp <= range.to) lo = mid + 1; else hi = mid }
      const last = lo - 1
      if (last < first) status.volumeProfile = 'empty'
      else if (last - first + 1 > MARKET_PROFILE_RANGE_LIMIT) status.volumeProfile = 'too-wide'
      else {
        const x0 = xOf(first) - slot / 2, x1 = xOf(last) + slot / 2
        if (x1 <= g.left || x0 >= g.right) status.volumeProfile = 'empty'
        else { const result = build(first, last, x0, x1); status.volumeProfile = result.status; profile = result.profile }
      }
    } else {
      const zone = settings.timeZone ?? 'UTC'
      const format = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' })
      const keys = new Map<number, string>()
      const keyOf = (index: number): string => {
        // A day starts on a quarter hour in every time zone, so a 15-minute bucket never holds two different days.
        const stamp = rawBars[index].timestamp, bucket = Math.floor(stamp / 900_000)
        let key = keys.get(bucket)
        if (key === undefined) { key = format.format(stamp); keys.set(bucket, key) }
        return key
      }
      let first = from, last = to
      const startKey = keyOf(from), endKey = keyOf(to)
      while (first > 0 && keyOf(first - 1) === startKey) first--
      while (last < rawBars.length - 1 && keyOf(last + 1) === endKey) last++
      const sessions: Array<[number, number]> = []
      for (let i = first; i <= last;) {
        const key = keyOf(i)
        let j = i
        while (j + 1 <= last && keyOf(j + 1) === key) j++
        sessions.push([i, j]); i = j + 1
        if (sessions.length > MARKET_PROFILE_SESSION_LIMIT) break
      }
      if (sessions.length > MARKET_PROFILE_SESSION_LIMIT) status.volumeProfile = 'too-wide'
      else {
        const list: MarketSessionProfile[] = []
        let ready = false, worst: MarketOverlayStatus = 'empty'
        for (const [a, b] of sessions) {
          const result = build(a, b, xOf(a) - slot / 2, xOf(b) + slot / 2)
          if (result.profile !== null) { list.push(Object.freeze({ startIndex: a, endIndex: b, profile: result.profile })); ready = true } else if (result.status === 'invalid-data') worst = 'invalid-data'
          else if (result.status === 'missing-volume' && worst === 'empty') worst = 'missing-volume'
        }
        sessionProfiles = list
        // A day with bad prices is never silently left out: the overlay says so, and the good days stay drawn.
        status.volumeProfile = worst === 'invalid-data' ? 'invalid-data' : ready ? 'ready' : worst
      }
    }
  }
  if (options.fairValueGaps) {
    const start = Math.max(0, from - 2)
    if (to - start + 1 > MARKET_ZONE_SCAN_LIMIT) status.fairValueGaps = 'too-wide'
    else {
      const bars = rawBars.slice(start, to + 1)
      if (!validBars(bars)) status.fairValueGaps = 'invalid-data'
      else {
        const gaps = detectFairValueGaps(bars)
        for (const gap of gaps) {
          const first = start + gap.index, last = gap.filledAtIndex === null ? to : start + gap.filledAtIndex
          const rect = zoneRect(first, last, gap.top, gap.bottom)
          if (rect !== null) { zones.push(Object.freeze({
            kind: 'fair-value-gap',
            direction: gap.direction,
            status: gap.filled ? 'filled' : 'open',
            startIndex: first,
            endIndex: last,
            confirmedAtIndex: first + 2,
            top: gap.top,
            bottom: gap.bottom,
            rect
          })) }
        }
        status.fairValueGaps = gaps.length > 0 ? 'ready' : 'empty'
      }
    }
  }
  if (options.orderBlocks) {
    const settings = typeof options.orderBlocks === 'object' ? options.orderBlocks : {}
    const swingLookback = integer(settings.swingLookback ?? 10, 1000, 'Order block swing lookback')
    const lookahead = integer(settings.lookahead ?? 3, 1000, 'Order block lookahead')
    const displacementFactor = settings.displacementFactor ?? 1.5
    if (!Number.isFinite(displacementFactor) || displacementFactor < 0) throw new RangeError('Order block displacement must be finite and nonnegative')
    const start = Math.max(0, from - swingLookback - lookahead), end = Math.min(rawBars.length - 1, to + lookahead)
    if (end - start + 1 > MARKET_ZONE_SCAN_LIMIT) status.orderBlocks = 'too-wide'
    else {
      const bars = rawBars.slice(start, end + 1)
      if (!validBars(bars)) status.orderBlocks = 'invalid-data'
      else {
        const blocks = detectOrderBlocks(bars, { swingLookback, lookahead, displacementFactor })
        let visibleBlocks = 0
        for (const block of blocks) {
          const first = start + block.index
          if (first > to) continue
          visibleBlocks++
          const rect = zoneRect(first, to, block.high, block.low)
          if (rect !== null) { zones.push(Object.freeze({
            kind: 'order-block',
            direction: block.direction,
            status: block.mitigated ? 'mitigated' : 'open',
            startIndex: first,
            endIndex: to,
            confirmedAtIndex: start + block.breakIndex,
            top: block.high,
            bottom: block.low,
            rect
          })) }
        }
        status.orderBlocks = visibleBlocks > 0 ? 'ready' : 'empty'
      }
    }
  }
  return finish()
}
