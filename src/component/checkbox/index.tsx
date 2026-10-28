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

import { Component, createSignal, JSX } from 'solid-js'


const CheckedIcon = () => {
  return (
    <svg
      viewBox="0 0 1024 1024"
      class="icon"
      aria-hidden="true">
      <path
        d="M810.666667 128H213.333333c-46.933333 0-85.333333 38.4-85.333333 85.333333v597.333334c0 46.933333 38.4 85.333333 85.333333 85.333333h597.333334c46.933333 0 85.333333-38.4 85.333333-85.333333V213.333333c0-46.933333-38.4-85.333333-85.333333-85.333333z m-353.706667 567.04a42.496 42.496 0 0 1-60.16 0L243.626667 541.866667c-8.106667-8.106667-12.373333-18.773333-12.373334-29.866667s4.693333-22.186667 12.373334-29.866667a42.496 42.496 0 0 1 60.16 0L426.666667 604.586667l293.546666-293.546667a42.496 42.496 0 1 1 60.16 60.16l-323.413333 323.84z"/>
    </svg>
  )
}

const NormalIcon = () => {
  return (
    <svg
      viewBox="0 0 1024 1024"
      class="icon"
      aria-hidden="true">
      <path
        d="M245.333333 128h533.333334A117.333333 117.333333 0 0 1 896 245.333333v533.333334A117.333333 117.333333 0 0 1 778.666667 896H245.333333A117.333333 117.333333 0 0 1 128 778.666667V245.333333A117.333333 117.333333 0 0 1 245.333333 128z m0 64c-29.44 0-53.333333 23.893333-53.333333 53.333333v533.333334c0 29.44 23.893333 53.333333 53.333333 53.333333h533.333334c29.44 0 53.333333-23.893333 53.333333-53.333333V245.333333c0-29.44-23.893333-53.333333-53.333333-53.333333H245.333333z"/>
    </svg>
  )
}

export interface CheckboxProps {
  class?: string
  style?: JSX.CSSProperties | string
  /** Given: controlled, it shows this value and only reports clicks. */
  checked?: boolean
  label?: JSX.Element
  onChange?: (checked: boolean) => void
}

// Controlled when `checked` is passed (SC-145): it renders that value and
// never flips itself, so a parent that re-renders it (or ignores a click)
// is never out of step with it. Its icons are decorative; the label is its
// text. A parent that makes a whole row the checkbox (role="checkbox" on the
// row, as the indicator dialog does) gives it no onChange.
const Checkbox: Component<CheckboxProps> = props => {
  const [innerChecked, setInnerChecked] = createSignal(props.checked ?? false)
  const checked = (): boolean => props.checked ?? innerChecked()

  return (
    <div
      style={props.style}
      class={`klinecharts-pro-checkbox ${(checked() && 'checked') || ''} ${props.class || ''}`}
      onClick={_ => {
        const ck = !checked()
        props.onChange && props.onChange(ck)
        if (props.checked === undefined) {
          setInnerChecked(ck)
        }
      }}>
      {checked() ? <CheckedIcon/> : <NormalIcon/>}
      {
      props.label && <span class="label">{props.label}</span>}
    </div>
  )
}

export default Checkbox
