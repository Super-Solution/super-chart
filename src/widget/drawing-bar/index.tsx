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

// The drawing rail. Rewritten for this batch:
// - Every control is a real, named <button> (SC-065, SC-144): Tab reaches
//   it, Enter/Space activates it, and it carries the current tool's i18n
//   name in aria-label/title. The armed tool (props.armedTool, owned by
//   ChartProComponent) is marked aria-pressed.
// - Picking a flyout variant no longer rebuilds the whole rail (SC-011): the
//   ten groups are one static array rendered with <For>, and each icon is
//   wrapped in a keyed <Show> so only that one glyph re-renders when its
//   group's tool changes.
// - Flyouts are portaled to the chart's root (SC-077) and clamped inside it
//   (SC-089), the same pattern component/menu/index.tsx already uses, so a
//   short or clipping host never cuts them off.
// - The tool list scrolls when the rail is taller than its container; magnet,
//   lock, the eye and remove-all stay pinned so a short pane never loses them
//   (SC-077).
// - Per-group tool, lock and magnet state is `props.state` (src/widget/
//   drawing-bar/state.ts), owned by ChartProComponent, so hiding and
//   re-showing the rail (it sits inside a <Show>) does not reset them
//   (SC-118, SC-182), and they persist across a reload by default.
//
// DOM/class contract kept for hosts (SupWallet's vibe-studio.css): `.item` is
// still the tool wrapper, and each icon's own `.icon-overlay` and the flyout
// toggle's `.icon-arrow` class are unchanged. `.item` is no longer a direct
// child of `.klinecharts-pro-drawing-bar` (it now scrolls inside `.tools`) —
// vibe-studio.css:132-136's `> .item` rail workaround stops matching and
// should be dropped in the lockstep wallet re-pack (see the PR body).
//
// Part of SUPer-Chart (Apache-2.0).

import { For, Show, createMemo, createSignal, onCleanup, onMount, createEffect } from 'solid-js'
import type { Component } from 'solid-js'
import { Portal } from 'solid-js/web'

import type { OverlayCreate, OverlayMode } from 'klinecharts'

import type { SelectDataSourceItem } from '../../component'
import { CheckIcon } from '../../component/menu'
import { useChartScope } from '../../common/chartScope'
import { KEY_PRIORITY, isEscape } from '../../common/keyDispatcher'
import { createOutsideDismiss } from '../../common/outsideDismiss'
import { clampPosition } from '../../drawing-editor/geometry'
import { CaretIcon } from '../../icons'
import i18n from '../../i18n'
import {
  createSingleLineOptions, createMoreLineOptions,
  createPolygonOptions, createFibonacciOptions, createWaveOptions,
  createPositionOptions, createMeasureOptions, createTextOptions, createBrushOptions, createVolumeOptions,
  createMagnetOptions,
  Icon
} from './icons'
import type { DrawingBarState, ToolGroupKey } from './state'
import { GROUP_KEYS } from './state'

export interface DrawingBarProps {
  locale: string
  /**
   * "All drawings visible" state of the eye button, when the parent owns it
   * (the drawing editor can hide a single drawing, which turns the eye to
   * "hidden" so one click shows everything again). Uncontrolled when omitted.
   */
  visible?: boolean
  /** Per-group tool, lock and magnet state, lifted so hiding/re-showing the rail keeps it (SC-118, SC-182). */
  state: DrawingBarState
  /** The name of the tool currently armed (mid-placement), if any — marks the matching rail button aria-pressed (SC-065, SC-094). */
  armedTool?: string | null
  onDrawingItemClick: (overlay: OverlayCreate) => void
  onModeChange: (mode: string) => void,
  onLockChange: (lock: boolean) => void
  onVisibleChange: (visible: boolean) => void
  onRemoveClick: (groupId: string) => void
}

const GROUP_ID = 'drawing_tools'

interface GroupDef { key: ToolGroupKey, options: (locale: string) => SelectDataSourceItem[] }

/** Static: referential stability is what lets <For> stop rebuilding the rail on a pick (SC-011). */
const GROUPS: readonly GroupDef[] = [
  { key: 'singleLine', options: createSingleLineOptions },
  { key: 'moreLine', options: createMoreLineOptions },
  { key: 'polygon', options: createPolygonOptions },
  { key: 'fibonacci', options: createFibonacciOptions },
  { key: 'wave', options: createWaveOptions },
  { key: 'position', options: createPositionOptions },
  { key: 'measure', options: createMeasureOptions },
  { key: 'text', options: createTextOptions },
  { key: 'brush', options: createBrushOptions },
  { key: 'volume', options: createVolumeOptions }
]

// GROUPS must cover every key state.ts knows about (a stray/missing entry
// would silently drop a group from the rail).
if (GROUPS.length !== GROUP_KEYS.length) {
  throw new Error('[super-chart] drawing-bar GROUPS is out of sync with GROUP_KEYS')
}

// SelectDataSourceItem.text is typed JSX.Element (Solid children are wider
// than string), but every option list here only ever puts a string or an
// i18n() call (itself a string) in it. aria-label/title need an actual
// string, so this coerces once instead of loosening every prop's type.
const textOf = (text: SelectDataSourceItem['text']): string => (typeof text === 'string' ? text : String(text ?? ''))

/**
 * A rail item's flyout: portaled to the chart's root and clamped inside it
 * (SC-077, SC-089), instead of a DOM child of the 52px-wide `.item` (which is
 * itself inside a region that can now scroll and whose ancestor can clip).
 */
const RailFlyout: Component<{
  anchor: () => HTMLElement | undefined
  label: string
  items: readonly SelectDataSourceItem[]
  current: string
  onPick: (key: string) => void
  /** The portaled <ul> itself: the caller's outside-dismiss must treat it as "inside" too — it is not a DOM child of the rail item any more (SC-077), so focusing its first row on open would otherwise look like focus leaving the item. */
  onListRef: (el: HTMLUListElement | undefined) => void
}> = fp => {
  const scope = useChartScope()
  let listEl: HTMLUListElement | undefined
  onCleanup(() => { fp.onListRef(undefined) })
  const [pos, setPos] = createSignal<{ left: number, top: number, maxHeight: number }>({ left: 0, top: 0, maxHeight: 320 })

  onMount(() => {
    const anchor = fp.anchor()
    if (anchor === undefined || listEl === undefined) {
      return
    }
    const a = anchor.getBoundingClientRect()
    const root = scope?.root
    const c = root?.getBoundingClientRect()
    const boundsWidth = c?.width ?? root?.clientWidth ?? document.documentElement.clientWidth
    const boundsHeight = c?.height ?? root?.clientHeight ?? document.documentElement.clientHeight
    const bounds = { x: 0, y: 0, width: boundsWidth, height: boundsHeight }
    const cLeft = c?.left ?? 0
    const cTop = c?.top ?? 0
    const maxHeight = Math.max(120, Math.min(320, boundsHeight - 16))
    const listHeight = Math.min(listEl.offsetHeight > 0 ? listEl.offsetHeight : maxHeight, maxHeight)
    const top = clampPosition({ x: 0, y: a.top - cTop }, { width: 0, height: listHeight }, bounds).y
    const listWidth = listEl.offsetWidth > 0 ? listEl.offsetWidth : 160
    const left = clampPosition({ x: a.right - cLeft + 1, y: 0 }, { width: listWidth, height: 0 }, bounds).x
    setPos({ left, top, maxHeight })
    // Focus the current value, else the first item.
    const current = listEl.querySelector<HTMLElement>('[aria-checked="true"]') ?? listEl.querySelector<HTMLElement>('li')
    current?.focus({ preventScroll: true })
  })

  return (
    <Portal mount={scope?.root ?? document.body}>
      <ul
        ref={el => { listEl = el; fp.onListRef(el) }}
        role="menu"
        aria-label={fp.label}
        class="klinecharts-pro-list klinecharts-pro-drawing-bar-flyout"
        style={{ left: `${pos().left}px`, top: `${pos().top}px`, 'max-height': `${pos().maxHeight}px` }}>
        <For each={fp.items}>
          {data => (
            <li
              tabIndex={0}
              role="menuitemradio"
              aria-checked={data.key === fp.current ? 'true' : 'false'}
              class={data.key === fp.current ? 'selected' : ''}
              onClick={() => { fp.onPick(data.key) }}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  fp.onPick(data.key)
                }
              }}>
              <Show when={data.key} keyed>{name => <Icon name={name}/>}</Show>
              <span style="padding-left:8px">{data.text}</span>
              <span class="check">{data.key === fp.current ? <CheckIcon/> : null}</span>
            </li>
          )}
        </For>
      </ul>
    </Portal>
  )
}

const DrawingBar: Component<DrawingBarProps> = props => {
  const scope = useChartScope()

  const [visibleState, setVisibleState] = createSignal(true)
  const visible = (): boolean => props.visible ?? visibleState()

  const [openKey, setOpenKey] = createSignal('')

  // A flyout closes on a press anywhere outside its rail button, touch taps
  // and pans on the canvas included, which never blur the button (SC-083);
  // Escape closes it (and only it) through the chart's key dispatcher.
  const itemRefs: Record<string, HTMLElement | undefined> = {}
  // The open flyout's own <ul> counts as "inside" too: it is portaled to the
  // chart's root (SC-077), not a DOM child of the rail item, and it focuses
  // its first row on open (SC-144) — without this, that focus move reads as
  // focus leaving the item and the flyout would dismiss itself immediately.
  let openFlyoutEl: HTMLUListElement | undefined
  const dismiss = createOutsideDismiss({
    isOpen: () => openKey() !== '',
    inside: () => [itemRefs[openKey()], openFlyoutEl],
    close: () => { setOpenKey('') }
  })
  createEffect(() => {
    if (openKey() === '' || scope === undefined) {
      return
    }
    const off = scope.keys.register(e => {
      if (!isEscape(e)) {
        return false
      }
      e.preventDefault()
      setOpenKey('')
      return true
    }, { priority: KEY_PRIORITY.POPOVER })
    onCleanup(off)
  })

  const modes = createMemo(() => createMagnetOptions(props.locale))
  const modeLabel = (): string => textOf(modes().find(o => o.key === props.state.magnetKind())?.text ?? props.state.magnetKind())

  const pickGroupTool = (group: ToolGroupKey, name: string): void => {
    props.state.setTool(group, name)
    props.onDrawingItemClick({ groupId: GROUP_ID, name, visible: visible(), lock: props.state.lock(), mode: props.state.mode() as OverlayMode })
    setOpenKey('')
  }

  return (
    <div
      class="klinecharts-pro-drawing-bar"
      role="toolbar"
      aria-orientation="vertical"
      aria-label={i18n('drawing_tools', props.locale)}>
      <div class="tools">
        <For each={GROUPS}>
          {group => {
            const options = createMemo(() => group.options(props.locale))
            const currentTool = (): string => props.state.tool(group.key)
            const currentLabel = (): string => textOf(options().find(o => o.key === currentTool())?.text ?? currentTool())
            const isArmed = (): boolean => props.armedTool !== undefined && props.armedTool !== null && props.armedTool === currentTool()
            const isOpen = (): boolean => openKey() === group.key
            return (
              <div
                ref={el => { itemRefs[group.key] = el }}
                class="item"
                onFocusOut={dismiss.onFocusOut}>
                <button
                  type="button"
                  class="icon-overlay-btn"
                  aria-label={currentLabel()}
                  title={currentLabel()}
                  aria-pressed={isArmed()}
                  onClick={() => { pickGroupTool(group.key, currentTool()) }}>
                  <Show when={currentTool()} keyed>{name => <Icon name={name}/>}</Show>
                </button>
                <button
                  type="button"
                  class="icon-arrow"
                  aria-label={`${i18n('more_tools', props.locale)}: ${currentLabel()}`}
                  aria-haspopup="menu"
                  aria-expanded={isOpen()}
                  onClick={() => { setOpenKey(isOpen() ? '' : group.key) }}>
                  <CaretIcon class={isOpen() ? 'rotate' : ''}/>
                </button>
                <Show when={isOpen()}>
                  <RailFlyout
                    anchor={() => itemRefs[group.key]}
                    label={currentLabel()}
                    items={options()}
                    current={currentTool()}
                    onPick={name => { pickGroupTool(group.key, name) }}
                    onListRef={el => { openFlyoutEl = el }}/>
                </Show>
              </div>
            )
          }}
        </For>
      </div>
      <span class="split-line"/>
      <div class="utility">
        <div
          ref={el => { itemRefs.mode = el }}
          class="item"
          onFocusOut={dismiss.onFocusOut}>
          <button
            type="button"
            class="icon-overlay-btn"
            aria-label={modeLabel()}
            title={modeLabel()}
            aria-pressed={props.state.mode() !== 'normal'}
            onClick={() => {
              const next = props.state.mode() === 'normal' ? props.state.magnetKind() : 'normal'
              props.state.setMode(next)
              props.onModeChange(next)
            }}>
            {
              // A plain ternary, not <Icon name={...()}/> directly: Icon reads
              // its `name` prop once (SC-011), so a fresh element per branch,
              // re-evaluated by Solid whenever magnetKind()/mode() change, is
              // what keeps this icon (and its "selected" class) live.
              props.state.magnetKind() === 'weak_magnet'
                ? (props.state.mode() !== 'normal' ? <Icon name="weak_magnet" class="selected"/> : <Icon name="weak_magnet"/>)
                : (props.state.mode() !== 'normal' ? <Icon name="strong_magnet" class="selected"/> : <Icon name="strong_magnet"/>)
            }
          </button>
          <button
            type="button"
            class="icon-arrow"
            aria-label={`${i18n('more_tools', props.locale)}: ${modeLabel()}`}
            aria-haspopup="menu"
            aria-expanded={openKey() === 'mode'}
            onClick={() => { setOpenKey(openKey() === 'mode' ? '' : 'mode') }}>
            <CaretIcon class={openKey() === 'mode' ? 'rotate' : ''}/>
          </button>
          <Show when={openKey() === 'mode'}>
            <RailFlyout
              anchor={() => itemRefs.mode}
              label={modeLabel()}
              items={modes()}
              current={props.state.magnetKind()}
              onPick={key => {
                const kind = key === 'strong_magnet' ? 'strong_magnet' : 'weak_magnet'
                props.state.setMode(kind)
                props.onModeChange(kind)
                setOpenKey('')
              }}
              onListRef={el => { openFlyoutEl = el }}/>
          </Show>
        </div>
        <div class="item">
          <button
            type="button"
            class="icon-overlay-btn"
            aria-label={props.state.lock() ? i18n('unlock_all_drawings', props.locale) : i18n('lock_all_drawings', props.locale)}
            title={props.state.lock() ? i18n('unlock_all_drawings', props.locale) : i18n('lock_all_drawings', props.locale)}
            aria-pressed={props.state.lock()}
            onClick={() => {
              const next = !props.state.lock()
              props.state.setLock(next)
              props.onLockChange(next)
            }}>
            {props.state.lock() ? <Icon name="lock"/> : <Icon name="unlock"/>}
          </button>
        </div>
        <div class="item">
          <button
            type="button"
            class="icon-overlay-btn"
            aria-label={visible() ? i18n('hide_all_drawings', props.locale) : i18n('show_all_drawings', props.locale)}
            title={visible() ? i18n('hide_all_drawings', props.locale) : i18n('show_all_drawings', props.locale)}
            aria-pressed={!visible()}
            onClick={() => {
              const v = !visible()
              setVisibleState(v)
              props.onVisibleChange(v)
            }}>
            {visible() ? <Icon name="visible" /> : <Icon name="invisible" />}
          </button>
        </div>
      </div>
      <span class="split-line"/>
      <div class="utility">
        <div class="item">
          <button
            type="button"
            class="icon-overlay-btn"
            aria-label={i18n('remove_all_drawings', props.locale)}
            title={i18n('remove_all_drawings', props.locale)}
            onClick={() => { props.onRemoveClick(GROUP_ID) }}>
            <Icon name="remove" />
          </button>
        </div>
      </div>
    </div>
  )
}

export default DrawingBar
