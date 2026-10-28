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

// Pane layout policy (SC-159): klinecharts gives every new sub-pane a fixed
// 100px and gives the candle pane only what is left, with no floor — a short
// host, or a handful of sub-indicators, squeezes the price chart to a sliver
// or to 0px. This computes sub-pane heights that respect a floor on the
// candle pane, first by scaling sub-panes down (never below a minimum) and,
// only if that still does not fit, by collapsing the lowest-priority ones to
// a legend-only strip — never to 0px, so every legend and close icon stays
// reachable. Pure and chart-agnostic: ChartProComponent applies the result
// with `setPaneOptions`.
//
// Part of SUPer-Chart (Apache-2.0).

export const MIN_SUB_PANE_HEIGHT = 30
export const COLLAPSED_PANE_HEIGHT = 22
/** The candle pane keeps at least this fraction of the total pane area, when auto layout applies. */
export const MAIN_FLOOR_RATIO = 0.55
/** Host-specified heights that overshoot the floor by this much or less are kept exactly. */
export const FIT_TOLERANCE = 4

export interface SubPaneSpec {
  id: string
  /** The host's configured height, or the user's last dragged height once one exists. */
  preferredHeight: number
  /** Collapses first when panes do not fit even at the minimum height (lowest value first). Ties keep array order. */
  priority: number
}

export interface PaneLayoutOptions {
  /** @default MAIN_FLOOR_RATIO */
  mainFloorRatio?: number
  /** @default MIN_SUB_PANE_HEIGHT */
  minSubHeight?: number
  /** @default COLLAPSED_PANE_HEIGHT */
  collapsedHeight?: number
  /** @default FIT_TOLERANCE */
  tolerance?: number
}

export interface SubPaneLayout {
  id: string
  height: number
  collapsed: boolean
}

export interface PaneLayoutResult {
  candleHeight: number
  subPanes: SubPaneLayout[]
}

/**
 * Sub-pane heights (and what is left for the candle pane) for `paneArea`
 * (candle + every sub-pane's current height). Never returns a height of 0:
 * a pane that cannot fit even at the minimum is collapsed to
 * `collapsedHeight` instead. Heights always sum to `paneArea`.
 */
export function layoutPaneHeights (paneArea: number, subPanes: readonly SubPaneSpec[], options: PaneLayoutOptions = {}): PaneLayoutResult {
  const mainFloorRatio = options.mainFloorRatio ?? MAIN_FLOOR_RATIO
  const minSubHeight = options.minSubHeight ?? MIN_SUB_PANE_HEIGHT
  const collapsedHeight = options.collapsedHeight ?? COLLAPSED_PANE_HEIGHT
  const tolerance = options.tolerance ?? FIT_TOLERANCE

  if (subPanes.length === 0) {
    return { candleHeight: Math.max(0, paneArea), subPanes: [] }
  }

  const mainFloor = Math.round(Math.max(0, paneArea) * mainFloorRatio)
  const budget = Math.max(0, paneArea - mainFloor)
  const totalPreferred = subPanes.reduce((sum, p) => sum + p.preferredHeight, 0)

  // 1. The preferred heights fit (within tolerance): keep them exactly.
  if (totalPreferred <= budget + tolerance) {
    return {
      candleHeight: paneArea - totalPreferred,
      subPanes: subPanes.map(p => ({ id: p.id, height: p.preferredHeight, collapsed: false }))
    }
  }

  // 2. They do not fit: collapse the lowest-priority panes, one at a time,
  //    until the rest fit at least at the minimum height each. Collapsing
  //    every pane is allowed (a legend strip is never 0px).
  const order = subPanes.map((_, i) => i).sort((a, b) => subPanes[a].priority - subPanes[b].priority)
  const collapsedIdx = new Set<number>()
  const fitsAtMinimum = (): boolean => {
    let total = 0
    for (let i = 0; i < subPanes.length; i++) {
      total += collapsedIdx.has(i) ? collapsedHeight : minSubHeight
    }
    return total <= budget
  }
  for (const i of order) {
    if (fitsAtMinimum()) {
      break
    }
    collapsedIdx.add(i)
  }

  // 3. Scale the remaining (non-collapsed) panes' preferred heights
  //    proportionally into what is left, clamped to the minimum each.
  const collapsedTotal = collapsedIdx.size * collapsedHeight
  const activeBudget = Math.max(0, budget - collapsedTotal)
  const active = subPanes.filter((_, i) => !collapsedIdx.has(i))
  const activePreferredTotal = active.reduce((sum, p) => sum + p.preferredHeight, 0)

  const activeHeights = new Map<string, number>()
  if (active.length > 0) {
    if (activePreferredTotal <= 0 || activeBudget <= active.length * minSubHeight) {
      // Nothing to weight by, or there is only room for the minimum: split evenly at the floor.
      active.forEach(p => { activeHeights.set(p.id, minSubHeight) })
    } else {
      // A largest-remainder split: each non-last pane gets its proportional
      // share (clamped to the floor and to what leaves enough for the rest),
      // and the last pane takes exactly what is left — so the total always
      // equals `activeBudget` exactly, never less (rounding never starves it,
      // by the same invariant that keeps every earlier pane above the floor).
      let remaining = activeBudget
      active.forEach((p, i) => {
        if (i === active.length - 1) {
          activeHeights.set(p.id, remaining)
          return
        }
        const remainingCount = active.length - i
        const raw = Math.round((p.preferredHeight / activePreferredTotal) * activeBudget)
        const maxAllowed = remaining - (remainingCount - 1) * minSubHeight
        const height = Math.min(maxAllowed, Math.max(minSubHeight, raw))
        activeHeights.set(p.id, height)
        remaining -= height
      })
    }
  }

  const subPaneLayout = subPanes.map((p, i) => ({
    id: p.id,
    height: collapsedIdx.has(i) ? collapsedHeight : (activeHeights.get(p.id) ?? minSubHeight),
    collapsed: collapsedIdx.has(i)
  }))
  const subTotal = subPaneLayout.reduce((sum, p) => sum + p.height, 0)
  return { candleHeight: paneArea - subTotal, subPanes: subPaneLayout }
}
