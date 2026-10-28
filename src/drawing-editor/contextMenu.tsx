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

// The menu a right-click on a finished drawing opens (SC-090), instead of
// klinecharts' old silent delete. Same action list, icons and visual language
// as the floating toolbar's own "More" menu (drawing-toolbar/index.tsx), so
// the two feel like one editor; positioned at the press point instead of a
// button, and closed the same three ways every popover in this chart is:
// Esc (through the chart's key dispatcher, POPOVER priority — above the
// toolbar's own EDITOR-priority shortcuts, so it never leaks past the menu),
// a press outside it, or picking an item.
//
// Part of SUPer-Chart (Apache-2.0).

import { Component, For, JSX, createEffect, onCleanup, onMount } from 'solid-js'

import i18n from '../i18n'
import { useChartScope } from '../common/chartScope'
import { KEY_PRIORITY, isEscape } from '../common/keyDispatcher'
import { createOutsideDismiss } from '../common/outsideDismiss'
import { clampPosition } from './geometry'
import { TOOLBAR_LABELS } from './labels'
import { Icon } from '../widget/drawing-bar/icons'
import { CloneIcon, FrontIcon, BackIcon, HideIcon } from '../widget/drawing-toolbar/icons'
import type { SelectionAnchor } from './controller'

export interface DrawingContextMenuProps {
  locale: string
  /** Page coordinates of the right-click that opened it. */
  anchor: SelectionAnchor
  /** The chart area element; the menu is kept inside it. Must share an offsetParent with the menu. */
  chartElement: () => HTMLElement | undefined
  locked: boolean
  canReorder: boolean
  onToggleLock: () => void
  onClone: () => void
  onBringToFront: () => void
  onSendToBack: () => void
  onHide: () => void
  onDelete: () => void
  onClose: () => void
}

const DrawingContextMenu: Component<DrawingContextMenuProps> = props => {
  let menuRef: HTMLDivElement | undefined
  const t = (key: string): string => i18n(key, props.locale)
  const scope = useChartScope()

  const place = (): JSX.CSSProperties => {
    const chart = props.chartElement()
    if (chart === undefined || menuRef === undefined) {
      return { visibility: 'hidden' }
    }
    const box = chart.getBoundingClientRect()
    const at = { x: props.anchor.pageX - window.scrollX - box.left, y: props.anchor.pageY - window.scrollY - box.top }
    const bounds = { x: 0, y: 0, width: chart.clientWidth, height: chart.clientHeight }
    const size = { width: menuRef.offsetWidth, height: menuRef.offsetHeight }
    const clamped = clampPosition(at, size, bounds)
    return { left: `${clamped.x}px`, top: `${clamped.y}px`, visibility: 'visible' }
  }

  const dismiss = createOutsideDismiss({
    isOpen: () => true,
    inside: () => [menuRef],
    close: () => { props.onClose() }
  })

  onMount(() => {
    menuRef?.focus({ preventScroll: true })
  })

  // Esc closes only this menu — a POPOVER-priority handler beats the
  // toolbar/editor's own EDITOR-priority shortcuts and the chart's CHART ones.
  createEffect(() => {
    if (scope === undefined) {
      return
    }
    const off = scope.keys.register(e => {
      if (!isEscape(e)) {
        return false
      }
      e.preventDefault()
      props.onClose()
      return true
    }, { priority: KEY_PRIORITY.POPOVER })
    onCleanup(off)
  })

  const act = (fn: () => void): void => {
    fn()
    props.onClose()
  }

  const items = (): Array<{ key: string, label: string, icon: JSX.Element, disabled?: boolean, onSelect: () => void }> => [
    {
      key: 'lock',
      label: t(props.locked ? TOOLBAR_LABELS.unlock : TOOLBAR_LABELS.lock),
      icon: props.locked ? <Icon name="unlock"/> : <Icon name="lock"/>,
      onSelect: props.onToggleLock
    },
    { key: 'clone', label: t(TOOLBAR_LABELS.clone), icon: <CloneIcon/>, onSelect: props.onClone },
    { key: 'front', label: t(TOOLBAR_LABELS.bringToFront), icon: <FrontIcon/>, disabled: !props.canReorder, onSelect: props.onBringToFront },
    { key: 'back', label: t(TOOLBAR_LABELS.sendToBack), icon: <BackIcon/>, disabled: !props.canReorder, onSelect: props.onSendToBack },
    { key: 'hide', label: t(TOOLBAR_LABELS.hide), icon: <HideIcon/>, onSelect: props.onHide },
    { key: 'delete', label: t(TOOLBAR_LABELS.remove), icon: <Icon name="remove"/>, onSelect: props.onDelete }
  ]

  return (
    <div
      ref={menuRef}
      class="klinecharts-pro-drawing-context-menu"
      role="menu"
      tabIndex={-1}
      aria-label={t(TOOLBAR_LABELS.contextMenu)}
      style={place()}
      onFocusOut={dismiss.onFocusOut}
      onContextMenu={e => { e.preventDefault() }}>
      <For each={items()}>
        {item => (
          <button
            type="button"
            role="menuitem"
            class="tb-menu-item"
            disabled={item.disabled === true}
            onClick={() => { act(item.onSelect) }}>
            {item.icon}<span>{item.label}</span>
          </button>
        )}
      </For>
    </div>
  )
}

export default DrawingContextMenu
