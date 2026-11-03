/**
 * The TA core: pure series math shared by SuperScript and Super Chart's own
 * indicators. Series in, series out; no klinecharts, no DOM.
 *
 * One documented convention, TradingView's:
 *   - EMA starts from the average of its first `len` values and is null before
 *     that (it used to start from the first value in SuperScript).
 *   - RMA (Wilder) starts the same way; RSI is Wilder's, 100 when the average
 *     loss is 0 and 0 when the average gain is 0.
 *   - Standard deviation is the population one.
 *   - MACD is { dif, dea, hist } with hist = dif - dea (TradingView), not
 *     klinecharts' (dif - dea) * 2; `histMultiplier: 2` gives the latter.
 *
 * Nulls: a windowed kernel (sum, sma, wma, stdev, dev, highest, lowest,
 * linreg, correlation) outputs a value only when its whole window holds no
 * null, so a null restarts the window. Recursive kernels (ema, rma) skip nulls.
 * A length that is not a positive integer yields an all-null series.
 *
 * Every windowed kernel is O(n): no per-bar slice, spread or allocation. Sums
 * are compensated (Neumaier) and re-seeded from the window every `len` bars,
 * stdev is a sliding Welford re-seeded the same way, and highest/lowest use a
 * monotonic deque. A window that holds NaN or an infinity is computed exactly
 * the way the old per-window code did, so those values do not poison the
 * running state.
 *
 * Maintained by ZzyzxLabs. Part of SUPer-Chart (Apache-2.0).
 */

export type Series = Array<number | null>

function nulls (n: number): Series {
  return new Array<number | null>(n).fill(null)
}

/** A usable window length: a positive integer. */
export function isLength (len: number): boolean {
  return Number.isInteger(len) && len >= 1
}

// --------------------------------------------------------------------------
// Windowed sums
// --------------------------------------------------------------------------

/** Plain left-to-right sum of src[from..to], the order the old code summed in. */
function plainSum (src: Series, from: number, to: number): number {
  let a = 0
  for (let j = from; j <= to; j++) a += src[j] as number
  return a
}

/**
 * The windowed kernels below share one shape. `run` counts consecutive
 * non-null bars; a window is ready once it reaches `len`. A window holding a
 * non-finite value is computed exactly the way the old per-window code did.
 * Otherwise the running state is either re-seeded from the window (when it is
 * not known to match the previous window, and every `len` bars so rounding
 * cannot accumulate) or slid by one bar. Amortised O(1) per bar.
 */

/** Rolling sum over `len` bars. */
export function sum (src: Series, len: number): Series {
  const n = src.length
  const out = nulls(n)
  if (!isLength(len)) return out
  let run = 0
  let lastBad = -1 // index of the latest non-finite value
  let valid = false // s + c is the sum of the window ending at the previous bar
  let s = 0
  let c = 0 // Neumaier compensation
  let sinceSeed = 0
  for (let i = 0; i < n; i++) {
    const v = src[i]
    if (v == null) { run = 0; valid = false; continue }
    run++
    if (!Number.isFinite(v)) lastBad = i
    if (run < len) continue
    if (lastBad > i - len) { out[i] = plainSum(src, i - len + 1, i); valid = false; continue }
    if (!valid || ++sinceSeed >= len) {
      s = 0; c = 0
      for (let j = i - len + 1; j <= i; j++) {
        const x = src[j] as number
        const t = s + x
        c += Math.abs(s) >= Math.abs(x) ? (s - t) + x : (x - t) + s
        s = t
      }
      sinceSeed = 0
      valid = true
    } else {
      const o = -(src[i - len] as number)
      let t = s + o
      c += Math.abs(s) >= Math.abs(o) ? (s - t) + o : (o - t) + s
      s = t
      t = s + v
      c += Math.abs(s) >= Math.abs(v) ? (s - t) + v : (v - t) + s
      s = t
    }
    out[i] = s + c
  }
  return out
}

/** Simple moving average. */
export function sma (src: Series, len: number): Series {
  const s = sum(src, len)
  for (let i = 0; i < s.length; i++) {
    const v = s[i]
    if (v != null) s[i] = v / len
  }
  return s
}

/** Weighted moving average (weights 1..len, the newest heaviest). */
export function wma (src: Series, len: number): Series {
  const n = src.length
  const out = nulls(n)
  if (!isLength(len)) return out
  const denom = (len * (len + 1)) / 2
  let run = 0
  let lastBad = -1
  let valid = false
  let s = 0 // sum of the window
  let num = 0 // weighted numerator
  let sinceSeed = 0
  for (let i = 0; i < n; i++) {
    const v = src[i]
    if (v == null) { run = 0; valid = false; continue }
    run++
    if (!Number.isFinite(v)) lastBad = i
    if (run < len) continue
    if (lastBad > i - len) {
      let w = 0
      for (let j = 0; j < len; j++) w += (src[i - len + 1 + j] as number) * (j + 1)
      out[i] = w / denom
      valid = false
      continue
    }
    if (!valid || ++sinceSeed >= len) {
      s = 0; num = 0
      for (let j = 0; j < len; j++) {
        const x = src[i - len + 1 + j] as number
        s += x
        num += x * (j + 1)
      }
      sinceSeed = 0
      valid = true
    } else {
      // Every weight drops by one and the new bar enters with weight len.
      num = num - s + len * v
      s = s - (src[i - len] as number) + v
    }
    out[i] = num / denom
  }
  return out
}

/** Hull moving average: wma(2*wma(src, len/2) - wma(src, len), sqrt(len)). */
export function hma (src: Series, len: number): Series {
  if (!isLength(len) || len < 2) return nulls(src.length)
  const half = wma(src, Math.floor(len / 2))
  const full = wma(src, len)
  const diff = half.map((h, i) => {
    const f = full[i]
    return h == null || f == null ? null : 2 * h - f
  })
  return wma(diff, Math.round(Math.sqrt(len)))
}

/** Volume-weighted moving average; null where the window's volume sums to 0. */
export function vwma (src: Series, volume: Series, len: number): Series {
  const pv = src.map((v, i) => {
    const w = volume[i]
    return v == null || w == null ? null : v * w
  })
  const vol = volume.map((w, i) => (src[i] == null ? null : w))
  const num = sum(pv, len)
  const den = sum(vol, len)
  return num.map((a, i) => {
    const b = den[i]
    return a == null || b == null || b === 0 ? null : a / b
  })
}

// --------------------------------------------------------------------------
// Recursive averages
// --------------------------------------------------------------------------

/**
 * Exponential moving average (TradingView / klinecharts): starts from the
 * average of the first `len` non-null values and is null before that; nulls
 * after the start are skipped.
 */
export function ema (src: Series, len: number): Series {
  const n = src.length
  const out = nulls(n)
  if (!isLength(len)) return out
  let prev: number | null = null
  let seedSum = 0
  let seedCount = 0
  for (let i = 0; i < n; i++) {
    const v = src[i]
    if (v == null) continue
    if (prev == null) {
      seedSum += v
      seedCount++
      if (seedCount === len) { prev = seedSum / len; out[i] = prev }
    } else {
      prev = (2 * v + (len - 1) * prev) / (len + 1)
      out[i] = prev
    }
  }
  return out
}

/** Wilder's moving average (RMA): starts from the SMA of the first `len` values. */
export function rma (src: Series, len: number): Series {
  const n = src.length
  const out = nulls(n)
  if (!isLength(len)) return out
  let prev: number | null = null
  let seedSum = 0
  let seedCount = 0
  for (let i = 0; i < n; i++) {
    const v = src[i]
    if (v == null) continue
    if (prev == null) {
      seedSum += v
      seedCount++
      if (seedCount === len) { prev = seedSum / len; out[i] = prev }
    } else {
      prev = (prev * (len - 1) + v) / len
      out[i] = prev
    }
  }
  return out
}

function rsiFrom (gain: number, loss: number): number {
  if (loss === 0) return 100
  if (gain === 0) return 0
  return 100 - 100 / (1 + gain / loss)
}

/** Wilder RSI: 100 when the average loss is 0, 0 when the average gain is 0. */
export function rsi (src: Series, len: number): Series {
  const n = src.length
  const out = nulls(n)
  if (!isLength(len)) return out
  let avgGain = 0
  let avgLoss = 0
  let prev: number | null = null
  let seeded = 0
  for (let i = 0; i < n; i++) {
    const v = src[i]
    if (v == null) { prev = null; continue }
    if (prev != null) {
      const ch = v - prev
      const gain = Math.max(ch, 0)
      const loss = Math.max(-ch, 0)
      if (seeded < len) {
        avgGain += gain
        avgLoss += loss
        seeded++
        if (seeded === len) { avgGain /= len; avgLoss /= len; out[i] = rsiFrom(avgGain, avgLoss) }
      } else {
        avgGain = (avgGain * (len - 1) + gain) / len
        avgLoss = (avgLoss * (len - 1) + loss) / len
        out[i] = rsiFrom(avgGain, avgLoss)
      }
    }
    prev = v
  }
  return out
}

export interface MacdResult { dif: Series, dea: Series, hist: Series }

/** MACD: dif = ema(fast) - ema(slow), dea = ema(dif, signal), hist = (dif - dea) * histMultiplier (1). */
export function macd (src: Series, fast = 12, slow = 26, signal = 9, options: { histMultiplier?: number } = {}): MacdResult {
  const m = options.histMultiplier ?? 1
  const f = ema(src, fast)
  const s = ema(src, slow)
  const dif = f.map((a, i) => {
    const b = s[i]
    return a == null || b == null ? null : a - b
  })
  const dea = ema(dif, signal)
  const hist = dif.map((a, i) => {
    const b = dea[i]
    return a == null || b == null ? null : (a - b) * m
  })
  return { dif, dea, hist }
}

// --------------------------------------------------------------------------
// Dispersion
// --------------------------------------------------------------------------

/** Population standard deviation over `len` bars (Pine `ta.stdev`). Never NaN on a finite window. */
export function stdev (src: Series, len: number): Series {
  const n = src.length
  const out = nulls(n)
  if (!isLength(len)) return out
  let run = 0
  let lastBad = -1
  let valid = false
  let mean = 0
  let m2 = 0 // Σ (x - mean)² over the window
  let sinceSeed = 0
  for (let i = 0; i < n; i++) {
    const v = src[i]
    if (v == null) { run = 0; valid = false; continue }
    run++
    if (!Number.isFinite(v)) lastBad = i
    if (run < len) continue
    if (lastBad > i - len || !valid || ++sinceSeed >= len) {
      // The old two-pass formula, exactly: for non-finite windows and to re-seed.
      let a = 0
      for (let j = i - len + 1; j <= i; j++) a += src[j] as number
      const m = a / len
      let q = 0
      for (let j = i - len + 1; j <= i; j++) q += ((src[j] as number) - m) ** 2
      out[i] = Math.sqrt(q / len)
      valid = !(lastBad > i - len)
      if (valid) { mean = m; m2 = q; sinceSeed = 0 }
      continue
    }
    // Sliding Welford: replace the oldest value with the newest, count fixed.
    const o = src[i - len] as number
    const next = mean + (v - o) / len
    m2 += (v - o) * (v - next + o - mean)
    mean = next
    out[i] = Math.sqrt(Math.max(m2, 0) / len)
  }
  return out
}

/** Mean absolute deviation from the window's mean (Pine `ta.dev`). O(n·len), no allocation. */
export function dev (src: Series, len: number): Series {
  const n = src.length
  const out = nulls(n)
  if (!isLength(len)) return out
  let run = 0
  for (let i = 0; i < n; i++) {
    if (src[i] == null) { run = 0; continue }
    run++
    if (run < len) continue
    let a = 0
    for (let j = i - len + 1; j <= i; j++) a += src[j] as number
    const m = a / len
    let d = 0
    for (let j = i - len + 1; j <= i; j++) d += Math.abs((src[j] as number) - m)
    out[i] = d / len
  }
  return out
}

/** Bollinger bands: basis = sma, upper/lower = basis ± mult × population stdev. */
export function bollinger (src: Series, len: number, mult = 2): { basis: Series, upper: Series, lower: Series } {
  const basis = sma(src, len)
  const sd = stdev(src, len)
  const upper = basis.map((b, i) => {
    const d = sd[i]
    return b == null || d == null ? null : b + mult * d
  })
  const lower = basis.map((b, i) => {
    const d = sd[i]
    return b == null || d == null ? null : b - mult * d
  })
  return { basis, upper, lower }
}

// --------------------------------------------------------------------------
// Extremes (monotonic deque)
// --------------------------------------------------------------------------

function extreme (src: Series, len: number, max: boolean): Series {
  const n = src.length
  const out = nulls(n)
  if (!isLength(len)) return out
  if (len > n) return out
  const dq = new Int32Array(len) // circular deque: at most one window of indices
  let head = 0
  let size = 0
  let run = 0
  let lastNaN = -1
  for (let i = 0; i < n; i++) {
    const v = src[i]
    if (v == null) { run = 0; head = 0; size = 0; continue }
    run++
    if (size > 0 && dq[head] <= i - len) { head = head + 1 === len ? 0 : head + 1; size-- }
    if (Number.isNaN(v)) {
      lastNaN = i
    } else {
      while (size > 0) {
        const tail = head + size - 1
        const b = src[dq[tail >= len ? tail - len : tail]] as number
        if (max ? b <= v : b >= v) size--
        else break
      }
      const tail = head + size
      dq[tail >= len ? tail - len : tail] = i
      size++
    }
    if (run < len) continue
    // Math.max/Math.min return NaN when the window holds one.
    out[i] = lastNaN > i - len ? NaN : (size > 0 ? (src[dq[head]] as number) : (max ? -Infinity : Infinity))
  }
  return out
}

/** Highest value over `len` bars. */
export function highest (src: Series, len: number): Series {
  return extreme(src, len, true)
}

/** Lowest value over `len` bars. */
export function lowest (src: Series, len: number): Series {
  return extreme(src, len, false)
}

// --------------------------------------------------------------------------
// Regression and correlation (sliding sums of centred values)
// --------------------------------------------------------------------------

/** Least-squares line over a window, evaluated at bar (len - 1 - offset). Direct form, used to re-seed and for non-finite windows. */
function linregExact (src: Series, end: number, len: number, offset: number): number {
  let sx = 0
  let sy = 0
  let sxx = 0
  let sxy = 0
  for (let x = 0; x < len; x++) {
    const y = src[end - len + 1 + x] as number
    sx += x; sy += y; sxx += x * x; sxy += x * y
  }
  const denom = len * sxx - sx * sx
  if (denom === 0) return sy / len
  const slope = (len * sxy - sx * sy) / denom
  const intercept = (sy - slope * sx) / len
  return intercept + slope * (len - 1 - offset)
}

/** Linear regression value (Pine `ta.linreg`). */
export function linreg (src: Series, len: number, offset = 0): Series {
  const n = src.length
  const out = nulls(n)
  if (!isLength(len)) return out
  const sx = (len * (len - 1)) / 2
  const sxx = ((len - 1) * len * (2 * len - 1)) / 6
  const denom = len * sxx - sx * sx
  let run = 0
  let lastBad = -1
  let ref = 0 // centring reference
  let sy = 0 // Σ (y - ref)
  let sxy = 0 // Σ x·(y - ref), x = position in the window
  let sinceSeed = len
  for (let i = 0; i < n; i++) {
    const v = src[i]
    if (v == null) { run = 0; sinceSeed = len; continue }
    run++
    if (!Number.isFinite(v)) lastBad = i
    if (run < len) continue
    if (lastBad > i - len) { out[i] = linregExact(src, i, len, offset); sinceSeed = len; continue }
    if (sinceSeed >= len) {
      ref = src[i - len + 1] as number
      sy = 0; sxy = 0
      for (let x = 0; x < len; x++) {
        const y = (src[i - len + 1 + x] as number) - ref
        sy += y; sxy += x * y
      }
      sinceSeed = 0
    } else {
      const first = (src[i - len] as number) - ref
      const y = v - ref
      sxy = sxy - (sy - first) + (len - 1) * y
      sy = sy - first + y
      sinceSeed++
    }
    if (denom === 0) { out[i] = sy / len + ref; continue }
    const slope = (len * sxy - sx * sy) / denom
    const intercept = (sy - slope * sx) / len
    out[i] = intercept + slope * (len - 1 - offset) + ref
  }
  return out
}

/** Windows up to this length are computed directly (two-pass); sliding is only worth it above. */
const DIRECT_CORRELATION = 32
/** Sliding co-moments are re-seeded at least this often, whatever the length. */
const CORRELATION_RESEED = 64

/** Pearson correlation of two series over `len` bars; null where either is flat. */
export function correlation (a: Series, b: Series, len: number): Series {
  const n = a.length
  const out = nulls(n)
  if (!isLength(len)) return out
  let run = 0
  let lastBad = -1
  let valid = false
  let sinceSeed = 0
  // Values are centred on (rx, ry) so the means stay small and exact; then the
  // means and co-moments Σ(x-mx)², Σ(y-my)², Σ(x-mx)(y-my) of the window.
  let rx = 0; let ry = 0
  let mx = 0; let my = 0; let cxx = 0; let cyy = 0; let cxy = 0
  const reseed = Math.min(len, CORRELATION_RESEED)
  const seed = (i: number): void => {
    rx = a[i - len + 1] as number
    ry = b[i - len + 1] as number
    mx = 0; my = 0
    for (let j = i - len + 1; j <= i; j++) { mx += (a[j] as number) - rx; my += (b[j] as number) - ry }
    mx /= len; my /= len
    cxx = 0; cyy = 0; cxy = 0
    for (let j = i - len + 1; j <= i; j++) {
      const p = (a[j] as number) - rx - mx
      const q = (b[j] as number) - ry - my
      cxx += p * p; cyy += q * q; cxy += p * q
    }
  }
  for (let i = 0; i < n; i++) {
    const x = a[i]
    const y = b[i]
    if (x == null || y == null) { run = 0; valid = false; continue }
    run++
    if (!Number.isFinite(x) || !Number.isFinite(y)) lastBad = i
    if (run < len) continue
    if (lastBad > i - len) {
      // The old raw-sum formula, for windows holding NaN or an infinity.
      let sa = 0; let sb = 0; let saa = 0; let sbb = 0; let sab = 0
      for (let j = i - len + 1; j <= i; j++) {
        const p = a[j] as number
        const q = b[j] as number
        sa += p; sb += q; saa += p * p; sbb += q * q; sab += p * q
      }
      const ma = sa / len
      const mb = sb / len
      const d = Math.sqrt((saa / len - ma * ma) * (sbb / len - mb * mb))
      out[i] = d === 0 ? null : (sab / len - ma * mb) / d
      valid = false
      continue
    }
    if (len <= DIRECT_CORRELATION || !valid || ++sinceSeed >= reseed) {
      seed(i)
      sinceSeed = 0
      valid = true
    } else {
      // Sliding Welford: replace the oldest pair with the newest, count fixed.
      const xo = (a[i - len] as number) - rx
      const yo = (b[i - len] as number) - ry
      const xn = x - rx
      const yn = y - ry
      const dx = xn - xo
      const dy = yn - yo
      const nx = mx + dx / len
      const ny = my + dy / len
      cxx += dx * (xn - nx + xo - mx)
      cyy += dy * (yn - ny + yo - my)
      cxy += dx * (yn - ny) + dy * (xo - mx)
      mx = nx; my = ny
    }
    // Rounding can leave a flat window with a tiny spread: treat it as flat.
    const flatX = cxx <= len * (16 * Number.EPSILON * Math.max(Math.abs(rx + mx), 1e-300)) ** 2
    const flatY = cyy <= len * (16 * Number.EPSILON * Math.max(Math.abs(ry + my), 1e-300)) ** 2
    out[i] = flatX || flatY ? null : Math.max(-1, Math.min(1, cxy / Math.sqrt(cxx * cyy)))
  }
  return out
}

// --------------------------------------------------------------------------
// Differences, signals, cumulative
// --------------------------------------------------------------------------

/** src - src[len] (len defaults to 1). */
export function change (src: Series, len = 1): Series {
  return src.map((v, i) => {
    const p = i - len >= 0 ? src[i - len] : null
    return v == null || p == null ? null : v - p
  })
}

/** Momentum: src - src[len]. */
export function mom (src: Series, len: number): Series {
  return change(src, len)
}

/** Rate of change in percent: 100 × (src - src[len]) / src[len]. */
export function roc (src: Series, len: number): Series {
  return src.map((v, i) => {
    const p = i - len >= 0 ? src[i - len] : null
    return v == null || p == null || p === 0 ? null : (100 * (v - p)) / p
  })
}

export function crossover (a: Series, b: Series): Series {
  return a.map((v, i) => {
    const pa = a[i - 1]; const pb = b[i - 1]; const cb = b[i]
    if (v == null || cb == null || pa == null || pb == null) return null
    return pa <= pb && v > cb ? 1 : 0
  })
}

export function crossunder (a: Series, b: Series): Series {
  return a.map((v, i) => {
    const pa = a[i - 1]; const pb = b[i - 1]; const cb = b[i]
    if (v == null || cb == null || pa == null || pb == null) return null
    return pa >= pb && v < cb ? 1 : 0
  })
}

/** A cross in either direction. */
export function cross (a: Series, b: Series): Series {
  return a.map((v, i) => {
    const pa = a[i - 1]; const pb = b[i - 1]; const cb = b[i]
    if (v == null || cb == null || pa == null || pb == null) return null
    return (pa <= pb && v > cb) || (pa >= pb && v < cb) ? 1 : 0
  })
}

/** Cumulative sum; a null bar stays null and does not reset the total. */
export function cum (src: Series): Series {
  const out = nulls(src.length)
  let acc = 0
  for (let i = 0; i < src.length; i++) {
    const v = src[i]
    if (v == null) continue
    acc += v
    out[i] = acc
  }
  return out
}

/** Bars since `cond` was last true (0 on that bar), null before the first time. */
export function barssince (cond: Series): Series {
  const out = nulls(cond.length)
  let count: number | null = null
  for (let i = 0; i < cond.length; i++) {
    const c = cond[i]
    if (c != null && c !== 0) count = 0
    else if (count != null) count++
    out[i] = count
  }
  return out
}

/** The value of `src` on the bar `cond` was true, `occurrence` hits back (0 = the latest). */
export function valuewhen (cond: Series, src: Series, occurrence = 0): Series {
  const out = nulls(cond.length)
  if (occurrence === 0) {
    // The latest-hit query needs one index, not a growing history of all hits.
    let latest: number | undefined
    for (let i = 0; i < cond.length; i++) {
      const c = cond[i]
      if (c != null && c !== 0) latest = i
      out[i] = latest === undefined ? null : src[latest]
    }
    return out
  }
  if (!Number.isInteger(occurrence) || occurrence < 0 || occurrence >= cond.length) return out
  const hits: number[] = []
  const capacity = occurrence + 1
  let next = 0
  for (let i = 0; i < cond.length; i++) {
    const c = cond[i]
    if (c != null && c !== 0) {
      hits[next] = i
      next = (next + 1) % capacity
    }
    const idx = hits.length === capacity ? hits[next] : undefined
    out[i] = idx == null ? null : src[idx]
  }
  return out
}

/** Pivot high or low: the pivot's value, placed `right` bars later (when it is confirmed). */
export function pivot (src: Series, left: number, right: number, kind: 'high' | 'low'): Series {
  const width = left + right + 1
  if (width >= 64 && width <= src.length && Number.isSafeInteger(left) && Number.isSafeInteger(right) &&
      left >= 0 && right >= 0 && src.every(v => v == null || Number.isFinite(v))) return pivotWindow(src, width, right, kind)
  return pivotScan(src, left, right, kind)
}

/** Linear finite-data path; retain earliest equal extreme and delay confirmation. */
function pivotWindow (src: Series, width: number, right: number, kind: 'high' | 'low'): Series {
  const out = nulls(src.length)
  const deque = new Int32Array(width)
  let head = 0, size = 0, run = 0
  for (let end = 0; end < src.length; end++) {
    const v = src[end]
    if (v == null) { head = 0; size = 0; run = 0; continue }
    run++
    if (size > 0 && deque[head] <= end - width) { head = head + 1 === width ? 0 : head + 1; size-- }
    while (size > 0) {
      const tail = head + size - 1
      const previous = src[deque[tail >= width ? tail - width : tail]] as number
      // Strict comparison retains the earliest equal extreme, matching ties.
      if (kind === 'high' ? previous < v : previous > v) size--
      else break
    }
    const tail = head + size
    deque[tail >= width ? tail - width : tail] = end
    size++
    const candidate = end - right
    if (run >= width && deque[head] === candidate) out[end] = src[candidate]
  }
  return out
}

// Keep the original scan for small windows and unusual bounds/non-finite inputs.
function pivotScan (src: Series, left: number, right: number, kind: 'high' | 'low'): Series {
  const out = nulls(src.length)
  for (let i = left; i < src.length - right; i++) {
    const v = src[i]
    if (v == null) continue
    let ok = true
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue
      const w = src[j]
      if (w == null) { ok = false; break }
      if (kind === 'high' ? w > v : w < v) { ok = false; break }
      if (w === v && j < i) { ok = false; break } // ties: the earliest bar owns the pivot
    }
    if (ok) out[i + right] = v
  }
  return out
}

// --------------------------------------------------------------------------
// OHLCV-aware
// --------------------------------------------------------------------------

/** True range; the first bar (no previous close) is high - low. */
export function trueRange (high: Series, low: Series, close: Series): Series {
  return high.map((h, i) => {
    const l = low[i]
    const pc = i > 0 ? close[i - 1] : null
    if (h == null || l == null) return null
    if (pc == null) return h - l
    return Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc))
  })
}

/** Average true range: rma of the true range. */
export function atr (high: Series, low: Series, close: Series, len: number): Series {
  return rma(trueRange(high, low, close), len)
}

/** On-balance volume. */
export function obv (close: Series, volume: Series): Series {
  const out = nulls(close.length)
  let acc = 0
  let prev: number | null = null
  for (let i = 0; i < close.length; i++) {
    const c = close[i]
    const v = volume[i] ?? 0
    if (c == null) continue
    if (prev != null) acc += c > prev ? v : c < prev ? -v : 0
    out[i] = acc
    prev = c
  }
  return out
}

/** Cumulative VWAP of hlc3 from the first bar (no session reset). */
export function vwap (high: Series, low: Series, close: Series, volume: Series): Series {
  const out = nulls(close.length)
  let pv = 0
  let vol = 0
  for (let i = 0; i < close.length; i++) {
    const h = high[i]; const l = low[i]; const c = close[i]
    const v = volume[i] ?? 0
    if (h == null || l == null || c == null) continue
    pv += ((h + l + c) / 3) * v
    vol += v
    out[i] = vol === 0 ? null : pv / vol
  }
  return out
}

function hlc3 (high: Series, low: Series, close: Series): Series {
  return high.map((h, i) => {
    const l = low[i]; const c = close[i]
    return h == null || l == null || c == null ? null : (h + l + c) / 3
  })
}

/** Commodity channel index over hlc3. */
export function cci (high: Series, low: Series, close: Series, len: number): Series {
  const tp = hlc3(high, low, close)
  const basis = sma(tp, len)
  const md = dev(tp, len)
  return tp.map((t, i) => {
    const b = basis[i]; const m = md[i]
    return t == null || b == null || m == null || m === 0 ? null : (t - b) / (0.015 * m)
  })
}

/** Money flow index over hlc3. */
export function mfi (high: Series, low: Series, close: Series, volume: Series, len: number): Series {
  const n = close.length
  const tp = hlc3(high, low, close)
  const pos: Series = new Array<number | null>(n).fill(0)
  const neg: Series = new Array<number | null>(n).fill(0)
  for (let i = 1; i < n; i++) {
    const t = tp[i]; const p = tp[i - 1]
    const v = volume[i] ?? 0
    if (t == null || p == null) continue
    if (t > p) pos[i] = t * v
    else if (t < p) neg[i] = t * v
  }
  const sp = sum(pos, len)
  const sn = sum(neg, len)
  return sp.map((p, i) => {
    const q = sn[i]
    if (p == null || q == null) return null
    if (q === 0) return 100
    return 100 - 100 / (1 + p / q)
  })
}

/** Raw stochastic %K; %D is sma(%K, d). */
export function stochK (high: Series, low: Series, close: Series, len: number): Series {
  const hh = highest(high, len)
  const ll = lowest(low, len)
  return close.map((c, i) => {
    const h = hh[i]; const l = ll[i]
    if (c == null || h == null || l == null) return null
    const d = h - l
    return d === 0 ? 0 : (100 * (c - l)) / d
  })
}

/** Parabolic SAR (Wilder), started from the first two bars. */
export function sar (high: Series, low: Series, start = 0.02, inc = 0.02, max = 0.2): Series {
  const n = high.length
  const out = nulls(n)
  if (n < 2) return out
  const h0 = high[0]; const l0 = low[0]; const h1 = high[1]; const l1 = low[1]
  if (h0 == null || l0 == null || h1 == null || l1 == null) return out
  let isLong = h1 >= h0
  let af = start
  let ep = isLong ? h1 : l1
  let s = isLong ? l0 : h0
  for (let i = 1; i < n; i++) {
    const h = high[i]; const l = low[i]
    if (h == null || l == null) continue
    s = s + af * (ep - s)
    if (isLong) {
      if (l < s) { isLong = false; s = ep; ep = l; af = start } else if (h > ep) { ep = h; af = Math.min(af + inc, max) }
    } else {
      if (h > s) { isLong = true; s = ep; ep = h; af = start } else if (l < ep) { ep = l; af = Math.min(af + inc, max) }
    }
    out[i] = s
  }
  return out
}

// --------------------------------------------------------------------------
// Bands, trend and anchored averages (Super Chart's SC_* indicators).
// TradingView's formulas; each documents the one it follows.
// --------------------------------------------------------------------------

function avg2 (a: Series, b: Series): Series {
  return a.map((x, i) => {
    const y = b[i]
    return x == null || y == null ? null : (x + y) / 2
  })
}

/** Stochastic of one series: 100 × (x − lowest(x, len)) / (highest(x, len) − lowest(x, len)); 0 on a flat window. */
export function stoch (src: Series, len: number): Series {
  return stochK(src, src, src, len)
}

/**
 * Stochastic RSI (TradingView): r = rsi(src, rsiLen), k = sma(stoch(r, stochLen), kLen),
 * d = sma(k, dLen). Not TA-Lib's STOCHRSI, whose default output is the unsmoothed %K.
 */
export function stochRsi (src: Series, rsiLen: number, stochLen: number, kLen: number, dLen: number): { k: Series, d: Series } {
  const k = sma(stoch(rsi(src, rsiLen), stochLen), kLen)
  return { k, d: sma(k, dLen) }
}

/** Bollinger %B: (src − lower) / (upper − lower) of bollinger(src, len, mult); null where the bands are flat. */
export function bbPercent (src: Series, len: number, mult = 2): Series {
  const { upper, lower } = bollinger(src, len, mult)
  return src.map((v, i) => {
    const u = upper[i]; const l = lower[i]
    return v == null || u == null || l == null || u === l ? null : (v - l) / (u - l)
  })
}

export interface Bands { basis: Series, upper: Series, lower: Series }

/** Keltner channels (TradingView, bands style "Average True Range"): basis = ema(close, len), basis ± mult × atr(atrLen). */
export function keltner (high: Series, low: Series, close: Series, len = 20, mult = 2, atrLen = 10): Bands {
  const basis = ema(close, len)
  const range = atr(high, low, close, atrLen)
  const band = (sign: number): Series => basis.map((b, i) => {
    const r = range[i]
    return b == null || r == null ? null : b + sign * mult * r
  })
  return { basis, upper: band(1), lower: band(-1) }
}

/** Donchian channels: upper = highest(high, len), lower = lowest(low, len), basis = their midpoint. */
export function donchian (high: Series, low: Series, len = 20): Bands {
  const upper = highest(high, len)
  const lower = lowest(low, len)
  return { basis: avg2(upper, lower), upper, lower }
}

/** ATR bands: close ± mult × atr(len). */
export function atrBands (high: Series, low: Series, close: Series, len = 14, mult = 2): Bands {
  const range = atr(high, low, close, len)
  const band = (sign: number): Series => close.map((c, i) => {
    const r = range[i]
    return c == null || r == null ? null : c + sign * mult * r
  })
  return { basis: close.slice(), upper: band(1), lower: band(-1) }
}

export interface SupertrendResult {
  /** The SuperTrend line: the lower band in an uptrend, the upper band in a downtrend. */
  line: Series
  /** 1 in an uptrend, -1 in a downtrend (TradingView's `direction` has the opposite sign). */
  trend: Series
}

/**
 * SuperTrend, as TradingView's ta.supertrend(factor, atrPeriod): bands hl2 ± factor × atr(len),
 * each trailing its previous value until the close crosses it. Starts in a downtrend on the
 * first bar with an ATR. A bar's value depends only on that bar and the ones before it.
 */
export function supertrend (high: Series, low: Series, close: Series, len = 10, factor = 3): SupertrendResult {
  const n = close.length
  const line = nulls(n)
  const trend = nulls(n)
  const range = atr(high, low, close, len)
  let prevUpper = 0 // nz(): 0 before the first band
  let prevLower = 0
  let prevLine: number | null = null
  let prevAtr: number | null = null
  for (let i = 0; i < n; i++) {
    const h = high[i]; const l = low[i]; const c = close[i]; const r = range[i]
    if (h == null || l == null || c == null || r == null) { prevAtr = r ?? null; continue }
    const mid = (h + l) / 2
    const pc = i > 0 ? close[i - 1] : null
    let upper = mid + factor * r
    let lower = mid - factor * r
    lower = lower > prevLower || (pc != null && pc < prevLower) ? lower : prevLower
    upper = upper < prevUpper || (pc != null && pc > prevUpper) ? upper : prevUpper
    let up: boolean
    if (prevAtr == null) up = false
    else if (prevLine === prevUpper) up = c > upper
    else up = !(c < lower)
    const v = up ? lower : upper
    line[i] = v
    trend[i] = up ? 1 : -1
    prevUpper = upper
    prevLower = lower
    prevLine = v
    prevAtr = r
  }
  return { line, trend }
}

export interface IchimokuResult {
  /** Tenkan-sen: the midpoint of the last `conversion` bars' range. */
  conversion: Series
  /** Kijun-sen: the midpoint of the last `base` bars' range. */
  base: Series
  /** Senkou span A at each bar: (conversion + base) / 2 of `displacement - 1` bars earlier. */
  spanA: Series
  /** Senkou span B at each bar: the `spanB`-bar midpoint of `displacement - 1` bars earlier. */
  spanB: Series
  /** Chikou span at each bar: the close of `displacement - 1` bars later (null for the last ones). */
  lagging: Series
  /** Span A and B for the `displacement - 1` bars after the last one (the projected cloud). */
  futureA: Series
  futureB: Series
}

/**
 * Ichimoku cloud with TradingView's defaults (9, 26, 52, 26): the leading spans are drawn
 * `displacement - 1` bars ahead and the lagging span that many bars back, as TradingView
 * plots them (offset = displacement - 1).
 */
export function ichimoku (high: Series, low: Series, close: Series, conversion = 9, base = 26, spanBLen = 52, displacement = 26): IchimokuResult {
  const n = close.length
  const conv = donchian(high, low, conversion).basis
  const kijun = donchian(high, low, base).basis
  const lead1 = avg2(conv, kijun)
  const lead2 = donchian(high, low, spanBLen).basis
  const shift = Math.max(0, Math.floor(displacement) - 1)
  const spanA = nulls(n)
  const spanB = nulls(n)
  const lagging = nulls(n)
  for (let i = 0; i < n; i++) {
    if (i - shift >= 0) { spanA[i] = lead1[i - shift]; spanB[i] = lead2[i - shift] }
    if (i + shift < n) lagging[i] = close[i + shift]
  }
  const futureA = nulls(shift)
  const futureB = nulls(shift)
  for (let k = 0; k < shift; k++) {
    const j = n - shift + k
    if (j >= 0) { futureA[k] = lead1[j]; futureB[k] = lead2[j] }
  }
  return { conversion: conv, base: kijun, spanA, spanB, lagging, futureA, futureB }
}

export interface AnchoredVwapResult {
  vwap: Series
  /** The volume-weighted standard deviation of hlc3 around the VWAP, for the bands. */
  stdev: Series
}

/**
 * VWAP of hlc3 that restarts whenever `periods[i]` changes (a session, week, month …),
 * with its volume-weighted standard deviation sqrt(Σv·tp²/Σv − vwap²), which TradingView's
 * VWAP bands use. A null period key gives a null bar. `skipFirst` nulls the whole first
 * period (its start is not in the data, so its sums would be wrong). Sums are centred on
 * the period's first hlc3, so a period's values depend only on its own bars.
 */
export function anchoredVwap (high: Series, low: Series, close: Series, volume: Series, periods: ReadonlyArray<number | null>, skipFirst = false): AnchoredVwapResult {
  const n = close.length
  const vwap = nulls(n)
  const sd = nulls(n)
  let key: number | null = null
  let index = -1
  let ref = 0
  let sv = 0
  let s1 = 0
  let s2 = 0
  for (let i = 0; i < n; i++) {
    const p = periods[i]
    const h = high[i]; const l = low[i]; const c = close[i]
    if (p == null || h == null || l == null || c == null) continue
    const tp = (h + l + c) / 3
    if (p !== key) { key = p; index++; ref = tp; sv = 0; s1 = 0; s2 = 0 }
    const v = volume[i] ?? 0
    const d = tp - ref
    sv += v
    s1 += v * d
    s2 += v * d * d
    if (skipFirst && index === 0) continue
    if (sv > 0) {
      const m = s1 / sv
      vwap[i] = ref + m
      sd[i] = Math.sqrt(Math.max(0, s2 / sv - m * m))
    }
  }
  return { vwap, stdev: sd }
}
