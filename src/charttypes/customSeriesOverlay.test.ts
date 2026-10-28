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

// createPointFigures itself (the actual drawing) is verified in the browser
// (e2e/tests/motion.spec.ts), matching how SC_VRVP/anchoredVWAP's drawing is
// verified elsewhere in this codebase — this file covers the pure kind
// classification and the overlay's create/update/remove lifecycle, the same
// split countdown.test.ts and highLowTags.test.ts use.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CUSTOM_SERIES_KINDS, _resetCustomSeriesRegistrationForTest, attachCustomSeriesOverlay, hidesNativeCandle,
  isCustomSeriesKind, type CustomSeriesChart
} from './customSeriesOverlay'

beforeEach(() => { _resetCustomSeriesRegistrationForTest() })

describe('isCustomSeriesKind / hidesNativeCandle', () => {
  it('recognises every CUSTOM_SERIES_KINDS entry and nothing else', () => {
    for (const kind of CUSTOM_SERIES_KINDS) expect(isCustomSeriesKind(kind)).toBe(true)
    expect(isCustomSeriesKind('candle_solid')).toBe(false)
    expect(isCustomSeriesKind('line')).toBe(false)
    expect(isCustomSeriesKind('not_a_type')).toBe(false)
  })

  it('every kind hides the native candle except line_markers', () => {
    for (const kind of CUSTOM_SERIES_KINDS) {
      expect(hidesNativeCandle(kind)).toBe(kind !== 'line_markers')
    }
  })
})

function fakeChart (overrides: Partial<CustomSeriesChart> = {}): CustomSeriesChart & { overlays: Map<string, unknown> } {
  const overlays = new Map<string, unknown>()
  let seq = 0
  return {
    overlays,
    getDataList: () => [],
    createOverlay: value => {
      const id = `ov${++seq}`
      overlays.set(id, value)
      return id
    },
    overrideOverlay: ({ id, extendData }) => { overlays.set(id, { ...(overlays.get(id) as object), extendData }) },
    removeOverlay: remove => {
      const r = remove as { id?: string } | undefined
      if (r?.id !== undefined) overlays.delete(r.id)
      else overlays.clear()
    },
    ...overrides
  }
}

describe('attachCustomSeriesOverlay', () => {
  it('creates nothing while getKind() returns null', () => {
    const chart = fakeChart()
    const attached = attachCustomSeriesOverlay(chart, { getKind: () => null, registerOverlay: vi.fn() })
    expect(chart.overlays.size).toBe(0)
    attached.dispose()
  })

  it('creates the overlay with the current kind once getKind() returns one', () => {
    const chart = fakeChart()
    let kind: 'columns' | null = null
    const attached = attachCustomSeriesOverlay(chart, { getKind: () => kind, registerOverlay: vi.fn() })
    expect(chart.overlays.size).toBe(0)
    kind = 'columns'
    attached.refresh()
    expect(chart.overlays.size).toBe(1)
    const [[, overlay]] = chart.overlays
    expect((overlay as { extendData: { kind: string } }).extendData.kind).toBe('columns')
    attached.dispose()
  })

  it('switching between two kinds updates extendData on the SAME overlay id (no teardown/recreate)', () => {
    const chart = fakeChart()
    let kind: 'columns' | 'baseline' = 'columns'
    const attached = attachCustomSeriesOverlay(chart, { getKind: () => kind, registerOverlay: vi.fn() })
    const [id] = [...chart.overlays.keys()]
    kind = 'baseline'
    attached.refresh()
    expect([...chart.overlays.keys()]).toEqual([id])
    expect((chart.overlays.get(id) as { extendData: { kind: string } }).extendData.kind).toBe('baseline')
    attached.dispose()
  })

  it('leaving every custom-series kind removes the overlay', () => {
    const chart = fakeChart()
    let kind: 'columns' | null = 'columns'
    const attached = attachCustomSeriesOverlay(chart, { getKind: () => kind, registerOverlay: vi.fn() })
    expect(chart.overlays.size).toBe(1)
    kind = null
    attached.refresh()
    expect(chart.overlays.size).toBe(0)
    attached.dispose()
  })

  it('re-creates the overlay if a host wipes every overlay while a custom kind is still active', async () => {
    const chart = fakeChart()
    const attached = attachCustomSeriesOverlay(chart, { getKind: () => 'high_low', registerOverlay: vi.fn() })
    expect(chart.overlays.size).toBe(1)
    const [id] = [...chart.overlays.keys()]
    const overlay = chart.overlays.get(id) as { onRemoved?: () => boolean }
    chart.removeOverlay()
    expect(chart.overlays.size).toBe(0)
    overlay.onRemoved?.()
    await Promise.resolve()
    expect(chart.overlays.size).toBe(1)
    attached.dispose()
  })

  it('registerOverlay is only called once even across multiple attach calls (idempotent registration)', () => {
    const registerOverlay = vi.fn()
    const chartA = fakeChart()
    const chartB = fakeChart()
    const a = attachCustomSeriesOverlay(chartA, { getKind: () => 'columns', registerOverlay })
    const b = attachCustomSeriesOverlay(chartB, { getKind: () => 'baseline', registerOverlay })
    expect(registerOverlay).toHaveBeenCalledTimes(1)
    a.dispose()
    b.dispose()
  })

  it('dispose removes the overlay and stops the onRemoved auto re-create', async () => {
    const chart = fakeChart()
    const attached = attachCustomSeriesOverlay(chart, { getKind: () => 'columns', registerOverlay: vi.fn() })
    const [id] = [...chart.overlays.keys()]
    const overlay = chart.overlays.get(id) as { onRemoved?: () => boolean }
    attached.dispose()
    expect(chart.overlays.size).toBe(0)
    overlay.onRemoved?.() // simulate klinecharts firing it during teardown
    await Promise.resolve()
    expect(chart.overlays.size).toBe(0) // must not resurrect after dispose
  })
})
