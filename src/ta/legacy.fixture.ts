/**
 * TEST FIXTURE: a frozen copy of SuperScript's series kernels as they were
 * before the TA core (src/superscript/index.ts at 314ebb87, the v0.0.15
 * import). The kernel tests compare the new O(n) kernels against these, so
 * this file must never change and product code must never import it.
 */
export type Series = Array<number | null>

function rolling (src: Series, len: number, f: (w: number[]) => number): Series {
  const out: Series = new Array<number | null>(src.length).fill(null)
  for (let i = len - 1; i < src.length; i++) {
    const w = src.slice(i - len + 1, i + 1)
    if (w.every((x) => x != null)) out[i] = f(w as number[])
  }
  return out
}

function linregAt (w: number[], len: number, offset: number): number {
  let sx = 0; let sy = 0; let sxx = 0; let sxy = 0
  for (let x = 0; x < len; x++) { const y = w[x]; sx += x; sy += y; sxx += x * x; sxy += x * y }
  const denom = len * sxx - sx * sx
  if (denom === 0) return sy / len
  const slope = (len * sxy - sx * sy) / denom
  const intercept = (sy - slope * sx) / len
  return intercept + slope * (len - 1 - offset)
}

function rsiFrom (g: number, l: number): number {
  if (l === 0) return 100
  const rs = g / l
  return 100 - 100 / (1 + rs)
}

export const legacy = {
  sma (src: Series, len: number): Series {
    const out: Series = new Array<number | null>(src.length).fill(null)
    let sum = 0
    const q: number[] = []
    for (let i = 0; i < src.length; i++) {
      const v = src[i]
      if (v == null) { q.length = 0; sum = 0; continue }
      q.push(v); sum += v
      if (q.length > len) sum -= q.shift() as number
      if (q.length === len) out[i] = sum / len
    }
    return out
  },
  /** The old EMA: started from the first value (NOT TradingView's convention). */
  ema (src: Series, len: number): Series {
    const out: Series = new Array<number | null>(src.length).fill(null)
    const k = 2 / (len + 1)
    let prev: number | null = null
    for (let i = 0; i < src.length; i++) {
      const v = src[i]
      if (v == null) continue
      prev = prev == null ? v : v * k + prev * (1 - k)
      out[i] = prev
    }
    return out
  },
  rsi (src: Series, len: number): Series {
    const out: Series = new Array<number | null>(src.length).fill(null)
    let avgGain = 0; let avgLoss = 0; let prev: number | null = null; let seeded = 0
    for (let i = 0; i < src.length; i++) {
      const v = src[i]
      if (v == null) { prev = null; continue }
      if (prev != null) {
        const ch = v - prev; const gain = Math.max(ch, 0); const loss = Math.max(-ch, 0)
        if (seeded < len) {
          avgGain += gain; avgLoss += loss; seeded++
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
  },
  highest (src: Series, len: number): Series { return rolling(src, len, (w) => Math.max(...w)) },
  lowest (src: Series, len: number): Series { return rolling(src, len, (w) => Math.min(...w)) },
  wma (src: Series, len: number): Series {
    const denom = (len * (len + 1)) / 2
    return rolling(src, len, (w) => { let s = 0; for (let j = 0; j < len; j++) s += w[j] * (j + 1); return s / denom })
  },
  stdev (src: Series, len: number): Series {
    return rolling(src, len, (w) => {
      const mean = w.reduce((a, b) => a + b, 0) / len
      const variance = w.reduce((a, b) => a + (b - mean) ** 2, 0) / len
      return Math.sqrt(variance)
    })
  },
  sum (src: Series, len: number): Series { return rolling(src, len, (w) => w.reduce((a, b) => a + b, 0)) },
  dev (src: Series, len: number): Series {
    return rolling(src, len, (w) => {
      const m = w.reduce((a, b) => a + b, 0) / len
      return w.reduce((a, b) => a + Math.abs(b - m), 0) / len
    })
  },
  linreg (src: Series, len: number, offset = 0): Series { return rolling(src, len, (w) => linregAt(w, len, offset)) },
  correlation (a: Series, b: Series, len: number): Series {
    const out: Series = new Array<number | null>(a.length).fill(null)
    for (let i = len - 1; i < a.length; i++) {
      let sa = 0; let sb = 0; let saa = 0; let sbb = 0; let sab = 0; let ok = true
      for (let j = i - len + 1; j <= i; j++) { const x = a[j]; const y = b[j]; if (x == null || y == null) { ok = false; break } sa += x; sb += y; saa += x * x; sbb += y * y; sab += x * y }
      if (!ok) continue
      const cov = sab / len - (sa / len) * (sb / len)
      const va = saa / len - (sa / len) ** 2; const vb = sbb / len - (sb / len) ** 2
      const d = Math.sqrt(va * vb)
      out[i] = d === 0 ? null : cov / d
    }
    return out
  },
  rma (src: Series, len: number): Series {
    const out: Series = new Array<number | null>(src.length).fill(null)
    let prev: number | null = null; let seedSum = 0; let seedCount = 0
    for (let i = 0; i < src.length; i++) {
      const v = src[i]
      if (v == null) continue
      if (prev == null) { seedSum += v; seedCount++; if (seedCount === len) { prev = seedSum / len; out[i] = prev } } else { prev = (prev * (len - 1) + v) / len; out[i] = prev }
    }
    return out
  }
}
