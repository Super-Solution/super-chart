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

// The top bar's header slot (SC-NEXT #4): lets a host (ProjectX, SupWallet)
// render its own symbol selector/header inside the chart's own top bar
// instead of building a separate header above it (screenshot 15.png in the
// SC-NEXT brief: "SupWallet's current chart header, to be replaced by the
// new selector"). Mirrors src/watermark.ts's Node-option contract exactly —
// same detached-vs-attached handling, same reasons — so a host already
// familiar with the watermark option needs to learn nothing new here.
//
// Providing a header slot hides the built-in symbol button automatically
// (ChartProComponent computes `parts.symbol && headerSlotEl === null`): a
// host supplying its own selector never has to *also* remember to pass
// `parts: { symbol: false }`, and the two can never disagree.
//
// Part of SUPer-Chart (Apache-2.0).

/** A Node, or a factory the chart calls once to get its own Node. No plain-string form (unlike watermark): a header slot is meant for an interactive selector, not a label. */
export type HeaderSlotOption = Node | (() => Node)

export const HEADER_SLOT_CLASS = 'klinecharts-pro-header-slot'

/**
 * Resolves a HeaderSlotOption to the actual Node the chart will mount,
 * WITHOUT wrapping it in a container (unlike createWatermark) — the caller
 * places it directly in the top bar's own flex layout, where an extra
 * wrapper div would need its own sizing rules to not throw off the row.
 *
 * - A detached Node is used as-is, so a host that keeps a reference to it can
 *   still update it in place after mounting.
 * - A Node already attached elsewhere (another chart, the host's own page) is
 *   deep-cloned instead: appending it here would move it out from under its
 *   original owner. The clone has no event listeners — a host that needs
 *   interactivity should pass a detached Node (or a factory that builds one).
 */
export function resolveHeaderSlot (option: HeaderSlotOption | null | undefined): Node | null {
  if (option === null || option === undefined) {
    return null
  }
  const node = typeof option === 'function' ? option() : option
  return node.parentNode === null ? node : node.cloneNode(true)
}
