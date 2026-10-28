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

// The timezone picker: a popover under the top bar's Timezone item (it was a
// modal with a select and a Confirm button, four clicks). A click on a zone
// applies it and closes. A search field filters the list; it is an ARIA
// combobox over a listbox: ↑/↓, Home/End, Enter applies, Escape closes, and
// focus goes back to the Timezone item.

import { Component, createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js'

import i18n from '../../i18n'

import { createTimezoneOptions, matchesTimezone, sameZone } from './data'

export interface TimezonePickerProps {
  locale: string
  /** The chart's zone (an IANA id). */
  timezone: string
  /** The Timezone item the popover opens from. */
  anchor: () => HTMLElement | null | undefined
  onSelect: (timezone: string) => void
  onClose: () => void
}

let pickerSeq = 0

const WIDTH = 280

const TimezonePicker: Component<TimezonePickerProps> = props => {
  const id = `klinecharts-pro-timezone-${++pickerSeq}`
  let root: HTMLDivElement | undefined
  let input: HTMLInputElement | undefined
  let list: HTMLUListElement | undefined

  const options = createMemo(() => createTimezoneOptions(props.locale))
  const [query, setQuery] = createSignal('')
  const filtered = createMemo(() => options().filter(o => matchesTimezone(o, query(), props.locale)))
  const selectedIndex = (): number => filtered().findIndex(o => sameZone(o.key, props.timezone))
  const [active, setActive] = createSignal(Math.max(0, selectedIndex()))
  const [position, setPosition] = createSignal({ left: 8, top: 40 })

  const close = (restoreFocus: boolean): void => {
    props.onClose()
    if (restoreFocus) {
      props.anchor()?.focus?.()
    }
  }
  const apply = (key: string): void => {
    props.onSelect(key)
    close(true)
  }
  const reveal = (index: number): void => {
    const el = list?.children[index] as HTMLElement | undefined
    el?.scrollIntoView?.({ block: 'nearest' })
  }
  const move = (index: number): void => {
    const count = filtered().length
    if (count === 0) {
      return
    }
    const next = Math.min(count - 1, Math.max(0, index))
    setActive(next)
    reveal(next)
  }

  const onKeyDown = (e: KeyboardEvent): void => {
    switch (e.key) {
      case 'ArrowDown': move(active() + 1); break
      case 'ArrowUp': move(active() - 1); break
      case 'Home': move(0); break
      case 'End': move(filtered().length - 1); break
      case 'PageDown': move(active() + 8); break
      case 'PageUp': move(active() - 8); break
      case 'Enter': {
        const option = filtered()[active()]
        if (option !== undefined) {
          apply(option.key)
        }
        break
      }
      case 'Escape': close(true); break
      case 'Tab': close(false); return
      default: return
    }
    e.preventDefault()
    // Keys typed here are the picker's, not the chart's (drawing shortcuts).
    e.stopPropagation()
  }

  // Outside the popover and its Timezone item (which toggles it), a press closes it.
  const onOutside = (e: PointerEvent): void => {
    const target = e.target as Node | null
    if (target !== null && (root?.contains(target) === true || props.anchor()?.contains(target) === true)) {
      return
    }
    close(false)
  }

  onMount(() => {
    const anchor = props.anchor()
    const container = root?.offsetParent as HTMLElement | null | undefined
    if (anchor !== null && anchor !== undefined && container !== null && container !== undefined) {
      const a = anchor.getBoundingClientRect()
      const c = container.getBoundingClientRect()
      const left = Math.max(8, Math.min(a.left - c.left, c.width - WIDTH - 8))
      setPosition({ left, top: a.bottom - c.top + 4 })
    }
    input?.focus({ preventScroll: true })
    reveal(active())
    root?.ownerDocument.addEventListener('pointerdown', onOutside, true)
  })
  onCleanup(() => {
    root?.ownerDocument.removeEventListener('pointerdown', onOutside, true)
  })

  return (
    <div
      ref={root}
      class="klinecharts-pro-timezone-picker"
      role="dialog"
      aria-label={i18n('timezone', props.locale)}
      style={{ left: `${position().left}px`, top: `${position().top}px`, width: `${WIDTH}px` }}>
      <input
        ref={input}
        class="search"
        type="text"
        role="combobox"
        aria-expanded="true"
        aria-autocomplete="list"
        aria-controls={`${id}-list`}
        aria-activedescendant={filtered().length > 0 ? `${id}-${active()}` : undefined}
        aria-label={i18n('timezone_search', props.locale)}
        placeholder={i18n('timezone_search', props.locale)}
        value={query()}
        onInput={e => {
          setQuery(e.currentTarget.value)
          setActive(0)
          if (list !== undefined) list.scrollTop = 0
        }}
        onKeyDown={onKeyDown}/>
      <ul
        ref={list}
        id={`${id}-list`}
        class="list"
        role="listbox"
        aria-label={i18n('timezone', props.locale)}
        // Keep focus in the search field while an option is clicked.
        onMouseDown={e => { e.preventDefault() }}>
        <For each={filtered()}>
          {(option, index) => (
            <li
              id={`${id}-${index()}`}
              role="option"
              aria-selected={sameZone(option.key, props.timezone)}
              data-key={option.key}
              data-group={option.group}
              class={`${index() === active() ? 'active' : ''} ${sameZone(option.key, props.timezone) ? 'selected' : ''}`}
              onMouseMove={() => { if (active() !== index()) setActive(index()) }}
              onClick={() => { apply(option.key) }}>
              <span class="name">{option.name}</span>
              <span class="offset">{option.offset}</span>
            </li>
          )}
        </For>
      </ul>
      <Show when={filtered().length === 0}>
        <div class="empty">{i18n('timezone_no_match', props.locale)}</div>
      </Show>
    </div>
  )
}

export default TimezonePicker
