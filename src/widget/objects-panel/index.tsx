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

// The object tree (SC-151): every tracked user drawing, one row each — never
// a host overlay, since it is built only from DrawingEditor.listDrawings(),
// which itself only ever enumerates `_userIds`. A row's eye/lock/delete call
// straight into the editor's id-based ops (setDrawingVisible/setDrawingLocked/
// removeDrawing), so a per-row action is undo-able exactly like the toolbar's.
//
// Part of SUPer-Chart (Apache-2.0).

import { Component, For, Show, createEffect, onCleanup } from 'solid-js'

import i18n from '../../i18n'
import { TOOLBAR_LABELS } from '../../drawing-editor/labels'
import { Icon } from '../drawing-bar/icons'
import { useChartScope } from '../../common/chartScope'
import { KEY_PRIORITY, isEscape } from '../../common/keyDispatcher'
import { createOutsideDismiss } from '../../common/outsideDismiss'

export interface ObjectsPanelRow {
  id: string
  name: string
  visible: boolean
  locked: boolean
}

export interface ObjectsPanelProps {
  locale: string
  rows: ObjectsPanelRow[]
  selectedId: string | null
  /** The button that opened the panel: counts as "inside" for outside-dismiss, and gets focus back on close. */
  anchor: () => HTMLElement | undefined
  onSelect: (id: string) => void
  onToggleVisible: (id: string, visible: boolean) => void
  onToggleLocked: (id: string, locked: boolean) => void
  onRemove: (id: string) => void
  onClose: () => void
}

const ObjectsPanel: Component<ObjectsPanelProps> = props => {
  let panelRef: HTMLDivElement | undefined
  const t = (key: string): string => i18n(key, props.locale)
  const scope = useChartScope()

  const close = (): void => {
    props.onClose()
    const anchor = props.anchor()
    if (anchor?.isConnected === true) {
      anchor.focus({ preventScroll: true })
    }
  }

  const dismiss = createOutsideDismiss({
    isOpen: () => true,
    inside: () => [panelRef, props.anchor()],
    close: () => { props.onClose() } // an outside press moved focus elsewhere on purpose: do not steal it back
  })

  createEffect(() => {
    if (scope === undefined) {
      return
    }
    const off = scope.keys.register(e => {
      if (!isEscape(e)) {
        return false
      }
      e.preventDefault()
      close()
      return true
    }, { priority: KEY_PRIORITY.POPOVER })
    onCleanup(off)
  })

  return (
    <div
      ref={panelRef}
      class="klinecharts-pro-objects-panel"
      role="dialog"
      aria-label={t(TOOLBAR_LABELS.objectsPanelTitle)}
      onFocusOut={dismiss.onFocusOut}>
      <div class="op-title">{t(TOOLBAR_LABELS.objectsPanelTitle)}</div>
      <Show when={props.rows.length > 0} fallback={<div class="op-empty">{t(TOOLBAR_LABELS.objectsPanelEmpty)}</div>}>
        <ul class="op-list" role="listbox" aria-label={t(TOOLBAR_LABELS.objectsPanelTitle)}>
          <For each={props.rows}>
            {row => (
              <li class="op-row" classList={{ selected: row.id === props.selectedId }}>
                <button
                  type="button"
                  class="op-name"
                  role="option"
                  aria-selected={row.id === props.selectedId}
                  onClick={() => { props.onSelect(row.id) }}>
                  {row.name}
                </button>
                <button
                  type="button"
                  class="op-icon"
                  aria-label={row.visible ? t(TOOLBAR_LABELS.hide) : t(TOOLBAR_LABELS.objectsPanelShow)}
                  onClick={() => { props.onToggleVisible(row.id, !row.visible) }}>
                  <Icon name={row.visible ? 'visible' : 'invisible'}/>
                </button>
                <button
                  type="button"
                  class="op-icon"
                  aria-label={row.locked ? t(TOOLBAR_LABELS.unlock) : t(TOOLBAR_LABELS.lock)}
                  aria-pressed={row.locked}
                  onClick={() => { props.onToggleLocked(row.id, !row.locked) }}>
                  <Icon name={row.locked ? 'lock' : 'unlock'}/>
                </button>
                <button
                  type="button"
                  class="op-icon"
                  aria-label={t(TOOLBAR_LABELS.remove)}
                  onClick={() => { props.onRemove(row.id) }}>
                  <Icon name="remove"/>
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  )
}

export default ObjectsPanel
