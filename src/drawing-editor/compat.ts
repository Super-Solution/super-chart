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

// Version bridges for the drawing editor. Super Chart builds against klinecharts
// 9.1.1 but hosts run newer 9.x (the wallet resolves 9.8.12). Four things the
// editor needs have no public API in 9.1.1:
//   - which pane an overlay lives on (9.8 has overlay.paneId),
//   - clearing / setting klinecharts' own "selected overlay" (no API in any 9.x),
//   - draw order (9.8 has overlay.zLevel; 9.1.1 has only insertion order),
//   - finishing an overlay that createOverlay left "being drawn" (no API in any 9.x).
// For those we reach into the chart's overlay store — chart.getChartStore()
// .getOverlayStore() with getClickInstanceInfo / setClickInstanceInfo /
// getInstances / getProgressInstanceInfo / progressInstanceComplete, and the
// overlay instance's forceComplete — which exist with the same shape in 9.1.1 and
// 9.8.12. Every access is feature-detected and wrapped in try/catch; when the
// store is missing the editor degrades (selection handles may linger, reordering
// is disabled, a clone that cannot be finished is not made) instead of throwing.
// Part of SUPer-Chart (Apache-2.0).

export const CANDLE_PANE_ID = 'candle_pane'

/** klinecharts' currentStep of a finished overlay (OVERLAY_DRAW_STEP_FINISHED). */
const DRAW_STEP_FINISHED = -1

interface ClickInfo {
  paneId?: string
  instance?: { id?: string } | null
}

interface ProgressInfo {
  paneId?: string
  instance?: { id?: string } | null
}

interface PrivateOverlayStore {
  getClickInstanceInfo?: () => ClickInfo | null | undefined
  setClickInstanceInfo?: (info: Record<string, unknown>, event: Record<string, unknown>) => void
  getInstances?: (paneId?: string) => unknown
  getProgressInstanceInfo?: () => ProgressInfo | null | undefined
  progressInstanceComplete?: () => void
}

interface OverlayLike {
  id: string
  paneId?: unknown
}

function overlayStoreOf (chart: unknown): PrivateOverlayStore | null {
  try {
    const getChartStore = (chart as { getChartStore?: () => unknown } | null)?.getChartStore
    if (typeof getChartStore !== 'function') {
      return null
    }
    const chartStore = getChartStore.call(chart) as { getOverlayStore?: () => unknown } | null
    const getOverlayStore = chartStore?.getOverlayStore
    if (typeof getOverlayStore !== 'function') {
      return null
    }
    const store = getOverlayStore.call(chartStore) as PrivateOverlayStore | null
    return store !== null && typeof store === 'object' ? store : null
  } catch {
    return null
  }
}

function clickInfoOf (store: PrivateOverlayStore | null): ClickInfo | null {
  try {
    return typeof store?.getClickInstanceInfo === 'function' ? (store.getClickInstanceInfo() ?? null) : null
  } catch {
    return null
  }
}

/** The pane an overlay lives on: overlay.paneId (9.8+), else klinecharts' click info when it is the selected one, else the candle pane. */
export function paneIdOf (chart: unknown, overlay: OverlayLike): string {
  if (typeof overlay.paneId === 'string' && overlay.paneId.length > 0) {
    return overlay.paneId
  }
  const info = clickInfoOf(overlayStoreOf(chart))
  if (info?.instance?.id === overlay.id && typeof info.paneId === 'string' && info.paneId.length > 0) {
    return info.paneId
  }
  return CANDLE_PANE_ID
}

/** Clear klinecharts' own selection (its handles) if it still points at an overlay. Returns true when it did. */
export function clearChartSelection (chart: unknown): boolean {
  const store = overlayStoreOf(chart)
  const info = clickInfoOf(store)
  if (store === null || typeof store.setClickInstanceInfo !== 'function' || info === null || info.instance === null || info.instance === undefined) {
    return false
  }
  try {
    store.setClickInstanceInfo({
      paneId: info.paneId ?? CANDLE_PANE_ID, instance: null, figureType: 0, figureKey: '', figureIndex: -1, attrsIndex: -1
    }, {})
    return true
  } catch {
    return false
  }
}

/** Make klinecharts select `overlay` (shows its handles), as a click on it would. Returns true when it did. */
export function selectInChart (chart: unknown, overlay: OverlayLike, paneId: string): boolean {
  const store = overlayStoreOf(chart)
  if (store === null || typeof store.setClickInstanceInfo !== 'function') {
    return false
  }
  try {
    store.setClickInstanceInfo({
      paneId, instance: overlay, figureType: 2, figureKey: '', figureIndex: 0, attrsIndex: 0
    }, {})
    return true
  } catch {
    return false
  }
}

/**
 * Finish an overlay that klinecharts still treats as "being drawn".
 *
 * createOverlay marks an overlay finished only when it gets at least
 * totalStep - 1 points (OverlayImp.setPoints). A drawing can legitimately be
 * finished with fewer: Any Waves (totalStep = MAX_SAFE_INTEGER) always ends with
 * a double-click, and a double-click ends any multi-point tool early. Recreating
 * such a drawing from its points (Clone) yields an overlay that klinecharts
 * installs as THE drawing in progress: it follows the pointer and swallows every
 * click. This does what klinecharts' own double-click handler does —
 * overlay.forceComplete(), then store.progressInstanceComplete() — but only for
 * the overlay that is actually the one in progress.
 * Returns true when the overlay is (now) finished and stored with the others.
 */
export function completeDrawing (chart: unknown, overlay: unknown): boolean {
  const o = overlay as { id?: unknown, currentStep?: unknown, forceComplete?: unknown } | null
  if (o === null || typeof o !== 'object') {
    return false
  }
  if (o.currentStep === DRAW_STEP_FINISHED) {
    return true
  }
  const store = overlayStoreOf(chart)
  if (store === null || typeof o.forceComplete !== 'function' ||
    typeof store.getProgressInstanceInfo !== 'function' || typeof store.progressInstanceComplete !== 'function') {
    return false
  }
  try {
    if (store.getProgressInstanceInfo()?.instance?.id !== o.id) {
      return false
    }
    ;(o.forceComplete as () => void).call(o)
    store.progressInstanceComplete()
    return o.currentStep === DRAW_STEP_FINISHED && store.getProgressInstanceInfo()?.instance?.id !== o.id
  } catch {
    return false
  }
}

/**
 * Whether klinecharts has a drawing in progress. It holds only one: creating
 * another unfinished overlay would replace it there and orphan it (it would
 * vanish, host overlays included). False when this cannot be known.
 */
export function drawingInProgress (chart: unknown): boolean {
  return progressInstanceId(chart) !== null
}

/**
 * The id of the overlay klinecharts still treats as "being drawn" (not yet
 * placed with all its points), or null when there is none or this cannot be
 * known. getOverlayById does not necessarily return a still-in-progress
 * overlay (it lives in the store's separate "progress" slot until finished),
 * so callers that need to tell "still being placed" apart from "gone" must
 * use this instead of `getOverlayById(id) === null`.
 */
export function progressInstanceId (chart: unknown): string | null {
  const store = overlayStoreOf(chart)
  if (store === null || typeof store.getProgressInstanceInfo !== 'function') {
    return null
  }
  try {
    const id = store.getProgressInstanceInfo()?.instance?.id
    return typeof id === 'string' && id.length > 0 ? id : null
  } catch {
    return null
  }
}

/** The id of the drawing currently being placed (still-drawing "in progress" overlay), or null when there is none / it cannot be known. */
export function progressOverlayId (chart: unknown): string | null {
  const store = overlayStoreOf(chart)
  if (store === null || typeof store.getProgressInstanceInfo !== 'function') {
    return null
  }
  try {
    const id = store.getProgressInstanceInfo()?.instance?.id
    return typeof id === 'string' && id.length > 0 ? id : null
  } catch {
    return null
  }
}

/** Whether draw-order changes are possible without zLevel (klinecharts 9.1.1). */
export function canReorderInPane (chart: unknown): boolean {
  return typeof overlayStoreOf(chart)?.getInstances === 'function'
}

/**
 * 9.1.1 fallback for bring-to-front / send-to-back: klinecharts draws a pane's
 * overlays in the order of its instance array, and getInstances(paneId) returns
 * that live array. Moves the overlay to the end (front) or start (back).
 * The caller must trigger a repaint. Returns false when nothing was moved.
 */
export function reorderInPane (chart: unknown, paneId: string, id: string, direction: 'front' | 'back'): boolean {
  const store = overlayStoreOf(chart)
  if (store === null || typeof store.getInstances !== 'function') {
    return false
  }
  try {
    const list = store.getInstances(paneId)
    if (!Array.isArray(list)) {
      return false
    }
    const index = list.findIndex((o: { id?: string } | null) => o?.id === id)
    if (index < 0) {
      return false
    }
    const [item] = list.splice(index, 1)
    if (direction === 'front') {
      list.push(item)
    } else {
      list.unshift(item)
    }
    return true
  } catch {
    return false
  }
}
