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
import {
  CHART_TYPE_GROUPS, DEFAULT_FAVOURITE_CHART_TYPES, GROUPED_CHART_TYPES, chartTypeLabel, chartTypeOrderIsComplete,
  isGroupedChartType, loadFavourites, saveFavourites, toggleFavourite
} from './chartTypes'
import { CHART_TYPES, type ChartType } from '../types'

describe('CHART_TYPE_GROUPS', () => {
  it('every group type has a distinct, non-empty label in every built-in locale', () => {
    for (const group of CHART_TYPE_GROUPS) {
      for (const type of group.types) {
        for (const locale of ['en-US', 'zh-CN', 'zh-TW']) {
          const label = chartTypeLabel(type, locale)
          expect(label.length).toBeGreaterThan(0)
        }
      }
    }
  })

  it('the four groups match SC-NEXT #2\'s curated set exactly: Candles, Bars, Lines, Areas', () => {
    expect(CHART_TYPE_GROUPS.map(g => g.id)).toEqual(['candles', 'bars', 'lines', 'areas'])
    expect(CHART_TYPE_GROUPS.find(g => g.id === 'candles')?.types).toEqual(['candle_solid', 'candle_stroke', 'heikin_ashi'])
    expect(CHART_TYPE_GROUPS.find(g => g.id === 'bars')?.types).toEqual(['ohlc', 'volume_bars', 'columns', 'high_low'])
    expect(CHART_TYPE_GROUPS.find(g => g.id === 'lines')?.types).toEqual(['line', 'line_markers', 'step_line'])
    expect(CHART_TYPE_GROUPS.find(g => g.id === 'areas')?.types).toEqual(['area', 'hlc_area', 'baseline'])
  })

  it('every grouped type is a real ChartType, and no type appears in two groups', () => {
    const seen = new Set<ChartType>()
    for (const type of GROUPED_CHART_TYPES) {
      expect((CHART_TYPES as readonly string[]).includes(type)).toBe(true)
      expect(seen.has(type)).toBe(false)
      seen.add(type)
    }
  })

  it('isGroupedChartType agrees with GROUPED_CHART_TYPES membership, and rejects a non-grouped type like candle_up_stroke', () => {
    expect(isGroupedChartType('heikin_ashi')).toBe(true)
    expect(isGroupedChartType('candle_up_stroke')).toBe(false)
    expect(isGroupedChartType('not_a_type')).toBe(false)
  })
})

describe('chartTypeOrderIsComplete still holds with the SC-NEXT additions', () => {
  it('CHART_TYPE_ORDER lists every CHART_TYPES value exactly once', () => {
    expect(chartTypeOrderIsComplete()).toBe(true)
  })
})

describe('favourites', () => {
  it('toggleFavourite adds an absent type and removes a present one, immutably', () => {
    const start = new Set<ChartType>(['candle_solid'])
    const added = toggleFavourite(start, 'heikin_ashi')
    expect(added.has('heikin_ashi')).toBe(true)
    expect(start.has('heikin_ashi')).toBe(false) // original untouched
    const removed = toggleFavourite(added, 'candle_solid')
    expect(removed.has('candle_solid')).toBe(false)
    expect(removed.has('heikin_ashi')).toBe(true)
  })

  function memoryStorage (): Storage {
    const map = new Map<string, string>()
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => { map.set(k, v) },
      removeItem: (k: string) => { map.delete(k) },
      clear: () => { map.clear() },
      key: () => null,
      get length () { return map.size }
    } as unknown as Storage
  }

  it('loadFavourites defaults to DEFAULT_FAVOURITE_CHART_TYPES with no storage, empty storage, or garbage JSON', () => {
    expect(loadFavourites(null)).toEqual(new Set(DEFAULT_FAVOURITE_CHART_TYPES))
    expect(loadFavourites(memoryStorage())).toEqual(new Set(DEFAULT_FAVOURITE_CHART_TYPES))
    const storage = memoryStorage()
    storage.setItem('klinecharts-pro-chart-type-favourites', 'not json{{{')
    expect(loadFavourites(storage)).toEqual(new Set(DEFAULT_FAVOURITE_CHART_TYPES))
  })

  it('round-trips through saveFavourites/loadFavourites', () => {
    const storage = memoryStorage()
    saveFavourites(storage, new Set<ChartType>(['ohlc', 'baseline']))
    expect(loadFavourites(storage)).toEqual(new Set(['ohlc', 'baseline']))
  })

  it('drops unknown type names from persisted JSON rather than trusting them', () => {
    const storage = memoryStorage()
    storage.setItem('klinecharts-pro-chart-type-favourites', JSON.stringify(['ohlc', 'not_a_real_type', 123]))
    expect(loadFavourites(storage)).toEqual(new Set(['ohlc']))
  })

  it('saveFavourites never throws even if storage.setItem throws (private mode / quota)', () => {
    const angry: Pick<Storage, 'setItem'> = { setItem: () => { throw new Error('quota') } }
    expect(() => { saveFavourites(angry, new Set(['ohlc'])) }).not.toThrow()
  })
})
