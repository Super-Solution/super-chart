// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { RealtimeSeries } from './realtimeSeries'
import { createDerivedSeriesPort } from './derivedPort'
import { averageTrueRange, deriveBars, toKagi, toLineBreak, toPointAndFigure, toRangeBars, toRenko, type DerivedStyle } from './derivedSeries'
import type { MarketBar } from './types'

/*
 * Reference values. The two fixtures below are 28-bar random walks on a price grid of 0.25 (every price and every size is
 * exact in binary floating point, so no tolerance is needed beyond rounding noise). Their expected marks come from an
 * independent implementation in exact rational arithmetic (Python fractions) that was written separately from the code
 * under test; the Renko marks were additionally confirmed equal to the third-party `stocktrends` Renko (close-based,
 * first synthetic brick dropped) when the fixtures were made. The hand-worked cases further down need no oracle.
 */

const A = {
  size: 2.0,
  bars: [
    [100, 101.25, 93.75, 95.75],
    [95.75, 98, 95, 97.75],
    [97.75, 103.25, 96.25, 101.25],
    [101.25, 106.25, 99.5, 104.25],
    [104.25, 112, 103.5, 110.25],
    [110.25, 110.5, 104, 104.25],
    [104.25, 104.5, 101, 102.75],
    [102.75, 104.5, 95.5, 96.75],
    [96.75, 98.25, 93, 94],
    [94, 95.25, 92, 93.5],
    [93.5, 101.25, 93.25, 99.25],
    [99.25, 106, 99, 104.75],
    [104.75, 109.5, 103.75, 107.5],
    [107.5, 109.25, 105.5, 106],
    [106, 111.25, 106, 110.25],
    [110.25, 116.75, 109, 115.5],
    [115.5, 118.25, 115.25, 116.75],
    [116.75, 119, 115, 117],
    [117, 118.5, 110.75, 112.75],
    [112.75, 120.5, 111.25, 118.75],
    [118.75, 122, 117.25, 121],
    [121, 125.75, 119, 124],
    [124, 126.25, 123.25, 126.25],
    [126.25, 126.25, 120.25, 122.25],
    [122.25, 127, 120.75, 126.75],
    [126.75, 128.75, 125, 128.25],
    [128.25, 128.5, 124, 125.75],
    [125.75, 132.25, 123.75, 130.5]
  ] as Array<[number, number, number, number]>,
  renko: [
    [94, 96, 94, 96],
    [96, 98, 96, 98],
    [98, 100, 98, 100],
    [100, 102, 100, 102],
    [102, 104, 102, 104],
    [104, 106, 104, 106],
    [106, 108, 106, 108],
    [108, 110, 108, 110],
    [108, 108, 106, 106],
    [106, 106, 104, 104],
    [104, 104, 102, 102],
    [102, 102, 100, 100],
    [100, 100, 98, 98],
    [98, 98, 96, 96],
    [96, 96, 94, 94],
    [96, 98, 96, 98],
    [98, 100, 98, 100],
    [100, 102, 100, 102],
    [102, 104, 102, 104],
    [104, 106, 104, 106],
    [106, 108, 106, 108],
    [108, 110, 108, 110],
    [110, 112, 110, 112],
    [112, 114, 112, 114],
    [114, 116, 114, 116],
    [116, 118, 116, 118],
    [118, 120, 118, 120],
    [120, 122, 120, 122],
    [122, 124, 122, 124],
    [124, 126, 124, 126],
    [126, 128, 126, 128],
    [128, 130, 128, 130]
  ] as Array<[number, number, number, number]>,
  lineBreak: [
    [95.75, 97.75, 95.75, 97.75],
    [97.75, 101.25, 97.75, 101.25],
    [101.25, 104.25, 101.25, 104.25],
    [104.25, 110.25, 104.25, 110.25],
    [110.25, 110.25, 96.75, 96.75],
    [96.75, 96.75, 94, 94],
    [94, 94, 93.5, 93.5],
    [93.5, 115.5, 93.5, 115.5],
    [115.5, 116.75, 115.5, 116.75],
    [116.75, 117, 116.75, 117],
    [117, 118.75, 117, 118.75],
    [118.75, 121, 118.75, 121],
    [121, 124, 121, 124],
    [124, 126.25, 124, 126.25],
    [126.25, 126.75, 126.25, 126.75],
    [126.75, 128.25, 126.75, 128.25],
    [128.25, 130.5, 128.25, 130.5]
  ] as Array<[number, number, number, number]>,
  range: [
    [100, 101.25, 99.25, 99.25],
    [99.25, 99.25, 97.25, 97.25],
    [97.25, 97.25, 95.25, 95.25],
    [95.25, 95.75, 93.75, 95.75],
    [95.75, 97, 95, 97],
    [97, 98.25, 96.25, 98.25],
    [98.25, 100.25, 98.25, 100.25],
    [100.25, 102.25, 100.25, 102.25],
    [102.25, 103.25, 101.25, 101.25],
    [101.25, 101.5, 99.5, 101.5],
    [101.5, 103.5, 101.5, 103.5],
    [103.5, 105.5, 103.5, 105.5],
    [105.5, 106.25, 104.25, 104.25],
    [104.25, 105.5, 103.5, 105.5],
    [105.5, 107.5, 105.5, 107.5],
    [107.5, 109.5, 107.5, 109.5],
    [109.5, 111.5, 109.5, 111.5],
    [111.5, 112, 110, 110],
    [110, 110, 108, 108],
    [108, 108, 106, 106],
    [106, 106, 104, 104],
    [104, 104.5, 102.5, 102.5],
    [102.5, 103, 101, 103],
    [103, 104.5, 102.5, 102.5],
    [102.5, 102.5, 100.5, 100.5],
    [100.5, 100.5, 98.5, 98.5],
    [98.5, 98.5, 96.5, 96.5],
    [96.5, 97.5, 95.5, 97.5],
    [97.5, 98.25, 96.25, 96.25],
    [96.25, 96.25, 94.25, 94.25],
    [94.25, 95, 93, 95],
    [95, 95.25, 93.25, 93.25],
    [93.25, 94, 92, 94],
    [94, 96, 94, 96],
    [96, 98, 96, 98],
    [98, 100, 98, 100],
    [100, 101.25, 99.25, 99.25],
    [99.25, 101, 99, 101],
    [101, 103, 101, 103],
    [103, 105, 103, 105],
    [105, 106, 104, 104],
    [104, 105.75, 103.75, 105.75],
    [105.75, 107.75, 105.75, 107.75],
    [107.75, 109.5, 107.5, 107.5],
    [107.5, 109.25, 107.25, 107.25],
    [107.25, 107.5, 105.5, 107.5],
    [107.5, 109.5, 107.5, 109.5],
    [109.5, 111.25, 109.25, 109.25],
    [109.25, 111, 109, 111],
    [111, 113, 111, 113],
    [113, 115, 113, 115],
    [115, 117, 115, 117],
    [117, 118.25, 116.25, 116.25],
    [116.25, 117, 115, 117],
    [117, 119, 117, 119],
    [119, 119, 117, 117],
    [117, 118.5, 116.5, 116.5],
    [116.5, 116.5, 114.5, 114.5],
    [114.5, 114.5, 112.5, 112.5],
    [112.5, 112.75, 110.75, 112.75],
    [112.75, 113.25, 111.25, 113.25],
    [113.25, 115.25, 113.25, 115.25],
    [115.25, 117.25, 115.25, 117.25],
    [117.25, 119.25, 117.25, 119.25],
    [119.25, 120.5, 118.5, 118.5],
    [118.5, 119.25, 117.25, 119.25],
    [119.25, 121.25, 119.25, 121.25],
    [121.25, 122, 120, 120],
    [120, 121, 119, 121],
    [121, 123, 121, 123],
    [123, 125, 123, 125],
    [125, 125.75, 123.75, 123.75],
    [123.75, 125.25, 123.25, 125.25],
    [125.25, 126.25, 124.25, 124.25],
    [124.25, 124.25, 122.25, 122.25],
    [122.25, 122.25, 120.25, 120.25],
    [120.25, 122.25, 120.25, 122.25],
    [122.25, 122.75, 120.75, 122.75],
    [122.75, 124.75, 122.75, 124.75],
    [124.75, 126.75, 124.75, 126.75],
    [126.75, 127, 125, 125],
    [125, 127, 125, 127],
    [127, 128.75, 126.75, 126.75],
    [126.75, 126.75, 124.75, 124.75],
    [124.75, 125.75, 123.75, 123.75],
    [123.75, 125.75, 123.75, 125.75],
    [125.75, 127.75, 125.75, 127.75],
    [127.75, 129.75, 127.75, 129.75],
    [129.75, 131.75, 129.75, 131.75],
    [131.75, 132.25, 130.5, 130.5]
  ] as Array<[number, number, number, number]>,
  kagi: [
    [95.75, 110.25, 95.75, 110.25],
    [110.25, 110.25, 93.5, 93.5],
    [93.5, 117, 93.5, 117],
    [117, 117, 112.75, 112.75],
    [112.75, 126.25, 112.75, 126.25],
    [126.25, 126.25, 122.25, 122.25],
    [122.25, 128.25, 122.25, 128.25],
    [128.25, 128.25, 125.75, 125.75],
    [125.75, 130.5, 125.75, 130.5]
  ] as Array<[number, number, number, number]>
}

const B = {
  size: 1.5,
  bars: [
    [100, 102, 96.5, 98],
    [98, 103.5, 96, 102.5],
    [102.5, 108.75, 100.75, 106.75],
    [106.75, 108.5, 106, 107],
    [107, 108, 105.5, 105.5],
    [105.5, 106, 98.25, 100],
    [100, 104, 98.75, 102.25],
    [102.25, 103.25, 97.5, 99.25],
    [99.25, 102.5, 97.5, 100.5],
    [100.5, 103.25, 100.5, 101.25],
    [101.25, 102.5, 98, 99.75],
    [99.75, 101.5, 93.25, 95.25],
    [95.25, 97, 92.75, 93.25],
    [93.25, 95.75, 93, 94],
    [94, 99.25, 92.25, 98.25],
    [98.25, 98.5, 97.25, 98],
    [98, 105.25, 97.5, 103.75],
    [103.75, 104.75, 103.5, 104.75],
    [104.75, 106.5, 96.75, 98.75],
    [98.75, 99.5, 93.25, 94],
    [94, 94, 87.75, 89.75],
    [89.75, 91, 87.5, 88],
    [88, 89.25, 80.25, 82],
    [82, 87.5, 80, 87],
    [87, 88.75, 84, 84.5],
    [84.5, 90, 83.5, 88],
    [88, 89.5, 82.75, 83.25],
    [83.25, 84.25, 77.25, 79.25]
  ] as Array<[number, number, number, number]>,
  renko: [
    [97.5, 99, 97.5, 99],
    [99, 100.5, 99, 100.5],
    [100.5, 102, 100.5, 102],
    [102, 103.5, 102, 103.5],
    [103.5, 105, 103.5, 105],
    [105, 106.5, 105, 106.5],
    [105, 105, 103.5, 103.5],
    [103.5, 103.5, 102, 102],
    [102, 102, 100.5, 100.5],
    [100.5, 100.5, 99, 99],
    [99, 99, 97.5, 97.5],
    [97.5, 97.5, 96, 96],
    [96, 96, 94.5, 94.5],
    [96, 97.5, 96, 97.5],
    [97.5, 99, 97.5, 99],
    [99, 100.5, 99, 100.5],
    [100.5, 102, 100.5, 102],
    [102, 103.5, 102, 103.5],
    [102, 102, 100.5, 100.5],
    [100.5, 100.5, 99, 99],
    [99, 99, 97.5, 97.5],
    [97.5, 97.5, 96, 96],
    [96, 96, 94.5, 94.5],
    [94.5, 94.5, 93, 93],
    [93, 93, 91.5, 91.5],
    [91.5, 91.5, 90, 90],
    [90, 90, 88.5, 88.5],
    [88.5, 88.5, 87, 87],
    [87, 87, 85.5, 85.5],
    [85.5, 85.5, 84, 84],
    [84, 84, 82.5, 82.5],
    [84, 85.5, 84, 85.5],
    [85.5, 87, 85.5, 87],
    [85.5, 85.5, 84, 84],
    [84, 84, 82.5, 82.5],
    [82.5, 82.5, 81, 81],
    [81, 81, 79.5, 79.5]
  ] as Array<[number, number, number, number]>,
  lineBreak: [
    [98, 102.5, 98, 102.5],
    [102.5, 106.75, 102.5, 106.75],
    [106.75, 107, 106.75, 107],
    [107, 107, 95.25, 95.25],
    [95.25, 95.25, 93.25, 93.25],
    [93.25, 93.25, 89.75, 89.75],
    [89.75, 89.75, 88, 88],
    [88, 88, 82, 82],
    [82, 82, 79.25, 79.25]
  ] as Array<[number, number, number, number]>,
  range: [
    [100, 101.5, 100, 101.5],
    [101.5, 102, 100.5, 100.5],
    [100.5, 100.5, 99, 99],
    [99, 99, 97.5, 97.5],
    [97.5, 98, 96.5, 98],
    [98, 98, 96.5, 96.5],
    [96.5, 97.5, 96, 97.5],
    [97.5, 99, 97.5, 99],
    [99, 100.5, 99, 100.5],
    [100.5, 102, 100.5, 102],
    [102, 103.5, 102, 103.5],
    [103.5, 103.5, 102, 102],
    [102, 102.25, 100.75, 102.25],
    [102.25, 103.75, 102.25, 103.75],
    [103.75, 105.25, 103.75, 105.25],
    [105.25, 106.75, 105.25, 106.75],
    [106.75, 108.25, 106.75, 108.25],
    [108.25, 108.75, 107.25, 107.25],
    [107.25, 107.5, 106, 107.5],
    [107.5, 108.5, 107, 107],
    [107, 108, 106.5, 106.5],
    [106.5, 106.5, 105, 105],
    [105, 105, 103.5, 103.5],
    [103.5, 103.5, 102, 102],
    [102, 102, 100.5, 100.5],
    [100.5, 100.5, 99, 99],
    [99, 99.75, 98.25, 99.75],
    [99.75, 100.25, 98.75, 100.25],
    [100.25, 101.75, 100.25, 101.75],
    [101.75, 103.25, 101.75, 103.25],
    [103.25, 104, 102.5, 102.5],
    [102.5, 103.25, 101.75, 101.75],
    [101.75, 101.75, 100.25, 100.25],
    [100.25, 100.25, 98.75, 98.75],
    [98.75, 99, 97.5, 99],
    [99, 99.25, 97.75, 97.75],
    [97.75, 99, 97.5, 99],
    [99, 100.5, 99, 100.5],
    [100.5, 102, 100.5, 102],
    [102, 102.5, 101, 101],
    [101, 102, 100.5, 102],
    [102, 103.25, 101.75, 101.75],
    [101.75, 102.5, 101, 101],
    [101, 101, 99.5, 99.5],
    [99.5, 99.5, 98, 98],
    [98, 99.5, 98, 99.5],
    [99.5, 101, 99.5, 101],
    [101, 101.5, 100, 100],
    [100, 100, 98.5, 98.5],
    [98.5, 98.5, 97, 97],
    [97, 97, 95.5, 95.5],
    [95.5, 95.5, 94, 94],
    [94, 94.75, 93.25, 94.75],
    [94.75, 96.25, 94.75, 96.25],
    [96.25, 97, 95.5, 95.5],
    [95.5, 95.5, 94, 94],
    [94, 94.25, 92.75, 94.25],
    [94.25, 95.75, 94.25, 95.75],
    [95.75, 95.75, 94.25, 94.25],
    [94.25, 94.25, 92.75, 92.75],
    [92.75, 93.75, 92.25, 93.75],
    [93.75, 95.25, 93.75, 95.25],
    [95.25, 96.75, 95.25, 96.75],
    [96.75, 98.25, 96.75, 98.25],
    [98.25, 99.25, 97.75, 97.75],
    [97.75, 98.75, 97.25, 98.75],
    [98.75, 100.25, 98.75, 100.25],
    [100.25, 101.75, 100.25, 101.75],
    [101.75, 103.25, 101.75, 103.25],
    [103.25, 104.75, 103.25, 104.75],
    [104.75, 105.25, 103.75, 103.75],
    [103.75, 105, 103.5, 105],
    [105, 106.5, 105, 106.5],
    [106.5, 106.5, 105, 105],
    [105, 105, 103.5, 103.5],
    [103.5, 103.5, 102, 102],
    [102, 102, 100.5, 100.5],
    [100.5, 100.5, 99, 99],
    [99, 99, 97.5, 97.5],
    [97.5, 98.25, 96.75, 98.25],
    [98.25, 99.5, 98, 98],
    [98, 98, 96.5, 96.5],
    [96.5, 96.5, 95, 95],
    [95, 95, 93.5, 93.5],
    [93.5, 94, 92.5, 92.5],
    [92.5, 92.5, 91, 91],
    [91, 91, 89.5, 89.5],
    [89.5, 89.5, 88, 88],
    [88, 89.25, 87.75, 89.25],
    [89.25, 90.75, 89.25, 90.75],
    [90.75, 91, 89.5, 89.5],
    [89.5, 89.5, 88, 88],
    [88, 89, 87.5, 89],
    [89, 89.25, 87.75, 87.75],
    [87.75, 87.75, 86.25, 86.25],
    [86.25, 86.25, 84.75, 84.75],
    [84.75, 84.75, 83.25, 83.25],
    [83.25, 83.25, 81.75, 81.75],
    [81.75, 81.75, 80.25, 80.25],
    [80.25, 81.75, 80.25, 81.75],
    [81.75, 82, 80.5, 80.5],
    [80.5, 81.5, 80, 81.5],
    [81.5, 83, 81.5, 83],
    [83, 84.5, 83, 84.5],
    [84.5, 86, 84.5, 86],
    [86, 87.5, 86, 87.5],
    [87.5, 88.5, 87, 88.5],
    [88.5, 88.75, 87.25, 87.25],
    [87.25, 87.25, 85.75, 85.75],
    [85.75, 85.75, 84.25, 84.25],
    [84.25, 85, 83.5, 85],
    [85, 86.5, 85, 86.5],
    [86.5, 88, 86.5, 88],
    [88, 89.5, 88, 89.5],
    [89.5, 90, 88.5, 88.5],
    [88.5, 89.5, 88, 89.5],
    [89.5, 89.5, 88, 88],
    [88, 88, 86.5, 86.5],
    [86.5, 86.5, 85, 85],
    [85, 85, 83.5, 83.5],
    [83.5, 84.25, 82.75, 84.25],
    [84.25, 84.25, 82.75, 82.75],
    [82.75, 82.75, 81.25, 81.25],
    [81.25, 81.25, 79.75, 79.75],
    [79.75, 79.75, 78.25, 78.25],
    [78.25, 78.75, 77.25, 78.75],
    [78.75, 79.25, 78.75, 79.25]
  ] as Array<[number, number, number, number]>,
  kagi: [
    [98, 107, 98, 107],
    [107, 107, 100, 100],
    [100, 102.25, 100, 102.25],
    [102.25, 102.25, 99.25, 99.25],
    [99.25, 101.25, 99.25, 101.25],
    [101.25, 101.25, 93.25, 93.25],
    [93.25, 104.75, 93.25, 104.75],
    [104.75, 104.75, 82, 82],
    [82, 87, 82, 87],
    [87, 87, 84.5, 84.5],
    [84.5, 88, 84.5, 88],
    [88, 88, 79.25, 79.25]
  ] as Array<[number, number, number, number]>
}

const DAY = 86_400_000
const T0 = 1_700_000_000_000

function toBars (rows: Array<[number, number, number, number]>, volume = 100): MarketBar[] {
  return rows.map(([open, high, low, close], i) => ({ timestamp: T0 + i * DAY, open, high, low, close, volume }))
}
function flat (bars: MarketBar[]): number[][] { return bars.map(bar => [bar.open, bar.high, bar.low, bar.close]) }
function closeTo (got: number[][], want: Array<[number, number, number, number]>): void {
  expect(got.length).toBe(want.length)
  got.forEach((row, i) => { row.forEach((value, k) => { expect(Math.abs(value - want[i][k])).toBeLessThan(1e-9) }) })
}
/** A bar that only matters through its close. */
function closes (values: number[]): MarketBar[] {
  return values.map((close, i) => ({ timestamp: T0 + i * DAY, open: close, high: close, low: close, close }))
}

describe('against the exact-arithmetic reference', () => {
  for (const [name, fixture] of [['a', A], ['b', B]] as const) {
    const bars = toBars(fixture.bars)
    it(`Renko, fixture ${name}`, () => { closeTo(flat(toRenko(bars, { size: fixture.size })), fixture.renko) })
    it(`line break (3 lines), fixture ${name}`, () => { closeTo(flat(toLineBreak(bars)), fixture.lineBreak) })
    it(`range bars, fixture ${name}`, () => { closeTo(flat(toRangeBars(bars, { size: fixture.size })), fixture.range) })
    it(`Kagi, fixture ${name}`, () => { closeTo(flat(toKagi(bars, { size: fixture.size })), fixture.kagi) })
  }
})

describe('Renko by hand', () => {
  it('starts on the lattice, one brick per size, reverses only after two', () => {
    // size 1, first close 10.4 -> anchor 10. 11.2: up brick 10->11. 11.9: nothing. 12.0: up 11->12.
    // 11.5: nothing (a reversal needs a close at or below 10). 10.0: down brick 11->10 (opens at the last brick's open).
    // 9.0: down 10->9.
    const out = toRenko(closes([10.4, 11.2, 11.9, 12, 11.5, 10, 9]), { size: 1 })
    expect(flat(out)).toEqual([[10, 11, 10, 11], [11, 12, 11, 12], [11, 11, 10, 10], [10, 10, 9, 9]])
  })

  it('a close that jumps several bricks makes all of them from one source bar, with strictly ascending times', () => {
    const out = toRenko(closes([10, 14.5]), { size: 1 })
    expect(out.map(bar => bar.close)).toEqual([11, 12, 13, 14])
    expect(out.every((bar, i) => i === 0 || bar.timestamp > out[i - 1].timestamp)).toBe(true)
    expect(out[0].timestamp).toBe(T0 + DAY)
    expect(out[3].timestamp).toBeLessThan(T0 + 2 * DAY)
  })

  it('shares volume over the marks and never loses it', () => {
    const bars = closes([10, 10.2, 14.5, 14.6]).map((bar, i) => ({ ...bar, volume: 100 * (i + 1) }))
    const out = toRenko(bars, { size: 1 })
    // 100 + 200 + 300 belong to the four marks made by bar 2; bar 3 made none, so its 400 is not in a mark yet.
    expect(out.reduce((sum, bar) => sum + (bar.volume ?? 0), 0)).toBe(600)
    expect(out.every(bar => bar.volume === 150)).toBe(true)
  })

  it('does not drift on long runs with a size that is not exact in binary', () => {
    const prices = Array.from({ length: 2000 }, (_, i) => 100 + i * 0.1)
    const out = toRenko(closes(prices), { size: 0.1 })
    expect(out.length).toBeGreaterThan(1990)
    for (const bar of out) expect(Math.abs(Math.abs(bar.close - bar.open) - 0.1)).toBeLessThan(1e-9)
  })
})

describe('line break by hand', () => {
  it('draws a line only for a new extreme, and reverses on a break of the last three lines', () => {
    // 11 makes the up line 10-11, 12 the up line 11-12, 11.5 is inside (nothing), 13 the up line 12-13.
    // The last three lines have lows 10, 11 and 12, so 9.5 is below all of them: a down line from 13 to 9.5.
    const out = toLineBreak(closes([10, 11, 12, 11.5, 13, 9.5]))
    expect(flat(out)).toEqual([[10, 11, 10, 11], [11, 12, 11, 12], [12, 13, 12, 13], [13, 13, 9.5, 9.5]])
  })

  it('a close inside the last lines draws nothing, and an equal close never draws the first line', () => {
    expect(toLineBreak(closes([10, 10, 10]))).toEqual([])
    const out = toLineBreak(closes([10, 11, 12, 11.5, 11.9]))
    expect(out.length).toBe(2)
  })

  it('needs fewer lines to reverse with a smaller depth', () => {
    // After the lines 10-11, 11-12 and 12-13, a close of 11.5 is not below the lowest low of the last three lines (10),
    // but it is below the low of the last line alone (12).
    const series = closes([10, 11, 12, 13, 11.5])
    expect(toLineBreak(series, { lines: 3 }).length).toBe(3)
    expect(flat(toLineBreak(series, { lines: 1 }))[3]).toEqual([13, 13, 11.5, 11.5])
  })
})

describe('range bars by hand', () => {
  it('finishes a bar when the path spans the size, opens the next one at the close and shows the forming bar', () => {
    // size 2, one up bar O1 L1 H5 C4: path 1, 1, 5, 4. 1..3 finishes the first bar (low 1, high 3, close 3);
    // the next bar opens at 3 and the path reaches 5, spanning 2: bar 3..5; then 4 stays inside the forming bar 5..4.
    const out = toRangeBars([{ timestamp: T0, open: 1, high: 5, low: 1, close: 4 }, { timestamp: T0 + DAY, open: 4, high: 4, low: 4, close: 4 }], { size: 2 })
    expect(flat(out)).toEqual([[1, 3, 1, 3], [3, 5, 3, 5], [5, 5, 4, 4]])
  })

  it('finished bars span exactly the size and open where the previous one closed', () => {
    const bars = toBars(A.bars)
    const out = toRangeBars(bars, { size: 2 })
    out.slice(0, -1).forEach((bar, i) => {
      expect(Math.abs(bar.high - bar.low - 2)).toBeLessThan(1e-9)
      if (i > 0) expect(Math.abs(bar.open - out[i - 1].close)).toBeLessThan(1e-9)
    })
  })
})

describe('Kagi by hand', () => {
  it('follows price, turns on a reversal of at least the size and keeps the line being drawn as the last bar', () => {
    // size 2: 10 -> 13 starts an up line from 10; 15 extends it; 14 is a 1 pullback (ignored); 12.9 is 2.1 down: turn.
    // The up line 10..15 is finished; a down line starts at 15; 11 extends it; 12.5 is a 1.5 bounce (ignored).
    const out = toKagi(closes([10, 13, 15, 14, 12.9, 11, 12.5]), { size: 2 })
    expect(flat(out)).toEqual([[10, 15, 10, 15], [15, 15, 11, 11]])
  })

  it('draws nothing while price has not moved by the size', () => {
    expect(toKagi(closes([10, 10.5, 11, 10.2]), { size: 2 })).toEqual([])
  })
})


/*
 * Point and figure. Two 25-bar random walks on a 0.25 price grid (exact in binary floating point). Expected columns come from
 * a separate implementation in exact rational arithmetic that fills explicit boxes one price at a time, for both the
 * close method and the high-low method.
 */
const P = {
  size: 1.25, reversal: 2,
  bars: [
    [165, 174, 163.75, 173.5],
    [173.5, 175, 171.75, 174.25],
    [174.25, 184.5, 174.25, 182],
    [182, 182, 180, 182],
    [182, 183.5, 171.75, 174],
    [174, 174.25, 173, 174.25],
    [174.25, 177.25, 169.5, 171.25],
    [171.25, 172, 167.75, 170.5],
    [170.5, 173.5, 164.75, 167],
    [167, 178.25, 165.5, 176.5],
    [176.5, 181.25, 175.75, 180.5],
    [180.5, 181, 170.75, 172.25],
    [172.25, 172.25, 165.5, 166],
    [166, 168.25, 156.5, 158.25],
    [158.25, 158.25, 151.25, 154],
    [154, 164.5, 151, 161.75],
    [161.75, 163.5, 156.25, 157],
    [157, 160, 155.5, 156.25],
    [156.25, 163.75, 155.75, 163.25],
    [163.25, 165.25, 159.5, 159.75],
    [159.75, 164.75, 159, 164.5],
    [164.5, 164.5, 155.75, 157.25],
    [157.25, 159.75, 153.25, 154.25],
    [154.25, 160.75, 152.75, 158.25],
    [158.25, 158.25, 150.25, 153]
  ] as Array<[number, number, number, number]>,
  close: [
    [172.5, 182.5, 172.5, 182.5],
    [181.25, 181.25, 166.25, 166.25],
    [167.5, 181.25, 167.5, 181.25],
    [180, 180, 153.75, 153.75],
    [155, 162.5, 155, 162.5],
    [161.25, 161.25, 156.25, 156.25],
    [157.5, 163.75, 157.5, 163.75],
    [162.5, 162.5, 158.75, 158.75],
    [160, 165, 160, 165],
    [163.75, 163.75, 153.75, 153.75],
    [155, 158.75, 155, 158.75],
    [157.5, 157.5, 152.5, 152.5]
  ],
  closeStart: [1, 4, 9, 11, 15, 16, 18, 19, 20, 21, 23, 24],
  highLow: [
    [165, 185, 165, 185],
    [183.75, 183.75, 171.25, 171.25],
    [172.5, 177.5, 172.5, 177.5],
    [176.25, 176.25, 163.75, 163.75],
    [165, 182.5, 165, 182.5],
    [181.25, 181.25, 150, 150],
    [151.25, 163.75, 151.25, 163.75],
    [162.5, 162.5, 155, 155],
    [156.25, 166.25, 156.25, 166.25],
    [165, 165, 152.5, 152.5],
    [153.75, 161.25, 153.75, 161.25],
    [160, 160, 150, 150]
  ],
  highLowStart: [0, 3, 5, 7, 9, 11, 16, 17, 18, 20, 23, 24]
}
const Q = {
  size: 1.0, reversal: 3,
  bars: [
    [53, 58.75, 51, 56.5],
    [56.5, 59.25, 55.25, 58.75],
    [58.75, 62.25, 58.25, 60.25],
    [60.25, 62.75, 59.25, 61.5],
    [61.5, 69.25, 61, 68.75],
    [68.75, 69.25, 63.25, 63.75],
    [63.75, 66, 54.25, 57.25],
    [57.25, 57.75, 50, 51],
    [51, 59.25, 48.75, 57],
    [57, 59, 48.25, 50],
    [50, 54.75, 48, 53],
    [53, 55.75, 43.25, 43.25],
    [43.25, 44.75, 40.25, 40.75],
    [40.75, 43.75, 38.25, 38.25],
    [38.25, 39.5, 35, 35.75],
    [35.75, 37.5, 26.25, 28.5],
    [28.5, 32.25, 27.25, 30.75],
    [30.75, 38.75, 30.75, 35.75],
    [35.75, 38.25, 32.75, 32.75],
    [32.75, 39, 32, 37],
    [37, 39.25, 27.5, 28],
    [28, 28.25, 23.25, 24.25],
    [24.25, 27.25, 15.5, 16.75],
    [16.75, 18, 7, 9.5],
    [9.5, 11, 0.25, 2]
  ] as Array<[number, number, number, number]>,
  close: [
    [56, 69, 56, 69],
    [68, 68, 51, 51],
    [52, 58, 52, 58],
    [57, 57, 50, 50],
    [51, 54, 51, 54],
    [53, 53, 28, 28],
    [29, 36, 29, 36],
    [35, 35, 32, 32],
    [33, 38, 33, 38],
    [37, 37, 2, 2]
  ],
  closeStart: [1, 5, 8, 9, 10, 11, 17, 18, 19, 20],
  highLow: [
    [53, 63, 53, 63],
    [62, 62, 59, 59],
    [60, 70, 60, 70],
    [69, 69, 48, 48],
    [49, 60, 49, 60],
    [59, 59, 26, 26],
    [27, 39, 27, 39],
    [38, 38, 32, 32],
    [33, 40, 33, 40],
    [39, 39, 0, 0]
  ],
  highLowStart: [0, 3, 4, 5, 9, 10, 16, 18, 19, 20]
}

describe('point and figure against the exact-arithmetic reference', () => {
  for (const [name, fixture] of [['p', P], ['q', Q]] as const) {
    it(`fixture ${name}: close method and high-low method give the reference columns, timed at the bar that started each`, () => {
      const bars = toBars(fixture.bars)
      const byClose = toPointAndFigure(bars, { size: fixture.size, reversal: fixture.reversal })
      closeTo(flat(byClose), fixture.close as Array<[number, number, number, number]>)
      expect(byClose.map(bar => bar.timestamp)).toEqual(fixture.closeStart.map(i => T0 + i * DAY))
      const byRange = toPointAndFigure(bars, { size: fixture.size, reversal: fixture.reversal, method: 'high-low' })
      closeTo(flat(byRange), fixture.highLow as Array<[number, number, number, number]>)
      expect(byRange.map(bar => bar.timestamp)).toEqual(fixture.highLowStart.map(i => T0 + i * DAY))
    })
  }
})

describe('point and figure by hand', () => {
  const walk = closes([10.5, 11.2, 13.1, 12.0, 10.2, 9.5, 11.9, 12.1])
  it('grows a column of X while price makes new boxes, turns after the reversal and grows the column of O', () => {
    // Column 1: X in boxes 10-13. 12.0 is not 3 boxes below the top (13), 10.2 is: column 2, O from box 12 down to 9.
    // 11.9 is only 2 boxes above the bottom (9); 12.1 is 3: column 3, X from box 10 to 12.
    closeTo(flat(toPointAndFigure(walk, { size: 1 })), [[10, 14, 10, 14], [13, 13, 9, 9], [10, 13, 10, 13]])
  })
  it('a smaller reversal turns sooner, a larger one later', () => {
    closeTo(flat(toPointAndFigure(closes([10.5, 13.2, 11.9, 12.5, 10.1]), { size: 1, reversal: 2 })), [[10, 14, 10, 14], [13, 13, 10, 10]])
    // With 3 boxes needed, 11.9 (two below the top box 13) and 10.1 (box 10, three below) differ: only the second turns.
    closeTo(flat(toPointAndFigure(closes([10.5, 13.2, 11.9, 12.5, 10.1]), { size: 1, reversal: 3 })), [[10, 14, 10, 14], [13, 13, 10, 10]])
    closeTo(flat(toPointAndFigure(closes([10.5, 13.2, 11.9, 12.5, 10.1]), { size: 1, reversal: 4 })), [[10, 14, 10, 14]])
  })
  it('draws nothing until price leaves the first box, and the first column may go down', () => {
    expect(toPointAndFigure(closes([10.1, 10.9, 10.4]), { size: 1 })).toEqual([])
    closeTo(flat(toPointAndFigure(closes([10.5, 9.8, 8.2]), { size: 1 })), [[11, 11, 8, 8]])
  })
  it('the high-low method uses highs while X grows and lows while O grows, and extending beats reversing', () => {
    const bars: MarketBar[] = [
      { timestamp: T0, open: 10.5, high: 10.9, low: 10.1, close: 10.5 },
      { timestamp: T0 + DAY, open: 10.5, high: 12.5, low: 10.5, close: 11 },
      // High reaches box 14 and low box 10: the bar extends the column of X; it does not also reverse it.
      { timestamp: T0 + 2 * DAY, open: 11, high: 14.2, low: 10.1, close: 12 },
      { timestamp: T0 + 3 * DAY, open: 12, high: 12.5, low: 10.9, close: 11 }
    ]
    closeTo(flat(toPointAndFigure(bars, { size: 1, method: 'high-low' })), [[10, 15, 10, 15], [14, 14, 10, 10]])
    // Closes alone: 11 then 12 grow the column to box 12, and 11 later is nowhere near a reversal.
    closeTo(flat(toPointAndFigure(bars, { size: 1 })), [[10, 13, 10, 13]])
  })
  it('lands exactly on a box edge without float noise, on a size that is not exact in binary', () => {
    const size = 0.1
    const prices = Array.from({ length: 40 }, (_, i) => i * size)
    const out = toPointAndFigure(closes(prices), { size })
    expect(out.length).toBe(1)
    expect(out[0].close).toBeCloseTo(4, 9)
  })
  it('refuses unusable input visibly', () => {
    expect(() => toPointAndFigure(closes([1, 2]), { size: 1, reversal: 0 })).toThrow(RangeError)
    expect(() => toPointAndFigure(closes([1, 2]), { size: 1, reversal: 2.5 })).toThrow(RangeError)
    expect(() => toPointAndFigure(closes([1, 2]), { size: 1, method: 'open' as never })).toThrow(RangeError)
    expect(() => toPointAndFigure(closes([1, 2]), { size: 0 })).toThrow(RangeError)
    expect(toPointAndFigure([], { size: 1 })).toEqual([])
  })
})

describe('input handling', () => {
  it('returns an empty list for no bars and rejects unusable input visibly', () => {
    for (const style of ['renko', 'line-break', 'range', 'kagi', 'point-figure'] as DerivedStyle[]) expect(deriveBars(style, [], { size: 1 })).toEqual([])
    expect(() => toRenko(closes([10, 11]), { size: 0 })).toThrow(RangeError)
    expect(() => toRenko(closes([10, 11]), { size: Number.NaN })).toThrow(RangeError)
    expect(() => toLineBreak(closes([10, 11]), { lines: 0 })).toThrow(RangeError)
    expect(() => toRenko([{ timestamp: 2, open: 1, high: 1, low: 1, close: 1 }, { timestamp: 1, open: 1, high: 1, low: 1, close: 1 }], { size: 1 })).toThrow(RangeError)
    expect(() => toKagi(closes([10, Number.NaN]), { size: 1 })).toThrow(RangeError)
    expect(() => deriveBars('nope' as DerivedStyle, closes([1, 2]), { size: 1 })).toThrow(TypeError)
  })

  it('asks for a larger size when one bar would make more marks than it has milliseconds, and refuses absurd mark counts', () => {
    const bars: MarketBar[] = [{ timestamp: 0, open: 0, high: 0, low: 0, close: 0 }, { timestamp: 3, open: 0, high: 10, low: 0, close: 10 }]
    expect(() => toRenko(bars, { size: 1 })).toThrow(/larger size/)
    expect(() => toRenko([{ timestamp: 0, open: 0, high: 0, low: 0, close: 0 }, { timestamp: 1e12, open: 0, high: 1e9, low: 0, close: 1e9 }], { size: 1e-3 })).toThrow(/too many marks/)
  })

  it('averageTrueRange is the Wilder average, falls back to the mean with few bars and refuses flat prices', () => {
    const bars: MarketBar[] = [
      { timestamp: 1, open: 10, high: 12, low: 9, close: 11 },
      { timestamp: 2, open: 11, high: 14, low: 10, close: 13 }
    ]
    // true ranges: 3, then max(4, |14-11|, |10-11|) = 4: mean 3.5
    expect(averageTrueRange(bars)).toBeCloseTo(3.5, 12)
    expect(() => averageTrueRange(closes([5, 5, 5]))).toThrow(/flat/)
  })
})

describe('createDerivedSeriesPort', () => {
  function walk (count: number, seed = 7): MarketBar[] {
    let state = seed, price = 100
    const next = (): number => { state = (state * 1664525 + 1013904223) % 4294967296; return state / 4294967296 }
    return Array.from({ length: count }, (_, i) => {
      const open = price, close = Math.max(1, open + (next() - 0.5) * 6)
      price = close
      return { timestamp: T0 + i * 60_000, open, high: Math.max(open, close) + next() * 2, low: Math.min(open, close) - next() * 2, close, volume: 100 + Math.floor(next() * 50) }
    })
  }

  for (const style of ['renko', 'line-break', 'range', 'kagi', 'point-figure'] as DerivedStyle[]) {
    it(`${style}: the chart always holds a fresh derivation and live ticks never reset it`, () => {
      const series = new RealtimeSeries({ referenceIndicators: false })
      const port = createDerivedSeriesPort(series)
      const kinds: string[] = []
      series.subscribe(change => { kinds.push(change.kind) })
      const raw = walk(120)
      port.applyNewData(raw.map(bar => ({ ...bar })), true)
      port.setStyle(style, style === 'line-break' ? {} : { size: 3 })
      const size = port.getStyle()?.size ?? undefined
      const options = style === 'line-break' ? {} : { size }
      const expectSame = (): void => {
        const want = deriveBars(style, raw, options), got = series.getDataList()
        expect(got.length).toBe(want.length)
        got.forEach((bar, i) => { for (const key of ['timestamp', 'open', 'high', 'low', 'close', 'volume']) expect(bar[key]).toBeCloseTo(want[i][key] as number, 9) })
      }
      expectSame()
      const resets = kinds.filter(kind => kind === 'reset').length
      const more = walk(160)
      for (let i = 120; i < 160; i++) {
        const bar = { ...more[i], timestamp: T0 + i * 60_000, open: raw[raw.length - 1].close }
        raw.push({ ...bar }); port.updateData({ ...bar }); expectSame()
        const last = raw[raw.length - 1], close = last.close + 1.7
        const tick = { ...last, close, high: Math.max(last.high, close), volume: (last.volume ?? 0) + 5 }
        raw[raw.length - 1] = tick; port.updateData({ ...tick }); expectSame()
      }
      expect(kinds.filter(kind => kind === 'reset').length).toBe(resets)
      // The loader keeps seeing the real bars.
      expect(port.getDataList().length).toBe(raw.length)
      expect(port.getLastTimestamp()).toBe(raw[raw.length - 1].timestamp)
      // Back to no style: the chart holds the real bars again.
      port.setStyle(null)
      expect(series.getDataList().length).toBe(raw.length)
    })
  }

  it('passes everything straight through when no style is set, and refuses replay truncation while one is', () => {
    const series = new RealtimeSeries({ referenceIndicators: false })
    const port = createDerivedSeriesPort(series)
    const raw = walk(30)
    port.applyNewData(raw.map(bar => ({ ...bar })), false)
    expect(series.getDataList().length).toBe(30)
    port.updateData({ ...raw[29], close: raw[29].close + 1 })
    expect(series.getDataList()[29].close).toBeCloseTo(raw[29].close + 1, 12)
    port.setStyle('renko', { size: 3 })
    expect(port.truncateData?.(10, 30, raw[29].timestamp)).toBe(false)
  })
})
