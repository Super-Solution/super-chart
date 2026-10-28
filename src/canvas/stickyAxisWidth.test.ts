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
import { attachStickyAxisWidth } from './stickyAxisWidth'

class Axis {
  natural = 60
  getAutoSize (): number { return this.natural }
}

function fakeChart (): { panes: Array<{ getId: () => string, getAxisComponent: () => unknown }>, size: unknown, axes: Axis[], getAllDrawPanes: () => Array<{ getId: () => string, getAxisComponent: () => unknown }>, getStyles: () => { yAxis: { size: unknown } } } {
  const candle = new Axis()
  const vol = new Axis()
  vol.natural = 40
  const xAxis = new Axis()
  xAxis.natural = 28 // a height
  const chart = {
    axes: [candle, vol, xAxis],
    size: 'auto' as unknown,
    panes: [
      { getId: () => 'candle_pane', getAxisComponent: () => candle },
      { getId: () => 'vol_pane', getAxisComponent: () => vol },
      { getId: () => 'x_axis_pane', getAxisComponent: () => xAxis }
    ],
    getAllDrawPanes: () => chart.panes,
    getStyles: () => ({ yAxis: { size: chart.size } })
  }
  return chart
}

describe('attachStickyAxisWidth', () => {
  it('only grows while the chart moves: narrower labels keep the widest width seen, on every pane', () => {
    const chart = fakeChart()
    const [candle, vol] = chart.axes
    attachStickyAxisWidth(chart)
    expect(candle.getAutoSize()).toBe(60)
    candle.natural = 66 // panned across 100,000
    expect(candle.getAutoSize()).toBe(66)
    candle.natural = 58 // and back
    expect(candle.getAutoSize()).toBe(66)
    expect(vol.getAutoSize()).toBe(66) // klinecharts takes the max over panes: all agree
  })

  it('reset() lets the next layout fit the labels (a new symbol or period)', () => {
    const chart = fakeChart()
    const [candle] = chart.axes
    const sticky = attachStickyAxisWidth(chart)
    candle.natural = 80
    candle.getAutoSize()
    candle.natural = 50
    expect(candle.getAutoSize()).toBe(80)
    sticky.reset()
    expect(candle.getAutoSize()).toBe(50)
  })

  it('never touches the x-axis, never overrides a fixed yAxis.size, and dispose restores the axes', () => {
    const chart = fakeChart()
    const [candle, , xAxis] = chart.axes
    const sticky = attachStickyAxisWidth(chart)
    candle.natural = 90
    candle.getAutoSize()
    expect(xAxis.getAutoSize()).toBe(28)
    chart.size = 70 // the host fixed the width
    candle.natural = 70
    expect(candle.getAutoSize()).toBe(70)
    sticky.dispose()
    expect(Object.prototype.hasOwnProperty.call(candle, 'getAutoSize')).toBe(false)
  })

  it('adopt() picks up panes added later, once', () => {
    const chart = fakeChart()
    const sticky = attachStickyAxisWidth(chart)
    const added = new Axis()
    added.natural = 100
    chart.panes.push({ getId: () => 'macd_pane', getAxisComponent: () => added })
    sticky.adopt()
    sticky.adopt()
    expect(added.getAutoSize()).toBe(100)
    expect(chart.axes[0].getAutoSize()).toBe(100)
  })
})
