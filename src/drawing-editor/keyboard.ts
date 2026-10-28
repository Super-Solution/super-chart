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

// Keyboard shortcuts for the selected drawing: Delete / Backspace delete it,
// Escape deselects (or closes an open popover first). The decision is kept pure
// so it can be tested; the toolbar component turns a KeyboardEvent into a
// KeyContext. Part of SUPer-Chart (Apache-2.0).

export type EditorKeyAction = 'delete' | 'deselect' | null

export interface KeyContext {
  key: string
  /** Any of Ctrl / Meta / Alt held — those combinations belong to the browser or host. */
  modifier: boolean
  /** IME composition in progress. */
  composing: boolean
  /** Lower-case tag name of the event target, or null. */
  targetTag: string | null
  /** Lower-case `type` of an <input> target (e.g. 'text', 'range'), else null. */
  targetInputType?: string | null
  targetEditable: boolean
  /** Focus is on <body>/<html> (nothing focused), so no host UI owns the key. */
  targetIsDocument: boolean
  /** The target is inside the chart's own container. */
  targetInsideChart: boolean
  /** The target is inside one of the chart's dialogs: its keys are the dialog's (SC-145). */
  targetInDialog?: boolean
  /**
   * The last press on the page landed inside this chart. With nothing focused,
   * that is what says the key is meant for this chart (and not for host UI the
   * user clicked since, or another chart on the same page).
   */
  lastPressInChart: boolean
}

/** <input> types that take no typed text: Escape means nothing to them. */
const NON_TEXT_INPUT_TYPES = ['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'image', 'file']

/** Where typed keys belong to the field: text inputs, textareas, selects, contenteditable. */
function isTextEntry (ctx: KeyContext): boolean {
  if (ctx.targetEditable || ctx.targetTag === 'textarea' || ctx.targetTag === 'select') {
    return true
  }
  return ctx.targetTag === 'input' && !NON_TEXT_INPUT_TYPES.includes(ctx.targetInputType ?? 'text')
}

// ---------------------------------------------------------------------------
// Drawing-tool hotkeys (SC-095): Alt+letter arms a tool, TradingView-style.
// A pure decision so the exact-modifier and text-entry rules are unit-tested
// without a browser. The caller (ChartProComponent, through the chart's
// shared key dispatcher) supplies the KeyboardEvent's own fields.

export type HotkeyTool = 'segment' | 'horizontalStraightLine' | 'horizontalRayLine' | 'verticalStraightLine' | 'fibonacciLine' | 'rect'

export interface HotkeyContext {
  /** e.code (physical key: works for the Mac Option-key glyphs Alt produces on e.key). */
  code: string
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  /** A held-down key repeating; only the first press arms a tool. */
  repeat: boolean
  composing: boolean
  /** isTextEntryTarget(e.target) (common/keyDispatcher.ts) — typed keys belong to the field. */
  isTextEntry: boolean
}

const HOTKEY_KEYS: Record<string, HotkeyTool> = {
  KeyT: 'segment',
  KeyH: 'horizontalStraightLine',
  KeyJ: 'horizontalRayLine',
  KeyV: 'verticalStraightLine',
  KeyF: 'fibonacciLine'
}

/**
 * The tool an Alt+letter (or Alt+Shift+R) hotkey arms, or null. Excludes
 * AltGr (which browsers report with ctrlKey also true on Windows) and a host
 * shortcut that also holds Ctrl/Meta (e.g. ProjectX's Ctrl/Cmd+Alt+C) by
 * requiring an EXACT modifier set: only Alt, plus Shift for Alt+Shift+R.
 */
export function chartHotkeyAction (ctx: HotkeyContext): HotkeyTool | null {
  if (ctx.composing || ctx.repeat || ctx.isTextEntry) {
    return null
  }
  if (!ctx.altKey || ctx.ctrlKey || ctx.metaKey) {
    return null
  }
  if (ctx.code === 'KeyR') {
    return ctx.shiftKey ? 'rect' : null
  }
  if (ctx.shiftKey) {
    return null
  }
  return HOTKEY_KEYS[ctx.code] ?? null
}

export function editorKeyAction (ctx: KeyContext): EditorKeyAction {
  if (ctx.modifier || ctx.composing || isTextEntry(ctx) || ctx.targetInDialog === true) {
    return null
  }
  if (!ctx.targetInsideChart && !(ctx.targetIsDocument && ctx.lastPressInChart)) {
    return null
  }
  switch (ctx.key) {
    case 'Delete':
    case 'Backspace':
      // Not from a form control either (e.g. the toolbar's opacity slider):
      // deleting the drawing is too much for a key pressed on a slider.
      return ctx.targetTag === 'input' ? null : 'delete'
    case 'Escape':
    case 'Esc':
      // Escape does reach a slider or checkbox, so it closes the popover it sits in.
      return 'deselect'
    default:
      return null
  }
}
