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

// A select-only combobox (WAI-ARIA 1.2 pattern, SC-145) with the current
// option marked by a check (SC-060).
//
// - Enter, Space, ArrowDown, ArrowUp or Alt+ArrowDown open it; ArrowUp and
//   ArrowDown, Home and End move the active option (aria-activedescendant,
//   focus stays on the combobox); Enter or Space picks; typing jumps to the
//   next option starting with those letters (the long timezone list).
// - Escape closes the list only: through the chart's key dispatcher it is
//   taken before the dialog it sits in, or the drawing editor, sees it.
// - On opening, the list scrolls itself (never the page or the dialog) so
//   the current option is centred.
// - The list is position: fixed, so the scrolling body of a dialog cannot
//   clip it; inside a chart the chart's root is its containing block. It
//   opens upward when there is more room above.
//
// Part of SUPer-Chart (Apache-2.0).

import { createSignal, createEffect, onCleanup, Component, JSX, For, Show } from 'solid-js'

import { useChartScope } from '../../common/chartScope'
import { KEY_PRIORITY, isEscape } from '../../common/keyDispatcher'
import { CheckIcon } from '../menu'
import { centredScrollTop, matchesTyped } from '../../common/popover'

export interface SelectDataSourceItem {
  key: string
  text: JSX.Element
}

export interface SelectProps {
  class?: string
  style?: JSX.CSSProperties | string
  value?: JSX.Element
  valueKey?: string
  /** The current option's key; without it, the option whose text equals `value`. */
  selectedKey?: string
  /** The id of the element naming it (its label), or a name. */
  labelId?: string
  ariaLabel?: string
  dataSource?: SelectDataSourceItem[] | string[]
  onSelected?: (data: SelectDataSourceItem | string) => void
}

let selectSeq = 0

const Select: Component<SelectProps> = props => {
  const scope = useChartScope()
  const id = `klinecharts-pro-select-${++selectSeq}`
  const [open, setOpen] = createSignal(false)
  const [active, setActive] = createSignal(-1)
  let ref: HTMLDivElement | undefined
  let dropRef: HTMLDivElement | undefined
  let typed = ''
  let typedAt = 0

  const items = (): Array<SelectDataSourceItem | string> => (props.dataSource ?? []) as Array<SelectDataSourceItem | string>
  const textOf = (data: SelectDataSourceItem | string): JSX.Element => {
    const d = data as SelectDataSourceItem
    // @ts-expect-error
    return d[props.valueKey ?? 'text'] ?? data
  }
  const keyOf = (data: SelectDataSourceItem | string): string => typeof data === 'string' ? data : data.key
  const selectedIndex = (): number => items().findIndex(data => props.selectedKey !== undefined ? keyOf(data) === props.selectedKey : textOf(data) === props.value)
  const optionId = (i: number): string => `${id}-option-${i}`

  const place = (): void => {
    const trigger = ref
    const drop = dropRef
    if (trigger === undefined || drop === undefined) {
      return
    }
    // The containing block of a fixed element: the viewport, or the chart's
    // root (it has layout containment). Its origin is where (0, 0) lands.
    drop.style.top = '0px'
    drop.style.left = '0px'
    drop.style.bottom = ''
    const origin = drop.getBoundingClientRect()
    const box = trigger.getBoundingClientRect()
    const limit = scope?.root.getBoundingClientRect() ?? { top: 0, bottom: document.documentElement.clientHeight }
    const below = limit.bottom - box.bottom - 4
    const above = box.top - limit.top - 4
    const upward = below < 160 && above > below
    drop.style.left = `${box.left - origin.left}px`
    drop.style.width = `${box.width}px`
    drop.style.maxHeight = `${Math.max(80, Math.min(200, upward ? above : below))}px`
    if (upward) {
      drop.style.top = `${box.top - origin.top - drop.offsetHeight - 1}px`
    } else {
      drop.style.top = `${box.bottom - origin.top + 1}px`
    }
  }

  const keepVisible = (i: number, centre: boolean): void => {
    const drop = dropRef
    const row = drop?.querySelectorAll<HTMLElement>('li')[i]
    if (drop === undefined || row === undefined) {
      return
    }
    if (centre) {
      drop.scrollTop = centredScrollTop(row.offsetTop, row.offsetHeight, drop.clientHeight, drop.scrollHeight)
    } else if (row.offsetTop < drop.scrollTop) {
      drop.scrollTop = row.offsetTop
    } else if (row.offsetTop + row.offsetHeight > drop.scrollTop + drop.clientHeight) {
      drop.scrollTop = row.offsetTop + row.offsetHeight - drop.clientHeight
    }
  }

  const show = (at?: number): void => {
    if (items().length === 0) {
      return
    }
    const i = at ?? Math.max(0, selectedIndex())
    setActive(i)
    setOpen(true)
    place()
    keepVisible(i, true)
  }

  const hide = (): void => {
    setOpen(false)
    setActive(-1)
  }

  const pick = (i: number): void => {
    const data = items()[i]
    hide()
    if (data !== undefined && i !== selectedIndex()) {
      props.onSelected?.(data)
    }
  }

  const move = (i: number): void => {
    const n = items().length
    const to = Math.max(0, Math.min(n - 1, i))
    setActive(to)
    keepVisible(to, false)
  }

  // Escape closes the list only.
  createEffect(() => {
    if (!open() || scope === undefined) {
      return
    }
    const off = scope.keys.register(e => {
      if (!isEscape(e)) {
        return false
      }
      e.preventDefault()
      hide()
      return true
    }, { priority: KEY_PRIORITY.POPOVER })
    // A scroll of the dialog or the page would leave the list behind.
    const onScroll = (e: Event): void => {
      if (e.target !== dropRef) {
        hide()
      }
    }
    document.addEventListener('scroll', onScroll, true)
    onCleanup(() => {
      off()
      document.removeEventListener('scroll', onScroll, true)
    })
  })

  const typeAhead = (key: string): void => {
    const now = Date.now()
    typed = now - typedAt > 700 ? key.toLowerCase() : typed + key.toLowerCase()
    typedAt = now
    const list = items()
    const n = list.length
    const from = Math.max(0, open() ? active() : selectedIndex())
    // One letter searches from the next option (pressing it again cycles);
    // a longer prefix from the current one.
    const start = typed.length === 1 ? 1 : 0
    for (let k = 0; k < n; k++) {
      const i = (from + start + k) % n
      if (matchesTyped(String(textOf(list[i]) ?? ''), typed)) {
        if (open()) {
          move(i)
        } else {
          show(i)
        }
        return
      }
    }
  }

  const onKeyDown = (e: KeyboardEvent): void => {
    const n = items().length
    if (!open()) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        show()
      } else if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault()
        show(e.key === 'Home' ? 0 : n - 1)
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        typeAhead(e.key)
      }
      return
    }
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); move(active() + 1); break
      case 'ArrowUp':
        e.preventDefault()
        if (e.altKey) { pick(active()) } else { move(active() - 1) }
        break
      case 'Home': e.preventDefault(); move(0); break
      case 'End': e.preventDefault(); move(n - 1); break
      case 'PageDown': e.preventDefault(); move(active() + 5); break
      case 'PageUp': e.preventDefault(); move(active() - 5); break
      case 'Enter':
      case ' ':
        e.preventDefault()
        pick(active())
        break
      case 'Tab': hide(); break
      default:
        if (scope === undefined && isEscape(e)) {
          e.preventDefault()
          hide()
        } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          typeAhead(e.key)
        }
    }
  }

  return (
    <div
      ref={ref}
      style={props.style}
      class={`klinecharts-pro-select ${props.class ?? ''} ${open() ? 'klinecharts-pro-select-show' : ''}`}
      tabIndex="0"
      role="combobox"
      aria-haspopup="listbox"
      aria-expanded={open()}
      aria-controls={`${id}-list`}
      aria-activedescendant={open() && active() >= 0 ? optionId(active()) : undefined}
      aria-labelledby={props.labelId}
      aria-label={props.labelId === undefined ? props.ariaLabel : undefined}
      onClick={() => { if (open()) { hide() } else { show() } }}
      onKeyDown={onKeyDown}
      onBlur={() => { hide() }}>
      <div
        class="selector-container">
        <span class="value">{props.value}</span>
        <i class="arrow" aria-hidden="true"/>
      </div>
      <Show when={items().length > 0}>
        <div
          ref={dropRef}
          class="drop-down-container">
          <ul role="listbox" id={`${id}-list`}>
            <For each={items()}>
              {(data, i) => (
                <li
                  id={optionId(i())}
                  role="option"
                  aria-selected={i() === selectedIndex()}
                  class={`${i() === selectedIndex() ? 'selected' : ''} ${i() === active() ? 'active' : ''}`}
                  onMouseDown={e => { e.preventDefault() }}
                  onClick={e => {
                    e.stopPropagation()
                    pick(i())
                  }}>
                  <span class="check">
                    <Show when={i() === selectedIndex()}><CheckIcon/></Show>
                  </span>
                  <span class="text">{textOf(data)}</span>
                </li>
              )}
            </For>
          </ul>
        </div>
      </Show>
    </div>
  )
}

export default Select
