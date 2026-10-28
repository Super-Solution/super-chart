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

import { type JSX, type Component, mergeProps, Show, createSignal } from 'solid-js'

export interface InputProps {
  class?: string
  style?: JSX.CSSProperties
  prefix?: JSX.Element
  suffix?: JSX.Element
  precision?: number
  min?: number
  max?: number
  placeholder?: string
  value: string | number
  disabled?: boolean
  /** The id of the element naming the field (its label), or a name (SC-145). */
  labelId?: string
  ariaLabel?: string
  onChange?: (v: string | number) => void
  /**
   * Fires whenever the field commits (blur/Enter, same as `onChange`) in the
   * `precision` (numeric) mode: false when the committed text is out of range
   * or unparsable (SC-163), so the value is kept on screen but not written
   * through. Only the indicator settings form uses `precision` today, so this
   * is the only caller that needs to watch it.
   */
  onValidityChange?: (valid: boolean) => void
  /** Every keystroke (the native 'input' event), raw — no precision validation (SC-106: search-as-you-type needs this; `onChange` still fires only on blur/Enter and keeps its commit-time validation for indicator-setting-modal). */
  onInput?: (v: string) => void
  onKeyDown?: (e: KeyboardEvent) => void
  /** The underlying <input>, e.g. to move the caret after a programmatic value change. */
  ref?: (el: HTMLInputElement) => void
  role?: string
  'aria-expanded'?: boolean
  'aria-controls'?: string
  'aria-activedescendant'?: string
  'aria-autocomplete'?: string
}

const Input: Component<InputProps> = p => {
  const props = mergeProps({ min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER }, p)
  let input: HTMLInputElement

  const [focused, setFocused] = createSignal(false)
  const [invalid, setInvalid] = createSignal(false)
  const status = (): string => (invalid() ? 'error' : focused() ? 'focus' : 'normal')

  return (
    <div
      style={props.style}
      class={`klinecharts-pro-input ${props.class ?? ''}`}
      data-status={status()}
      onClick={() => { input?.focus() }}>
      <Show when={props.prefix}>
        <span class="prefix">{props.prefix}</span>
      </Show>
      <input
        ref={(el) => { input = el; props.ref?.(el) }}
        class="value"
        role={props.role as never}
        aria-labelledby={props.labelId}
        aria-label={props.labelId === undefined ? props.ariaLabel : undefined}
        aria-invalid={invalid()}
        aria-expanded={props['aria-expanded']}
        aria-controls={props['aria-controls']}
        aria-activedescendant={props['aria-activedescendant']}
        aria-autocomplete={props['aria-autocomplete'] as never}
        placeholder={props.placeholder ?? ''}
        value={props.value}
        onFocus={() => { setFocused(true) }}
        onBlur={() => { setFocused(false) }}
        onKeyDown={props.onKeyDown}
        onInput={(e) => {
          // @ts-expect-error
          props.onInput?.(e.target.value)
        }}
        onChange={(e) => {
          // @ts-expect-error
          const raw = e.target.value
          if ('precision' in props) {
            // Lenient parsing (SC-163): full-width digits (a zh IME), leading
            // zeros/spaces and a bare "-" while typing a negative number should
            // not read as "rejected" the way /^[1-9]\d*$/ read them.
            const v = typeof raw === 'string' ? raw.normalize('NFKC').trim() : raw
            if (v === '' || v === '-') {
              setInvalid(false)
              props.onValidityChange?.(true)
              props.onChange?.(v)
              return
            }
            const n = Number(v)
            const decimalDigit = Math.max(0, Math.floor(props.precision!))
            const integerOk = decimalDigit > 0 || Number.isInteger(n)
            const valid = Number.isFinite(n) && integerOk && n >= props.min && n <= props.max
            props.onValidityChange?.(valid)
            setInvalid(!valid)
            // Invalid: keep the typed text on screen (this input's own DOM
            // value already holds it) and flag it, instead of silently
            // dropping it with no sign anything happened (SC-163's bug).
            if (valid) props.onChange?.(n)
          } else {
            props.onChange?.(raw)
          }
        }}/>
      <Show when={props.suffix}>
        <span class="suffix">{props.suffix}</span>
      </Show>  
    </div>
  )
}

export default Input
