import type { MarketBar } from '../types'
import { volumeProfile } from '../analysis/volumeProfile'
import { detectFairValueGaps } from '../analysis/fairValueGaps'
import { detectOrderBlocks } from '../analysis/orderBlocks'
import type { EngineFrame } from './frame'

/** Existing zone detectors inspect later candles; cap their quadratic scan explicitly. */
export const MARKET_ZONE_SCAN_LIMIT = 5000

export interface MarketOverlayOptions {
  volumeProfile?: boolean | {
    /** Equal price bins, from 1 to 200. @default 24 */
    rows?: number
    /** Fraction of reported volume included in the value area. @default 0.7 */
    valueArea?: number
    /** Fraction of plot width occupied by the largest bin. @default 0.2 */
    widthFraction?: number
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
  readonly profile: MarketVolumeProfile | null
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
  const finish = (): MarketOverlayFrame => Object.freeze({ bounds, profile, zones: Object.freeze(zones), status: Object.freeze(status) })
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
    const rows = integer(settings.rows ?? 24, 200, 'Volume profile rows')
    const valueArea = fraction(settings.valueArea ?? 0.7, 'Volume profile value area')
    const widthFraction = fraction(settings.widthFraction ?? 0.2, 'Volume profile width')
    const visible = rawBars.slice(from, to + 1)
    let missingVolumeBars = 0
    const bars = visible.map(bar => {
      const known = typeof bar.volume === 'number' && Number.isFinite(bar.volume) && bar.volume >= 0
      if (!known) missingVolumeBars++
      return { high: bar.high, low: bar.low, volume: known ? bar.volume! : 0 }
    })
    if (!validBars(visible)) status.volumeProfile = 'invalid-data'
    else {
      const value = volumeProfile(bars, { rows, valueArea })
      const totalVolume = bars.reduce((sum, bar) => sum + bar.volume, 0)
      const maxVolume = value.rows.reduce((max, row) => Math.max(max, row.volume), 0)
      if (!Number.isFinite(totalVolume) || value.rows.some(row => !Number.isFinite(row.volume) || !Number.isFinite(row.priceLow) || !Number.isFinite(row.priceHigh))) {
        status.volumeProfile = 'invalid-data'
      } else if (missingVolumeBars === bars.length) status.volumeProfile = 'missing-volume'
      else if (totalVolume > 0 && maxVolume <= 0) status.volumeProfile = 'invalid-data'
      else if (totalVolume > 0 && maxVolume > 0) {
        const projectedRows = value.rows.map(row => Object.freeze({
          ...row,
          pointOfControl: row.priceLow <= value.poc && value.poc <= row.priceHigh,
          inValueArea: row.priceLow >= value.val && row.priceHigh <= value.vah,
          rect: row.volume > 0 && widthFraction > 0 ? clippedRect(bounds, bounds.left, frame.model.y(row.priceHigh),
            bounds.left + row.volume / maxVolume * g.plotWidth * widthFraction, frame.model.y(row.priceLow)) : null
        }))
        profile = Object.freeze({
          rows: Object.freeze(projectedRows),
          totalVolume,
          missingVolumeBars,
          poc: value.poc,
          vah: value.vah,
          val: value.val,
          pocY: priceY(value.poc),
          vahY: priceY(value.vah),
          valY: priceY(value.val)
        })
        status.volumeProfile = 'ready'
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
