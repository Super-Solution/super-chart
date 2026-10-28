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

// Floating toolbar for editing the selected drawing (TradingView-style): drag
// grip, line colour, text colour, line width, line style, lock, delete and a
// "more" menu. It is only a view: all decisions live in src/drawing-editor
// (DrawingEditor, styles, geometry, keyboard) and reach the chart through the
// callbacks ChartProComponent passes in.
//
// Not included, on purpose: price alerts and style templates (TradingView has
// both in this toolbar) — Super Chart has no alert or template feature to back them.
//
// Part of SUPer-Chart (Apache-2.0).

import { Component, createSignal, createEffect, createMemo, createUniqueId, on, onMount, onCleanup, Show, For } from 'solid-js'

import i18n from '../../i18n'

import type { DrawingSnapshot } from '../../drawing-editor/controller'
import { LINE_STYLES, LINE_WIDTHS, LineStyleKind, StyleChange } from '../../drawing-editor/styles'
import { buildPalette, formatColor, parseColor, parseHexInput, sameRgb, toHex } from '../../drawing-editor/color'
import { clampPosition, defaultToolbarPosition, popoverLeft, Point2, Rect, Segment, Size, ToolbarAvoid } from '../../drawing-editor/geometry'
import { editorKeyAction } from '../../drawing-editor/keyboard'
import { useChartScope } from '../../common/chartScope'
import { KEY_PRIORITY } from '../../common/keyDispatcher'
import { CheckIcon } from '../../component/menu'
import { TOOLBAR_LABELS, LINE_STYLE_LABELS } from '../../drawing-editor/labels'

import {
  GripIcon, PencilIcon, TextIcon, MoreIcon, CloneIcon, FrontIcon, BackIcon, HideIcon, WidthGlyph, StyleGlyph,
  LockIcon, UnlockIcon, TrashIcon
} from './icons'

export interface DrawingToolbarProps {
  locale: string
  snapshot: DrawingSnapshot
  /** Changes whenever a different drawing is selected. */
  selectionKey: number
  /** The chart area element; the toolbar is kept inside it. Must share an offsetParent with the toolbar. */
  chartElement: () => HTMLElement | undefined
  /** Super Chart's root element: keys are only handled when focus is inside it (or nowhere). */
  rootElement: () => HTMLElement | undefined
  /** What the toolbar should not cover when it first opens (the selected drawing), chart-local px, or null when unknown. */
  avoid: () => ToolbarAvoid | null
  /** Where the user last dragged the toolbar (chart-local), kept for this chart's lifetime. */
  userPosition: () => Point2 | null
  onUserPositionChange: (pos: Point2) => void
  /** Extra px to keep clear at the chart's bottom (the replay bar, while replay is on). @default 0 */
  reservedBottom?: () => number
  onStyleChange: (change: StyleChange) => void
  onToggleLock: () => void
  onDelete: () => void
  onClone: () => void
  onBringToFront: () => void
  onSendToBack: () => void
  onHide: () => void
  onDeselect: () => void
}

type PopoverKey = 'lineColor' | 'textColor' | 'lineWidth' | 'lineStyle' | 'more'

const KEYBOARD_STEP = 10
/** Keep the chart's OHLC legend row (top-left) readable when the toolbar first opens. */
const LEGEND_INSET = 28

interface ColorPopoverProps {
  ref?: (el: HTMLDivElement) => void
  locale: string
  label: string
  color: string
  palette: string[]
  onPick: (color: string) => void
  onClose: () => void
}

const ColorPopover: Component<ColorPopoverProps> = props => {
  const current = createMemo(() => parseColor(props.color) ?? { r: 22, g: 119, b: 255, a: 1 })
  const [hexText, setHexText] = createSignal(toHex(current()))
  const [hexInvalid, setHexInvalid] = createSignal(false)
  // SC-150: an id per instance, not a literal, so two charts on the same page
  // never end up with two elements sharing one id.
  const hexErrorId = createUniqueId()
  createEffect(on(current, c => { setHexText(toHex(c)); setHexInvalid(false) }, { defer: true }))

  const applyHex = (): void => {
    const text = hexText().trim()
    const parsed = parseHexInput(text)
    if (parsed === null) {
      setHexInvalid(true)
      return
    }
    setHexInvalid(false)
    const digits = text.replace('#', '').length
    const typedAlpha = digits === 4 || digits === 8
    props.onPick(formatColor({ ...parsed, a: typedAlpha ? parsed.a : current().a }))
  }

  return (
    <div ref={props.ref} class="tb-popover tb-color-popover" role="dialog" aria-label={props.label}>
      <div class="tb-swatches">
        <For each={props.palette}>
          {color => (
            <button
              type="button"
              class="tb-swatch"
              classList={{ selected: sameRgb(color, props.color) }}
              style={{ 'background-color': color }}
              aria-label={`${i18n(TOOLBAR_LABELS.color, props.locale)} ${color}`}
              aria-pressed={sameRgb(color, props.color)}
              title={color}
              onClick={() => {
                const c = parseColor(color)
                if (c !== null) {
                  props.onPick(formatColor({ ...c, a: current().a }))
                }
              }}/>
          )}
        </For>
      </div>
      <label class="tb-field">
        <span>{i18n(TOOLBAR_LABELS.opacity, props.locale)}</span>
        <input
          type="range"
          min="0"
          max="100"
          step="5"
          value={Math.round(current().a * 100)}
          aria-label={i18n(TOOLBAR_LABELS.opacity, props.locale)}
          onInput={e => {
            const a = Number(e.currentTarget.value) / 100
            props.onPick(formatColor({ ...current(), a }))
          }}/>
        <span class="tb-field-value">{Math.round(current().a * 100)}%</span>
      </label>
      <label class="tb-field tb-field-stack">
        <span>{i18n(TOOLBAR_LABELS.customColor, props.locale)}</span>
        <input
          type="text"
          class="tb-hex"
          maxLength={9}
          spellcheck={false}
          value={hexText()}
          aria-label={i18n(TOOLBAR_LABELS.customColor, props.locale)}
          aria-invalid={hexInvalid()}
          // SC-150: only the id of the error text below, and only while it is
          // showing — an empty/absent aria-describedby is how screen readers
          // are told there is nothing to describe it once the value is fixed.
          aria-describedby={hexInvalid() ? hexErrorId : undefined}
          onInput={e => { setHexText(e.currentTarget.value) }}
          onChange={applyHex}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault()
              applyHex()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              props.onClose()
            }
          }}/>
        <Show when={hexInvalid()}>
          <span id={hexErrorId} class="tb-hex-error" role="alert">{i18n(TOOLBAR_LABELS.invalidHex, props.locale)}</span>
        </Show>
      </label>
    </div>
  )
}

const DrawingToolbar: Component<DrawingToolbarProps> = props => {
  let toolbarRef: HTMLDivElement | undefined
  const [pos, setPos] = createSignal<Point2 | null>(null)
  const [openUp, setOpenUp] = createSignal(false)
  const [popover, setPopover] = createSignal<PopoverKey | null>(null)
  // SC-080: capped explicitly, in code, rather than left to the browser — an
  // absolutely positioned box otherwise sizes to "containing block width
  // minus its own left", not "the chart's width", so a toolbar dragged toward
  // the right edge would fold into a tall column instead of wrapping sideways.
  const [maxWidth, setMaxWidth] = createSignal<number | null>(null)

  // ---- popover focus management (SC-150) --------------------------------------
  // Refs to each trigger button, so a popover that closes from the keyboard can
  // put focus back where it opened from, and so ArrowDown on a trigger can open
  // its popover.
  let lineColorTrigger: HTMLButtonElement | undefined
  let textColorTrigger: HTMLButtonElement | undefined
  let lineWidthTrigger: HTMLButtonElement | undefined
  let lineStyleTrigger: HTMLButtonElement | undefined
  let moreTrigger: HTMLButtonElement | undefined
  const triggerFor = (key: PopoverKey): HTMLButtonElement | undefined => {
    switch (key) {
      case 'lineColor': return lineColorTrigger
      case 'textColor': return textColorTrigger
      case 'lineWidth': return lineWidthTrigger
      case 'lineStyle': return lineStyleTrigger
      case 'more': return moreTrigger
    }
  }
  // Set right before a popover opens from Enter/Space (a click with detail 0)
  // or ArrowDown on its trigger; consumed (and cleared) the moment that popover
  // mounts, so a later re-render never re-triggers the focus move.
  let openedFromKeyboard = false

  const toggle = (key: PopoverKey, fromKeyboard: boolean): void => {
    const opening = popover() !== key
    openedFromKeyboard = opening && fromKeyboard
    setPopover(opening ? key : null)
  }

  /**
   * Closes whatever popover is open. `returnFocus` moves focus back to that
   * popover's own trigger — but never onto a trigger that is no longer there:
   * the selection can change the toolbar out from under the click (Clone) or
   * remove it entirely (Delete, Hide, Deselect), and pushing focus onto a
   * detached node throws in some browsers and does nothing useful in the rest.
   */
  const closePopover = (returnFocus: boolean): void => {
    const key = popover()
    setPopover(null)
    if (returnFocus && key !== null) {
      const trigger = triggerFor(key)
      if (trigger !== undefined && trigger.isConnected) {
        trigger.focus({ preventScroll: true })
      }
    }
  }

  const menuItems = (el: HTMLElement): HTMLButtonElement[] =>
    Array.from(el.querySelectorAll<HTMLButtonElement>('.tb-menu-item:not(:disabled)'))

  /** Moves focus into a just-opened popover, only when it was opened from the keyboard. */
  const focusPopoverOpenTarget = (el: HTMLElement): void => {
    if (el.getAttribute('role') === 'dialog') {
      const swatches = Array.from(el.querySelectorAll<HTMLButtonElement>('.tb-swatch'))
      ;(swatches.find(s => s.classList.contains('selected')) ?? swatches[0])?.focus({ preventScroll: true })
      return
    }
    const items = menuItems(el)
    ;(items.find(i => i.getAttribute('aria-checked') === 'true') ?? items[0])?.focus({ preventScroll: true })
  }

  /** Arrow/Home/End navigation inside an open role="menu" popover (SC-150). Tab closes it. */
  const onMenuKeyDown = (e: KeyboardEvent): void => {
    const container = e.currentTarget as HTMLElement
    if (e.key === 'Tab') {
      closePopover(false)
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') {
      return
    }
    const items = menuItems(container)
    if (items.length === 0) {
      return
    }
    e.preventDefault()
    if (e.key === 'Home') {
      items[0].focus({ preventScroll: true })
      return
    }
    if (e.key === 'End') {
      items[items.length - 1].focus({ preventScroll: true })
      return
    }
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    const dir = e.key === 'ArrowDown' ? 1 : -1
    items[(current + dir + items.length) % items.length].focus({ preventScroll: true })
  }

  /** ArrowDown on a trigger opens its popover and moves focus in, same as Enter/Space. */
  const onTriggerKeyDown = (key: PopoverKey) => (e: KeyboardEvent): void => {
    if (e.key === 'ArrowDown' && popover() !== key) {
      e.preventDefault()
      toggle(key, true)
    }
  }

  const t = (key: string): string => i18n(key, props.locale)
  const palette = createMemo(() => buildPalette(props.snapshot.defaultColor))

  const measure = (): { bounds: Rect, size: Size } | null => {
    const chart = props.chartElement()
    if (chart === undefined || toolbarRef === undefined) {
      return null
    }
    // SC-057: the replay bar sits at a fixed z-index below the toolbar, so a
    // z-order fix alone would not stop the toolbar's own placement (default,
    // dragged or keyboard-nudged) from landing on top of it. Reserving the
    // room here — before any of those run — is a hard exclusion, not a
    // cost term a crossing-everywhere layout could still pick.
    const height = chart.clientHeight - Math.max(0, props.reservedBottom?.() ?? 0)
    return {
      bounds: { x: chart.offsetLeft, y: chart.offsetTop, width: chart.clientWidth, height: Math.max(0, height) },
      size: { width: toolbarRef.offsetWidth, height: toolbarRef.offsetHeight }
    }
  }

  const place = (recompute: boolean): void => {
    const m = measure()
    if (m === null || m.size.width === 0) {
      return
    }
    const { bounds, size } = m
    setMaxWidth(bounds.width)
    const user = props.userPosition()
    let next: Point2
    if (user !== null) {
      next = clampPosition({ x: bounds.x + user.x, y: bounds.y + user.y }, size, bounds)
    } else if (recompute || pos() === null) {
      const avoid = props.avoid()
      const shift = (p: Point2): Point2 => ({ x: p.x + bounds.x, y: p.y + bounds.y })
      const rect: Rect | null = avoid?.rect === null || avoid?.rect === undefined ? null : { ...avoid.rect, ...shift(avoid.rect) }
      const avoidLines = (avoid?.lines ?? []).map((line): Segment => [shift(line[0]), shift(line[1])])
      next = defaultToolbarPosition(bounds, size, rect, { topInset: LEGEND_INSET, avoidLines })
    } else {
      next = clampPosition(pos() as Point2, size, bounds)
    }
    setPos(next)
    setOpenUp(next.y + size.height / 2 > bounds.y + bounds.height / 2)
  }

  const commitUserPosition = (): void => {
    const m = measure()
    const p = pos()
    if (m !== null && p !== null) {
      props.onUserPositionChange({ x: p.x - m.bounds.x, y: p.y - m.bounds.y })
    }
  }

  // A different drawing: close popovers and choose a spot for it.
  createEffect(on(() => props.selectionKey, () => {
    setPopover(null)
    place(true)
    if (pos() === null) {
      requestAnimationFrame(() => { place(true) })
    }
  }))

  // SC-057: replay starting/stopping while a drawing is already selected
  // changes how much room measure() reserves at the bottom; re-clamp so an
  // already-placed toolbar cannot end up sitting on the replay bar.
  createEffect(on(() => props.reservedBottom?.(), () => { place(false) }, { defer: true }))

  // ---- drag grip -------------------------------------------------------------
  let drag: { pointerId: number, startX: number, startY: number, origin: Point2 } | null = null

  const onGripPointerDown = (e: PointerEvent): void => {
    const p = pos()
    if (e.button !== 0 || p === null) {
      return
    }
    e.preventDefault()
    drag = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, origin: p }
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId) } catch { /* ignore */ }
  }
  const onGripPointerMove = (e: PointerEvent): void => {
    const m = measure()
    if (drag === null || e.pointerId !== drag.pointerId || m === null) {
      return
    }
    setPos(clampPosition({ x: drag.origin.x + e.clientX - drag.startX, y: drag.origin.y + e.clientY - drag.startY }, m.size, m.bounds))
  }
  const onGripPointerUp = (e: PointerEvent): void => {
    if (drag === null || e.pointerId !== drag.pointerId) {
      return
    }
    drag = null
    const m = measure()
    const p = pos()
    if (m !== null && p !== null) {
      setOpenUp(p.y + m.size.height / 2 > m.bounds.y + m.bounds.height / 2)
    }
    commitUserPosition()
  }
  const onGripKeyDown = (e: KeyboardEvent): void => {
    const delta: Record<string, Point2> = {
      ArrowLeft: { x: -KEYBOARD_STEP, y: 0 },
      ArrowRight: { x: KEYBOARD_STEP, y: 0 },
      ArrowUp: { x: 0, y: -KEYBOARD_STEP },
      ArrowDown: { x: 0, y: KEYBOARD_STEP }
    }
    const d = delta[e.key]
    const m = measure()
    const p = pos()
    if (d === undefined || m === null || p === null) {
      return
    }
    e.preventDefault()
    setPos(clampPosition({ x: p.x + d.x, y: p.y + d.y }, m.size, m.bounds))
    commitUserPosition()
  }

  // ---- popovers: kept inside the chart horizontally ------------------------------
  // A popover opens under its button (the "more" menu under the button's right
  // edge) and is moved sideways just enough to stay inside the chart: the
  // toolbar can sit against either edge, and a narrow one (a pin, a note) is much
  // narrower than the colour popover.
  let popoverEl: HTMLElement | undefined

  const fitPopover = (el: HTMLElement): void => {
    const chart = props.chartElement()
    const anchor = el.parentElement
    if (chart === undefined || anchor === null || !el.isConnected) {
      return
    }
    const a = anchor.getBoundingClientRect()
    const c = chart.getBoundingClientRect()
    const align = el.classList.contains('tb-menu-end') ? 'end' : 'start'
    const left = popoverLeft({ left: a.left, right: a.right }, el.offsetWidth, { x: c.left, width: c.width }, align)
    el.style.left = `${left - a.left}px`
    el.style.right = 'auto'
  }

  const popoverRef = (el: HTMLElement): void => {
    popoverEl = el
    // SC-150: consume the flag once, here — the value it had when this popover
    // was requested to open, not whatever it is by the time this microtask runs.
    const shouldFocus = openedFromKeyboard
    openedFromKeyboard = false
    // The ref runs before <Show> inserts the element; measure it once it is in
    // the page, which is still before the browser paints it.
    void Promise.resolve().then(() => {
      if (popoverEl === el) {
        fitPopover(el)
        if (shouldFocus) {
          focusPopoverOpenTarget(el)
        }
      }
    })
  }

  // The toolbar moved (dragged, window resized) with a popover open.
  createEffect(on(pos, () => {
    if (popover() !== null && popoverEl !== undefined) {
      fitPopover(popoverEl)
    }
  }, { defer: true }))

  // ---- keyboard: Delete / Backspace / Escape -----------------------------------
  // Registered on the chart's key dispatcher at EDITOR priority (moved off
  // its own window listener): the dispatcher already knows whether this key
  // belongs to this chart (focus inside it, or the last press was) and
  // whether a modal has suspended EDITOR-tier shortcuts, so this handler no
  // longer tracks either itself.
  const scope = useChartScope()
  const onEditorKey = (e: KeyboardEvent): boolean => {
    const target = e.target
    const root = props.rootElement()
    const action = editorKeyAction({
      key: e.key,
      modifier: e.ctrlKey || e.metaKey || e.altKey,
      composing: e.isComposing,
      targetTag: target instanceof Element ? target.tagName.toLowerCase() : null,
      targetInputType: target instanceof HTMLInputElement ? target.type.toLowerCase() : null,
      targetEditable: target instanceof HTMLElement && target.isContentEditable,
      // The dispatcher (scope.keys) only calls this handler when the key
      // already belongs to this chart, so that check is settled here.
      targetIsDocument: false,
      targetInsideChart: true,
      targetInDialog: target instanceof Element && target.closest('.klinecharts-pro-modal') !== null,
      lastPressInChart: false
    })
    if (action === null) {
      return false
    }
    e.preventDefault()
    if (action === 'deselect' && popover() !== null) {
      // SC-150: this is Escape closing a popover (the hex field and the
      // opacity slider reach here too — Escape on a menu item, a slider or the
      // hex field are the three "focus lost to body" cases the finding named).
      closePopover(true)
      return true
    }
    if (action === 'delete') {
      props.onDelete()
    } else {
      props.onDeselect()
    }
    return true
  }

  // A press outside the toolbar closes an open popover.
  const onDocumentPointerDown = (e: PointerEvent): void => {
    if (popover() !== null && toolbarRef !== undefined && e.target instanceof Node && !toolbarRef.contains(e.target)) {
      setPopover(null)
    }
  }

  const onWindowResize = (): void => { place(false) }
  let resizeObserver: ResizeObserver | undefined
  let offEditorKey: (() => void) | undefined

  onMount(() => {
    offEditorKey = scope?.keys.register(onEditorKey, { priority: KEY_PRIORITY.EDITOR })
    window.addEventListener('resize', onWindowResize)
    document.addEventListener('pointerdown', onDocumentPointerDown, true)
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => { place(false) })
      const chart = props.chartElement()
      if (chart !== undefined) {
        resizeObserver.observe(chart)
      }
      if (toolbarRef !== undefined) {
        resizeObserver.observe(toolbarRef)
      }
    }
  })

  onCleanup(() => {
    offEditorKey?.()
    window.removeEventListener('resize', onWindowResize)
    document.removeEventListener('pointerdown', onDocumentPointerDown, true)
    resizeObserver?.disconnect()
  })

  return (
    <div
      ref={toolbarRef}
      class="klinecharts-pro-drawing-toolbar"
      classList={{ 'open-up': openUp() }}
      role="toolbar"
      aria-label={t(TOOLBAR_LABELS.toolbar)}
      style={{
        left: `${pos()?.x ?? 0}px`,
        top: `${pos()?.y ?? 0}px`,
        visibility: pos() === null ? 'hidden' : 'visible',
        ...(maxWidth() === null ? {} : { 'max-width': `${maxWidth()}px` })
      }}
      onContextMenu={e => { e.preventDefault() }}>
      <button
        type="button"
        class="tb-button tb-grip"
        aria-label={t(TOOLBAR_LABELS.drag)}
        title={t(TOOLBAR_LABELS.drag)}
        onPointerDown={onGripPointerDown}
        onPointerMove={onGripPointerMove}
        onPointerUp={onGripPointerUp}
        onPointerCancel={onGripPointerUp}
        onKeyDown={onGripKeyDown}>
        <GripIcon/>
      </button>

      <Show when={props.snapshot.controls.lineColor}>
        <div class="tb-control">
          <button
            ref={lineColorTrigger}
            type="button"
            class="tb-button"
            aria-label={t(TOOLBAR_LABELS.lineColor)}
            title={t(TOOLBAR_LABELS.lineColor)}
            aria-haspopup="true"
            aria-expanded={popover() === 'lineColor'}
            onClick={e => { toggle('lineColor', e.detail === 0) }}
            onKeyDown={onTriggerKeyDown('lineColor')}>
            <span class="tb-color-icon">
              <PencilIcon/>
              <span class="tb-color-bar" style={{ 'background-color': props.snapshot.lineColor }}/>
            </span>
          </button>
          <Show when={popover() === 'lineColor'}>
            <ColorPopover
              ref={popoverRef}
              locale={props.locale}
              label={t(TOOLBAR_LABELS.lineColor)}
              color={props.snapshot.lineColor}
              palette={palette()}
              onPick={color => { props.onStyleChange({ kind: 'lineColor', color }) }}
              onClose={() => { closePopover(true) }}/>
          </Show>
        </div>
      </Show>

      <Show when={props.snapshot.controls.textColor}>
        <div class="tb-control">
          <button
            ref={textColorTrigger}
            type="button"
            class="tb-button"
            aria-label={t(TOOLBAR_LABELS.textColor)}
            title={t(TOOLBAR_LABELS.textColor)}
            aria-haspopup="true"
            aria-expanded={popover() === 'textColor'}
            onClick={e => { toggle('textColor', e.detail === 0) }}
            onKeyDown={onTriggerKeyDown('textColor')}>
            <span class="tb-color-icon">
              <TextIcon/>
              <span class="tb-color-bar" style={{ 'background-color': props.snapshot.textColor }}/>
            </span>
          </button>
          <Show when={popover() === 'textColor'}>
            <ColorPopover
              ref={popoverRef}
              locale={props.locale}
              label={t(TOOLBAR_LABELS.textColor)}
              color={props.snapshot.textColor}
              palette={palette()}
              onPick={color => { props.onStyleChange({ kind: 'textColor', color }) }}
              onClose={() => { closePopover(true) }}/>
          </Show>
        </div>
      </Show>

      <Show when={props.snapshot.controls.lineWidth}>
        <div class="tb-control">
          <button
            ref={lineWidthTrigger}
            type="button"
            class="tb-button tb-text-button"
            aria-label={`${t(TOOLBAR_LABELS.lineWidth)}: ${props.snapshot.lineWidth}px`}
            title={t(TOOLBAR_LABELS.lineWidth)}
            aria-haspopup="true"
            aria-expanded={popover() === 'lineWidth'}
            onClick={e => { toggle('lineWidth', e.detail === 0) }}
            onKeyDown={onTriggerKeyDown('lineWidth')}>
            <WidthGlyph width={props.snapshot.lineWidth}/>
            <span>{props.snapshot.lineWidth}px</span>
          </button>
          <Show when={popover() === 'lineWidth'}>
            <div ref={popoverRef} class="tb-popover tb-menu" role="menu" aria-label={t(TOOLBAR_LABELS.lineWidth)} onKeyDown={onMenuKeyDown}>
              <For each={LINE_WIDTHS}>
                {width => (
                  <button
                    type="button"
                    role="menuitemradio"
                    class="tb-menu-item"
                    classList={{ selected: props.snapshot.lineWidth === width }}
                    aria-checked={props.snapshot.lineWidth === width}
                    aria-label={`${t(TOOLBAR_LABELS.lineWidth)} ${width}px`}
                    onClick={() => {
                      props.onStyleChange({ kind: 'lineWidth', width })
                      closePopover(true)
                    }}>
                    <WidthGlyph width={width}/>
                    <span>{width}px</span>
                    {/* The current width is marked by a check, not colour alone (SC-060). */}
                    <span class="tb-check">{props.snapshot.lineWidth === width ? <CheckIcon/> : null}</span>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>
      </Show>

      <Show when={props.snapshot.controls.lineStyle}>
        <div class="tb-control">
          <button
            ref={lineStyleTrigger}
            type="button"
            class="tb-button"
            aria-label={`${t(TOOLBAR_LABELS.lineStyle)}: ${t(LINE_STYLE_LABELS[props.snapshot.lineStyle])}`}
            title={t(TOOLBAR_LABELS.lineStyle)}
            aria-haspopup="true"
            aria-expanded={popover() === 'lineStyle'}
            onClick={e => { toggle('lineStyle', e.detail === 0) }}
            onKeyDown={onTriggerKeyDown('lineStyle')}>
            <StyleGlyph style={props.snapshot.lineStyle}/>
          </button>
          <Show when={popover() === 'lineStyle'}>
            <div ref={popoverRef} class="tb-popover tb-menu" role="menu" aria-label={t(TOOLBAR_LABELS.lineStyle)} onKeyDown={onMenuKeyDown}>
              <For each={LINE_STYLES}>
                {(style: LineStyleKind) => (
                  <button
                    type="button"
                    role="menuitemradio"
                    class="tb-menu-item"
                    classList={{ selected: props.snapshot.lineStyle === style }}
                    aria-checked={props.snapshot.lineStyle === style}
                    onClick={() => {
                      props.onStyleChange({ kind: 'lineStyle', style })
                      closePopover(true)
                    }}>
                    <StyleGlyph style={style}/>
                    <span>{t(LINE_STYLE_LABELS[style])}</span>
                    <span class="tb-check">{props.snapshot.lineStyle === style ? <CheckIcon/> : null}</span>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>
      </Show>

      <span class="tb-separator" aria-hidden="true"/>

      {/* A toggle: one fixed name, the state in aria-pressed (a name that flips to
          "Unlock" would read as "unlock, pressed" — the opposite of the state). */}
      <button
        type="button"
        class="tb-button"
        classList={{ active: props.snapshot.locked }}
        aria-label={t(TOOLBAR_LABELS.lock)}
        title={t(TOOLBAR_LABELS.lock)}
        aria-pressed={props.snapshot.locked}
        onClick={() => { props.onToggleLock() }}>
        {props.snapshot.locked ? <LockIcon/> : <UnlockIcon/>}
      </button>

      <button
        type="button"
        class="tb-button"
        aria-label={t(TOOLBAR_LABELS.remove)}
        title={t(TOOLBAR_LABELS.remove)}
        onClick={() => { props.onDelete() }}>
        <TrashIcon/>
      </button>

      <div class="tb-control">
        <button
          ref={moreTrigger}
          type="button"
          class="tb-button"
          aria-label={t(TOOLBAR_LABELS.more)}
          title={t(TOOLBAR_LABELS.more)}
          aria-haspopup="true"
          aria-expanded={popover() === 'more'}
          onClick={e => { toggle('more', e.detail === 0) }}
          onKeyDown={onTriggerKeyDown('more')}>
          <MoreIcon/>
        </button>
        <Show when={popover() === 'more'}>
          <div ref={popoverRef} class="tb-popover tb-menu tb-menu-end" role="menu" aria-label={t(TOOLBAR_LABELS.more)} onKeyDown={onMenuKeyDown}>
            <button type="button" role="menuitem" class="tb-menu-item" onClick={() => { closePopover(true); props.onClone() }}>
              <CloneIcon/><span>{t(TOOLBAR_LABELS.clone)}</span>
            </button>
            <button type="button" role="menuitem" class="tb-menu-item" disabled={!props.snapshot.canReorder} onClick={() => { closePopover(true); props.onBringToFront() }}>
              <FrontIcon/><span>{t(TOOLBAR_LABELS.bringToFront)}</span>
            </button>
            <button type="button" role="menuitem" class="tb-menu-item" disabled={!props.snapshot.canReorder} onClick={() => { closePopover(true); props.onSendToBack() }}>
              <BackIcon/><span>{t(TOOLBAR_LABELS.sendToBack)}</span>
            </button>
            <button type="button" role="menuitem" class="tb-menu-item" onClick={() => { closePopover(true); props.onHide() }}>
              <HideIcon/><span>{t(TOOLBAR_LABELS.hide)}</span>
            </button>
          </div>
        </Show>
      </div>
    </div>
  )
}

export default DrawingToolbar
