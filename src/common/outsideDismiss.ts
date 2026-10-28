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

// Close a popover on a press anywhere outside it (SC-083). A capture-phase
// pointerdown on the document, added only while the popover is open: it sees
// touch taps and pans on the canvas (klinecharts cancels the mouse events a
// touch would produce, so a mousedown listener never fires) and presses in
// brush mode (whose handler cancels them for the mouse too). It never stops
// the event. The anchor that toggles the popover counts as inside, so the
// press that lands on it does not close the popover the following click
// would then reopen. Keyboard users leaving it with Tab close it through
// onFocusOut.
//
// The drawing toolbar's popovers already work this way; the top bar's menus
// use this helper, and the drawing rail's flyouts can (PR 10).
//
// Part of SUPer-Chart (Apache-2.0).

import { createEffect, onCleanup } from 'solid-js'

type MaybeElement = Element | null | undefined

/** Whether an event's innermost target lies outside every one of `inside`. Pure, for tests. */
export function isOutside (target: unknown, inside: readonly MaybeElement[]): boolean {
  if (target === null || target === undefined || typeof (target as Node).nodeType !== 'number') {
    return true
  }
  return !inside.some(el => el !== null && el !== undefined && el.contains(target as Node))
}

export interface OutsideDismissOptions {
  isOpen: () => boolean
  /** The popover and everything that counts as part of it (its anchor). */
  inside: () => readonly MaybeElement[]
  close: () => void
  /** Defaults to the first inside element's document. */
  document?: () => Document | undefined
}

export interface OutsideDismiss {
  /** Put on the popover (and its anchor): closes it when focus moves outside. */
  onFocusOut: (e: FocusEvent) => void
}

export function createOutsideDismiss (options: OutsideDismissOptions): OutsideDismiss {
  const onPointerDown = (e: Event): void => {
    const target = e.composedPath?.()[0] ?? e.target
    if (options.isOpen() && isOutside(target, options.inside())) {
      options.close()
    }
  }

  createEffect(() => {
    if (!options.isOpen()) {
      return
    }
    const doc = options.document?.() ?? options.inside().find(el => el !== null && el !== undefined)?.ownerDocument ?? document
    doc.addEventListener('pointerdown', onPointerDown, true)
    onCleanup(() => { doc.removeEventListener('pointerdown', onPointerDown, true) })
  })

  return {
    onFocusOut: (e: FocusEvent) => {
      // relatedTarget null: focus left the page or went to <body> after a press
      // on nothing focusable; the pointerdown above handles presses.
      if (e.relatedTarget !== null && options.isOpen() && isOutside(e.relatedTarget, options.inside())) {
        options.close()
      }
    }
  }
}
