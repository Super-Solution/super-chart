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

// The chart's dialog (SC-105, SC-078, SC-071).
//
// - role="dialog" named by its title. aria-modal only while the chart is full
//   screen: otherwise the overlay covers the chart alone and the host page
//   around it stays live, so it must not be announced as inert.
// - Closes on Escape (through the chart's key dispatcher, before the drawing
//   editor, freehand and the host's own Escape handlers see the key), on a
//   press that starts and ends on the backdrop (not a drag out of a field),
//   and on its close button (a real button, 28px, named "Close").
// - While open it suspends the chart's shortcuts, so Delete or Backspace on
//   a control in it never deletes the drawing behind it.
// - Focus moves in when it opens (the first field, else the dialog) and back
//   to what had it when it closes. Tab and Shift+Tab wrap inside it; nothing
//   recaptures focus at the document, so the host page beside the chart
//   stays usable.
// - Enter submits only where a dialog opts in (`onEnter`), and only from a
//   text field: never on a button, a list or a destructive action.
// - It fits a short or narrow chart: at most the chart's size minus 16px,
//   the body scrolls, the title and buttons stay.
//
// Part of SUPer-Chart (Apache-2.0).

import { ParentComponent, ParentProps, JSX, Show, For, onMount, onCleanup } from 'solid-js'

import Button, { ButtonProps } from '../button'
import { useChartScope } from '../../common/chartScope'
import { KEY_PRIORITY, isEscape, isTextEntryTarget } from '../../common/keyDispatcher'
import i18n from '../../i18n'

export interface ModalProps extends ParentProps {
  width?: number
  title?: JSX.Element
  buttons?: ButtonProps[]
  /** The close button's accessible name, pre-localized by the caller.
   *  Takes precedence over `locale` when both are given. */
  closeLabel?: string
  /** The close button's name, resolved from this locale when `closeLabel`
   *  is not given. @default 'en-US' strings */
  locale?: string
  onClose?: () => void
  /** Enter in a text field of this dialog calls it (opt-in). */
  onEnter?: () => void
  /** Extra class on the dialog box. */
  class?: string
}

let modalSeq = 0

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function focusables (container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el => !el.hidden && el.getClientRects().length > 0)
}

const Modal: ParentComponent<ModalProps> = props => {
  const scope = useChartScope()
  const titleId = `klinecharts-pro-modal-title-${++modalSeq}`
  let innerRef: HTMLDivElement | undefined
  let pressedBackdrop = false
  const opener = document.activeElement as HTMLElement | null

  const close = (): void => { props.onClose?.() }

  onMount(() => {
    const release = scope?.keys.suspend()
    const off = scope?.keys.register(e => {
      if (!isEscape(e)) {
        return false
      }
      e.preventDefault()
      close()
      return true
    }, { priority: KEY_PRIORITY.MODAL })
    // The first text field, else the dialog itself.
    const field = innerRef?.querySelector<HTMLElement>('input:not([disabled]):not([type="hidden"]), textarea:not([disabled])')
    ;(field ?? innerRef)?.focus({ preventScroll: true })
    onCleanup(() => {
      off?.()
      release?.()
      // Back to the opener, if it is still there and was not the page.
      if (opener !== null && opener.isConnected && opener !== document.body && typeof opener.focus === 'function') {
        const active = document.activeElement
        if (active === null || active === document.body || innerRef?.contains(active) === true || !(active as Node).isConnected) {
          opener.focus({ preventScroll: true })
        }
      }
    })
  })

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Tab' && innerRef !== undefined) {
      const list = focusables(innerRef)
      if (list.length === 0) {
        e.preventDefault()
        innerRef.focus({ preventScroll: true })
        return
      }
      const first = list[0]
      const last = list[list.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || active === innerRef)) {
        e.preventDefault()
        last.focus({ preventScroll: true })
      } else if (!e.shiftKey && (active === last || active === innerRef)) {
        e.preventDefault()
        first.focus({ preventScroll: true })
      }
      return
    }
    if (e.key === 'Enter' && props.onEnter !== undefined && !e.isComposing && isTextEntryTarget(e.target) && (e.target as HTMLElement).tagName === 'INPUT') {
      e.preventDefault()
      props.onEnter()
      return
    }
    // Outside a chart there is no dispatcher: close on Escape here.
    if (scope === undefined && isEscape(e)) {
      e.preventDefault()
      close()
    }
  }

  return (
    <div
      class="klinecharts-pro-modal"
      onPointerDown={e => { pressedBackdrop = e.target === e.currentTarget }}
      onClick={e => {
        if (pressedBackdrop && e.target === e.currentTarget) {
          close()
        }
        pressedBackdrop = false
      }}>
      <div
        ref={innerRef}
        role="dialog"
        aria-modal={scope?.fullscreen.isFullscreen() === true ? 'true' : undefined}
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{ width: `min(${props.width ?? 400}px, calc(100% - 16px))` }}
        class={`inner ${props.class ?? ''}`}
        onKeyDown={onKeyDown}>
        <div
          class="title-container">
          <span id={titleId} class="title">{props.title}</span>
          <button
            type="button"
            class="close-icon"
            aria-label={props.closeLabel ?? i18n('close', props.locale ?? 'en-US')}
            title={props.closeLabel ?? i18n('close', props.locale ?? 'en-US')}
            onClick={close}>
            <svg
              viewBox="0 0 1024 1024"
              aria-hidden="true">
              <path
                d="M934.184927 199.723787 622.457206 511.452531l311.727721 311.703161c14.334473 14.229073 23.069415 33.951253 23.069415 55.743582 0 43.430138-35.178197 78.660524-78.735226 78.660524-21.664416 0-41.361013-8.865925-55.642275-23.069415L511.149121 622.838388 199.420377 934.490384c-14.204513 14.20349-33.901111 23.069415-55.642275 23.069415-43.482327 0-78.737272-35.230386-78.737272-78.660524 0-21.792329 8.864902-41.513486 23.094998-55.743582l311.677579-311.703161L88.135828 199.723787c-14.230096-14.255679-23.094998-33.92567-23.094998-55.642275 0-43.430138 35.254945-78.762855 78.737272-78.762855 21.741163 0 41.437761 8.813736 55.642275 23.069415l311.727721 311.727721L822.876842 88.389096c14.281261-14.255679 33.977859-23.069415 55.642275-23.069415 43.557028 0 78.735226 35.332716 78.735226 78.762855C957.254342 165.798117 948.5194 185.468109 934.184927 199.723787" />
            </svg>
          </button>
        </div>
        <div
          class="content-container">
          {props.children}
        </div>
        <Show when={props.buttons !== undefined && props.buttons.length > 0}>
          <div
            class="button-container">
            <For each={props.buttons}>
              {button => (
                <Button {...button}>
                  {button.children}
                </Button>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  )
}

export default Modal
