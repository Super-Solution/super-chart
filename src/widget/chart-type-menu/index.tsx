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

// The grouped, favourited chart-type menu (SC-NEXT #2, 11.png): Candles/
// Bars/Lines/Areas group headers, a star toggle per row, the current type
// checked. A dedicated component rather than a mode of the generic <Menu>
// (component/menu) — grouping and a second interactive control (the star)
// per row do not fit that component's one-column, one-action-per-row
// contract, and <Menu> is shared by the period and More menus, which do not
// need either. It reuses the same building blocks <Menu> does (useChartScope,
// createOutsideDismiss, placeMenu, the chart's key dispatcher for Escape), so
// it behaves the same way as every other top-bar menu: rendered at the
// chart's root so nothing clips it, closes on outside press/Escape/Tab,
// returns focus to its trigger.
//
// Part of SUPer-Chart (Apache-2.0).

import { type Component, For, type JSX, Show, createSignal, onCleanup, onMount, createEffect } from 'solid-js'
import { Portal } from 'solid-js/web'

import { CHART_TYPE_GROUPS } from '../../common/chartTypes'
import type { ChartType } from '../../types'
import { useChartScope } from '../../common/chartScope'
import { KEY_PRIORITY, isEscape } from '../../common/keyDispatcher'
import { createOutsideDismiss } from '../../common/outsideDismiss'
import { placeMenu } from '../../common/popover'
import { CheckIcon, type MenuCloseReason } from '../../component/menu'
import i18n from '../../i18n'

const StarIcon: Component<{ filled: boolean }> = props => (
  <svg class="klinecharts-pro-star" viewBox="0 0 16 16" aria-hidden="true">
    <path
      d="M8 1.6l1.9 4.06 4.37.53-3.24 3.05.87 4.36L8 11.5l-3.9 2.1.87-4.36L1.73 6.2l4.37-.53L8 1.6z"
      fill={props.filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      stroke-width="1.1"
      stroke-linejoin="round"/>
  </svg>
)

export interface ChartTypeMenuProps {
  open: boolean
  anchor: () => HTMLElement | undefined
  value: ChartType
  favourites: ReadonlySet<ChartType>
  locale: string
  labelFor: (type: ChartType) => string
  onChange: (type: ChartType) => void
  onToggleFavourite: (type: ChartType) => void
  onClose: (reason: MenuCloseReason) => void
}

const ChartTypeMenu: Component<ChartTypeMenuProps> = props => {
  const scope = useChartScope()
  let menuEl: HTMLDivElement | undefined
  const t = (key: string): string => i18n(key, props.locale)

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
    const anchor = props.anchor()
    props.onClose(reason)
    if (reason === 'escape') focusTrigger(anchor)
  }

  createEffect(() => {
    if (!props.open || scope === undefined) return
    const off = scope.keys.register(e => {
      if (!isEscape(e)) return false
      e.preventDefault()
      close('escape')
      return true
    }, { priority: KEY_PRIORITY.POPOVER })
    onCleanup(off)
  })

  const items = (): HTMLElement[] => [...(menuEl?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])]

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
        if (scope === undefined && isEscape(e)) {
          e.preventDefault()
          close('escape')
        }
    }
  }

  const select = (type: ChartType): void => {
    // Read the anchor BEFORE closing: the owner (period-bar's `menu` signal)
    // forgets it once onClose fires (same ordering note as component/menu's
    // own close()/onClick — props.anchor() reads menu()?.anchor, which is
    // null once onClose has cleared that signal).
    const anchor = props.anchor()
    props.onChange(type)
    props.onClose('select')
    const active = document.activeElement
    if (active === null || active === document.body || menuEl?.contains(active) === true) {
      focusTrigger(anchor)
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
        setPos({ ...at, maxHeight: Math.max(160, height - at.top - 8) })
      }
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
        role="menu"
        aria-label={t('chart_type')}
        // 'chart-type-menu' (unprefixed) is kept alongside the new prefixed
        // class for e2e/host backward compat — SC-124's period-bar.tsx put
        // the old flat <Menu class="chart-type-menu"> selector into several
        // specs (chrome.spec.ts, chrome-layout.spec.ts, style-stack.spec.ts)
        // before this grouped menu existed.
        class="klinecharts-pro-menu klinecharts-pro-chart-type-menu chart-type-menu"
        style={style()}
        onKeyDown={onKeyDown}
        onFocusOut={dismiss.onFocusOut}>
        <For each={CHART_TYPE_GROUPS}>
          {group => (
            <div class="klinecharts-pro-chart-type-group">
              <div class="klinecharts-pro-chart-type-group-label" role="presentation">{t(group.labelKey)}</div>
              <For each={group.types}>
                {type => {
                  const checked = (): boolean => type === props.value
                  const favourite = (): boolean => props.favourites.has(type)
                  return (
                    <div class={`klinecharts-pro-menu-item klinecharts-pro-chart-type-item ${checked() ? 'selected' : ''}`}>
                      <button
                        type="button"
                        role="menuitemradio"
                        aria-checked={String(checked()) as 'true' | 'false'}
                        tabIndex={-1}
                        class="klinecharts-pro-chart-type-item-main chart-type-item"
                        onClick={() => { select(type) }}>
                        <span class="klinecharts-pro-menu-check">
                          <Show when={checked()}><CheckIcon/></Show>
                        </span>
                        <span class="klinecharts-pro-menu-label">{props.labelFor(type)}</span>
                      </button>
                      <button
                        type="button"
                        class={`klinecharts-pro-chart-type-favourite ${favourite() ? 'active' : ''}`}
                        aria-pressed={favourite()}
                        aria-label={t(favourite() ? 'chart_type_favourite_remove' : 'chart_type_favourite_add')}
                        title={t(favourite() ? 'chart_type_favourite_remove' : 'chart_type_favourite_add')}
                        tabIndex={-1}
                        onClick={e => { e.stopPropagation(); props.onToggleFavourite(type) }}>
                        <StarIcon filled={favourite()}/>
                      </button>
                    </div>
                  )
                }}
              </For>
            </div>
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

export default ChartTypeMenu
