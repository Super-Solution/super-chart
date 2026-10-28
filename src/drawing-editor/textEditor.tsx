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

// Inline editor for a text-typed drawing's label, or an image drawing's URL
// (SC-093) — replaces the two window.prompt() calls that used to block
// placement, read in English regardless of locale, and place nothing at all
// in a sandboxed iframe with no allow-modals (Chrome silently no-ops
// window.prompt there). ChartProComponent opens this: once a text/image tool
// finishes placing, on a double-click on one of the editor's own completed
// drawings (never a host overlay — this never runs for one), on the
// toolbar's "Edit text", or on Enter while one is selected.
//
// Part of SUPer-Chart (Apache-2.0).

import { Component, JSX, Show, createSignal, onMount } from 'solid-js'

import i18n from '../i18n'
import { TOOLBAR_LABELS } from './labels'
import { clampPosition, Point2 } from './geometry'

/** Overlay names whose extendData is a plain text label. */
export const TEXT_TOOL_NAMES = ['text', 'note', 'callout', 'signpost'] as const
export const IMAGE_TOOL_NAME = 'image'

const DEFAULT_TEXT_KEY: Readonly<Record<string, string>> = {
  text: TOOLBAR_LABELS.textDefaultText,
  note: TOOLBAR_LABELS.textDefaultNote,
  callout: TOOLBAR_LABELS.textDefaultCallout,
  signpost: TOOLBAR_LABELS.textDefaultSignpost
}

export function isTextTool (name: string): boolean {
  return (TEXT_TOOL_NAMES as readonly string[]).includes(name)
}

export function isImageTool (name: string): boolean {
  return name === IMAGE_TOOL_NAME
}

/** The localized placeholder for a fresh text-typed drawing ('' for a tool this module does not know, e.g. priceLabel — which has no editable text at all). */
export function defaultTextFor (name: string, locale: string): string {
  const key = DEFAULT_TEXT_KEY[name]
  return key === undefined ? '' : i18n(key, locale)
}

/** A URL this editor accepts (never a bare string that would draw nothing, or a scheme the image figure cannot load). */
export function isAcceptableImageUrl (value: string): boolean {
  return /^(https?:|data:)/i.test(value.trim())
}

export interface TextEditorProps {
  locale: string
  kind: 'text' | 'image'
  /** Where the editor opens, in the SAME page coordinates as OverlayEvent.pageX/pageY. */
  anchor: { pageX: number, pageY: number }
  /** The chart area element; the editor is kept inside it. Must share an offsetParent with the editor. */
  chartElement: () => HTMLElement | undefined
  initialValue: string
  /** Called with the trimmed value on Enter or blur; never called for an unacceptable image URL (onCancel runs instead). */
  onCommit: (value: string) => void
  /** Called on Escape (with the trimmed value the field held, so the caller can remove a fresh, still-empty placement) or an empty image URL. */
  onCancel: (value: string) => void
}

const TextEditor: Component<TextEditorProps> = props => {
  let inputRef: HTMLInputElement | undefined
  const [value, setValue] = createSignal(props.initialValue)
  const [invalid, setInvalid] = createSignal(false)
  let done = false

  onMount(() => {
    inputRef?.focus({ preventScroll: true })
    inputRef?.select()
  })

  const finish = (fn: () => void): void => {
    if (done) {
      return
    }
    done = true
    fn()
  }

  const commit = (): void => {
    const v = value().trim()
    if (props.kind === 'image' && !isAcceptableImageUrl(v)) {
      if (v.length === 0) {
        finish(() => { props.onCancel(v) })
      } else {
        setInvalid(true)
      }
      return
    }
    finish(() => { props.onCommit(v) })
  }

  const style = (): JSX.CSSProperties => {
    const chart = props.chartElement()
    const width = props.kind === 'image' ? 240 : 140
    if (chart === undefined) {
      return { visibility: 'hidden', width: `${width}px` }
    }
    const box = chart.getBoundingClientRect()
    const at: Point2 = { x: props.anchor.pageX - window.scrollX - box.left, y: props.anchor.pageY - window.scrollY - box.top - 16 }
    const bounds = { x: 0, y: 0, width: chart.clientWidth, height: chart.clientHeight }
    const pos = clampPosition(at, { width, height: 32 }, bounds)
    return { left: `${pos.x}px`, top: `${pos.y}px`, width: `${width}px` }
  }

  return (
    <div class="klinecharts-pro-drawing-text-editor" style={style()}>
      <input
        ref={inputRef}
        type={props.kind === 'image' ? 'url' : 'text'}
        class="dte-input"
        value={value()}
        placeholder={props.kind === 'image' ? i18n(TOOLBAR_LABELS.imageUrlPlaceholder, props.locale) : undefined}
        aria-label={props.kind === 'image' ? i18n(TOOLBAR_LABELS.imageUrl, props.locale) : i18n(TOOLBAR_LABELS.editText, props.locale)}
        aria-invalid={invalid()}
        spellcheck={props.kind !== 'image'}
        onInput={e => {
          setInvalid(false)
          // A single-line label: strip any pasted newline instead of losing the rest of the text.
          setValue(props.kind === 'image' ? e.currentTarget.value : e.currentTarget.value.replace(/[\r\n]+/g, ' '))
        }}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.isComposing) {
            e.preventDefault()
            commit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            finish(() => { props.onCancel(value().trim()) })
          }
        }}
        onBlur={commit}/>
      <Show when={invalid()}>
        <span class="dte-error" role="alert">{i18n(TOOLBAR_LABELS.imageLoadError, props.locale)}</span>
      </Show>
    </div>
  )
}

export default TextEditor
