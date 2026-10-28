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
 * Reads the chart's real indicator state (SC-114): the picker's checked rows,
 * the v2 getIndicators() and the settings modal all come from this, not from
 * a signal ChartProComponent keeps on the side. `owned` is the one thing the
 * chart itself cannot answer — "did the engine create this, or a host?" — so
 * the caller (ChartProComponent) keeps that small Set and passes it in; this
 * module never mutates it.
 *
 * Maintained by ZzyzxLabs. Part of SUPer-Chart (Apache-2.0).
 */
import type { Chart, Indicator, Nullable } from 'klinecharts'

export interface IndicatorSnapshot {
  paneId: string
  name: string
  calcParams: unknown[]
  visible: boolean
  owner: 'engine' | 'host'
}

/** The key readIndicators/ChartProComponent use for the `owned` set: one indicator instance, by pane and name. */
export function ownerKey (paneId: string, name: string): string {
  return `${paneId}\u0000${name}`
}

/** Every indicator instance currently on `widget`, across every pane. [] for a null/undisposed-less chart. */
export function readIndicators (widget: Nullable<Chart>, owned: ReadonlySet<string>): IndicatorSnapshot[] {
  if (widget === null) return []
  const mapping = widget.getIndicatorByPaneId() as Nullable<Map<string, Map<string, Indicator>>>
  const out: IndicatorSnapshot[] = []
  if (!(mapping instanceof Map)) return out
  for (const [paneId, byName] of mapping) {
    if (!(byName instanceof Map)) continue
    for (const [name, ind] of byName) {
      out.push({
        paneId,
        name,
        calcParams: Array.isArray(ind.calcParams) ? ind.calcParams : [],
        visible: ind.visible,
        owner: owned.has(ownerKey(paneId, name)) ? 'engine' : 'host'
      })
    }
  }
  return out
}

/** The first instance of `name` (optionally restricted to `paneId`). */
export function findIndicator (widget: Nullable<Chart>, name: string, paneId?: string): { paneId: string, instance: Indicator } | null {
  if (widget === null) return null
  if (paneId !== undefined) {
    const ind = widget.getIndicatorByPaneId(paneId, name) as Nullable<Indicator>
    return ind === null || ind === undefined ? null : { paneId, instance: ind }
  }
  const mapping = widget.getIndicatorByPaneId() as Nullable<Map<string, Map<string, Indicator>>>
  if (!(mapping instanceof Map)) return null
  for (const [pid, byName] of mapping) {
    if (byName instanceof Map && byName.has(name)) return { paneId: pid, instance: byName.get(name) as Indicator }
  }
  return null
}
