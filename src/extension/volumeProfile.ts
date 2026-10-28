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
 * Volume-by-price binning shared by the fixedRangeVolumeProfile and
 * anchoredVolumeProfile drawing tools (src/extension/volumeTools.ts) and by
 * SC_VRVP (SC-171). Pure: no klinecharts, no canvas, no chart access, so it is
 * unit-testable on its own and cannot pull in the two tools' chartRef/dataIndex
 * concerns (owned elsewhere; see the batch's overlap note).
 *
 * Each bar's volume is spread across every row its [low, high] range touches,
 * in proportion to the overlap — not dropped into one "typical price" row,
 * which put the POC (the widest row) off by several percent of the range on
 * synthetic and real data alike. POC is the row with the most volume; the
 * value area expands out from it, one row at a time on whichever side has
 * more volume, until it holds `valueArea` (default 70%) of the total.
 *
 * Maintained by ZzyzxLabs. Part of SUPer-Chart (Apache-2.0).
 */

export interface VolumeProfileBar {
  high: number
  low: number
  volume: number
}

export interface VolumeProfileRow {
  priceLow: number
  priceHigh: number
  volume: number
}

export interface VolumeProfileResult {
  rows: VolumeProfileRow[]
  /** The row with the most volume (its midpoint). NaN when there is no data. */
  poc: number
  /** Value-area high/low bounds. NaN when there is no data. */
  vah: number
  val: number
  pmin: number
  pmax: number
}

export interface VolumeProfileOptions {
  rows?: number
  /** Fraction of total volume the value area should hold. @default 0.7 */
  valueArea?: number
}

function clampBin (bin: number, rows: number): number {
  return Math.max(0, Math.min(rows - 1, bin))
}

/** Bins `bars` by price into `rows` equal-height rows across [lowest low, highest high]. */
export function volumeProfile (bars: readonly VolumeProfileBar[], options: VolumeProfileOptions = {}): VolumeProfileResult {
  const rows = options.rows ?? 24
  const valueArea = options.valueArea ?? 0.7
  let pmin = Infinity
  let pmax = -Infinity
  for (const b of bars) {
    if (b.low < pmin) pmin = b.low
    if (b.high > pmax) pmax = b.high
  }
  if (!Number.isFinite(pmin) || !Number.isFinite(pmax)) {
    return { rows: [], poc: NaN, vah: NaN, val: NaN, pmin, pmax }
  }
  if (!(pmax > pmin)) {
    // A flat range (every bar's high === low, or a single price): one row holds everything.
    const total = bars.reduce((s, b) => s + Math.max(0, b.volume), 0)
    return {
      rows: [{ priceLow: pmin, priceHigh: pmin, volume: total }],
      poc: pmin,
      vah: pmin,
      val: pmin,
      pmin,
      pmax: pmin
    }
  }
  const vol = new Array<number>(rows).fill(0)
  const binH = (pmax - pmin) / rows
  for (const b of bars) {
    const v = Math.max(0, b.volume)
    if (v <= 0) continue
    if (!(b.high > b.low)) {
      vol[clampBin(Math.floor((b.low - pmin) / binH), rows)] += v
      continue
    }
    const loBin = clampBin(Math.floor((b.low - pmin) / binH), rows)
    const hiBin = clampBin(Math.floor((b.high - pmin) / binH), rows)
    const span = b.high - b.low
    for (let bi = loBin; bi <= hiBin; bi++) {
      const rowLo = pmin + bi * binH
      const rowHi = rowLo + binH
      const overlap = Math.min(b.high, rowHi) - Math.max(b.low, rowLo)
      if (overlap > 0) vol[bi] += v * (overlap / span)
    }
  }
  const total = vol.reduce((a, b) => a + b, 0)
  let pocBin = 0
  for (let i = 1; i < rows; i++) if (vol[i] > vol[pocBin]) pocBin = i
  let lo = pocBin
  let hi = pocBin
  let sum = vol[pocBin]
  while (sum < total * valueArea && (lo > 0 || hi < rows - 1)) {
    const loVol = lo > 0 ? vol[lo - 1] : -1
    const hiVol = hi < rows - 1 ? vol[hi + 1] : -1
    if (hiVol >= loVol) { hi++; sum += vol[hi] } else { lo--; sum += vol[lo] }
  }
  const rowsOut = vol.map((v, i) => ({ priceLow: pmin + i * binH, priceHigh: pmin + (i + 1) * binH, volume: v }))
  return {
    rows: rowsOut,
    poc: pmin + (pocBin + 0.5) * binH,
    vah: pmin + (hi + 1) * binH,
    val: pmin + lo * binH,
    pmin,
    pmax
  }
}
