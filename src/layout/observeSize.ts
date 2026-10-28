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

// Resize the canvas when its element changes size, whatever the cause: the
// host's pane, a size class, the rail shown or hidden, full screen (SC-085).
// klinecharts v9 only watches the window. Zero sizes (a hidden tab) and
// repeats of the last size are skipped, so a hidden chart keeps its scroll
// position.
//
// Part of SUPer-Chart (Apache-2.0).

/** Whether a new size should resize the chart. Pure, for tests. */
export function shouldResize (next: { width: number, height: number }, last: { width: number, height: number } | null): boolean {
  if (next.width <= 0 || next.height <= 0) {
    return false
  }
  return last === null || Math.abs(next.width - last.width) >= 0.5 || Math.abs(next.height - last.height) >= 0.5
}

/** Calls onResize after each size change of `el`; returns the function that stops. */
export function observeSize (el: HTMLElement, onResize: () => void): () => void {
  const win = el.ownerDocument.defaultView ?? window
  if (typeof win.ResizeObserver === 'undefined') {
    return () => {}
  }
  let last: { width: number, height: number } | null = null
  const observer = new win.ResizeObserver(entries => {
    const rect = entries[entries.length - 1]?.contentRect
    if (rect === undefined) {
      return
    }
    const next = { width: rect.width, height: rect.height }
    if (shouldResize(next, last)) {
      last = next
      onResize()
    }
  })
  observer.observe(el)
  return () => { observer.disconnect() }
}
