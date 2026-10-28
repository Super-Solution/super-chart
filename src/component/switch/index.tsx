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

import { Component, JSX } from 'solid-js'

// A switch (SC-145): role="switch" with aria-checked, focusable, and Space or
// Enter toggles it. Named by its label (labelId) or ariaLabel.

export interface SwitchProps {
  class?: string
  style?: JSX.CSSProperties | string
  open: boolean
  /** The id of the element naming it. */
  labelId?: string
  ariaLabel?: string
  onChange: () => void
}

const Switch: Component<SwitchProps> = props => {
  return (
    <div
      style={props.style}
      class={`klinecharts-pro-switch ${props.open ? 'turn-on' : 'turn-off'} ${props.class ?? ''}`}
      role="switch"
      aria-checked={props.open}
      aria-labelledby={props.labelId}
      aria-label={props.labelId === undefined ? props.ariaLabel : undefined}
      tabIndex={0}
      onClick={_ => {
        props.onChange && props.onChange()
      }}
      onKeyDown={e => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault()
          props.onChange && props.onChange()
        }
      }}>
      <i
        class="thumb"/>
    </div>
  )
}

export default Switch
