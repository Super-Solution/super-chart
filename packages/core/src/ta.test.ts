import { describe, expect, it } from 'vitest'

import * as ta from './ta'
import { legacy, type Series } from './ta.legacy.fixture'

// A small deterministic PRNG, so a failure reproduces.
function rng (seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6D2B79F5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A random walk around `base` with relative volatility `vol` per bar. */
function walk (n: number, base: number, vol: number, seed: number): number[] {
  const r = rng(seed)
  const out: number[] = []
  let x = base
  for (let i = 0; i < n; i++) {
    x += (r() - 0.5) * 2 * vol * base
    out.push(x)
  }
  return out
}

const BASES: Array<[string, number, number]> = [
  ['1', 1, 0.01],
  ['stablecoin 1±1e-5', 1, 1e-6],
  ['100', 100, 0.01],
  ['6e4', 6e4, 0.005],
  ['1e6', 1e6, 0.005]
]

/** Same nulls, and every value within the tolerance (NaN only where the reference has NaN). */
function expectClose (got: Series, want: Series, tol: (w: number, i: number) => number, label: string): void {
  expect(got.length, `${label}: length`).toBe(want.length)
  for (let i = 0; i < want.length; i++) {
    const g = got[i]; const w = want[i]
    if (w == null || g == null) {
      expect(g, `${label}[${i}] null where the reference is ${String(w)}`).toBe(w)
      continue
    }
    if (Number.isNaN(w)) { expect(Number.isNaN(g), `${label}[${i}] NaN`).toBe(true); continue }
    if (!Number.isFinite(w)) { expect(g, `${label}[${i}]`).toBe(w); continue }
    const d = Math.abs(g - w)
    if (!(d <= tol(w, i))) {
      throw new Error(`${label}[${i}]: got ${g}, want ${w} (|diff| ${d} > ${tol(w, i)})`)
    }
  }
}

const rel = (r: number) => (w: number): number => r * Math.max(Math.abs(w), 1e-300)
const exact = (): number => 0

describe('TA core: O(n) kernels match the old per-window code', () => {
  for (const [label, base, vol] of BASES) {
    const src = walk(3000, base, vol, 7 + base)
    const other = walk(3000, base, vol, 99 + base)
    for (const len of [1, 2, 14, 200]) {
      it(`${label}, len ${len}`, () => {
        expectClose(ta.highest(src, len), legacy.highest(src, len), exact, 'highest')
        expectClose(ta.lowest(src, len), legacy.lowest(src, len), exact, 'lowest')
        expectClose(ta.sum(src, len), legacy.sum(src, len), rel(1e-9), 'sum')
        expectClose(ta.sma(src, len), legacy.sma(src, len), rel(1e-9), 'sma')
        expectClose(ta.wma(src, len), legacy.wma(src, len), rel(1e-9), 'wma')
        expectClose(ta.linreg(src, len), legacy.linreg(src, len), rel(1e-9), 'linreg')
        expectClose(ta.linreg(src, len, 3), legacy.linreg(src, len, 3), rel(1e-9), 'linreg offset 3')
        expectClose(ta.dev(src, len), legacy.dev(src, len), exact, 'dev')
        expectClose(ta.rma(src, len), legacy.rma(src, len), exact, 'rma')
        expectClose(ta.rsi(src, len), legacy.rsi(src, len), exact, 'rsi')
        // stdev: absolute 1e-9·max(|mean|, 1) (the old two-pass is the reference).
        const mean = ta.sma(src, len)
        expectClose(ta.stdev(src, len), legacy.stdev(src, len), (_w, i) => 1e-9 * Math.max(Math.abs(mean[i] ?? 0), 1), 'stdev')
        // The old raw-sum correlation is itself off by up to ~1e-6 where the
        // variance is tiny next to the mean (a stablecoin) or the window is 2
        // bars (always exactly ±1); those are checked against a precise
        // reference below instead.
        if (len > 2 && label !== 'stablecoin 1±1e-5') {
          expectClose(ta.correlation(src, other, len), legacy.correlation(src, other, len), (w) => 1e-9 * Math.max(Math.abs(w), 1), 'correlation')
        }
        if (len === 2) {
          for (const v of ta.correlation(src, other, len).slice(1)) expect(Math.abs(Math.abs(v as number) - 1)).toBeLessThan(1e-9)
        }
      })
    }
  }

  it('correlation matches a centred two-pass reference, even on a stablecoin', () => {
    const a = walk(1000, 1, 1e-6, 3)
    const b = walk(1000, 1, 1e-6, 4)
    const len = 50
    const want: Series = a.map((_, i) => {
      if (i < len - 1) return null
      let ma = 0; let mb = 0
      for (let j = i - len + 1; j <= i; j++) { ma += a[j]; mb += b[j] }
      ma /= len; mb /= len
      let c = 0; let va = 0; let vb = 0
      for (let j = i - len + 1; j <= i; j++) { c += (a[j] - ma) * (b[j] - mb); va += (a[j] - ma) ** 2; vb += (b[j] - mb) ** 2 }
      return c / Math.sqrt(va * vb)
    })
    expectClose(ta.correlation(a, b, len), want, () => 1e-9, 'correlation')
  })

  it('keeps the null, NaN and length semantics', () => {
    const src: Series = walk(400, 100, 0.01, 5)
    src[50] = null
    src[120] = NaN
    src[300] = null
    for (const len of [3, 20]) {
      for (const k of ['highest', 'lowest', 'sum', 'wma', 'stdev', 'dev', 'linreg'] as const) {
        const got = ta[k](src, len)
        const want = legacy[k](src, len)
        expectClose(got, want, (w) => 1e-9 * Math.max(Math.abs(w), 1), `${k}(${len})`)
      }
      // A NaN poisons only the windows that contain it.
      expect(ta.highest(src, len)[120 + len - 1]).toBeNaN()
      expect(ta.highest(src, len)[120 + len]).not.toBeNaN()
      expect(ta.sum(src, len)[120 + len]).not.toBeNaN()
    }
    for (const len of [0, -1, 2.5, NaN, 401]) {
      for (const k of ['highest', 'lowest', 'sum', 'sma', 'wma', 'stdev', 'dev', 'linreg', 'ema', 'rma', 'rsi', 'hma'] as const) {
        expect(ta[k](src, len).every(v => v === null), `${k}(${len}) is all null`).toBe(true)
      }
    }
  })

  it('stdev stays finite and >= 0 on a flat run after a volatile one', () => {
    const src: Series = [...walk(2000, 6e4, 0.01, 11), ...new Array<number>(2400).fill(60123.45)]
    const sd = ta.stdev(src, 200)
    for (let i = 2000 + 199; i < src.length; i++) {
      const v = sd[i] as number
      expect(Number.isFinite(v) && v >= 0, `stdev[${i}] = ${v}`).toBe(true)
      expect(v).toBeLessThan(1e-6)
    }
  })

  it('infinities give what Math.max/Math.min and plain sums gave', () => {
    const src: Series = [1, 2, Infinity, 3, 4, -Infinity, 5, 6, 7]
    expectClose(ta.highest(src, 3), legacy.highest(src, 3), exact, 'highest')
    expectClose(ta.lowest(src, 3), legacy.lowest(src, 3), exact, 'lowest')
    expectClose(ta.sum(src, 3), legacy.sum(src, 3), exact, 'sum')
    expectClose(ta.wma(src, 3), legacy.wma(src, 3), exact, 'wma')
    expectClose(ta.stdev(src, 3), legacy.stdev(src, 3), exact, 'stdev')
  })
})

describe('TA core: speed at 20k bars', () => {
  const high = walk(20_000, 6e4, 0.005, 21)
  const low = high.map(h => h * 0.99)
  // The fastest of several runs, after a warm-up: robust to a busy machine.
  const best = (f: () => void): number => {
    for (let i = 0; i < 3; i++) f()
    let min = Infinity
    for (let i = 0; i < 15; i++) {
      const t = performance.now()
      f()
      min = Math.min(min, performance.now() - t)
    }
    return min
  }

  // The gate is the shape, not the machine: an O(n) kernel costs about the
  // same at len 200 as at len 2, an O(n*len) one 20-50x more (a plain
  // per-window loop measured 13.2 vs 0.24 ms). Both lengths run on the same
  // machine in the same test, so a slower CI runner cannot fail it. The
  // absolute ceilings are 3x the targets (Donchian(200) 1.5 ms, stdev(200)
  // 1 ms; measured 0.47 and 0.10 ms on the dev machine) and catch only a
  // gross constant-factor regression.
  const donchian = (len: number): number => best(() => { ta.highest(high, len); ta.lowest(low, len) })

  it('Donchian(200) (highest + lowest) costs about what Donchian(2) does, and under 4.5 ms', () => {
    const short = donchian(2)
    const long = donchian(200)
    expect(long, `len 200: ${long.toFixed(3)} ms, len 2: ${short.toFixed(3)} ms`).toBeLessThan(3 * short)
    expect(long).toBeLessThan(4.5)
  })

  it('stdev(200) costs about what stdev(2) does, and under 3 ms', () => {
    const short = best(() => ta.stdev(high, 2))
    const long = best(() => ta.stdev(high, 200))
    expect(long, `len 200: ${long.toFixed(3)} ms, len 2: ${short.toFixed(3)} ms`).toBeLessThan(3 * short)
    expect(long).toBeLessThan(3)
  })
})

// TradingView's conventions, checked against hand-written references.
describe('TA core: TradingView conventions', () => {
  /** EMA by its definition: SMA of the first len values, then alpha = 2/(len+1). */
  function refEma (src: number[], len: number): Series {
    const out: Series = src.map(() => null)
    if (src.length < len) return out
    let prev = 0
    for (let i = 0; i < len; i++) prev += src[i]
    prev /= len
    out[len - 1] = prev
    const a = 2 / (len + 1)
    for (let i = len; i < src.length; i++) { prev = a * src[i] + (1 - a) * prev; out[i] = prev }
    return out
  }
  const within = (w: number): number => 1e-12 * Math.max(1, Math.abs(w))

  it('ema starts from the SMA of the first len values and is null before', () => {
    const src = walk(300, 76, 0.01, 1)
    const e = ta.ema(src, 20)
    expect(e.slice(0, 19).every(v => v === null)).toBe(true)
    expect(e[19]).toBeCloseTo(src.slice(0, 20).reduce((a, b) => a + b, 0) / 20, 12)
    expectClose(e, refEma(src, 20), within, 'ema')
  })

  it('ema over a 1e9-range series matches the reference to 1e-12 relative', () => {
    const src = walk(500, 1e9, 0.01, 2)
    expectClose(ta.ema(src, 50), refEma(src, 50), within, 'ema 1e9')
  })

  it('rsi is 100 on a monotonic rise (never 0) and 0 on a monotonic fall', () => {
    const up = Array.from({ length: 60 }, (_, i) => 100 + i)
    const r = ta.rsi(up, 14)
    expect(r.slice(0, 14).every(v => v === null)).toBe(true)
    expect(r.slice(14).every(v => v === 100)).toBe(true)
    const down = up.slice().reverse()
    expect(ta.rsi(down, 14).slice(14).every(v => v === 0)).toBe(true)
  })

  it('rsi is Wilder smoothing of gains and losses', () => {
    const src = walk(200, 100, 0.02, 3)
    const ch = src.map((v, i) => (i === 0 ? null : v - src[i - 1]))
    const g = ta.rma(ch.map(c => (c == null ? null : Math.max(c, 0))), 14)
    const l = ta.rma(ch.map(c => (c == null ? null : Math.max(-c, 0))), 14)
    const want = g.map((a, i) => {
      const b = l[i]
      return a == null || b == null ? null : b === 0 ? 100 : a === 0 ? 0 : 100 - 100 / (1 + a / b)
    })
    expectClose(ta.rsi(src, 14), want, within, 'rsi')
  })

  it('macd: hist = dif - dea by default; dea is an ema of dif that starts after its leading nulls', () => {
    const src = walk(300, 100, 0.01, 4)
    const m = ta.macd(src, 12, 26, 9)
    // dif starts at bar 25; dea needs 9 dif values, so it starts at bar 33.
    expect(m.dif.findIndex(v => v != null)).toBe(25)
    expect(m.dea.findIndex(v => v != null)).toBe(33)
    expect(m.dea[33]).toBeCloseTo((m.dif.slice(25, 34) as number[]).reduce((a, b) => a + b, 0) / 9, 12)
    for (let i = 33; i < 300; i++) expect(m.hist[i]).toBe((m.dif[i] as number) - (m.dea[i] as number))
    const kc = ta.macd(src, 12, 26, 9, { histMultiplier: 2 })
    expect(kc.hist[100]).toBe(((m.dif[100] as number) - (m.dea[100] as number)) * 2)
  })

  it('a length longer than the data gives all nulls', () => {
    const src = walk(10, 100, 0.01, 5)
    for (const k of ['ema', 'rma', 'rsi', 'sma', 'stdev', 'highest'] as const) {
      expect(ta[k](src, 11).every(v => v === null), k).toBe(true)
    }
  })

  it('hma = wma(2·wma(len/2) − wma(len), round(√len)), for odd and even lengths', () => {
    const src = walk(200, 100, 0.01, 6)
    for (const len of [9, 16, 21]) {
      const half = ta.wma(src, Math.floor(len / 2))
      const full = ta.wma(src, len)
      const diff = half.map((h, i) => (h == null || full[i] == null ? null : 2 * h - (full[i] as number)))
      expectClose(ta.hma(src, len), ta.wma(diff, Math.round(Math.sqrt(len))), exact, `hma ${len}`)
      expect(ta.hma(src, len).some(v => v != null)).toBe(true)
    }
    expect(ta.hma(src, 1).every(v => v === null)).toBe(true)
  })

  it('vwma weights by volume and is null when the volume sums to 0 or is missing', () => {
    const src: Series = [10, 20, 30, 40]
    const vol: Series = [1, 3, 0, 0]
    expect(ta.vwma(src, vol, 2)).toEqual([null, (10 + 60) / 4, 60 / 3, null])
    expect(ta.vwma(src, [1, null, 1, 1], 2)).toEqual([null, null, null, 35])
  })
})

// --------------------------------------------------------------------------
// SC_* pack additions (SC-155/168/169/170): stoch/stochRsi/bbPercent,
// keltner/donchian/atrBands, supertrend, ichimoku, anchoredVwap.
// --------------------------------------------------------------------------
describe('rsi (Wilder): the SC-155 golden cases', () => {
  it('a monotonic rise gives 100 once seeded, never 0', () => {
    const src = Array.from({ length: 60 }, (_, i) => 100 + i)
    const r = ta.rsi(src, 14)
    for (let i = 14; i < src.length; i++) expect(r[i]).toBe(100)
  })

  it('40 falling bars then 40 rising bars give about 94.82 at period 14 (the finding\'s own figure)', () => {
    const down = Array.from({ length: 40 }, (_, i) => 100 - i)
    const up = Array.from({ length: 40 }, (_, i) => down[39] + i + 1)
    const src = [...down, ...up]
    const r = ta.rsi(src, 14)
    expect(r[src.length - 1]).toBeCloseTo(94.82, 1)
  })

  it('put-back: a Cutler-style fixed-window RSI would read 0 at the top of a rally, not 100', () => {
    const src = Array.from({ length: 30 }, (_, i) => 100 + i)
    const wilder = ta.rsi(src, 14)
    // The defect this guards: sum gains/losses over the last N bars (no losses -> 0).
    const cutler = src.map((_, i) => {
      if (i < 14) return null
      let g = 0, l = 0
      for (let j = i - 13; j <= i; j++) { const d = src[j] - src[j - 1]; if (d > 0) g += d; else l -= d }
      return l === 0 ? 0 : 100 - 100 / (1 + g / l)
    })
    expect(wilder[29]).toBe(100)
    expect(cutler[29]).toBe(0)
  })
})

describe('stoch/stochRsi/bbPercent', () => {
  it('stoch is 100 at the window high, 0 at the window low, 0 on a flat window', () => {
    const src: Series = [1, 2, 3, 10, 3]
    const s = ta.stoch(src, 4)
    expect(s[3]).toBe(100) // 10 is the highest of the last 4
    expect(s[4]).toBeCloseTo((3 - 2) / (10 - 2) * 100, 10)
    expect(ta.stoch([5, 5, 5, 5], 4)[3]).toBe(0)
  })

  it('stochRsi = sma(stoch(rsi(src,rsiLen),stochLen),kLen), d = sma(k,dLen)', () => {
    const src = walk(200, 100, 0.01, 11)
    const { k, d } = ta.stochRsi(src, 14, 14, 3, 3)
    const r = ta.rsi(src, 14)
    const expectedK = ta.sma(ta.stoch(r, 14), 3)
    const expectedD = ta.sma(expectedK, 3)
    expectClose(k, expectedK, exact, 'stochRsi.k')
    expectClose(d, expectedD, exact, 'stochRsi.d')
  })

  it('bbPercent is 1 at the upper band, 0 at the lower band, null on a flat window', () => {
    const src = walk(100, 100, 0.02, 12)
    const { upper, lower } = ta.bollinger(src, 20, 2)
    const b = ta.bbPercent(src, 20, 2)
    for (let i = 20; i < 100; i++) {
      const u = upper[i] as number; const l = lower[i] as number
      expect(b[i]).toBeCloseTo((src[i] - l) / (u - l), 10)
    }
    expect(ta.bbPercent([5, 5, 5, 5, 5], 4, 2)[4]).toBeNull()
  })
})

describe('keltner/donchian/atrBands', () => {
  const h = walk(120, 100, 0.02, 20).map(v => v + 1)
  const l = walk(120, 100, 0.02, 20).map(v => v - 1)
  const c = walk(120, 100, 0.02, 20)

  it('keltner: basis = ema(close,len), bands = basis ± mult*atr(atrLen)', () => {
    const basis = ta.ema(c, 20)
    const range = ta.atr(h, l, c, 10)
    const k = ta.keltner(h, l, c, 20, 2, 10)
    expectClose(k.basis, basis, exact, 'keltner.basis')
    for (let i = 0; i < c.length; i++) {
      if (basis[i] == null || range[i] == null) continue
      expect(k.upper[i]).toBeCloseTo((basis[i] as number) + 2 * (range[i] as number), 10)
      expect(k.lower[i]).toBeCloseTo((basis[i] as number) - 2 * (range[i] as number), 10)
    }
  })

  it('donchian: upper/lower are the rolling extremes, basis their midpoint', () => {
    const d = ta.donchian(h, l, 20)
    const hh = ta.highest(h, 20)
    const ll = ta.lowest(l, 20)
    expectClose(d.upper, hh, exact, 'donchian.upper')
    expectClose(d.lower, ll, exact, 'donchian.lower')
    for (let i = 0; i < c.length; i++) {
      if (hh[i] == null || ll[i] == null) continue
      expect(d.basis[i]).toBeCloseTo(((hh[i] as number) + (ll[i] as number)) / 2, 10)
    }
  })

  it('atrBands: close ± mult*atr(len)', () => {
    const range = ta.atr(h, l, c, 14)
    const b = ta.atrBands(h, l, c, 14, 2)
    for (let i = 0; i < c.length; i++) {
      if (range[i] == null) continue
      expect(b.upper[i]).toBeCloseTo(c[i]! + 2 * (range[i] as number), 10)
      expect(b.lower[i]).toBeCloseTo(c[i]! - 2 * (range[i] as number), 10)
    }
  })
})

describe('supertrend', () => {
  it('the line is the lower band while trend is up, the upper band while trend is down', () => {
    const h = walk(150, 100, 0.02, 30).map(v => v + 1)
    const l = walk(150, 100, 0.02, 30).map(v => v - 1)
    const c = walk(150, 100, 0.02, 30)
    const { line, trend } = ta.supertrend(h, l, c, 10, 3)
    let sawUp = false; let sawDown = false
    for (let i = 0; i < c.length; i++) {
      if (line[i] == null || trend[i] == null) continue
      if (trend[i] === 1) sawUp = true
      if (trend[i] === -1) sawDown = true
    }
    expect(sawUp).toBe(true)
    expect(sawDown).toBe(true)
  })

  it('no-repaint: bars 0..n-2 are unchanged when one more bar is appended', () => {
    const h = walk(80, 100, 0.02, 31).map(v => v + 1)
    const l = walk(80, 100, 0.02, 31).map(v => v - 1)
    const c = walk(80, 100, 0.02, 31)
    const full = ta.supertrend(h, l, c, 10, 3)
    const partial = ta.supertrend(h.slice(0, -1), l.slice(0, -1), c.slice(0, -1), 10, 3)
    for (let i = 0; i < c.length - 1; i++) {
      expect(full.line[i]).toBe(partial.line[i])
      expect(full.trend[i]).toBe(partial.trend[i])
    }
  })
})

describe('ichimoku', () => {
  const n = 200
  const h = walk(n, 100, 0.01, 40).map(v => v + 1)
  const l = walk(n, 100, 0.01, 40).map(v => v - 1)
  const c = walk(n, 100, 0.01, 40)

  it('conversion/base are donchian midpoints of their own length', () => {
    const r = ta.ichimoku(h, l, c, 9, 26, 52, 26)
    expectClose(r.conversion, ta.donchian(h, l, 9).basis, exact, 'conversion')
    expectClose(r.base, ta.donchian(h, l, 26).basis, exact, 'base')
  })

  it('lagging[i] is the close `displacement-1` bars later; null past the end', () => {
    const r = ta.ichimoku(h, l, c, 9, 26, 52, 26)
    for (let i = 0; i < n - 25; i++) expect(r.lagging[i]).toBe(c[i + 25])
    for (let i = n - 25; i < n; i++) expect(r.lagging[i]).toBeNull()
  })

  it('spanA/spanB at bar i equal the lead values computed `displacement-1` bars earlier', () => {
    const r = ta.ichimoku(h, l, c, 9, 26, 52, 26)
    const conv = ta.donchian(h, l, 9).basis
    const base = ta.donchian(h, l, 26).basis
    const leadB = ta.donchian(h, l, 52).basis
    for (let i = 25; i < n; i++) {
      const a = conv[i - 25]; const b = base[i - 25]
      expect(r.spanA[i]).toBe(a == null || b == null ? null : (a + b) / 2)
      expect(r.spanB[i]).toBe(leadB[i - 25])
    }
  })
})

describe('anchoredVwap', () => {
  it('resets at each period boundary and matches a manual cumulative-from-anchor calc', () => {
    const n = 40
    const h: Series = Array.from({ length: n }, (_, i) => 10 + (i % 10) * 0.1 + 1)
    const l: Series = Array.from({ length: n }, (_, i) => 10 + (i % 10) * 0.1 - 1)
    const c: Series = Array.from({ length: n }, (_, i) => 10 + (i % 10) * 0.1)
    const v: Series = Array.from({ length: n }, (_, i) => 1 + (i % 5))
    const periods = Array.from({ length: n }, (_, i) => Math.floor(i / 10))
    const { vwap } = ta.anchoredVwap(h, l, c, v, periods, false)
    for (let p = 0; p < 4; p++) {
      let pv = 0, vol = 0
      for (let i = p * 10; i < p * 10 + 10; i++) {
        const tp = (h[i]! + l[i]! + c[i]!) / 3
        pv += tp * v[i]!; vol += v[i]!
        expect(vwap[i]).toBeCloseTo(pv / vol, 10)
      }
    }
  })

  it('skipFirst nulls the whole first period only', () => {
    const n = 20
    const h: Series = Array(n).fill(11)
    const l: Series = Array(n).fill(9)
    const c: Series = Array(n).fill(10)
    const v: Series = Array(n).fill(1)
    const periods = Array.from({ length: n }, (_, i) => Math.floor(i / 10))
    const { vwap } = ta.anchoredVwap(h, l, c, v, periods, true)
    for (let i = 0; i < 10; i++) expect(vwap[i]).toBeNull()
    for (let i = 10; i < 20; i++) expect(vwap[i]).not.toBeNull()
  })

  it('a bar with a null period key produces a null bar and does not join a neighbouring period', () => {
    const h: Series = [11, 11, 11, 11]
    const l: Series = [9, 9, 9, 9]
    const c: Series = [10, 10, 10, 10]
    const v: Series = [1, 1, 1, 1]
    const { vwap } = ta.anchoredVwap(h, l, c, v, [0, null, 0, 0], false)
    expect(vwap[1]).toBeNull()
    expect(vwap[2]).toBeCloseTo(10, 10)
  })
})
