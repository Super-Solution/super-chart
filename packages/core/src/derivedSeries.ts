// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Price-driven chart styles: Renko, line break, range bars and Kagi.
 *
 * These styles do not draw one mark per time bar. Each mark is made when price moves enough, so the number of marks
 * differs from the number of source bars and the time axis stops being evenly spaced. The functions here are pure:
 * they read the full ascending source history and return a new ascending bar list that any chart renders like
 * ordinary candles (a Renko brick is a candle with no wick). They start from the first bar, so the same history
 * always gives the same result; computing only the visible window would change older marks every time more history
 * loaded.
 *
 * Output bars carry a real timestamp so crosshair, drawings and indicators keep working on the derived series:
 * a mark takes the time of the source bar whose price made it. Several marks made by one source bar are spread
 * evenly inside that bar's time slot so timestamps stay strictly ascending (the series requires it). If the slot is
 * too short to hold them (more marks than milliseconds) the transform throws; use a larger brick.
 *
 * Volume of the source bars is shared out over the marks they made; volume of bars that made no mark yet waits for
 * the next mark, so the volume of all marks adds up to the volume of the bars up to the last mark.
 */
import type { MarketBar } from './types'

export type DerivedStyle = 'renko' | 'line-break' | 'range' | 'kagi'
export const DERIVED_STYLES: readonly DerivedStyle[] = Object.freeze(['renko', 'line-break', 'range', 'kagi'] as const)

export interface DerivedStyleOptions {
  /**
   * Price distance that makes a mark: the Renko brick, the range of a range bar or the Kagi reversal amount.
   * Default: the 14-bar average true range of the source bars (see `averageTrueRange`).
   */
  size?: number
  /** Line break only: how many previous lines a close must break to reverse. Default 3. */
  lines?: number
}

/** One mark before it gets its time: `source` is the index of the source bar that made it. */
interface Mark { source: number, open: number, high: number, low: number, close: number }

/** A size far smaller than the price moves would make millions of marks; refuse instead of freezing the page. */
const MAX_MARKS = 2_000_000
function push (marks: Mark[], mark: Mark): void {
  if (marks.length >= MAX_MARKS) throw new RangeError('This size makes too many marks; use a larger size')
  marks.push(mark)
}

/** Ticks of float noise allowed when a price lands exactly on a brick or range boundary. */
const EPS = 1e-9

function finiteBar (bar: MarketBar): boolean {
  return Number.isFinite(bar.timestamp) && Number.isFinite(bar.open) && Number.isFinite(bar.high) && Number.isFinite(bar.low) && Number.isFinite(bar.close)
}

function assertSource (bars: readonly MarketBar[]): void {
  let previous = -Infinity
  for (const bar of bars) {
    if (!finiteBar(bar) || bar.timestamp <= previous) throw new RangeError('Price-driven styles need finite OHLC and strictly ascending timestamps')
    previous = bar.timestamp
  }
}

function assertSize (size: number, name: string): void {
  if (!Number.isFinite(size) || size <= 0) throw new RangeError(`${name} must be a positive finite price distance`)
}

/**
 * Wilder average true range of the source bars, the usual default brick. With fewer than `period + 1` bars it is the
 * mean true range of what exists. Throws when the result is not positive (flat prices): no size can be chosen then.
 */
export function averageTrueRange (bars: readonly MarketBar[], period = 14): number {
  if (!Number.isSafeInteger(period) || period < 1) throw new RangeError('ATR period must be a positive integer')
  assertSource(bars)
  if (bars.length === 0) throw new RangeError('There are no bars to size a price-driven style')
  let value = 0, count = 0
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i]
    const range = i === 0 ? bar.high - bar.low : Math.max(bar.high - bar.low, Math.abs(bar.high - bars[i - 1].close), Math.abs(bar.low - bars[i - 1].close))
    if (count < period) { value = (value * count + range) / (count + 1); count++ } else value = (value * (period - 1) + range) / period
  }
  if (!(value > 0)) throw new RangeError('Prices are flat: give an explicit size')
  return value
}

function sizeOf (bars: readonly MarketBar[], options: DerivedStyleOptions): number {
  const size = options.size ?? averageTrueRange(bars)
  assertSize(size, 'size')
  return size
}

/** Turn marks into bars: times spread inside the source slot, volume shared out. */
function realise (bars: readonly MarketBar[], marks: readonly Mark[]): MarketBar[] {
  const out: MarketBar[] = []
  let pending = 0, hasVolume = false, volumeUpTo = -1
  const volumeThrough = (source: number): number => {
    for (let i = volumeUpTo + 1; i <= source; i++) {
      const volume = bars[i].volume
      if (typeof volume === 'number' && Number.isFinite(volume)) { pending += volume; hasVolume = true }
    }
    volumeUpTo = Math.max(volumeUpTo, source)
    const taken = pending
    pending = 0
    return taken
  }
  let i = 0
  while (i < marks.length) {
    let j = i
    while (j < marks.length && marks[j].source === marks[i].source) j++
    const count = j - i, source = marks[i].source, start = bars[source].timestamp
    const slot = source + 1 < bars.length ? bars[source + 1].timestamp - start : source > 0 ? start - bars[source - 1].timestamp : 1
    if (count > 1 && Math.floor(slot / count) < 1) throw new RangeError(`One ${slot} ms bar made ${count} marks; use a larger size`)
    const volume = volumeThrough(source)
    for (let k = 0; k < count; k++) {
      const mark = marks[i + k]
      const bar: MarketBar = { timestamp: start + Math.floor(k * slot / count), open: mark.open, high: mark.high, low: mark.low, close: mark.close }
      if (hasVolume) bar.volume = volume / count
      out.push(bar)
    }
    i = j
  }
  return out
}

/** Whole bricks between two prices, tolerating float noise right on a boundary. */
function bricksBetween (from: number, to: number, size: number): number {
  const q = (to - from) / size, r = Math.round(q)
  return Math.abs(q - r) < EPS * Math.max(1, Math.abs(q)) ? r : Math.trunc(q)
}

/**
 * Traditional Renko on closing prices. Bricks sit on a lattice of `size`, anchored at the first close rounded down to a
 * multiple of `size`. A brick in the trend's direction needs a close one brick beyond the last brick; a reversal
 * needs two (the close must pass the opposite end of the last brick by one brick). The first brick may go either
 * way, one lattice step from the anchor. A close that jumps several bricks makes them all, each one `size` tall.
 * Bricks have no wick: open and close are the brick ends and high and low equal the larger and the smaller.
 */
export function toRenko (bars: readonly MarketBar[], options: DerivedStyleOptions = {}): MarketBar[] {
  assertSource(bars)
  if (bars.length === 0) return []
  const size = sizeOf(bars, options)
  const marks: Mark[] = []
  // Levels are whole multiples of size, so long runs never drift: level k is k * size. `last` is the level of the last
  // brick's close (before any brick: the anchor level); `direction` is 1 after an up brick, -1 after a down brick.
  let last = Math.floor(bars[0].close / size + EPS), direction = 0
  const up = (source: number, count: number, first: number): void => {
    let from = first
    for (let k = 0; k < count; k++, from++) push(marks, { source, open: from * size, high: (from + 1) * size, low: from * size, close: (from + 1) * size })
    last = from; direction = 1
  }
  const down = (source: number, count: number, first: number): void => {
    let from = first
    for (let k = 0; k < count; k++, from--) push(marks, { source, open: from * size, high: from * size, low: (from - 1) * size, close: (from - 1) * size })
    last = from; direction = -1
  }
  for (let s = 0; s < bars.length; s++) {
    const n = bricksBetween(last * size, bars[s].close, size)
    if (direction === 0) { if (n >= 1) up(s, n, last); else if (n <= -1) down(s, -n, last) }
    else if (direction === 1) { if (n >= 1) up(s, n, last); else if (n <= -2) down(s, -n - 1, last - 1) }
    else if (n <= -1) down(s, -n, last)
    else if (n >= 2) up(s, n - 1, last + 1)
  }
  return realise(bars, marks)
}

/**
 * Line break (default three line break) on closing prices. The first line joins the first two different closes.
 * Each new close then either extends the trend (a close beyond the last line's close in its direction makes a
 * new line from that close) or reverses it (a close beyond the high or low of the last `lines` lines in the
 * opposite direction makes a line the other way); any other close makes no line. Every line opens at the previous
 * line's close, reversals included. Lines carry no wick.
 */
export function toLineBreak (bars: readonly MarketBar[], options: DerivedStyleOptions = {}): MarketBar[] {
  assertSource(bars)
  const lines = options.lines ?? 3
  if (!Number.isSafeInteger(lines) || lines < 1) throw new RangeError('lines must be a positive integer')
  if (bars.length === 0) return []
  const marks: Mark[] = []
  const anchor = bars[0].close
  for (let s = 1; s < bars.length; s++) {
    const close = bars[s].close
    if (marks.length === 0) {
      if (close !== anchor) push(marks, { source: s, open: anchor, high: Math.max(anchor, close), low: Math.min(anchor, close), close })
      continue
    }
    const last = marks[marks.length - 1], up = last.close > last.open
    let high = -Infinity, low = Infinity
    for (let k = Math.max(0, marks.length - lines); k < marks.length; k++) { high = Math.max(high, marks[k].high); low = Math.min(low, marks[k].low) }
    if ((up && close > last.close) || (!up && close < last.close) || (up && close < low) || (!up && close > high)) {
      push(marks, { source: s, open: last.close, high: Math.max(last.close, close), low: Math.min(last.close, close), close })
    }
  }
  return realise(bars, marks)
}

/**
 * Range bars. Every finished bar spans exactly `size` from low to high. Inside each source bar the price path is
 * taken as open, low, high, close when the bar closed up and open, high, low, close when it closed down (daily
 * OHLC cannot say which came first, so this is an approximation; real tick data would be exact). A bar finishes when the
 * path moves `size` from its low or high; it closes at that boundary and the next bar opens there. The bar still
 * forming at the end of the history is included, shorter than `size`.
 */
export function toRangeBars (bars: readonly MarketBar[], options: DerivedStyleOptions = {}): MarketBar[] {
  assertSource(bars)
  if (bars.length === 0) return []
  const size = sizeOf(bars, options), limit = size * (1 - EPS)
  const marks: Mark[] = []
  let open = bars[0].open, high = open, low = open, source = 0
  const visit = (price: number): void => {
    for (;;) {
      const nextHigh = Math.max(high, price), nextLow = Math.min(low, price)
      if (nextHigh - nextLow < limit) { high = nextHigh; low = nextLow; return }
      if (price > high) {
        const close = low + size
        push(marks, { source, open, high: close, low, close }); open = close; high = close; low = close
      } else {
        const close = high - size
        push(marks, { source, open, high, low: close, close }); open = close; high = close; low = close
      }
    }
  }
  for (let s = 0; s < bars.length; s++) {
    source = s
    const bar = bars[s]
    const path = bar.close >= bar.open ? [bar.open, bar.low, bar.high, bar.close] : [bar.open, bar.high, bar.low, bar.close]
    for (const price of path) visit(price)
  }
  // The bar still forming: show it so the chart reaches the latest price. It is the last mark and may change tick by tick.
  const lastClose = bars[bars.length - 1].close
  if (marks.length === 0 || high > low) push(marks, { source: bars.length - 1, open, high, low, close: lastClose })
  return realise(bars, marks)
}

/**
 * Kagi on closing prices with a fixed reversal amount. The line follows price while it keeps moving the same way
 * and turns when a close moves against it by `size` or more. Each output bar is one vertical line: it opens where the
 * line started (the previous turning point) and closes at its current end. Thick/thin (yang/yin) is not encoded.
 * The line still being drawn is the last bar.
 */
export function toKagi (bars: readonly MarketBar[], options: DerivedStyleOptions = {}): MarketBar[] {
  assertSource(bars)
  if (bars.length === 0) return []
  const size = sizeOf(bars, options), limit = size * (1 - EPS)
  const marks: Mark[] = []
  const anchor = bars[0].close
  let direction = 0, start = anchor, end = anchor, endSource = 0
  const emitLine = (source: number): void => { push(marks, { source, open: start, high: Math.max(start, end), low: Math.min(start, end), close: end }) }
  for (let s = 1; s < bars.length; s++) {
    const close = bars[s].close
    if (direction === 0) {
      if (Math.abs(close - anchor) >= limit) { direction = close > anchor ? 1 : -1; start = anchor; end = close; endSource = s }
      continue
    }
    if ((direction === 1 && close > end) || (direction === -1 && close < end)) { end = close; endSource = s; continue }
    if ((direction === 1 && end - close >= limit) || (direction === -1 && close - end >= limit)) {
      emitLine(endSource)
      start = end; end = close; direction = -direction as 1 | -1; endSource = s
    }
  }
  if (direction !== 0) emitLine(endSource)
  return realise(bars, marks)
}

/** Dispatch by style name. */
export function deriveBars (style: DerivedStyle, bars: readonly MarketBar[], options: DerivedStyleOptions = {}): MarketBar[] {
  switch (style) {
    case 'renko': return toRenko(bars, options)
    case 'line-break': return toLineBreak(bars, options)
    case 'range': return toRangeBars(bars, options)
    case 'kagi': return toKagi(bars, options)
    default: throw new TypeError('Unknown price-driven style')
  }
}
