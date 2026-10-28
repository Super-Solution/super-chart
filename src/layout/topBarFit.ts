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

// How the top bar fits its width (SC-064, SC-085). It needs about 1,200px
// with labels, and what it needs depends on the locale, the symbol and the
// number of periods, so fixed breakpoints are the wrong trigger: the bar is
// measured. It steps down, least collapsed first, and keeps the first step
// whose content fits (scrollWidth <= clientWidth):
//
//   regular   labelled tools
//   compact   icon-only tools (every tool keeps its name in aria-label/title),
//             then the lowest-priority tools move one by one into a More menu
//             (Screenshot, Timezone, Replay, Full screen, Settings; the core
//             tools, Indicators and Chart type, stay)
//   narrow    the periods collapse into one dropdown showing the current
//             period, again moving tools into More as needed, core ones last
//
// Within one size class, moving one more tool out never makes the bar wider,
// so the count is found by binary search: a handful of layouts per resize,
// all in one synchronous pass, so nothing flickers. A step back up (the
// chart grew) needs a few pixels of slack, so a width at the boundary does
// not flip between two classes.
//
// A forced layout mode ('regular', 'compact', 'narrow') keeps its size class
// and still moves tools into More when they do not fit, so a tool is always
// reachable. A host stylesheet that wraps the bar (SupWallet's Vibe Trading)
// means it never overflows: the fit is then always 'regular', a no-op.
//
// Part of SUPer-Chart (Apache-2.0).

import type { LayoutMode, SizeClass } from '../types'

export interface FitStep {
  size: SizeClass
  /** How many tools (in hide order) are in the More menu. */
  hidden: number
}

const ORDER: SizeClass[] = ['regular', 'compact', 'narrow']

/**
 * Every step for a layout mode, least collapsed first. `hideable` tools can
 * move into More, in order; in 'auto', compact moves only the first
 * `beforeNarrow` of them (the rest are core tools: the periods collapse
 * first). A forced class may move them all, so every tool stays reachable.
 * Pure, for tests.
 */
export function fitSteps (mode: LayoutMode, hideable: number, beforeNarrow: number = hideable): FitStep[] {
  const classes = mode === 'auto' ? ORDER : [mode]
  const steps: FitStep[] = []
  for (const size of classes) {
    let most = hideable
    if (mode === 'auto') {
      // Regular never hides tools: compact comes first.
      most = size === 'regular' ? 0 : (size === 'compact' ? Math.min(beforeNarrow, hideable) : hideable)
    }
    for (let hidden = 0; hidden <= most; hidden++) {
      steps.push({ size, hidden })
    }
  }
  return steps
}

/** 0 for the least collapsed step; larger is more collapsed. */
export function stepRank (step: FitStep, hideable: number): number {
  return ORDER.indexOf(step.size) * (hideable + 1) + step.hidden
}

/**
 * The first step that fits, trying as few as possible: one per size class
 * (with no tool hidden, then all hidden), then a binary search for the
 * count inside the first class whose most-collapsed step fits. The last step
 * when none fits. Pure: `fits` does the measuring.
 */
export function chooseStep (steps: FitStep[], fits: (step: FitStep) => boolean): FitStep {
  if (steps.length === 0) {
    return { size: 'regular', hidden: 0 }
  }
  const classes = [...new Set(steps.map(s => s.size))]
  for (const size of classes) {
    const inClass = steps.filter(s => s.size === size)
    if (!fits(inClass[inClass.length - 1])) {
      continue
    }
    // inClass[hi] fits; find the first that does.
    let lo = 0
    let hi = inClass.length - 1
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2)
      if (fits(inClass[mid])) {
        hi = mid
      } else {
        lo = mid + 1
      }
    }
    return inClass[lo]
  }
  return steps[steps.length - 1]
}

/** Pixels a step up (less collapsed than now) must have to spare. */
export const FIT_SLACK = 8

/**
 * Whether a bar's content fits it with `slack` pixels to spare. scrollWidth
 * alone cannot say how much room is left (it is never below clientWidth), so
 * the room is measured from the right edge of the last child that shows.
 */
export function barFits (bar: HTMLElement, slack: number): boolean {
  if (bar.scrollWidth > bar.clientWidth) {
    return false
  }
  if (slack <= 0) {
    return true
  }
  const win = bar.ownerDocument.defaultView ?? window
  const box = bar.getBoundingClientRect()
  let right = 0
  for (const child of Array.from(bar.children) as HTMLElement[]) {
    const r = child.getBoundingClientRect()
    if (r.width > 0 || r.height > 0) {
      right = Math.max(right, r.right + (Number.parseFloat(win.getComputedStyle(child).marginRight) || 0))
    }
  }
  const needed = right - (box.left + bar.clientLeft) + (Number.parseFloat(win.getComputedStyle(bar).paddingRight) || 0)
  return needed <= bar.clientWidth - slack
}

export interface TopBarFitDriver {
  /** Put the bar in this state (DOM attributes only, synchronously). */
  apply: (step: FitStep) => void
  /** Whether the bar's content fits now, with this much room to spare. */
  measure: (slack: number) => boolean
}

/**
 * Measure and choose. `current` is the step in use: steps less collapsed than
 * it must fit with FIT_SLACK to spare. Leaves the bar in the chosen state.
 */
export function fitTopBar (mode: LayoutMode, hideable: number, current: FitStep | null, driver: TopBarFitDriver, beforeNarrow: number = hideable): FitStep {
  const steps = fitSteps(mode, hideable, beforeNarrow)
  const currentRank = current === null ? Infinity : stepRank(current, hideable)
  const chosen = chooseStep(steps, step => {
    driver.apply(step)
    return driver.measure(stepRank(step, hideable) < currentRank ? FIT_SLACK : 0)
  })
  driver.apply(chosen)
  return chosen
}
