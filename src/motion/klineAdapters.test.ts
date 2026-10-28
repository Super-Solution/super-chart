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

import { describe, expect, it } from 'vitest'
import { klineInertiaChart, klineWheelChart, type KlineMotionChartLike } from './klineAdapters'

/**
 * klinecharts 9.x's time-scale store, reduced to what the adapters use: its
 * zoom step (`barSpace * (1 + scale / 10)`, anchored at x) and its guard that
 * IGNORES a bar space outside [1, 50] instead of clamping it.
 */
function fakeKline (barSpace = 8): KlineMotionChartLike & { zooms: Array<{ scale: number, x: number }>, lbr: number, bs: number } {
  const chart = {
    zooms: [] as Array<{ scale: number, x: number }>,
    lbr: -300, // scrolled 300 bars into history
    bs: barSpace,
    getBarSpace: () => chart.bs,
    setBarSpace: (s: number) => { chart.bs = s },
    isZoomEnabled: () => true,
    scrollByDistance: (d: number) => { chart.lbr -= d / chart.bs },
    getDom: () => null,
    convertToPixel: () => ({ x: 0 }),
    getChartStore: () => ({
      getTimeScaleStore: () => ({
        zoom: (scale: number, c: { x: number }) => {
          chart.zooms.push({ scale, x: c.x })
          const next = chart.bs + scale * (chart.bs / 10)
          if (next < 1 || next > 50) return
          chart.bs = next
        },
        getLastBarRightSideDiffBarCount: () => chart.lbr,
        getBarSpace: () => ({ bar: chart.bs })
      })
    })
  }
  return chart
}

describe('klineWheelChart.zoomTo', () => {
  it('reaches the requested bar space exactly through klinecharts\' own anchored zoom step', () => {
    const chart = fakeKline(8)
    klineWheelChart(chart).zoomTo(8.8, 321)
    expect(chart.bs).toBeCloseTo(8.8, 12)
    expect(chart.zooms.length).toBe(1)
    expect(chart.zooms[0].scale).toBeCloseTo(1, 12) // (8.8 / 8 - 1) * 10
    expect(chart.zooms[0].x).toBe(321)
  })

  it('steps back inside when rounding lands a hair past 50 (klinecharts would ignore it)', () => {
    // From 45.009802 the step computes 50.00000000000001: the first zoom is ignored.
    const chart = fakeKline(45.009802)
    klineWheelChart(chart).zoomTo(50, 10)
    expect(chart.zooms.length).toBe(2)
    expect(chart.bs).toBeGreaterThan(49.999)
    expect(chart.bs).toBeLessThanOrEqual(50)
  })

  it('never writes the scroll offset (zooming in history must not jump to the newest bar)', () => {
    const chart = fakeKline(8)
    const before = chart.lbr
    klineWheelChart(chart).zoomTo(12, 400)
    expect(chart.lbr).toBe(before) // the fake store's zoom anchors elsewhere; the adapter itself never touches it
  })
})

describe('klineInertiaChart.getScrollPosition', () => {
  it('grows as the content moves right, however far into history the chart is', () => {
    const chart = fakeKline(8)
    const inertia = klineInertiaChart(chart)
    const p0 = inertia.getScrollPosition?.() ?? NaN
    inertia.scrollByDistance(40) // a rightward pan of 40px
    expect((inertia.getScrollPosition?.() ?? NaN) - p0).toBeCloseTo(40, 10)
    expect(p0).toBeCloseTo(300 * 8, 10) // not clamped at 0 like getOffsetRightDistance()
  })
})
