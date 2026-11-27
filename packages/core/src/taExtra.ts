// SPDX-License-Identifier: GPL-3.0-or-later
// Further owned kernels for the technical pack: percentage price oscillator, Chaikin oscillator, detrended price oscillator,
// linear regression channel and Fisher transform. Pure functions over `Series` (null where a value does not exist yet), built on
// the kernels in `ta.ts`; a bar with a missing input gives null, never a guess.
import { adl, ema, highest, isLength, lowest, sma, type Series } from './ta'

const nulls = (n: number): Series => new Array<number | null>(n).fill(null)

/** Percentage price oscillator: the gap between a fast and a slow EMA as a percent of the slow one, a signal EMA of that, and their difference. */
export function ppo (src: Series, fast: number, slow: number, signal: number): { ppo: Series, signal: Series, hist: Series } {
  const f = ema(src, fast), s = ema(src, slow)
  const line = src.map((_, i) => {
    const a = f[i], b = s[i]
    return a === null || b === null || b === 0 ? null : (a - b) / Math.abs(b) * 100
  })
  const sig = ema(line, signal)
  return { ppo: line, signal: sig, hist: line.map((v, i) => v === null || sig[i] === null ? null : v - (sig[i] as number)) }
}

/** Chaikin oscillator: a fast EMA of the accumulation/distribution line minus a slow one. */
export function chaikinOscillator (high: Series, low: Series, close: Series, volume: Series, fast: number, slow: number): Series {
  const line = adl(high, low, close, volume), f = ema(line, fast), s = ema(line, slow)
  return line.map((_, i) => f[i] === null || s[i] === null ? null : (f[i] as number) - (s[i] as number))
}

/** Detrended price oscillator: the price `floor(len / 2) + 1` bars ago minus today's simple average, so the trend drops out and the cycles stay. */
export function dpo (src: Series, len: number): Series {
  const out = nulls(src.length)
  if (!isLength(len)) return out
  const average = sma(src, len), shift = Math.floor(len / 2) + 1
  for (let i = shift; i < src.length; i++) {
    const past = src[i - shift], mean = average[i]
    if (past !== null && mean !== null) out[i] = past - mean
  }
  return out
}

/**
 * Linear regression channel: for each bar, the least-squares line through the last `len` values, read at that bar, with bands
 * `mult` times the standard deviation of the values from the line either side. Costs `len` steps per bar.
 */
export function linearRegression (src: Series, len: number, mult: number): { mid: Series, upper: Series, lower: Series } {
  const n = src.length, mid = nulls(n), upper = nulls(n), lower = nulls(n)
  if (!isLength(len) || len < 2) return { mid, upper, lower }
  const meanX = (len - 1) / 2
  let sxx = 0
  for (let k = 0; k < len; k++) sxx += (k - meanX) ** 2
  for (let i = len - 1; i < n; i++) {
    let sum = 0, bad = false
    for (let k = 0; k < len; k++) { const v = src[i - len + 1 + k]; if (v === null || !Number.isFinite(v)) { bad = true; break } sum += v }
    if (bad) continue
    const meanY = sum / len
    let sxy = 0
    for (let k = 0; k < len; k++) sxy += (k - meanX) * ((src[i - len + 1 + k] as number) - meanY)
    const slope = sxy / sxx, intercept = meanY - slope * meanX
    let residual = 0
    for (let k = 0; k < len; k++) residual += ((src[i - len + 1 + k] as number) - (intercept + slope * k)) ** 2
    const deviation = Math.sqrt(residual / len), end = intercept + slope * (len - 1)
    mid[i] = end; upper[i] = end + mult * deviation; lower[i] = end - mult * deviation
  }
  return { mid, upper, lower }
}

/**
 * Fisher transform of the median price over `len` bars: the price's place in its recent range, smoothed and stretched so turning
 * points stand out, with the previous bar's value as the trigger line.
 */
export function fisher (high: Series, low: Series, len: number): { fisher: Series, trigger: Series } {
  const n = high.length, out = nulls(n), trigger = nulls(n)
  if (!isLength(len)) return { fisher: out, trigger }
  const median = high.map((h, i) => h === null || low[i] === null ? null : (h + (low[i] as number)) / 2)
  const top = highest(median, len), bottom = lowest(median, len)
  let value = 0, previous = 0
  for (let i = 0; i < n; i++) {
    const m = median[i], hi = top[i], lo = bottom[i]
    if (m === null || hi === null || lo === null) continue
    const place = hi === lo ? 0 : (m - lo) / (hi - lo) - 0.5
    value = Math.max(-0.999, Math.min(0.999, 0.66 * place + 0.67 * value))
    const next = 0.5 * Math.log((1 + value) / (1 - value)) + 0.5 * previous
    out[i] = next
    trigger[i] = previous
    previous = next
  }
  return { fisher: out, trigger }
}
