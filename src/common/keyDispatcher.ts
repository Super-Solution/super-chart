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

// The chart-scoped key dispatcher: one keyboard entry point per chart
// (SC-105, SC-083). Every keyboard shortcut of the chart registers here
// instead of adding its own window listener, so that one key press is used
// by exactly one thing: Escape closes the topmost modal OR the open menu OR
// ends the armed tool OR deselects the drawing, never several of them.
//
// How a key travels
// -----------------
// One capture-phase `keydown` listener on the window, so it runs before any
// bubble-phase listener (the drawing editor's, freehand's, a host's own
// Escape handler such as SupWallet's pane un-zoom). The key is offered to the
// chart only when it belongs to this chart (`keyBelongsToChart`): focus is
// inside the chart's root, or nothing is focused and the last pointerdown on
// the page landed inside the chart. Two charts on a page therefore never see
// each other's keys, and a host input next to the chart keeps its keys. An
// IME composition is never touched.
//
// Handlers are tried highest priority first; among equal priorities the most
// recently registered first. Dialogs and popovers share one priority, so the
// layer opened last gets the key first: a select's list open in a dialog
// closes before the dialog does, and a dialog opened over a menu closes
// before the menu. A handler returns true when it took the key: the dispatcher
// then calls stopPropagation (bubble listeners and the target's own handlers
// never see it). Whether the browser's default is cancelled is the handler's
// call (it must not cancel typing in a field): call e.preventDefault() in it.
//
// Suspension (modal dialogs)
// --------------------------
// `suspend()` returns a release function. While any suspension is held (a
// modal is open), only handlers registered with `whileSuspended: true` run;
// by default that is the MODAL/POPOVER layer (a modal's Escape, a select's
// list inside the modal). Chart-level shortcuts (CHART, EDITOR, FALLBACK: arm
// a tool, undo, delete the selected drawing, leave full screen) are skipped,
// so Delete or Backspace on a control in a dialog never deletes the drawing
// behind it. Code that still listens on the window itself (the drawing
// toolbar until PR 11 moves it here) must check `suspended()`.
//
// Registering (for later PRs)
// ---------------------------
//   const scope = useChartScope()
//   onMount(() => {
//     const off = scope?.keys.register(e => {
//       if (!isEscape(e) || !armed()) return false
//       cancelTool(); e.preventDefault(); return true
//     }, { priority: KEY_PRIORITY.EDITOR })
//     onCleanup(() => off?.())
//   })
// Use `isTextEntryTarget(e.target)` to leave keys typed into a field alone,
// and `hasCommandModifier(e)` / `e.code` for hotkeys. A handler that must
// run after the bubble-phase listeners (to see whether they used the key)
// defers its decision with setTimeout and checks e.defaultPrevented (see
// the pseudo full screen's Escape in fullscreen.ts).
//
// Part of SUPer-Chart (Apache-2.0).

import { createSignal } from 'solid-js'

/**
 * Priorities, highest first. MODAL and POPOVER (an open dialog; an open
 * menu, list or flyout) are one layer: the one opened last goes first.
 * EDITOR: the selected drawing or the armed tool. CHART: chart-wide
 * shortcuts (periods, replay, zoom). FALLBACK: last resort (the pseudo full
 * screen's Escape).
 */
export const KEY_PRIORITY = { MODAL: 300, POPOVER: 300, EDITOR: 150, CHART: 100, FALLBACK: 0 } as const

/**
 * Returns true when it took the key; the dispatcher then stops the event.
 * Cancelling the default (e.preventDefault()) is the handler's call.
 */
export type ChartKeyHandler = (e: KeyboardEvent) => boolean

export interface ChartKeyOptions {
  /** @default KEY_PRIORITY.CHART */
  priority?: number
  /** Also run while a modal holds a suspension. Default: priority >= POPOVER. */
  whileSuspended?: boolean
}

export interface KeyTargetInfo {
  /** The target is inside the chart's root. */
  insideRoot: boolean
  /** The target is document, <html> or <body>: nothing is focused. */
  isDocument: boolean
  /** The last pointerdown on the page landed inside the chart. */
  lastPressInChart: boolean
  /** An IME composition is in progress (keyCode 229 included). */
  composing: boolean
}

/** Whether a key event is this chart's to handle. Pure, for tests. */
export function keyBelongsToChart (info: KeyTargetInfo): boolean {
  if (info.composing) {
    return false
  }
  return info.insideRoot || (info.isDocument && info.lastPressInChart)
}

export interface KeyDispatcher {
  /** Add a handler (a number is the priority); returns the function that removes it. */
  register: (handler: ChartKeyHandler, options?: ChartKeyOptions | number) => () => void
  /** Hold a suspension while a modal is open; returns its release (idempotent). */
  suspend: () => () => void
  /** Whether a suspension is held. Reactive (a Solid signal). */
  suspended: () => boolean
  /** Whether the last press on the page landed inside this chart. */
  lastPressInChart: () => boolean
  /** Whether this key event belongs to this chart (same test the dispatcher uses). */
  owns: (e: KeyboardEvent) => boolean
  dispose: () => void
}

interface Entry { handler: ChartKeyHandler, priority: number, whileSuspended: boolean, order: number }

/** Escape, as browsers report it (old Edge: 'Esc'). */
export function isEscape (e: KeyboardEvent): boolean {
  return e.key === 'Escape' || e.key === 'Esc'
}

/** Ctrl, Meta or Alt held: combinations that usually belong to the browser or the host. */
export function hasCommandModifier (e: KeyboardEvent): boolean {
  return e.ctrlKey || e.metaKey || e.altKey
}

/** <input> types that take no typed text. */
const NON_TEXT_INPUT_TYPES = ['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'image', 'file']

/** Where typed keys belong to the field: text inputs, textareas, selects, contenteditable. */
export function isTextEntryTarget (target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (el === null || typeof el.tagName !== 'string') {
    return false
  }
  const tag = el.tagName.toLowerCase()
  if (el.isContentEditable || tag === 'textarea' || tag === 'select') {
    return true
  }
  return tag === 'input' && !NON_TEXT_INPUT_TYPES.includes(((el as HTMLInputElement).type ?? 'text').toLowerCase())
}

/**
 * @param root the chart's root element (read on every key, so it may be set
 *   after the dispatcher is created).
 */
export function createKeyDispatcher (root: () => HTMLElement | null | undefined, win: Window = window): KeyDispatcher {
  const entries: Entry[] = []
  let order = 0
  const [holds, setHolds] = createSignal(0)
  // A chart owns an unfocused page's keys only after the user pressed it.
  let pressedInside = false

  // The window's own Node (the chart may live in an iframe's document).
  const NodeClass = (win as unknown as { Node: typeof Node }).Node
  const inside = (target: EventTarget | null): boolean => {
    const r = root()
    return r !== null && r !== undefined && target instanceof NodeClass && r.contains(target)
  }

  const onPointerDown = (e: Event): void => {
    pressedInside = inside(e.composedPath?.()[0] ?? e.target)
  }

  const owns = (e: KeyboardEvent): boolean => {
    const doc = win.document
    const target = e.target
    const isDocument = target === null || target === doc || target === doc.body || target === doc.documentElement || (target as unknown) === win
    return keyBelongsToChart({
      insideRoot: inside(target),
      isDocument,
      lastPressInChart: pressedInside,
      composing: e.isComposing || e.keyCode === 229
    })
  }

  const onKeyDown = (e: KeyboardEvent): void => {
    if (entries.length === 0 || !owns(e)) {
      return
    }
    const suspended = holds() > 0
    // A copy: a handler may remove itself (a modal closing on Escape).
    for (const entry of entries.slice()) {
      if (suspended && !entry.whileSuspended) {
        continue
      }
      if (entry.handler(e)) {
        e.stopPropagation()
        return
      }
    }
  }

  win.addEventListener('keydown', onKeyDown, true)
  win.document.addEventListener('pointerdown', onPointerDown, true)

  return {
    register (handler, options) {
      const opts: ChartKeyOptions = typeof options === 'number' ? { priority: options } : (options ?? {})
      const priority = opts.priority ?? KEY_PRIORITY.CHART
      const entry: Entry = { handler, priority, whileSuspended: opts.whileSuspended ?? priority >= KEY_PRIORITY.POPOVER, order: order++ }
      entries.push(entry)
      entries.sort((a, b) => (b.priority - a.priority) || (b.order - a.order))
      return () => {
        const i = entries.indexOf(entry)
        if (i >= 0) {
          entries.splice(i, 1)
        }
      }
    },
    suspend () {
      setHolds(n => n + 1)
      let released = false
      return () => {
        if (!released) {
          released = true
          setHolds(n => Math.max(0, n - 1))
        }
      }
    },
    suspended: () => holds() > 0,
    lastPressInChart: () => pressedInside,
    owns,
    dispose () {
      entries.length = 0
      win.removeEventListener('keydown', onKeyDown, true)
      win.document.removeEventListener('pointerdown', onPointerDown, true)
    }
  }
}
