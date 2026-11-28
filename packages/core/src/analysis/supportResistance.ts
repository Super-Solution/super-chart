// SPDX-License-Identifier: GPL-3.0-or-later
// Automatic support and resistance: swing pivots that price kept coming back to. A pivot is a bar whose high (or low) is the
// extreme of `strength` bars on each side. Pivots whose prices lie within a tolerance of each other form one level; the more
// pivots a level has, and the more recent they are, the stronger it is. Pure, OHLC only, no state.

export interface LevelBar { readonly high: number, readonly low: number, readonly close: number }

export interface SupportResistanceLevel {
  /** Mean price of the pivots that form the level. */
  readonly price: number
  /** How many swing pivots sit on it. */
  readonly touches: number
  /** Index of the latest pivot on it. */
  readonly lastIndex: number
  /** Touches weighted by recency, 0 to touches; for ranking, not for display. */
  readonly strength: number
}

export interface SupportResistanceOptions {
  /** Bars on each side that a pivot must out-reach. @default 5 */
  readonly strength?: number
  /** Only the latest this many bars are read. @default 500 */
  readonly lookback?: number
  /** Pivots closer than this price distance are one level. @default half of the average true range */
  readonly tolerance?: number
  /** A level needs at least this many pivots. @default 2 */
  readonly minTouches?: number
}

export interface SupportResistance {
  /** Levels above the last close, nearest first. */
  readonly resistance: readonly SupportResistanceLevel[]
  /** Levels below the last close, nearest first. */
  readonly support: readonly SupportResistanceLevel[]
}

const EMPTY: SupportResistance = Object.freeze({ resistance: Object.freeze([]), support: Object.freeze([]) })

function averageTrueRange (bars: readonly LevelBar[], from: number): number {
  let sum = 0, n = 0
  for (let i = Math.max(1, from); i < bars.length; i++) {
    const b = bars[i]
    sum += Math.max(b.high - b.low, Math.abs(b.high - bars[i - 1].close), Math.abs(b.low - bars[i - 1].close))
    n++
  }
  return n === 0 ? 0 : sum / n
}

export interface SwingPivot {
  /** Index of the bar in the array given. */
  readonly index: number
  readonly kind: 'high' | 'low'
  readonly price: number
}

function findPivots (bars: readonly LevelBar[], start: number, strength: number): SwingPivot[] {
  const pivots: SwingPivot[] = []
  for (let i = start + strength; i < bars.length - strength; i++) {
    let high = true, low = true
    for (let k = 1; k <= strength && (high || low); k++) {
      if (bars[i - k].high >= bars[i].high || bars[i + k].high > bars[i].high) high = false
      if (bars[i - k].low <= bars[i].low || bars[i + k].low < bars[i].low) low = false
    }
    if (high && Number.isFinite(bars[i].high)) pivots.push({ index: i, kind: 'high', price: bars[i].high })
    if (low && Number.isFinite(bars[i].low)) pivots.push({ index: i, kind: 'low', price: bars[i].low })
  }
  return pivots
}

/**
 * The swing highs and lows of the latest `lookback` bars in time order, alternating high and low (of two highs in a row
 * only the higher stays, of two lows the lower), so each neighbour pair is one leg of the price path: what a trend line
 * or a retracement is anchored on. `strength` is the bars on each side a pivot must out-reach.
 */
export function swingPivots (bars: readonly LevelBar[], options: { readonly strength?: number, readonly lookback?: number } = {}): readonly SwingPivot[] {
  const strength = options.strength ?? 5, lookback = options.lookback ?? 500
  if (!Number.isSafeInteger(strength) || strength < 1) throw new RangeError('strength must be a positive integer')
  if (!Number.isSafeInteger(lookback) || lookback < 1) throw new RangeError('lookback must be a positive integer')
  const start = Math.max(0, bars.length - lookback)
  if (bars.length - start < 2 * strength + 1) return Object.freeze([])
  const raw = findPivots(bars, start, strength).sort((a, b) => a.index - b.index || (a.kind === 'high' ? -1 : 1))
  const out: SwingPivot[] = []
  for (const pivot of raw) {
    const previous = out[out.length - 1]
    if (previous !== undefined && previous.kind === pivot.kind) {
      if (pivot.kind === 'high' ? pivot.price > previous.price : pivot.price < previous.price) out[out.length - 1] = pivot
    } else out.push(pivot)
  }
  return Object.freeze(out)
}

export function supportResistance (bars: readonly LevelBar[], options: SupportResistanceOptions = {}): SupportResistance {
  const strength = options.strength ?? 5, lookback = options.lookback ?? 500, minTouches = options.minTouches ?? 2
  if (!Number.isSafeInteger(strength) || strength < 1) throw new RangeError('strength must be a positive integer')
  if (!Number.isSafeInteger(lookback) || lookback < 1) throw new RangeError('lookback must be a positive integer')
  if (!Number.isSafeInteger(minTouches) || minTouches < 1) throw new RangeError('minTouches must be a positive integer')
  const start = Math.max(0, bars.length - lookback)
  if (bars.length - start < 2 * strength + 1) return EMPTY
  const last = bars[bars.length - 1].close
  if (!Number.isFinite(last)) return EMPTY
  const tolerance = options.tolerance ?? averageTrueRange(bars, start) / 2
  if (!Number.isFinite(tolerance) || tolerance < 0) throw new RangeError('tolerance must be a finite, non-negative price distance')
  const pivots = findPivots(bars, start, strength).map(p => ({ price: p.price, index: p.index }))
  pivots.sort((a, b) => a.price - b.price)
  const span = Math.max(1, bars.length - start)
  const levels: SupportResistanceLevel[] = []
  let group: typeof pivots = []
  const flush = (): void => {
    if (group.length < minTouches) { group = []; return }
    let sum = 0, recent = 0, lastIndex = 0
    for (const p of group) { sum += p.price; recent += 0.5 + 0.5 * (p.index - start) / span; lastIndex = Math.max(lastIndex, p.index) }
    levels.push(Object.freeze({ price: sum / group.length, touches: group.length, lastIndex, strength: recent }))
    group = []
  }
  for (const p of pivots) {
    if (group.length > 0 && p.price - group[group.length - 1].price > tolerance) flush()
    group.push(p)
  }
  flush()
  const byDistance = (a: SupportResistanceLevel, b: SupportResistanceLevel): number => Math.abs(a.price - last) - Math.abs(b.price - last)
  return Object.freeze({
    resistance: Object.freeze(levels.filter(l => l.price > last).sort(byDistance)),
    support: Object.freeze(levels.filter(l => l.price <= last).sort(byDistance))
  })
}
