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

// The bar index an overlay point is actually DRAWN on (SC-161). klinecharts
// places a point by its timestamp when it has one — a nearest-bar search over
// the loaded data (binarySearchNearest, the same code in 9.1.1 and 9.8.12; see
// drawing-editor/fakeChart.ts's independent port, used by the drawing-editor's
// own tests). A point's stored `dataIndex` is never refreshed when older bars
// are prepended (loadMore): neither klinecharts 9.1.1 (addData does not touch
// overlay points) nor 9.8.12 (OverlayStore.updatePointPosition only shifts
// points that have NO timestamp) corrects it. So a data-driven tool that reads
// `dataIndex` after a loadMore starts computing at the wrong bar, drifting by
// exactly the page size — this file is the one place that gets it right, for
// volumeTools.ts and measure.ts to share.
//
// Part of SUPer-Chart (Apache-2.0).

export interface BarLike {
  timestamp: number
}

export interface BarPoint {
  dataIndex?: number
  timestamp?: number
}

/**
 * klinecharts' binarySearchNearest(dataList, timestamp) over ascending
 * timestamps: an exact match, else the nearest bar (converging toward the
 * side the search last stepped away from — the same quirk klinecharts itself
 * has for a timestamp outside the loaded range, so a future or before-history
 * point degrades exactly the way klinecharts' own handle would).
 */
export function timestampToBarIndex (data: readonly BarLike[], timestamp: number): number {
  const last = data.length - 1
  if (last < 0) {
    return 0
  }
  let left = 0
  let right = last
  while (left !== right) {
    const midIndex = Math.floor((right + left) / 2)
    const spread = right - left
    if (timestamp === data[left].timestamp) {
      return left
    }
    if (timestamp === data[right].timestamp) {
      return right
    }
    if (timestamp === data[midIndex].timestamp) {
      return midIndex
    }
    if (timestamp > data[midIndex].timestamp) {
      left = midIndex
    } else {
      right = midIndex
    }
    if (spread <= 2) {
      break
    }
  }
  return left
}

/**
 * The bar a point is drawn on: from its timestamp when it has one (this is
 * what stays correct across loadMore and off-grid timestamps), else its
 * dataIndex (a future point, or one klinecharts itself stores with no
 * timestamp), else null.
 */
export function barIndexOf (point: BarPoint, data: readonly BarLike[]): number | null {
  if (typeof point.timestamp === 'number' && Number.isFinite(point.timestamp) && data.length > 0) {
    return timestampToBarIndex(data, point.timestamp)
  }
  if (typeof point.dataIndex === 'number' && Number.isFinite(point.dataIndex)) {
    return Math.round(point.dataIndex)
  }
  return null
}
