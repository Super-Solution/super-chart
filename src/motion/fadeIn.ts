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

// Fade-in on a new page of history or a chart-type switch (SC-NEXT #1's last
// bullet). Deliberately NOT a rAF/runTween animation like the rest of
// src/motion: a plain opacity transition is the browser's own job (one
// composited property, no per-frame JS), and `prefers-reduced-motion` is
// handled by CSS alone (@media in index.less) rather than a JS check here —
// so this module works correctly even if a caller forgets to gate it, which
// a rAF-driven effect could not guarantee.
//
// Part of SUPer-Chart (Apache-2.0).

const FADE_CLASS = 'klinecharts-pro-fade-target'

/**
 * Restarts the fade: opacity 0 -> 1 over the CSS transition already declared
 * for `.klinecharts-pro-fade-target` (index.less; no-op under prefers-reduced-
 * motion via its own @media block). Forces a reflow between the two opacity
 * writes so the browser actually starts from 0 instead of coalescing both
 * into the same style recalculation (which would skip the visible fade).
 */
export function triggerFadeIn (el: HTMLElement | null | undefined): void {
  if (el === null || el === undefined) {
    return
  }
  el.classList.add(FADE_CLASS)
  el.style.opacity = '0'
  void el.offsetHeight // force reflow: commits opacity:0 before the next line changes it
  el.style.opacity = '1'
}
