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

// A minimal klinecharts test double for src/api/{drawings,annotations,anchors}.test.ts.
// Modelling: overlays keyed by id/groupId, `dataIndex`-based x (uniform pixel
// spacing per bar, the same assumption klinecharts' own linear time scale
// makes), and a linear or LOG y-axis (so drawingLevelsAt's geometric-midpoint
// claim is actually exercised). This is deliberately its own, smaller double —
// src/drawing-editor/fakeChart.ts (an earlier batch's, not owned here) models
// klinecharts' SELECTION/undo semantics in detail but never computes an x
// pixel from a point, which is exactly what drawingLevelsAt needs.
//
// Used only by tests.

export const FAKE_BAR_MS = 60_000
export const FAKE_PX_PER_BAR = 10

export interface FakeAnchorOverlay {
  id: string
  name: string
  points: Array<{ timestamp?: number, dataIndex?: number, value?: number }>
  styles?: unknown
  lock?: boolean
  visible?: boolean
  extendData?: unknown
  groupId?: string
  currentStep: number
}

export interface FakeLogAxis {
  min: number
  max: number
  height: number
}

export interface FakeAnchorChartOptions {
  /** Number of loaded bars (timestamps 0, FAKE_BAR_MS, ...). @default 20 */
  bars?: number
  /** A log y-axis instead of the default linear one. */
  logAxis?: FakeLogAxis
}

export class FakeAnchorChart {
  private _seq = 0
  readonly overlays = new Map<string, FakeAnchorOverlay>()
  readonly calls: Array<{ method: string, arg: unknown }> = []

  constructor (private readonly options: FakeAnchorChartOptions = {}) {}

  getDataList (): Array<{ timestamp: number, close: number }> {
    return Array.from({ length: this.options.bars ?? 20 }, (_, i) => ({ timestamp: i * FAKE_BAR_MS, close: 100 + i }))
  }

  createOverlay (create: Record<string, unknown>): string {
    this.calls.push({ method: 'createOverlay', arg: create })
    const id = (create.id as string | undefined) ?? `overlay_${++this._seq}`
    this.overlays.set(id, {
      id,
      name: create.name as string,
      points: [...((create.points as FakeAnchorOverlay['points']) ?? [])],
      styles: create.styles,
      lock: create.lock as boolean | undefined,
      visible: (create.visible as boolean | undefined) ?? true,
      extendData: create.extendData,
      groupId: create.groupId as string | undefined,
      currentStep: -1
    })
    return id
  }

  overrideOverlay (patch: Record<string, unknown>): boolean {
    this.calls.push({ method: 'overrideOverlay', arg: patch })
    const o = this.overlays.get(patch.id as string)
    if (o === undefined) {
      return false
    }
    if (patch.points !== undefined) o.points = patch.points as FakeAnchorOverlay['points']
    if (patch.styles !== undefined) o.styles = patch.styles
    if (patch.extendData !== undefined) o.extendData = patch.extendData
    if (patch.lock !== undefined) o.lock = patch.lock as boolean
    if (patch.visible !== undefined) o.visible = patch.visible as boolean
    return true
  }

  removeOverlay (query: { id?: string, groupId?: string }): boolean {
    this.calls.push({ method: 'removeOverlay', arg: query })
    let removed = false
    for (const [id, o] of [...this.overlays]) {
      if ((query.id !== undefined && id === query.id) || (query.groupId !== undefined && o.groupId === query.groupId)) {
        this.overlays.delete(id)
        removed = true
      }
    }
    return removed
  }

  getOverlayById (id: string): FakeAnchorOverlay | null {
    return this.overlays.get(id) ?? null
  }

  /** klinecharts' own binary-search-nearest, clamped to the loaded range (never extrapolated — that is the SC-135/178 bug this package works around). */
  private _dataIndexOf (point: { timestamp?: number, dataIndex?: number }): number {
    if (typeof point.dataIndex === 'number') {
      return point.dataIndex
    }
    if (typeof point.timestamp === 'number') {
      const bars = this.getDataList()
      const idx = Math.round(point.timestamp / FAKE_BAR_MS)
      return Math.max(0, Math.min(idx, bars.length - 1))
    }
    return 0
  }

  convertToPixel (points: unknown, _options: { paneId: string }): Array<{ x: number, y?: number }> {
    const arr = (Array.isArray(points) ? points : [points]) as Array<{ value?: number, timestamp?: number, dataIndex?: number }>
    return arr.map(p => ({ x: this._dataIndexOf(p) * FAKE_PX_PER_BAR, ...(typeof p.value === 'number' ? { y: this.valueToY(p.value) } : {}) }))
  }

  convertFromPixel (points: unknown, _options: { paneId: string }): Array<{ value: number }> {
    const arr = (Array.isArray(points) ? points : [points]) as Array<{ y: number }>
    return arr.map(p => ({ value: this.yToValue(p.y) }))
  }

  valueToY (value: number): number {
    const log = this.options.logAxis
    if (log === undefined) {
      return 1000 - value
    }
    const span = Math.log10(log.max) - Math.log10(log.min)
    return (Math.log10(log.max) - Math.log10(value)) / span * log.height
  }

  yToValue (y: number): number {
    const log = this.options.logAxis
    if (log === undefined) {
      return 1000 - y
    }
    const span = Math.log10(log.max) - Math.log10(log.min)
    return 10 ** (Math.log10(log.max) - (y / log.height) * span)
  }
}
