import type { MarketBar } from '../core/types'
import {
  sma, ema, rma, sum, highest, lowest, trueRange, cci, obv, roc, mom, type Series
} from '../core/ta'
import type { EngineIndicators, IndicatorDefinition, IndicatorFigure, IndicatorRow } from './indicators'

/** Optional classic names advertised by the existing chart's own indicator catalogue. */
export const CLASSIC_INDICATOR_NAMES = Object.freeze([
  'CCI', 'DMI', 'CR', 'PSY', 'DMA', 'TRIX', 'OBV', 'VR', 'WR', 'MTM',
  'EMV', 'ROC', 'PVT', 'AO', 'SAR', 'BIAS', 'BRAR', 'SMA', 'BBI'
] as const)
export type ClassicIndicatorName = typeof CLASSIC_INDICATOR_NAMES[number]

function finite (value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function field (bars: readonly MarketBar[], key: 'open' | 'high' | 'low' | 'close' | 'volume'): Series {
  return bars.map(bar => {
    const value = finite(bar[key])
    return key === 'volume' && value !== null && value < 0 ? null : value
  })
}

function combine (a: Series, b: Series, operation: (x: number, y: number) => number): Series {
  return a.map((x, i) => x === null || b[i] === null ? null : finite(operation(x, b[i] as number)))
}

function ratio (a: Series, b: Series, scale = 100): Series {
  return combine(a, b, (x, y) => y === 0 ? NaN : scale * x / y)
}

function lag (values: Series, count = 1): Series {
  return values.map((_, i) => i < count ? null : values[i - count])
}

function subtract (a: Series, b: Series): Series { return combine(a, b, (x, y) => x - y) }
function positiveDifference (a: Series, b: Series): Series { return combine(a, b, (x, y) => Math.max(0, x - y)) }
function midpoint (high: Series, low: Series): Series { return combine(high, low, (h, l) => (h + l) / 2) }

function rows (keys: readonly string[], values: readonly Series[]): IndicatorRow[] {
  const result: IndicatorRow[] = new Array(values[0]?.length ?? 0)
  for (let i = 0; i < result.length; i++) {
    const row: Record<string, number | null> = Object.create(null)
    for (let j = 0; j < keys.length; j++) row[keys[j]] = finite(values[j][i])
    result[i] = row
  }
  return result
}

function lines (...entries: Array<readonly [string, string]>): readonly IndicatorFigure[] {
  return Object.freeze(entries.map(([key, title]) => Object.freeze({ key, title, type: 'line' as const })))
}

function define (
  name: ClassicIndicatorName,
  defaults: readonly number[],
  figures: readonly IndicatorFigure[],
  calculate: IndicatorDefinition['calculate'],
  pane: IndicatorDefinition['pane'] = 'separate'
): IndicatorDefinition {
  return Object.freeze({
    name,
    params: Object.freeze([...defaults]),
    pane,
    figures,
    calculate: (bars: readonly MarketBar[], supplied: readonly number[]) => {
      if (supplied.length > defaults.length) throw new RangeError(`${name} accepts at most ${defaults.length} parameters`)
      const params = defaults.map((fallback, index) => {
        const value = supplied[index] ?? fallback
        if (!Number.isFinite(value) || value <= 0 || (name !== 'SAR' && !Number.isSafeInteger(value))) {
          throw new RangeError(`${name} requires ${name === 'SAR' ? 'positive finite factors' : 'positive integer periods'}`)
        }
        return value
      })
      if (name === 'SAR' && (params[0] > params[2] || params[1] > params[2] || params[2] > 100)) {
        throw new RangeError('SAR factors use hundredths: initial and increment must not exceed the maximum, which must not exceed 100')
      }
      return calculate(bars, params)
    }
  })
}

function directionalMovement (bars: readonly MarketBar[], p: readonly number[]): IndicatorRow[] {
  const high = field(bars, 'high'), low = field(bars, 'low'), close = field(bars, 'close')
  const rise = subtract(high, lag(high)), fall = subtract(lag(low), low)
  const positive = combine(rise, fall, (up, down) => up > down && up > 0 ? up : 0)
  const negative = combine(rise, fall, (up, down) => down > up && down > 0 ? down : 0)
  const ranges = trueRange(high, low, close)
  // DMI's first observation is a transition. Do not seed TR a bar earlier than DM.
  if (ranges.length > 0) ranges[0] = null
  const averageRange = rma(ranges, p[0])
  const pdi = combine(rma(positive, p[0]), averageRange, (dm, range) => range === 0 ? 0 : 100 * dm / range)
  const mdi = combine(rma(negative, p[0]), averageRange, (dm, range) => range === 0 ? 0 : 100 * dm / range)
  const dx = combine(pdi, mdi, (up, down) => up + down === 0 ? 0 : 100 * Math.abs(up - down) / (up + down))
  const adx = rma(dx, p[1])
  const adxr = combine(adx, lag(adx, p[1]), (now, previous) => (now + previous) / 2)
  return rows(['pdi', 'mdi', 'adx', 'adxr'], [pdi, mdi, adx, adxr])
}

function pressureRatio (bars: readonly MarketBar[], p: readonly number[]): IndicatorRow[] {
  const high = field(bars, 'high'), low = field(bars, 'low')
  const previousMidpoint = lag(midpoint(high, low))
  const cr = ratio(sum(positiveDifference(high, previousMidpoint), p[0]), sum(positiveDifference(previousMidpoint, low), p[0]))
  // The auxiliary lines are ordinary, unshifted SMAs of CR, not displaced lines.
  return rows(['cr', 'ma1', 'ma2', 'ma3', 'ma4'], [cr, ...p.slice(1).map(period => sma(cr, period))])
}

function volumeRatio (bars: readonly MarketBar[], p: readonly number[]): IndicatorRow[] {
  const close = field(bars, 'close'), volume = field(bars, 'volume')
  const movement = subtract(close, lag(close))
  const up = combine(movement, volume, (change, value) => change > 0 ? value : 0)
  const down = combine(movement, volume, (change, value) => change < 0 ? value : 0)
  const equal = sum(combine(movement, volume, (change, value) => change === 0 ? value : 0), p[0])
  const numerator = combine(sum(up, p[0]), equal, (u, e) => 2 * u + e)
  const denominator = combine(sum(down, p[0]), equal, (d, e) => 2 * d + e)
  const vr = ratio(numerator, denominator)
  return rows(['vr', 'signal'], [vr, sma(vr, p[1])])
}

function priceVolumeTrend (bars: readonly MarketBar[]): IndicatorRow[] {
  const close = field(bars, 'close'), volume = field(bars, 'volume')
  const result: Series = new Array(bars.length).fill(null)
  let total = 0
  for (let i = 0; i < close.length; i++) {
    const value = close[i]
    if (value === null) continue
    if (i === 0) { result[i] = 0; continue }
    const previous = close[i - 1], amount = volume[i]
    if (previous === null || previous === 0 || amount === null) continue
    const increment = (value - previous) / previous * amount
    if (!Number.isFinite(increment) || !Number.isFinite(total + increment)) continue
    total += increment
    result[i] = total
  }
  return rows(['pvt'], [result])
}

function easeOfMovement (bars: readonly MarketBar[], p: readonly number[]): IndicatorRow[] {
  const high = field(bars, 'high'), low = field(bars, 'low'), volume = field(bars, 'volume')
  const middle = midpoint(high, low)
  const distance = subtract(middle, lag(middle))
  const distanceTimesRange = combine(distance, subtract(high, low), (d, range) => d * range)
  // Raw-price units / reported-volume units. No stock-specific 1e8 scaling.
  const raw = ratio(distanceTimesRange, volume, 1)
  const emv = sma(raw, p[0])
  return rows(['emv', 'signal'], [emv, sma(emv, p[1])])
}

function willingness (bars: readonly MarketBar[], p: readonly number[]): IndicatorRow[] {
  const high = field(bars, 'high'), low = field(bars, 'low'), open = field(bars, 'open')
  const previousClose = lag(field(bars, 'close'))
  const ar = ratio(sum(subtract(high, open), p[0]), sum(subtract(open, low), p[0]))
  const br = ratio(sum(positiveDifference(high, previousClose), p[0]), sum(positiveDifference(previousClose, low), p[0]))
  return rows(['ar', 'br'], [ar, br])
}

/**
 * Owned Wilder SAR. Seed from two consecutive bars: the first has no value;
 * the second close determines direction (a tie seeds down), its SAR is the
 * previous low/high, and its own high/low is the first trend extreme.
 * A missing sample breaks the sequence instead of inventing intervening prices.
 */
function parabolicSar (bars: readonly MarketBar[], p: readonly number[]): IndicatorRow[] {
  const high = field(bars, 'high'), low = field(bars, 'low'), close = field(bars, 'close')
  const result: Series = new Array(bars.length).fill(null)
  const start = p[0] / 100, increment = p[1] / 100, maximum = p[2] / 100
  let segment = -1, rising = false, value = 0, extreme = 0, acceleration = start
  for (let i = 0; i < bars.length; i++) {
    const h = high[i], l = low[i], c = close[i]
    if (h === null || l === null || c === null || h < l || c < l || c > h) {
      segment = -1
      continue
    }
    if (segment < 0) { segment = i; continue }
    if (i === segment + 1) {
      rising = c > (close[i - 1] as number)
      value = (rising ? low[i - 1] : high[i - 1]) as number
      extreme = rising ? h : l
      acceleration = start
    } else {
      // Today's candidate uses yesterday's state. Reversal precedes the clamp;
      // on reversal the previous trend's extreme is the new SAR, not this bar.
      const candidate = value + acceleration * (extreme - value)
      if (!Number.isFinite(candidate)) { segment = i; continue }
      if (rising ? l < candidate : h > candidate) {
        value = extreme
        rising = !rising
        extreme = rising ? h : l
        acceleration = start
      } else {
        value = rising
          ? Math.min(candidate, low[i - 1] as number, low[i - 2] as number)
          : Math.max(candidate, high[i - 1] as number, high[i - 2] as number)
        if (rising ? h > extreme : l < extreme) {
          extreme = rising ? h : l
          acceleration = Math.min(acceleration + increment, maximum)
        }
      }
    }
    result[i] = value
  }
  return rows(['sar'], [result])
}

/**
 * Explicit owned conventions, not a claim of numeric compatibility with the
 * legacy engine's same-named formulas. Full window warmup is required; a
 * previous-bar comparison first becomes available at index 1, not index 0.
 * Zero denominators and nonfinite results are gaps (except flat DMI: DI/DX 0).
 * Each optional definition currently recomputes after data changes; viewport
 * changes reuse EngineIndicators' results. There are no renderer/UI imports.
 *
 * - CCI/OBV/ROC use the existing owned core. OBV starts at zero and the
 *   core treats missing volume as zero contribution; its SMA signal waits for
 *   its complete window. SAR's public factors retain stored hundredths [2,2,20].
 *   SAR has its own Wilder recurrence with prior-two-extrema clamping. It seeds
 *   direction from the second close, keeps the first bar null, uses strict
 *   reversal comparisons and restarts after a missing/invalid OHLC sample.
 * - DMI uses Wilder RMA for DM/TR and ADX, not rolling sums/EMA; ADXR is the
 *   mean of ADX now and ADX `adxPeriod` bars earlier. DM/TR seed from transitions.
 * - TRIX uses three SMA-seeded EMAs, one-bar percent change, then an EMA signal.
 *   With [12,9], TRIX first appears at index 34 and its signal at index 42.
 * - WR is one conventional negative Williams %R line (-100..0), default 14;
 *   this is not a positive 0..100 or multi-period legacy display convention.
 * - CR uses the previous high/low midpoint and unshifted SMA signal lines.
 * - EMV is unscaled midpoint movement * range / volume, SMA then signal SMA;
 *   it is not a turnover-based, rolling-sum or 1e8-scaled variant.
 * - PVT starts at zero; missing/invalid volume or a zero previous close makes
 *   a gap and leaves the known subtotal unchanged. No missing flow is invented.
 * - BIAS has three fixed lines (default 6/12/24). SMA means the true arithmetic
 *   mean (the existing chart's SC_SMA alias), not a Chinese recursive SMA.
 * - AO is the 5/34 midpoint SMA difference; histogram values are preserved,
 *   but per-bar rising/falling colors belong to the renderer, not this pack.
 *
 * Formula references used independently of any upstream implementation:
 * https://www.tradingview.com/support/solutions/43000589099-average-directional-index-adx/
 * https://www.tradingview.com/support/solutions/43000502331-trix/
 * https://www.tradingview.com/support/solutions/43000501985-williams-r-r/
 * https://www.tradingview.com/support/solutions/43000502256-ease-of-movement-eom/
 * https://www.tradingview.com/support/solutions/43000502345-price-volume-trend-pvt/
 * https://www.tradingview.com/support/solutions/43000501826-awesome-oscillator-ao/
 * https://www.tradingview.com/support/solutions/43000502597-parabolic-sar-sar/
 * https://www.moomoo.com/sg/support/topic3_248
 * https://www.moomoo.com/jp/support/topic3_815
 * https://www.moomoo.com/ca/hant/support/topic3_157
 * https://support.futunn.com/topic656
 */
export const CLASSIC_INDICATOR_DEFINITIONS: readonly IndicatorDefinition[] = Object.freeze([
  define('CCI', [20], lines(['cci', 'CCI']), (bars, p) => rows(['cci'], [cci(field(bars, 'high'), field(bars, 'low'), field(bars, 'close'), p[0])])),
  define('DMI', [14, 6], lines(['pdi', '+DI'], ['mdi', '-DI'], ['adx', 'ADX'], ['adxr', 'ADXR']), directionalMovement),
  define('CR', [26, 10, 20, 40, 60], lines(['cr', 'CR'], ['ma1', 'MA1'], ['ma2', 'MA2'], ['ma3', 'MA3'], ['ma4', 'MA4']), pressureRatio),
  define('PSY', [12, 6], lines(['psy', 'PSY'], ['signal', 'Signal']), (bars, p) => {
    const close = field(bars, 'close')
    const rises = combine(close, lag(close), (value, previous) => value > previous ? 1 : 0)
    const psy = sma(rises, p[0]).map(value => value === null ? null : value * 100)
    return rows(['psy', 'signal'], [psy, sma(psy, p[1])])
  }),
  define('DMA', [10, 50, 10], lines(['dma', 'DMA'], ['signal', 'Signal']), (bars, p) => {
    const close = field(bars, 'close')
    const dma = subtract(sma(close, p[0]), sma(close, p[1]))
    return rows(['dma', 'signal'], [dma, sma(dma, p[2])])
  }),
  define('TRIX', [12, 9], lines(['trix', 'TRIX'], ['signal', 'Signal EMA']), (bars, p) => {
    const triple = ema(ema(ema(field(bars, 'close'), p[0]), p[0]), p[0])
    const trix = roc(triple, 1)
    return rows(['trix', 'signal'], [trix, ema(trix, p[1])])
  }),
  define('OBV', [30], lines(['obv', 'OBV'], ['signal', 'Signal']), (bars, p) => {
    const value = obv(field(bars, 'close'), field(bars, 'volume'))
    return rows(['obv', 'signal'], [value, sma(value, p[0])])
  }),
  define('VR', [26, 6], lines(['vr', 'VR'], ['signal', 'Signal']), volumeRatio),
  define('WR', [14], lines(['wr', 'Williams %R']), (bars, p) => {
    const upper = highest(field(bars, 'high'), p[0]), lower = lowest(field(bars, 'low'), p[0])
    return rows(['wr'], [ratio(subtract(upper, field(bars, 'close')), subtract(upper, lower), -100)])
  }),
  define('MTM', [12, 6], lines(['mtm', 'MTM'], ['signal', 'Signal']), (bars, p) => {
    const value = mom(field(bars, 'close'), p[0])
    return rows(['mtm', 'signal'], [value, sma(value, p[1])])
  }),
  define('EMV', [14, 9], lines(['emv', 'EMV'], ['signal', 'Signal']), easeOfMovement),
  define('ROC', [12, 6], lines(['roc', 'ROC'], ['signal', 'Signal']), (bars, p) => {
    const value = roc(field(bars, 'close'), p[0])
    return rows(['roc', 'signal'], [value, sma(value, p[1])])
  }),
  define('PVT', [], lines(['pvt', 'PVT']), bars => priceVolumeTrend(bars)),
  define('AO', [5, 34], Object.freeze([Object.freeze({ key: 'ao', title: 'AO', type: 'bar' as const })]), (bars, p) => {
    const middle = midpoint(field(bars, 'high'), field(bars, 'low'))
    return rows(['ao'], [subtract(sma(middle, p[0]), sma(middle, p[1]))])
  }),
  define('SAR', [2, 2, 20], lines(['sar', 'SAR']), parabolicSar, 'price'),
  define('BIAS', [6, 12, 24], lines(['bias1', 'BIAS1'], ['bias2', 'BIAS2'], ['bias3', 'BIAS3']), (bars, p) => {
    const close = field(bars, 'close')
    return rows(['bias1', 'bias2', 'bias3'], p.map(period => {
      const average = sma(close, period)
      return ratio(subtract(close, average), average)
    }))
  }),
  define('BRAR', [26], lines(['ar', 'AR'], ['br', 'BR']), willingness),
  define('SMA', [9], lines(['sma', 'SMA']), (bars, p) => rows(['sma'], [sma(field(bars, 'close'), p[0])]), 'price'),
  define('BBI', [3, 6, 12, 24], lines(['bbi', 'BBI']), (bars, p) => {
    const close = field(bars, 'close')
    const averages = p.map(period => sma(close, period))
    const value = averages[0].map((a, i) => {
      const b = averages[1][i], c = averages[2][i], d = averages[3][i]
      return a === null || b === null || c === null || d === null ? null : (a + b + c + d) / 4
    })
    return rows(['bbi'], [value])
  }, 'price')
])

/** Register once; callers decide which instances to add. No default chart work is added. */
export function registerClassicIndicators (registry: EngineIndicators): void {
  for (const definition of CLASSIC_INDICATOR_DEFINITIONS) registry.register(definition)
}
