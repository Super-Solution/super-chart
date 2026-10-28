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

// A menu opened from a button (the WAI-ARIA menu button pattern), for the
// top bar's chart type, periods and More menus (SC-143, SC-060, SC-064).
//
// - Rendered at the chart's root, positioned from its trigger and kept
//   inside the chart's width: nothing that clips or scrolls the top bar can
//   clip it (SC-064), and the root's overflow-x clip never cuts it off.
// - Items are buttons: role menuitemradio with aria-checked and a check mark
//   when the menu picks one value (the check is the cue, not colour alone,
//   SC-060), else menuitem. Arrow keys, Home and End move focus; Enter or
//   Space picks; Escape (through the chart's key dispatcher, so it closes
//   only this menu) and Tab close it; focus goes back to the trigger.
// - A press anywhere outside it closes it, touch taps on the canvas
//   included (createOutsideDismiss, SC-083).
//
// Part of SUPer-Chart (Apache-2.0).

import { Component, For, JSX, Show, createSignal, onCleanup, onMount, createEffect } from 'solid-js'
import { Portal } from 'solid-js/web'

import { useChartScope } from '../../common/chartScope'
import { KEY_PRIORITY, isEscape } from '../../common/keyDispatcher'
import { createOutsideDismiss } from '../../common/outsideDismiss'
import { placeMenu } from '../../common/popover'

export interface MenuItem {
  key: string
  label: string
  /** Defined: a radio item (true for the current value), or a checkbox item with `toggle`. */
  checked?: boolean
  /** A checkbox item (an on/off tool) instead of a radio item. */
  toggle?: boolean
  /** The item stays in the DOM but cannot be picked. */
  disabled?: boolean
  onSelect: () => void
}

export type MenuCloseReason = 'select' | 'escape' | 'outside' | 'tab'

export interface MenuProps {
  open: boolean
  anchor: () => HTMLElement | undefined
  items: MenuItem[]
  /** The menu's accessible name. */
  label: string
  id?: string
  class?: string
  itemClass?: string
  onClose: (reason: MenuCloseReason) => void
}

export const CheckIcon: Component = () => (
  <svg class="klinecharts-pro-check" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M3 8.5l3.2 3.2L13 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
)

const Menu: Component<MenuProps> = props => {
  const scope = useChartScope()
  let menuEl: HTMLDivElement | undefined

  const dismiss = createOutsideDismiss({
    isOpen: () => props.open,
    inside: () => [menuEl, props.anchor()],
    close: () => { props.onClose('outside') }
  })

  const focusTrigger = (anchor: HTMLElement | undefined): void => {
    if (anchor?.isConnected === true && !anchor.hidden) {
      anchor.focus({ preventScroll: true })
    }
  }

  const close = (reason: MenuCloseReason): void => {
    // Read before closing: the owner forgets its anchor when it closes.
    const anchor = props.anchor()
    props.onClose(reason)
    if (reason === 'escape') {
      focusTrigger(anchor)
    }
  }

  // Escape closes this menu only: the modal, the drawing editor and the host
  // never see that key press.
  createEffect(() => {
    if (!props.open || scope === undefined) {
      return
    }
    const off = scope.keys.register(e => {
      if (!isEscape(e)) {
        return false
      }
      e.preventDefault()
      close('escape')
      return true
    }, { priority: KEY_PRIORITY.POPOVER })
    onCleanup(off)
  })

  // One check column for every item once any item can be checked, so labels align.
  const hasChecks = (): boolean => props.items.some(item => item.checked !== undefined)

  const items = (): HTMLElement[] => [...(menuEl?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])') ?? [])]

  const onKeyDown = (e: KeyboardEvent): void => {
    const list = items()
    const i = list.indexOf(document.activeElement as HTMLElement)
    const move = (to: number): void => {
      e.preventDefault()
      list[(to + list.length) % list.length]?.focus({ preventScroll: true })
    }
    switch (e.key) {
      case 'ArrowDown': move(i + 1); break
      case 'ArrowUp': move(i < 0 ? list.length - 1 : i - 1); break
      case 'Home': move(0); break
      case 'End': move(list.length - 1); break
      case 'Tab': close('tab'); break
      default:
        // Outside a chart there is no dispatcher: close on Escape here.
        if (scope === undefined && isEscape(e)) {
          e.preventDefault()
          close('escape')
        }
    }
  }

  const Surface: Component = () => {
    const [pos, setPos] = createSignal({ left: 0, top: 0, maxHeight: 0 })
    onMount(() => {
      const anchor = props.anchor()
      const container = scope?.root
      if (anchor !== undefined && menuEl !== undefined) {
        const a = anchor.getBoundingClientRect()
        const c = container?.getBoundingClientRect() ?? { left: 0, top: 0 }
        const width = container?.clientWidth ?? document.documentElement.clientWidth
        const height = container?.clientHeight ?? document.documentElement.clientHeight
        const at = placeMenu({ left: a.left - c.left, top: a.top - c.top, bottom: a.bottom - c.top }, menuEl.offsetWidth, width)
        // A long list in a short chart scrolls instead of running off it.
        setPos({ ...at, maxHeight: Math.max(120, height - at.top - 8) })
      }
      // Focus the current value, else the first item.
      const list = items()
      const current = list.find(el => el.getAttribute('aria-checked') === 'true') ?? list[0]
      current?.focus({ preventScroll: true })
    })
    const style = (): JSX.CSSProperties => ({
      left: `${pos().left}px`,
      top: `${pos().top}px`,
      ...(pos().maxHeight > 0 ? { 'max-height': `${pos().maxHeight}px` } : {})
    })
    return (
      <div
        ref={el => { menuEl = el }}
        id={props.id}
        role="menu"
        aria-label={props.label}
        class={`klinecharts-pro-menu ${props.class ?? ''}`}
        style={style()}
        onKeyDown={onKeyDown}
        onFocusOut={dismiss.onFocusOut}>
        <For each={props.items}>
          {item => (
            <button
              type="button"
              role={item.checked === undefined ? 'menuitem' : (item.toggle === true ? 'menuitemcheckbox' : 'menuitemradio')}
              aria-checked={item.checked === undefined ? undefined : String(item.checked) as 'true' | 'false'}
              aria-disabled={item.disabled === true ? 'true' : undefined}
              tabIndex={-1}
              class={`klinecharts-pro-menu-item ${props.itemClass ?? ''} ${item.checked === true ? 'selected' : ''}`}
              onClick={() => {
                if (item.disabled === true) {
                  return
                }
                const anchor = props.anchor()
                item.onSelect()
                props.onClose('select')
                // Back to the trigger, unless what the item opened (a dialog)
                // took the focus.
                const active = document.activeElement
                if (active === null || active === document.body || menuEl?.contains(active) === true) {
                  focusTrigger(anchor)
                }
              }}>
              <Show when={hasChecks()}>
                <span class="klinecharts-pro-menu-check">
                  <Show when={item.checked === true}><CheckIcon/></Show>
                </span>
              </Show>
              <span class="klinecharts-pro-menu-label">{item.label}</span>
            </button>
          )}
        </For>
      </div>
    )
  }

  return (
    <Show when={props.open}>
      <Portal mount={scope?.root ?? document.body}>
        <Surface/>
      </Portal>
    </Show>
  )
}

export default Menu
