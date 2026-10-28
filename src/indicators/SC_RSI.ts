/**
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at

 * http://www.apache.org/licenses/LICENSE-2.0

 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * SC_RSI (SC-155): klinecharts' built-in 'RSI' sums gains/losses over a fixed
 * window (Cutler) and sets 0 whenever the window has no losses — in a strong
 * uptrend it reads maximally oversold. SC_RSI is Wilder's RSI from the shared
 * ta core (`ta.rsi`, the same function SuperScript's `rsi()` calls), 100 when
 * the average loss is 0. The built-in stays registered, unchanged: a direct
 * `createIndicator('RSI')` keeps klinecharts' own behaviour until the lockstep
 * wallet PR moves those call sites to this name (or the v2 API, which aliases
 * 'RSI' to 'SC_RSI' — see ./aliases.ts).
 *
 * The recurrence (average gain/loss) cannot be read back out of the RSI value
 * alone, so a tail step needs its own copy of ta.rsi's step (rsiStep below) and
 * carries {avgGain, avgLoss} across ticks. Two snapshots are kept — the state
 * just before the last bar, and just after it — so both 'append' (advance from
 * "after") and 'replace' (recompute the last bar from "before") are correct.
 * ta.rsi and this module's full path are the same algorithm; ta/ta.test.ts and
 * this module's own test check they agree bit-for-bit.
 *
 * Maintained by ZzyzxLabs. Part of SUPer-Chart (Apache-2.0).
 */
import type { IndicatorTemplate, KLineData } from 'klinecharts'
import { createLevelsDraw } from './levels'
import { OSCILLATOR_PRECISION, SERIES_NORMAL } from './shared'
import { paramsKey, tailMode, type TailCache } from './tail'

type Row = Record<string, number>

export interface RsiRecurrence {
  avgGain: number
  avgLoss: number
  prevClose: number | null
  /** How many changes have gone into the seeding average so far (caps at `len`). */
  seeded: number
}

export const INITIAL_RSI_STATE: Readonly<RsiRecurrence> = { avgGain: 0, avgLoss: 0, prevClose: null, seeded: 0 }

function rsiFrom (avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return 100
  if (avgGain === 0) return 0
  return 100 - 100 / (1 + avgGain / avgLoss)
}

/** One bar of Wilder's RSI recurrence — the same rule as ta.rsi's inner loop. */
export function rsiStep (close: number, len: number, st: RsiRecurrence): { value: number | null, state: RsiRecurrence } {
  if (st.prevClose == null) return { value: null, state: { ...st, prevClose: close } }
  const ch = close - st.prevClose
  const gain = Math.max(ch, 0)
  const loss = Math.max(-ch, 0)
  if (st.seeded < len) {
    const avgGain = st.avgGain + gain
    const avgLoss = st.avgLoss + loss
    const seeded = st.seeded + 1
    if (seeded === len) {
      const ag = avgGain / len
      const al = avgLoss / len
      return { value: rsiFrom(ag, al), state: { avgGain: ag, avgLoss: al, prevClose: close, seeded } }
    }
    return { value: null, state: { avgGain, avgLoss, prevClose: close, seeded } }
  }
  const avgGain = (st.avgGain * (len - 1) + gain) / len
  const avgLoss = (st.avgLoss * (len - 1) + loss) / len
  return { value: rsiFrom(avgGain, avgLoss), state: { avgGain, avgLoss, prevClose: close, seeded: st.seeded } }
}

interface State { rows: Row[], beforeLast: RsiRecurrence, afterLast: RsiRecurrence }

function fullRsi (dataList: KLineData[], len: number): State {
  let state: RsiRecurrence = INITIAL_RSI_STATE
  let beforeLast: RsiRecurrence = INITIAL_RSI_STATE
  const rows: Row[] = new Array(dataList.length)
  for (let i = 0; i < dataList.length; i++) {
    if (i === dataList.length - 1) beforeLast = state
    const r = rsiStep(dataList[i].close, len, state)
    state = r.state
    rows[i] = r.value == null ? {} : { rsi: r.value }
  }
  return { rows, beforeLast, afterLast: state }
}

export function createScRsiCalc (): (dataList: KLineData[], indicator?: { calcParams?: unknown[] }) => Row[] {
  const caches = new WeakMap<object, TailCache<State>>()
  return (dataList, indicator) => {
    const len = Number(indicator?.calcParams?.[0]) > 0 ? Math.round(Number(indicator!.calcParams![0])) : 14
    const key = paramsKey([len])
    const n = dataList.length
    const cacheKey = indicator ?? dataList
    const cache = caches.get(cacheKey) ?? null
    const mode = tailMode(cache, dataList, key)
    if (mode === 'full' || n < 2) {
      const full = fullRsi(dataList, len)
      caches.set(cacheKey, { ref: dataList, length: n, paramsKey: key, state: full })
      return full.rows
    }
    const { rows, beforeLast, afterLast } = cache!.state
    if (mode === 'append') {
      const r = rsiStep(dataList[n - 1].close, len, afterLast)
      rows.push(r.value == null ? {} : { rsi: r.value })
      caches.set(cacheKey, { ref: dataList, length: n, paramsKey: key, state: { rows, beforeLast: afterLast, afterLast: r.state } })
      return rows
    }
    // replace: the last bar's close changed; recompute it from the state as of n-2.
    const r = rsiStep(dataList[n - 1].close, len, beforeLast)
    rows[n - 1] = r.value == null ? {} : { rsi: r.value }
    caches.set(cacheKey, { ref: dataList, length: n, paramsKey: key, state: { rows, beforeLast, afterLast: r.state } })
    return rows
  }
}

export const SC_RSI: IndicatorTemplate<Row> = {
  name: 'SC_RSI',
  shortName: 'RSI',
  series: SERIES_NORMAL,
  precision: OSCILLATOR_PRECISION,
  calcParams: [14],
  minValue: 0,
  maxValue: 100,
  figures: [{ key: 'rsi', title: 'RSI: ', type: 'line' }],
  regenerateFigures: (calcParams) => [{ key: 'rsi', title: `RSI${Number(calcParams?.[0]) || 14}: `, type: 'line' }],
  calc: createScRsiCalc(),
  draw: createLevelsDraw('SC_RSI')
}
