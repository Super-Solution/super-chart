// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Price-driven chart styles: Renko, line break, range bars, Kagi and point and figure.
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

export type DerivedStyle = 'renko' | 'line-break' | 'range' | 'kagi' | 'point-figure'
export const DERIVED_STYLES: readonly DerivedStyle[] = Object.freeze(['renko', 'line-break', 'range', 'kagi', 'point-figure'] as const)

export interface DerivedStyleOptions {
  /**
   * Price distance that makes a mark: the Renko brick, the range of a range bar or the Kagi reversal amount.
   * Default: the 14-bar average true range of the source bars (see `averageTrueRange`).
   */
  size?: number
  /** Line break only: how many previous lines a close must break to reverse. Default 3. */
  lines?: number
  /** Point and figure only: boxes a move against the column must cover to start the next column. Default 3. */
  reversal?: number
  /** Point and figure only: which prices fill boxes, the closes (default) or each bar's high and low. */
  method?: 'close' | 'high-low'
}

/** One mark before it gets its time: `source` is the index of the source bar that made it. */
export interface Mark { source: number, open: number, high: number, low: number, close: number }

/** A size far smaller than the price moves would make millions of marks; refuse instead of freezing the page. */
const MAX_MARKS = 2_000_000
function push (marks: Mark[], mark: Mark): void {
  if (marks.length >= MAX_MARKS) throw new RangeError('This size makes too many marks; use a larger size')
  // Prices so large for the size that a level overflows would otherwise reach the chart as Infinity.
  if (!Number.isFinite(mark.open) || !Number.isFinite(mark.high) || !Number.isFinite(mark.low) || !Number.isFinite(mark.close)) throw new RangeError('These prices are too large for this size; use a larger size')
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

/**
 * Turn marks into bars: times spread inside the source slot, volume shared out. `from` is the index of the first mark to
 * turn (it must start a group of marks made by one source bar) and `out` already holds the bars of the marks before it;
 * the live port uses this to redo only the end of the series after a tick.
 */
export function realiseMarks (bars: readonly MarketBar[], marks: readonly Mark[], from = 0, out: MarketBar[] = []): MarketBar[] {
  let pending = 0, volumeUpTo = from > 0 ? marks[from - 1].source : -1
  // A mark has volume once any bar up to its source did; the mark before `from` already says whether that happened.
  let hasVolume = from > 0 && out[from - 1].volume !== undefined
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
  let i = from
  while (i < marks.length) {
    let j = i
    while (j < marks.length && marks[j].source === marks[i].source) j++
    const count = j - i, source = marks[i].source, start = bars[source].timestamp
    const slot = source + 1 < bars.length ? bars[source + 1].timestamp - start : source > 0 ? start - bars[source - 1].timestamp : 1
    if (count > 1 && Math.floor(slot / count) < 1) throw new RangeError(`One ${slot} ms bar made ${count} marks; use a larger size`)
    const volume = volumeThrough(source)
    for (let k = 0; k < count; k++) {
      const mark = marks[i + k]
      // The mark still forming never went through `push`, so the same overflow check applies here.
      if (!Number.isFinite(mark.open) || !Number.isFinite(mark.high) || !Number.isFinite(mark.low) || !Number.isFinite(mark.close)) throw new RangeError('These prices are too large for this size; use a larger size')
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
 * One style as a state machine over the source bars. The batch functions below feed it the whole history; the live port
 * keeps one and, when only the last source bar changes, goes back to a saved state and feeds that bar again instead of
 * starting over. `marks` holds the finished marks, which never change once they are there; `snapshot()` adds the mark still
 * forming at the end (range bar, Kagi line, point and figure column) without touching the state.
 */
export interface DerivedBuilder {
  readonly marks: readonly Mark[]
  /** Feed the next source bar; `index` is its position in the history, counting from 0 without gaps. */
  feed: (bar: MarketBar, index: number) => void
  save: () => DerivedCheckpoint
  restore: (checkpoint: DerivedCheckpoint) => void
  snapshot: () => readonly Mark[]
}
export interface DerivedCheckpoint { readonly length: number, readonly state: readonly number[] }

/** The options that do not depend on the data: refuse them before any work, also for an empty history. */
function checkOptions (style: DerivedStyle, options: DerivedStyleOptions): void {
  if (style === 'line-break') {
    const lines = options.lines ?? 3
    if (!Number.isSafeInteger(lines) || lines < 1) throw new RangeError('lines must be a positive integer')
  }
  if (style === 'point-figure') {
    const reversal = options.reversal ?? 3
    if (!Number.isSafeInteger(reversal) || reversal < 1) throw new RangeError('reversal must be a positive integer')
    const method = options.method ?? 'close'
    if (method !== 'close' && method !== 'high-low') throw new RangeError("method must be 'close' or 'high-low'")
  }
}

/** Check one bar the way `assertSource` checks a history, for a builder that is fed bar by bar. */
export function assertSourceBar (bar: MarketBar, previousTimestamp: number): void {
  if (!finiteBar(bar) || bar.timestamp <= previousTimestamp) throw new RangeError('Price-driven styles need finite OHLC and strictly ascending timestamps')
}

/** `size` is the price distance already settled on (see `averageTrueRange`); line break ignores it. */
export function createDerivedBuilder (style: DerivedStyle, size: number, options: DerivedStyleOptions = {}): DerivedBuilder {
  checkOptions(style, options)
  if (style !== 'line-break') assertSize(size, 'size')
  const marks: Mark[] = []
  const limit = size * (1 - EPS)
  const common = (state: () => number[], reset: (values: readonly number[]) => void): Pick<DerivedBuilder, 'marks' | 'save' | 'restore'> => ({
    marks,
    save: () => ({ length: marks.length, state: state() }),
    restore: checkpoint => { marks.length = checkpoint.length; reset(checkpoint.state) }
  })
  switch (style) {
    case 'renko': {
      // Levels are whole multiples of size, so long runs never drift: level k is k * size. `last` is the level of the last
      // brick's close (before any brick: the anchor level); `direction` is 1 after an up brick, -1 after a down brick.
      let last = 0, direction = 0
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
      return {
        ...common(() => [last, direction], v => { last = v[0]; direction = v[1] }),
        feed: (bar, s) => {
          if (s === 0) last = Math.floor(bar.close / size + EPS)
          const n = bricksBetween(last * size, bar.close, size)
          if (direction === 0) { if (n >= 1) up(s, n, last); else if (n <= -1) down(s, -n, last) }
          else if (direction === 1) { if (n >= 1) up(s, n, last); else if (n <= -2) down(s, -n - 1, last - 1) }
          else if (n <= -1) down(s, -n, last)
          else if (n >= 2) up(s, n - 1, last + 1)
        },
        snapshot: () => marks
      }
    }
    case 'line-break': {
      const lines = options.lines ?? 3
      let anchor = 0
      return {
        ...common(() => [anchor], v => { anchor = v[0] }),
        feed: (bar, s) => {
          if (s === 0) { anchor = bar.close; return }
          const close = bar.close
          if (marks.length === 0) {
            if (close !== anchor) push(marks, { source: s, open: anchor, high: Math.max(anchor, close), low: Math.min(anchor, close), close })
            return
          }
          const last = marks[marks.length - 1], up = last.close > last.open
          let high = -Infinity, low = Infinity
          for (let k = Math.max(0, marks.length - lines); k < marks.length; k++) { high = Math.max(high, marks[k].high); low = Math.min(low, marks[k].low) }
          if ((up && close > last.close) || (!up && close < last.close) || (up && close < low) || (!up && close > high)) {
            push(marks, { source: s, open: last.close, high: Math.max(last.close, close), low: Math.min(last.close, close), close })
          }
        },
        snapshot: () => marks
      }
    }
    case 'range': {
      let open = 0, high = 0, low = 0, source = 0, lastClose = 0
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
      return {
        ...common(() => [open, high, low, source, lastClose], v => { open = v[0]; high = v[1]; low = v[2]; source = v[3]; lastClose = v[4] }),
        feed: (bar, s) => {
          if (s === 0) { open = bar.open; high = open; low = open }
          source = s; lastClose = bar.close
          const path = bar.close >= bar.open ? [bar.open, bar.low, bar.high, bar.close] : [bar.open, bar.high, bar.low, bar.close]
          for (const price of path) visit(price)
        },
        // The bar still forming: show it so the chart reaches the latest price. It is the last mark and may change tick by tick.
        snapshot: () => marks.length === 0 || high > low ? [...marks, { source, open, high, low, close: lastClose }] : marks
      }
    }
    case 'kagi': {
      let anchor = 0, direction = 0, start = 0, end = 0, endSource = 0
      const line = (): Mark => ({ source: endSource, open: start, high: Math.max(start, end), low: Math.min(start, end), close: end })
      return {
        ...common(() => [anchor, direction, start, end, endSource], v => { anchor = v[0]; direction = v[1]; start = v[2]; end = v[3]; endSource = v[4] }),
        feed: (bar, s) => {
          if (s === 0) { anchor = bar.close; start = anchor; end = anchor; endSource = 0; return }
          const close = bar.close
          if (direction === 0) {
            if (Math.abs(close - anchor) >= limit) { direction = close > anchor ? 1 : -1; start = anchor; end = close; endSource = s }
            return
          }
          if ((direction === 1 && close > end) || (direction === -1 && close < end)) { end = close; endSource = s; return }
          if ((direction === 1 && end - close >= limit) || (direction === -1 && close - end >= limit)) {
            push(marks, line())
            start = end; end = close; direction = -direction; endSource = s
          }
        },
        snapshot: () => direction === 0 ? marks : [...marks, line()]
      }
    }
    case 'point-figure': {
      const reversal = options.reversal ?? 3, closeMethod = (options.method ?? 'close') === 'close'
      const box = (price: number): number => Math.floor(price / size + EPS)
      // `direction`: 1 = column of X, -1 = column of O, 0 = no column yet. `top` and `bottom` are box numbers.
      let anchor = 0, direction = 0, top = 0, bottom = 0, startSource = 0
      const column = (): Mark => {
        const rising = direction === 1, low = bottom * size, high = (top + 1) * size
        return { source: startSource, open: rising ? low : high, high, low, close: rising ? high : low }
      }
      return {
        ...common(() => [anchor, direction, top, bottom, startSource], v => { anchor = v[0]; direction = v[1]; top = v[2]; bottom = v[3]; startSource = v[4] }),
        feed: (bar, s) => {
          if (s === 0) anchor = box(closeMethod ? bar.close : bar.open)
          const hi = box(closeMethod ? bar.close : bar.high), lo = box(closeMethod ? bar.close : bar.low)
          if (direction === 0) {
            const goesUp = hi >= anchor + 1, goesDown = lo <= anchor - 1
            if (!goesUp && !goesDown) return
            if (goesUp && (!goesDown || bar.close >= bar.open)) { direction = 1; bottom = anchor; top = hi }
            else { direction = -1; top = anchor; bottom = lo }
            startSource = s
            return
          }
          if (direction === 1) {
            if (hi >= top + 1) top = hi
            else if (lo <= top - reversal) { push(marks, column()); direction = -1; const end = top - 1; bottom = lo; top = end; startSource = s }
          } else if (lo <= bottom - 1) bottom = lo
          else if (hi >= bottom + reversal) { push(marks, column()); direction = 1; const first = bottom + 1; top = hi; bottom = first; startSource = s }
        },
        snapshot: () => direction === 0 ? marks : [...marks, column()]
      }
    }
    default: throw new TypeError('Unknown price-driven style')
  }
}

function runBatch (style: DerivedStyle, bars: readonly MarketBar[], options: DerivedStyleOptions): MarketBar[] {
  assertSource(bars)
  checkOptions(style, options)
  if (bars.length === 0) return []
  const builder = createDerivedBuilder(style, style === 'line-break' ? 1 : sizeOf(bars, options), options)
  for (let s = 0; s < bars.length; s++) builder.feed(bars[s], s)
  return realiseMarks(bars, builder.snapshot())
}

/**
 * Traditional Renko on closing prices. Bricks sit on a lattice of `size`, anchored at the first close rounded down to a
 * multiple of `size`. A brick in the trend's direction needs a close one brick beyond the last brick; a reversal
 * needs two (the close must pass the opposite end of the last brick by one brick). The first brick may go either
 * way, one lattice step from the anchor. A close that jumps several bricks makes them all, each one `size` tall.
 * Bricks have no wick: open and close are the brick ends and high and low equal the larger and the smaller.
 */
export function toRenko (bars: readonly MarketBar[], options: DerivedStyleOptions = {}): MarketBar[] { return runBatch('renko', bars, options) }

/**
 * Line break (default three line break) on closing prices. The first line joins the first two different closes.
 * Each new close then either extends the trend (a close beyond the last line's close in its direction makes a
 * new line from that close) or reverses it (a close beyond the high or low of the last `lines` lines in the
 * opposite direction makes a line the other way); any other close makes no line. Every line opens at the previous
 * line's close, reversals included. Lines carry no wick.
 */
export function toLineBreak (bars: readonly MarketBar[], options: DerivedStyleOptions = {}): MarketBar[] { return runBatch('line-break', bars, options) }

/**
 * Range bars. Every finished bar spans exactly `size` from low to high. Inside each source bar the price path is
 * taken as open, low, high, close when the bar closed up and open, high, low, close when it closed down (daily
 * OHLC cannot say which came first, so this is an approximation; real tick data would be exact). A bar finishes when the
 * path moves `size` from its low or high; it closes at that boundary and the next bar opens there. The bar still
 * forming at the end of the history is included, shorter than `size`.
 */
export function toRangeBars (bars: readonly MarketBar[], options: DerivedStyleOptions = {}): MarketBar[] { return runBatch('range', bars, options) }

/**
 * Kagi on closing prices with a fixed reversal amount. The line follows price while it keeps moving the same way
 * and turns when a close moves against it by `size` or more. Each output bar is one vertical line: it opens where the
 * line started (the previous turning point) and closes at its current end. Thick/thin (yang/yin) is not encoded.
 * The line still being drawn is the last bar.
 */
export function toKagi (bars: readonly MarketBar[], options: DerivedStyleOptions = {}): MarketBar[] { return runBatch('kagi', bars, options) }

/**
 * Point and figure. Prices fall into boxes of `size` on a lattice (box k covers k * size up to (k + 1) * size). A column
 * of X fills boxes upward, a column of O downward, and every column is one output bar: an X column opens at the
 * bottom edge of its lowest box and closes at the top edge of its highest box, an O column the other way round.
 * While price keeps making a new box in the column's direction the column grows. A move against it of `reversal`
 * boxes (default 3) from the column's end starts the next column, in the next box beside the old one: an X column
 * ending in box T is followed by an O column from T - 1 downward, an O column ending in box B by an X column from
 * B + 1 upward. The first column starts in the box of the first price and goes whichever way price first leaves it.
 *
 * `method: 'close'` (default) fills boxes from the closes. `method: 'high-low'` uses each bar's high while a column
 * of X grows and its low while a column of O grows; a bar never both extends and reverses a column (extending wins),
 * and a first bar that leaves its box both ways goes the way the bar closed. A column takes the time of the source
 * bar that started it, so the column still forming keeps its time as it grows. The volume of the bars inside a
 * column is carried to the column that follows it.
 */
export function toPointAndFigure (bars: readonly MarketBar[], options: DerivedStyleOptions = {}): MarketBar[] { return runBatch('point-figure', bars, options) }

/** Dispatch by style name. */
export function deriveBars (style: DerivedStyle, bars: readonly MarketBar[], options: DerivedStyleOptions = {}): MarketBar[] {
  if (!DERIVED_STYLES.includes(style)) throw new TypeError('Unknown price-driven style')
  return runBatch(style, bars, options)
}
