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

import { createAnnotationsApi, resolveTone, type AnnotationSpec, type AnnotationsRawChart } from './annotations'
import { FakeAnchorChart } from './testkit'

const PERIOD = { multiplier: 1, timespan: 'minute' as const, text: '1m' }

function makeApi (chart: FakeAnchorChart): ReturnType<typeof createAnnotationsApi> {
  return createAnnotationsApi({
    getChart: () => chart as unknown as AnnotationsRawChart,
    getTheme: () => 'light',
    getPeriod: () => PERIOD
  })
}

const LEVEL: AnnotationSpec = { key: 'r1', kind: 'level', anchors: [{ time: 0, price: 100 }], tone: 'bear' }

describe('resolveTone', () => {
  it('resolves a tone against the theme palette, and an explicit colour wins', () => {
    expect(resolveTone('light', 'bull', undefined)).toMatch(/^(#|rgba?)/)
    expect(resolveTone('light', 'accent', undefined)).not.toBe(resolveTone('light', 'bear', undefined))
    expect(resolveTone('light', 'bull', '#abcdef')).toBe('#abcdef')
  })
})

describe('createAnnotationsApi.setAnnotations (SC-128)', () => {
  it('creates one overlay per key, namespaced by layer', () => {
    const chart = new FakeAnchorChart()
    const api = makeApi(chart)
    const result = api.setAnnotations('ai', [LEVEL])
    expect(result.applied).toEqual(['sc:ann:ai:r1'])
    expect(result.rejected).toEqual([])
    const overlay = chart.getOverlayById('sc:ann:ai:r1')
    expect(overlay?.name).toBe('priceLine')
    expect(overlay?.groupId).toBe('sc:ann:ai')
    // Never a user drawing: locked by default (addHostOverlay's contract).
    expect(overlay?.lock).toBe(true)
  })

  it('identical specs make no further create/remove/override call at all', () => {
    const chart = new FakeAnchorChart()
    const api = makeApi(chart)
    api.setAnnotations('ai', [LEVEL])
    const callsAfterFirst = chart.calls.length
    const result = api.setAnnotations('ai', [{ ...LEVEL }])
    expect(chart.calls.length).toBe(callsAfterFirst)
    expect(result.applied).toEqual(['sc:ann:ai:r1'])
  })

  it('one changed field is exactly one override call', () => {
    const chart = new FakeAnchorChart()
    const api = makeApi(chart)
    api.setAnnotations('ai', [LEVEL])
    const overridesBefore = chart.calls.filter(c => c.method === 'overrideOverlay').length
    api.setAnnotations('ai', [{ ...LEVEL, anchors: [{ time: 0, price: 105 }] }])
    const overridesAfter = chart.calls.filter(c => c.method === 'overrideOverlay').length
    expect(overridesAfter - overridesBefore).toBe(1)
    expect(chart.getOverlayById('sc:ann:ai:r1')?.points[0]).toMatchObject({ value: 105 })
  })

  it('a kind change under the same key is a remove + create, not an override', () => {
    const chart = new FakeAnchorChart()
    const api = makeApi(chart)
    api.setAnnotations('ai', [LEVEL])
    const originalId = 'sc:ann:ai:r1'
    api.setAnnotations('ai', [{ key: 'r1', kind: 'marker', anchors: [{ time: 0, price: 100 }] }])
    expect(chart.getOverlayById(originalId)?.name).toBe('simpleAnnotation')
    const removeCalls = chart.calls.filter(c => c.method === 'removeOverlay')
    const createCalls = chart.calls.filter(c => c.method === 'createOverlay')
    expect(removeCalls.length).toBeGreaterThanOrEqual(1)
    expect(createCalls.length).toBe(2) // the original 'level' create, then the 'marker' recreate
  })

  it('a key missing from the next call is removed', () => {
    const chart = new FakeAnchorChart()
    const api = makeApi(chart)
    api.setAnnotations('ai', [LEVEL])
    api.setAnnotations('ai', [])
    expect(chart.getOverlayById('sc:ann:ai:r1')).toBeNull()
  })

  it('rejects a duplicate key within one call, keeping the first', () => {
    const chart = new FakeAnchorChart()
    const api = makeApi(chart)
    const result = api.setAnnotations('ai', [LEVEL, { ...LEVEL, anchors: [{ time: 0, price: 999 }] }])
    expect(result.rejected).toEqual([{ key: 'r1', code: 'duplicate_key' }])
    expect(chart.getOverlayById('sc:ann:ai:r1')?.points[0]).toMatchObject({ value: 100 })
  })

  it('rejects a bad anchor (missing price for a level/marker)', () => {
    const chart = new FakeAnchorChart()
    const api = makeApi(chart)
    const result = api.setAnnotations('ai', [{ key: 'bad', kind: 'level', anchors: [{ time: 0 }] }])
    expect(result.rejected).toEqual([{ key: 'bad', code: 'bad_anchor' }])
  })

  it('rejects an unknown kind', () => {
    const chart = new FakeAnchorChart()
    const api = makeApi(chart)
    const result = api.setAnnotations('ai', [{ key: 'x', kind: 'nonsense' as never, anchors: [{ time: 0, price: 1 }] }])
    expect(result.rejected).toEqual([{ key: 'x', code: 'unknown_kind' }])
  })

  it('a zone needs two distinct anchors', () => {
    const chart = new FakeAnchorChart()
    const api = makeApi(chart)
    const same = api.setAnnotations('ai', [{ key: 'z', kind: 'zone', anchors: [{ time: 0, price: 1 }, { time: 0, price: 1 }] }])
    expect(same.rejected).toEqual([{ key: 'z', code: 'out_of_range' }])
    const ok = api.setAnnotations('ai', [{ key: 'z', kind: 'zone', anchors: [{ time: 0, price: 1 }, { time: 60_000, price: 2 }] }])
    expect(ok.applied).toEqual(['sc:ann:ai:z'])
  })

  it('two layers never collide on the same key', () => {
    const chart = new FakeAnchorChart()
    const api = makeApi(chart)
    api.setAnnotations('host', [LEVEL])
    api.setAnnotations('ai', [LEVEL])
    expect(chart.getOverlayById('sc:ann:host:r1')).not.toBeNull()
    expect(chart.getOverlayById('sc:ann:ai:r1')).not.toBeNull()
  })
})

describe('createAnnotationsApi.getAnnotations / clearAnnotations', () => {
  it('getAnnotations echoes exactly what was set, per layer or across all', () => {
    const chart = new FakeAnchorChart()
    const api = makeApi(chart)
    api.setAnnotations('ai', [LEVEL])
    expect(api.getAnnotations('ai')).toEqual([LEVEL])
    expect(api.getAnnotations('host')).toEqual([])
    expect(api.getAnnotations()).toEqual([LEVEL])
  })

  it('clearAnnotations removes every overlay in that layer by groupId, and only that layer', () => {
    const chart = new FakeAnchorChart()
    const api = makeApi(chart)
    api.setAnnotations('ai', [LEVEL, { key: 'r2', kind: 'marker', anchors: [{ time: 0, price: 1 }] }])
    api.setAnnotations('host', [LEVEL])
    api.clearAnnotations('ai')
    expect(chart.getOverlayById('sc:ann:ai:r1')).toBeNull()
    expect(chart.getOverlayById('sc:ann:ai:r2')).toBeNull()
    expect(chart.getOverlayById('sc:ann:host:r1')).not.toBeNull()
    expect(api.getAnnotations('ai')).toEqual([])
  })
})
