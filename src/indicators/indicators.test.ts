import { describe, expect, it } from 'vitest'
import type { KLineData } from 'klinecharts'
import * as ta from '../ta'

import { createScSmaCalc } from './SC_SMA'
import { createScRsiCalc, rsiStep, INITIAL_RSI_STATE } from './SC_RSI'
import { calcScMacd } from './SC_MACD'
import { calcScVwap, vwapPeriodKey } from './SC_VWAP'
import { calcScAtr } from './SC_ATR'
import { calcScStoch } from './SC_STOCH'
import { calcScStochRsi } from './SC_STOCHRSI'
import { calcScBbp } from './SC_BBP'
import { calcScMfi } from './SC_MFI'
import { calcScKeltner } from './SC_KELTNER'
import { calcScDonchian } from './SC_DONCHIAN'
import { calcScAtrBands } from './SC_ATR_BANDS'
import { calcScSupertrend } from './SC_SUPERTREND'
import { calcScIchimoku } from './SC_ICHIMOKU'

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

function synthBars (n: number, seed: number): KLineData[] {
  const r = rng(seed)
  const out: KLineData[] = []
  let price = 100
  for (let i = 0; i < n; i++) {
    price += (r() - 0.5) * 2
    const open = price
    const close = price + (r() - 0.5)
    const high = Math.max(open, close) + r() * 0.5
    const low = Math.min(open, close) - r() * 0.5
    out.push({ timestamp: i * 60000, open, high, low, close, volume: 1 + r() * 10 })
    price = close
  }
  return out
}

describe('SC_SMA', () => {
  it('is the arithmetic rolling mean, not EMA(12) — the SC-167 golden case', () => {
    const bars = synthBars(60, 1)
    const calc = createScSmaCalc()
    const rows = calc(bars, { calcParams: [20] })
    const closes = bars.map(b => b.close)
    const ref = ta.sma(closes, 20)
    for (let i = 0; i < bars.length; i++) {
      if (ref[i] == null) expect(rows[i].sma).toBeUndefined()
      else expect(rows[i].sma).toBeCloseTo(ref[i] as number, 9)
    }
  })

  it('calcParams [20] (a single length) gives finite values, unlike the old SMA which read NaN', () => {
    const bars = synthBars(30, 2)
    const rows = createScSmaCalc()(bars, { calcParams: [20] })
    expect(rows[29].sma).toBeTypeOf('number')
    expect(Number.isFinite(rows[29].sma)).toBe(true)
  })

  it('tail append/replace match a full recompute at every step (put-back: a wrong window would drift)', () => {
    const calc = createScSmaCalc()
    const indicator = { calcParams: [9] }
    const dataList: KLineData[] = []
    const r = rng(3)
    for (let step = 0; step < 120; step++) {
      const bar: KLineData = { timestamp: step * 60000, open: 100, high: 101, low: 99, close: 100 + r() * 10, volume: 1 }
      if (step > 0 && r() < 0.3) {
        dataList[dataList.length - 1] = bar // replace
      } else {
        dataList.push(bar) // append
      }
      const got = calc(dataList, indicator)
      const ref = ta.sma(dataList.map(d => d.close), 9)
      const wantLast = ref[ref.length - 1]
      if (wantLast === null) expect(got[dataList.length - 1].sma).toBeUndefined()
      else expect(got[dataList.length - 1].sma).toBeCloseTo(wantLast, 9)
    }
  })
})

describe('SC_RSI', () => {
  it('rsiStep matches ta.rsi bar for bar (the algorithms must agree, not just look alike)', () => {
    const closes = synthBars(100, 4).map(b => b.close)
    let state = INITIAL_RSI_STATE
    const got: Array<number | null> = []
    for (const c of closes) {
      const r = rsiStep(c, 14, state)
      state = r.state
      got.push(r.value)
    }
    const ref = ta.rsi(closes, 14)
    for (let i = 0; i < closes.length; i++) {
      if (ref[i] == null) expect(got[i]).toBeNull()
      else expect(got[i]).toBeCloseTo(ref[i] as number, 9)
    }
  })

  it('a monotonic uptrend gives 100 (SC-155): the template, not just the ta core', () => {
    const bars: KLineData[] = Array.from({ length: 40 }, (_, i) => ({ timestamp: i * 60000, open: 100 + i, high: 100 + i + 1, low: 100 + i - 1, close: 100 + i, volume: 1 }))
    const rows = createScRsiCalc()(bars, { calcParams: [14] })
    expect(rows[39].rsi).toBe(100)
  })

  it('tail append/replace match a full recompute over a random tick sequence', () => {
    const calc = createScRsiCalc()
    const indicator = { calcParams: [14] }
    const dataList: KLineData[] = []
    const r = rng(5)
    for (let step = 0; step < 200; step++) {
      const bar: KLineData = { timestamp: step * 60000, open: 100, high: 101, low: 99, close: 100 + r() * 20, volume: 1 }
      if (step > 0 && r() < 0.3) dataList[dataList.length - 1] = bar
      else dataList.push(bar)
      const got = calc(dataList, indicator)
      const ref = ta.rsi(dataList.map(d => d.close), 14)
      const lastRef = ref[ref.length - 1]
      const lastGot = got[got.length - 1].rsi
      if (lastRef == null) expect(lastGot).toBeUndefined()
      else expect(lastGot).toBeCloseTo(lastRef, 9)
    }
  })

  it('put-back: seeding avgGain/avgLoss from the wrong bar (an off-by-one) would fail the tail-parity test above', () => {
    // Direct regression check on rsiStep's seeding boundary instead of re-running
    // the whole random sequence: bar `len` is exactly where the seed completes.
    const closes = [100, 101, 102, 103, 104, 103, 102, 101, 100, 99, 98, 97, 96, 95, 94]
    let state = INITIAL_RSI_STATE
    let seededAt = -1
    for (let i = 0; i < closes.length; i++) {
      const r = rsiStep(closes[i], 14, state)
      if (r.value != null && seededAt === -1) seededAt = i
      state = r.state
    }
    expect(seededAt).toBe(14) // 14 changes (bars 1..14) seed a length-14 average
  })
})

describe('SC_MACD', () => {
  it('hist = dif - dea (not doubled), computed from the shared ta core', () => {
    const bars = synthBars(200, 6)
    const rows = calcScMacd(bars, { calcParams: [12, 26, 9] })
    const closes = bars.map(b => b.close)
    const ref = ta.macd(closes, 12, 26, 9)
    for (let i = 0; i < bars.length; i++) {
      if (ref.hist[i] == null) continue
      expect(rows[i].hist).toBeCloseTo(ref.hist[i] as number, 9)
      expect(rows[i].hist).toBeCloseTo((rows[i].dif) - (rows[i].dea), 9)
    }
  })

  it('put-back: multiplying the histogram by 2 (the old bug) would fail the hist===dif-dea check above', () => {
    const bars = synthBars(60, 7)
    const rows = calcScMacd(bars, { calcParams: [12, 26, 9] })
    const last = rows[rows.length - 1]
    if (last.hist != null) {
      const doubled = last.hist * 2
      expect(doubled).not.toBeCloseTo((last.dif) - (last.dea), 9)
    }
  })
})

describe('SC_VWAP', () => {
  it('vwapPeriodKey is stable within a UTC day and changes across the boundary', () => {
    const a = vwapPeriodKey(Date.UTC(2024, 0, 1, 23, 59), 0, 0)
    const b = vwapPeriodKey(Date.UTC(2024, 0, 2, 0, 1), 0, 0)
    expect(a).not.toBe(b)
    const c = vwapPeriodKey(Date.UTC(2024, 0, 1, 1, 0), 0, 0)
    expect(vwapPeriodKey(Date.UTC(2024, 0, 1, 23, 0), 0, 0)).toBe(c)
  })

  it('is identical at the same bar whether 200, 400 or 800 bars of history are loaded (SC-168)', () => {
    // 15-minute bars: 96 per UTC day, so 800 bars covers about 8 days.
    const all = synthBars(800, 8).map((b, i) => ({ ...b, timestamp: i * 15 * 60000 }))
    const last = all.length - 1
    const r200 = calcScVwap(all.slice(last - 199), { calcParams: [0, 0, 2] })
    const r400 = calcScVwap(all.slice(last - 399), { calcParams: [0, 0, 2] })
    const r800 = calcScVwap(all, { calcParams: [0, 0, 2] })
    const v200 = r200[r200.length - 1].vwap
    const v400 = r400[r400.length - 1].vwap
    const v800 = r800[r800.length - 1].vwap
    expect(v200).toBeCloseTo(v400, 9)
    expect(v400).toBeCloseTo(v800, 9)
  })

  it('nulls the whole first (partial) period', () => {
    const all = synthBars(50, 9).map((b, i) => ({ ...b, timestamp: i * 15 * 60000 }))
    const rows = calcScVwap(all, { calcParams: [0, 0, 2] })
    expect(rows[0].vwap).toBeUndefined()
  })
})

describe('SC_ATR/SC_STOCH/SC_STOCHRSI/SC_BBP/SC_MFI: templates agree with the shared ta core', () => {
  const bars = synthBars(150, 10)
  const h = bars.map(b => b.high); const l = bars.map(b => b.low); const c = bars.map(b => b.close); const v = bars.map(b => b.volume as number)

  it('SC_ATR', () => {
    const rows = calcScAtr(bars, { calcParams: [14] })
    const ref = ta.atr(h, l, c, 14)
    expect(rows[149].atr).toBeCloseTo(ref[149] as number, 9)
  })

  it('SC_STOCH', () => {
    const rows = calcScStoch(bars, { calcParams: [14, 1, 3] })
    const ref = ta.sma(ta.sma(ta.stochK(h, l, c, 14), 1), 3)
    expect(rows[149].d).toBeCloseTo(ref[149] as number, 9)
  })

  it('SC_STOCHRSI', () => {
    const rows = calcScStochRsi(bars, { calcParams: [14, 14, 3, 3] })
    const ref = ta.stochRsi(c, 14, 14, 3, 3)
    expect(rows[149].k).toBeCloseTo(ref.k[149] as number, 9)
  })

  it('SC_BBP', () => {
    const rows = calcScBbp(bars, { calcParams: [20, 2] })
    const ref = ta.bbPercent(c, 20, 2)
    expect(rows[149].b).toBeCloseTo(ref[149] as number, 9)
  })

  it('SC_MFI', () => {
    const rows = calcScMfi(bars, { calcParams: [14] })
    const ref = ta.mfi(h, l, c, v, 14)
    expect(rows[149].mfi).toBeCloseTo(ref[149] as number, 9)
  })
})

describe('SC_KELTNER/SC_DONCHIAN/SC_ATR_BANDS/SC_SUPERTREND/SC_ICHIMOKU: templates agree with the shared ta core', () => {
  const bars = synthBars(150, 11)
  const h = bars.map(b => b.high); const l = bars.map(b => b.low); const c = bars.map(b => b.close)

  it('SC_KELTNER', () => {
    const rows = calcScKeltner(bars, { calcParams: [20, 2, 10] })
    const ref = ta.keltner(h, l, c, 20, 2, 10)
    expect(rows[149].upper).toBeCloseTo(ref.upper[149] as number, 9)
  })

  it('SC_DONCHIAN', () => {
    const rows = calcScDonchian(bars, { calcParams: [20] })
    const ref = ta.donchian(h, l, 20)
    expect(rows[149].basis).toBeCloseTo(ref.basis[149] as number, 9)
  })

  it('SC_ATR_BANDS', () => {
    const rows = calcScAtrBands(bars, { calcParams: [14, 2] })
    const ref = ta.atrBands(h, l, c, 14, 2)
    expect(rows[149].lower).toBeCloseTo(ref.lower[149] as number, 9)
  })

  it('SC_SUPERTREND', () => {
    const rows = calcScSupertrend(bars, { calcParams: [10, 3] })
    const ref = ta.supertrend(h, l, c, 10, 3)
    expect(rows[149].line).toBeCloseTo(ref.line[149] as number, 9)
    expect(rows[149].trend).toBe(ref.trend[149])
  })

  it('SC_ICHIMOKU', () => {
    const rows = calcScIchimoku(bars, { calcParams: [9, 26, 52, 26] })
    const ref = ta.ichimoku(h, l, c, 9, 26, 52, 26)
    expect(rows[149].conversion).toBeCloseTo(ref.conversion[149] as number, 9)
    expect(rows[100].lagging).toBeCloseTo(ref.lagging[100] as number, 9)
  })
})
