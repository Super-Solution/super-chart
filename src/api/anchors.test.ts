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

import { installReplayFutureAnchor, periodMs, pointToTime, timeToPoint } from './anchors'

const BAR_MS = 60_000
const dataList = (n: number): Array<{ timestamp: number }> => Array.from({ length: n }, (_, i) => ({ timestamp: i * BAR_MS }))

describe('periodMs', () => {
  it('resolves every recognised timespan', () => {
    expect(periodMs({ multiplier: 1, timespan: 'minute' })).toBe(60_000)
    expect(periodMs({ multiplier: 4, timespan: 'hour' })).toBe(4 * 3_600_000)
    expect(periodMs({ multiplier: 1, timespan: 'day' })).toBe(86_400_000)
  })

  it('is null for an unrecognised timespan, a bad multiplier, or nothing', () => {
    expect(periodMs({ multiplier: 1, timespan: 'fortnight' as never })).toBeNull()
    expect(periodMs({ multiplier: 0, timespan: 'minute' })).toBeNull()
    expect(periodMs({ multiplier: -1, timespan: 'minute' })).toBeNull()
    expect(periodMs(null)).toBeNull()
    expect(periodMs(undefined)).toBeNull()
  })
})

describe('timeToPoint (SC-135)', () => {
  it('keeps a timestamp at or before the last loaded bar (klinecharts places this correctly on its own)', () => {
    const list = dataList(10)
    expect(timeToPoint(list[3].timestamp, list, { multiplier: 1, timespan: 'minute' })).toEqual({ timestamp: list[3].timestamp })
    expect(timeToPoint(list[9].timestamp, list, { multiplier: 1, timespan: 'minute' })).toEqual({ timestamp: list[9].timestamp })
  })

  it('extrapolates a future time to a bare dataIndex, never a timestamp klinecharts would clamp', () => {
    const list = dataList(10) // last bar at index 9, timestamp 9*BAR_MS
    const future = list[9].timestamp + 4 * BAR_MS
    const point = timeToPoint(future, list, { multiplier: 1, timespan: 'minute' })
    expect(point).toEqual({ dataIndex: 13 })
    expect('timestamp' in point).toBe(false)
  })

  it('falls back to the recent bar spacing when no period is given', () => {
    const list = dataList(10)
    const future = list[9].timestamp + 2 * BAR_MS
    expect(timeToPoint(future, list, null)).toEqual({ dataIndex: 11 })
  })

  it('keeps the raw timestamp when there is nothing loaded to anchor a dataIndex against', () => {
    expect(timeToPoint(12345, [], { multiplier: 1, timespan: 'minute' })).toEqual({ timestamp: 12345 })
  })
})

describe('pointToTime (inverse of timeToPoint)', () => {
  it('a timestamp point round-trips exactly', () => {
    const list = dataList(10)
    expect(pointToTime({ timestamp: list[3].timestamp }, list, null)).toBe(list[3].timestamp)
  })

  it('a dataIndex within the loaded range resolves to that bar\'s own timestamp', () => {
    const list = dataList(10)
    expect(pointToTime({ dataIndex: 5 }, list, null)).toBe(list[5].timestamp)
  })

  it('a dataIndex past the last bar extrapolates by the period', () => {
    const list = dataList(10)
    expect(pointToTime({ dataIndex: 13 }, list, { multiplier: 1, timespan: 'minute' })).toBe(list[9].timestamp + 4 * BAR_MS)
  })

  it('round-trips through timeToPoint for a future time', () => {
    const list = dataList(10)
    const period = { multiplier: 1, timespan: 'minute' as const }
    const future = list[9].timestamp + 7 * BAR_MS
    const point = timeToPoint(future, list, period)
    expect(pointToTime(point, list, period)).toBe(future)
  })

  it('is null with nothing loaded', () => {
    expect(pointToTime({ dataIndex: 3 }, [], null)).toBeNull()
    expect(pointToTime({}, [], null)).toBeNull()
  })
})

describe('installReplayFutureAnchor (SC-178)', () => {
  function fakeWidget (dataListValue: Array<{ timestamp: number }>): {
    widget: { getChartStore: () => { getTimeScaleStore: () => { timestampToDataIndex: (t: number) => number } }, getDataList: () => Array<{ timestamp: number }> }
    original: (t: number) => number
  } {
    const original = (t: number): number => {
      // Mimics klinecharts' own clamp-to-second-to-last-bar behaviour for anything past the last bar.
      const last = dataListValue.length - 1
      const idx = dataListValue.findIndex(d => d.timestamp >= t)
      if (idx === -1) return Math.max(0, last - 1)
      return idx
    }
    const store = { timestampToDataIndex: original }
    return { widget: { getChartStore: () => ({ getTimeScaleStore: () => store }), getDataList: () => dataListValue }, original }
  }

  it('is a no-op (returns a no-op restorer) when the widget exposes no chart store', () => {
    const restore = installReplayFutureAnchor({}, () => ({ multiplier: 1, timespan: 'minute' }), () => true)
    expect(() => { restore() }).not.toThrow()
  })

  it('extrapolates a future timestamp instead of clamping it, only while replaying', () => {
    const list = dataList(10) // shown/sliced during "replay" in this test
    const { widget } = fakeWidget(list)
    let replaying = true
    const restore = installReplayFutureAnchor(widget, () => ({ multiplier: 1, timespan: 'minute' }), () => replaying)
    const future = list[9].timestamp + 4 * BAR_MS
    expect(widget.getChartStore().getTimeScaleStore().timestampToDataIndex(future)).toBe(13)
    // Once replay ends, the same timestamp goes back to the original (clamping) lookup.
    replaying = false
    expect(widget.getChartStore().getTimeScaleStore().timestampToDataIndex(future)).toBe(8) // original's clamp: length-2
    restore()
  })

  it('leaves an in-range timestamp to the original lookup even while replaying', () => {
    const list = dataList(10)
    const { widget, original } = fakeWidget(list)
    const restore = installReplayFutureAnchor(widget, () => ({ multiplier: 1, timespan: 'minute' }), () => true)
    const inRange = list[4].timestamp
    expect(widget.getChartStore().getTimeScaleStore().timestampToDataIndex(inRange)).toBe(original(inRange))
    restore()
  })

  it('restores the original (clamping) behaviour after uninstall, so a stale wrapper never survives', () => {
    const list = dataList(10)
    const { widget, original } = fakeWidget(list)
    const restore = installReplayFutureAnchor(widget, () => null, () => true)
    restore()
    const future = list[9].timestamp + 4 * BAR_MS
    // Once restored, the lookup clamps exactly like the original again — the
    // wrapper itself is gone, not merely disabled by its own isReplaying gate.
    expect(widget.getChartStore().getTimeScaleStore().timestampToDataIndex(future)).toBe(original(future))
  })
})
