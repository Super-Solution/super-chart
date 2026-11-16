import { drawingUsesText, type Drawing, type DrawingBounds, type DrawingGeometry, type DrawingStore, type DrawingStyle } from '@supersolutions/super-chart-core'
import { createIcon } from './icons'

/** What the floating toolbar needs from its workspace. The drawings themselves are read from and written to the store. */
export interface DrawingToolbarHost {
  readonly doc: Document
  readonly win: Window & typeof globalThis
  /** The element the toolbar floats in: same origin and size as the plot canvas. */
  readonly stage: HTMLElement
  readonly store: DrawingStore
  /** Translated text for a catalogue key. */
  t: (key: string, params?: Readonly<Record<string, string | number>>) => string
  /** Run `apply` now and again whenever the locale changes. */
  bind: (apply: () => void) => void
  listen: (target: EventTarget, type: string, listener: EventListener) => void
  /** The drawing as last painted (clipped to the plot) and the plot area, or null when it is not on screen. */
  geometryOf: (id: string) => { geometry: DrawingGeometry, plot: DrawingBounds } | null
  /** Called after the toolbar changed a drawing, for the host's own bookkeeping (saving, objects list). */
  changed?: () => void
}

/** The ink the person's drawings use when no style says otherwise: shown on the swatches as "default". */
const SWATCHES: readonly string[] = [
  '#ffffff', '#d1d4dc', '#9598a1', '#5d606b', '#2a2e39', '#000000',
  '#f23645', '#ff9800', '#ffeb3b', '#4caf50', '#089981', '#00bcd4', '#2962ff', '#673ab7', '#9c27b0', '#e91e63',
  '#fcccce', '#ffe0b2', '#fff9c4', '#c8e6c9', '#b2dfdb', '#b2ebf2', '#bbd9fb', '#d1c4e9', '#e1bee7', '#f8bbd0'
]
const WIDTHS: readonly number[] = [1, 2, 3, 4, 6, 8]
const DASHES: ReadonlyArray<'solid' | 'dashed' | 'dotted'> = ['solid', 'dashed', 'dotted']
const BRUSH_WIDTHS: readonly number[] = [2, 4, 8, 12, 20]

type Popup = 'color' | 'fill' | 'text' | 'width' | 'dash' | 'more'

interface Capabilities { stroke: boolean, fill: boolean, text: boolean, dash: boolean, freehand: boolean }

/** Which controls make sense for a drawing, from what it actually paints. */
function capabilities (drawing: Drawing, geometry: DrawingGeometry): Capabilities {
  const kinds = new Set(geometry.primitives.map(item => item.kind))
  const freehand = drawing.type === 'brush' || drawing.type === 'highlighter'
  return {
    freehand,
    stroke: drawing.type !== 'image',
    fill: kinds.has('rect') || kinds.has('polygon') || kinds.has('ellipse'),
    text: drawingUsesText(drawing.type) || kinds.has('text') || kinds.has('label'),
    dash: !freehand && drawing.type !== 'image'
  }
}

/** The box the visible parts of a drawing cover, in plot coordinates. */
export function geometryBox (geometry: DrawingGeometry): DrawingBounds | null {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
  const add = (x: number, y: number): void => { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y) }
  for (const primitive of geometry.primitives) {
    switch (primitive.kind) {
      case 'line': case 'rect': add(primitive.from.x, primitive.from.y); add(primitive.to.x, primitive.to.y); break
      case 'polygon': case 'stroke': for (const point of primitive.points) add(point.x, point.y); break
      case 'ellipse':
        add(Math.max(primitive.clip.left, primitive.center.x - primitive.radiusX), Math.max(primitive.clip.top, primitive.center.y - primitive.radiusY))
        add(Math.min(primitive.clip.right, primitive.center.x + primitive.radiusX), Math.min(primitive.clip.bottom, primitive.center.y + primitive.radiusY)); break
      case 'label': case 'image': add(primitive.bounds.left, primitive.bounds.top); add(primitive.bounds.right, primitive.bounds.bottom); break
      case 'text': add(primitive.position.x, primitive.position.y); break
    }
  }
  for (const handle of geometry.handles) add(handle.point.x, handle.point.y)
  return Number.isFinite(left) && Number.isFinite(top) ? { left, top, right, bottom } : null
}

/**
 * The floating toolbar over the selected drawing, as on TradingView: colours, line width and style, lock, delete and a
 * menu. Pure DOM driven by `DrawingToolbarHost`; everything it changes goes through `DrawingStore.update`, so each
 * change is one undo step. It shows only for an unlocked or locked selection that is on screen, and follows the
 * drawing as the chart is panned or zoomed (the host calls `refresh`).
 */
export class DrawingToolbar {
  readonly element: HTMLDivElement
  private readonly host: DrawingToolbarHost
  private readonly doc: Document
  private readonly popup: HTMLDivElement
  private readonly buttons = new Map<string, HTMLButtonElement>()
  private open: Popup | null = null
  private shownId: string | null = null
  private shownSignature = ''
  /** Where the person dragged the toolbar to, kept for the next selections. */
  private moved: { x: number, y: number } | null = null
  private dragging = false
  private pressing = false
  private disposed = false
  private enabled = true

  constructor (host: DrawingToolbarHost) {
    this.host = host; this.doc = host.doc
    this.element = this.doc.createElement('div'); this.element.className = 'sc-dt'; this.element.setAttribute('role', 'toolbar'); this.element.hidden = true
    this.popup = this.doc.createElement('div'); this.popup.className = 'sc-dt-pop'; this.popup.hidden = true
    host.bind(() => { this.element.setAttribute('aria-label', host.t('dt.label')); this.render(true) })
    host.stage.append(this.element)
    // A press on the plot (placing, dragging or panning) takes the toolbar out of the way until the pointer is up.
    const stageDown = (event: Event): void => {
      if (event.target instanceof host.win.Node && this.element.contains(event.target)) return
      this.pressing = true; this.close(); this.element.dataset.busy = 'true'
    }
    const release = (): void => { if (!this.pressing) return; this.pressing = false; delete this.element.dataset.busy; this.refresh() }
    host.listen(host.stage, 'pointerdown', stageDown)
    host.listen(host.win, 'pointerup', release); host.listen(host.win, 'pointercancel', release)
    host.listen(host.doc, 'pointerdown', event => {
      if (this.open !== null && event.target instanceof host.win.Node && !this.element.contains(event.target)) this.close()
    })
    host.listen(this.element, 'keydown', event => {
      const e = event as KeyboardEvent
      // Keys here belong to the toolbar: Escape closes a popup, and nothing reaches the chart's shortcuts (Delete would
      // otherwise remove the drawing while a colour is being typed).
      e.stopPropagation()
      if (e.key === 'Escape' && this.open !== null) { e.preventDefault(); this.close(); this.buttons.get(this.open ?? '')?.focus() }
    })
  }

  /** The `drawingToolbar` part: off hides the toolbar and nothing in it can be reached. */
  setEnabled (enabled: boolean): void {
    if (enabled === this.enabled) return
    this.enabled = enabled
    if (!enabled) { this.close(); this.element.hidden = true } else this.refresh()
  }

  /** Show, move or hide the toolbar for the current selection. Cheap enough to call on every frame of a pan. */
  refresh (): void {
    if (this.disposed || !this.enabled) return
    const snapshot = this.host.store.getSnapshot(), drawing = snapshot.drawings.find(item => item.id === snapshot.selectedId)
    const found = drawing === undefined ? null : this.host.geometryOf(drawing.id)
    const box = found === null ? null : geometryBox(found.geometry)
    if (drawing === undefined || found === null || box === null || this.pressing) {
      this.element.hidden = drawing === undefined || found === null || box === null
      if (drawing === undefined) { this.shownId = null; this.close() }
      return
    }
    const signature = JSON.stringify([drawing.style, drawing.locked, drawing.strokeWidth])
    if (this.shownId !== drawing.id || this.element.hidden) { this.close(); this.shownId = drawing.id; this.shownSignature = signature; this.element.hidden = false; this.render(false) }
    else if (signature !== this.shownSignature) { this.shownSignature = signature; this.render(false) }
    this.place(box, found.plot)
  }

  dispose (): void {
    if (this.disposed) return
    this.disposed = true; this.element.remove()
  }

  private place (box: DrawingBounds, plot: DrawingBounds): void {
    const width = this.element.offsetWidth, height = this.element.offsetHeight
    if (width === 0) return
    let x: number, y: number
    if (this.moved !== null) { x = this.moved.x; y = this.moved.y } else {
      x = (Math.max(box.left, plot.left) + Math.min(box.right, plot.right)) / 2 - width / 2
      y = box.top - height - 12
      if (y < plot.top + 4) y = box.bottom + 12
    }
    x = Math.max(plot.left + 4, Math.min(plot.right - width - 4, x)); y = Math.max(plot.top + 4, Math.min(plot.bottom - height - 4, y))
    this.element.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`
  }

  private current (): Drawing | undefined {
    const snapshot = this.host.store.getSnapshot()
    return snapshot.drawings.find(item => item.id === snapshot.selectedId)
  }

  private apply (patch: (drawing: Drawing) => Parameters<DrawingStore['update']>[1]): void {
    const drawing = this.current()
    if (drawing === undefined) return
    try { this.host.store.update(drawing.id, patch(drawing)) } catch (error) { console.warn('[super-chart] Drawing style was not applied', error) }
    this.host.changed?.()
  }

  private style (change: Partial<{ -readonly [K in keyof DrawingStyle]: DrawingStyle[K] | null }>): void {
    this.apply(drawing => {
      const next: Record<string, unknown> = { ...drawing.style }
      for (const [key, value] of Object.entries(change)) { if (value === null) delete next[key]; else next[key] = value }
      return { style: Object.keys(next).length === 0 ? null : next as DrawingStyle }
    })
  }

  private close (): void {
    if (this.open === null) return
    this.open = null; this.popup.hidden = true; this.popup.replaceChildren()
    for (const button of this.buttons.values()) button.setAttribute('aria-expanded', 'false')
  }

  private button (key: string, icon: string | null, label: string, run: () => void, options: { swatch?: string | null, text?: string, pressed?: boolean, disabled?: boolean, danger?: boolean } = {}): HTMLButtonElement {
    const button = this.doc.createElement('button')
    button.type = 'button'; button.className = 'sc-dt-button'; button.dataset.control = key
    button.setAttribute('aria-label', label); button.title = label
    if (options.danger === true) button.classList.add('sc-danger')
    if (icon !== null) button.append(createIcon(this.doc, icon))
    if (options.text !== undefined) { const text = this.doc.createElement('span'); text.className = 'sc-dt-text'; text.textContent = options.text; button.append(text) }
    if (options.swatch !== undefined) { const bar = this.doc.createElement('span'); bar.className = 'sc-dt-swatch'; bar.style.background = options.swatch ?? 'transparent'; bar.dataset.empty = String(options.swatch === null); button.append(bar) }
    if (options.pressed !== undefined) button.setAttribute('aria-pressed', String(options.pressed))
    button.disabled = options.disabled === true
    button.addEventListener('click', () => { run() })
    return button
  }

  private toggle (kind: Popup, build: (into: HTMLElement) => void, anchor: HTMLButtonElement): void {
    if (this.open === kind) { this.close(); return }
    this.close(); this.open = kind
    this.popup.replaceChildren(); this.popup.dataset.kind = kind; build(this.popup); this.popup.hidden = false
    anchor.setAttribute('aria-expanded', 'true')
    anchor.after(this.popup)
    // Under the button, unless that runs out of the stage: then above it.
    const stage = this.host.stage.getBoundingClientRect(), place = this.popup.getBoundingClientRect(), at = anchor.getBoundingClientRect()
    this.popup.style.left = `${Math.max(-at.left + stage.left + 4, Math.min(0, stage.right - place.width - at.left - 4))}px`
    const room = stage.bottom - at.bottom
    this.popup.dataset.side = room < place.height + 12 ? 'top' : 'bottom'
  }

  private colorPopup (key: 'color' | 'fillColor' | 'textColor', current: string | undefined, into: HTMLElement): void {
    const t = this.host.t
    const grid = this.doc.createElement('div'); grid.className = 'sc-dt-swatches'; grid.setAttribute('role', 'listbox')
    for (const colour of SWATCHES) {
      const swatch = this.doc.createElement('button')
      swatch.type = 'button'; swatch.className = 'sc-dt-chip'; swatch.style.background = colour
      swatch.setAttribute('role', 'option'); swatch.setAttribute('aria-label', colour); swatch.setAttribute('aria-selected', String(current?.slice(0, 7).toLowerCase() === colour))
      swatch.addEventListener('click', () => { this.style({ [key]: colour }); this.close() })
      grid.append(swatch)
    }
    const reset = this.doc.createElement('button'); reset.type = 'button'; reset.className = 'sc-dt-wide'; reset.textContent = t('dt.default')
    reset.addEventListener('click', () => { this.style({ [key]: null }); this.close() })
    const custom = this.doc.createElement('label'); custom.className = 'sc-dt-wide'
    const input = this.doc.createElement('input'); input.type = 'color'; input.value = /^#[0-9a-f]{6}/i.test(current ?? '') ? current!.slice(0, 7) : '#2962ff'
    input.setAttribute('aria-label', t('dt.custom'))
    input.addEventListener('change', () => { this.style({ [key]: input.value }); this.close() })
    custom.append(input, this.doc.createTextNode(` ${t('dt.custom')}`))
    into.append(grid, reset, custom)
  }

  private choicePopup<T extends string | number> (values: readonly T[], current: T | undefined, label: (value: T) => string, pick: (value: T) => void, into: HTMLElement, preview?: (value: T) => string): void {
    const list = this.doc.createElement('div'); list.className = 'sc-dt-list'; list.setAttribute('role', 'listbox')
    for (const value of values) {
      const item = this.doc.createElement('button'); item.type = 'button'; item.className = 'sc-dt-item'
      item.setAttribute('role', 'option'); item.setAttribute('aria-selected', String(value === current))
      if (preview !== undefined) { const bar = this.doc.createElement('span'); bar.className = 'sc-dt-preview'; bar.style.cssText = preview(value); item.append(bar) }
      item.append(this.doc.createTextNode(label(value)))
      item.addEventListener('click', () => { pick(value); this.close() })
      list.append(item)
    }
    into.append(list)
  }

  private render (relocale: boolean): void {
    const drawing = this.current(), found = drawing === undefined ? null : this.host.geometryOf(drawing.id)
    if (drawing === undefined || found === null) return
    const t = this.host.t, caps = capabilities(drawing, found.geometry), style = drawing.style
    const reopen = relocale ? this.open : null
    this.close(); this.buttons.clear()
    const grip = this.doc.createElement('div'); grip.className = 'sc-dt-grip'; grip.title = t('dt.move'); grip.append(createIcon(this.doc, 'grip'))
    grip.addEventListener('pointerdown', event => {
      if (event.button !== 0) return
      event.preventDefault(); grip.setPointerCapture(event.pointerId)
      const stage = this.host.stage.getBoundingClientRect(), box = this.element.getBoundingClientRect()
      const dx = event.clientX - box.left, dy = event.clientY - box.top
      this.dragging = true
      const move = (e: PointerEvent): void => {
        this.moved = { x: e.clientX - stage.left - dx, y: e.clientY - stage.top - dy }
        const plot = found.plot, width = this.element.offsetWidth, height = this.element.offsetHeight
        this.moved.x = Math.max(plot.left + 4, Math.min(plot.right - width - 4, this.moved.x)); this.moved.y = Math.max(plot.top + 4, Math.min(plot.bottom - height - 4, this.moved.y))
        this.element.style.transform = `translate(${Math.round(this.moved.x)}px,${Math.round(this.moved.y)}px)`
      }
      const up = (): void => { this.dragging = false; grip.removeEventListener('pointermove', move as EventListener); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up) }
      grip.addEventListener('pointermove', move as EventListener); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up)
    })
    const items: HTMLElement[] = [grip]
    const locked = drawing.locked, ink = style?.color
    const add = (key: string, button: HTMLButtonElement): void => { this.buttons.set(key, button); items.push(button) }
    const sep = (): void => { const s = this.doc.createElement('span'); s.className = 'sc-dt-sep'; s.setAttribute('role', 'separator'); items.push(s) }
    if (caps.stroke) {
      const b = this.button('color', 'pen', t('dt.color'), () => { this.toggle('color', into => { this.colorPopup('color', style?.color, into) }, b) }, { swatch: ink ?? null, disabled: locked })
      b.setAttribute('aria-haspopup', 'listbox'); b.setAttribute('aria-expanded', 'false'); add('color', b)
    }
    if (caps.fill) {
      const b = this.button('fill', 'fill', t('dt.fill'), () => {
        this.toggle('fill', into => {
          this.colorPopup('fillColor', style?.fillColor, into)
          const label = this.doc.createElement('label'); label.className = 'sc-dt-wide'
          const range = this.doc.createElement('input'); range.type = 'range'; range.min = '0'; range.max = '100'; range.step = '5'
          range.value = String(Math.round((style?.fillOpacity ?? 0.1) * 100)); range.setAttribute('aria-label', t('dt.opacity'))
          range.addEventListener('change', () => { this.style({ fillOpacity: Number(range.value) / 100 }) })
          label.append(this.doc.createTextNode(`${t('dt.opacity')} `), range); into.append(label)
        }, b)
      }, { swatch: style?.fillColor ?? null, disabled: locked })
      b.setAttribute('aria-haspopup', 'listbox'); b.setAttribute('aria-expanded', 'false'); add('fill', b)
    }
    if (caps.text) {
      const b = this.button('text', 'text', t('dt.textColor'), () => { this.toggle('text', into => { this.colorPopup('textColor', style?.textColor, into) }, b) }, { swatch: style?.textColor ?? null, disabled: locked })
      b.setAttribute('aria-haspopup', 'listbox'); b.setAttribute('aria-expanded', 'false'); add('text', b)
    }
    if (caps.stroke || caps.fill || caps.text) sep()
    if (caps.freehand) {
      const widthNow = drawing.strokeWidth ?? (drawing.type === 'highlighter' ? 12 : 3)
      const b = this.button('width', null, t('dt.width'), () => { this.toggle('width', into => { this.choicePopup(BRUSH_WIDTHS, widthNow, value => `${value}px`, value => { this.apply(() => ({ strokeWidth: value })) }, into, value => `height:${Math.min(value, 14)}px;background:currentColor`) }, b) }, { text: `${widthNow}px`, disabled: locked })
      b.setAttribute('aria-haspopup', 'listbox'); b.setAttribute('aria-expanded', 'false'); add('width', b)
    } else if (caps.stroke) {
      const widthNow = style?.width ?? 1.5
      const b = this.button('width', null, t('dt.width'), () => { this.toggle('width', into => { this.choicePopup(WIDTHS, style?.width, value => `${value}px`, value => { this.style({ width: value }) }, into, value => `height:${value}px;background:currentColor`) }, b) }, { text: `${Number.isInteger(widthNow) ? widthNow : widthNow.toFixed(1)}px`, disabled: locked })
      b.setAttribute('aria-haspopup', 'listbox'); b.setAttribute('aria-expanded', 'false'); add('width', b)
    }
    if (caps.dash) {
      const dash = style?.dash ?? 'solid'
      const b = this.button('dash', null, t('dt.dash'), () => {
        this.toggle('dash', into => { this.choicePopup(DASHES, dash, value => t(`dt.dash.${value}`), value => { this.style({ dash: value === 'solid' ? null : value }) }, into, value => `height:0;border-top:2px ${value === 'dotted' ? 'dotted' : value === 'dashed' ? 'dashed' : 'solid'} currentColor`) }, b)
      }, { disabled: locked })
      const preview = this.doc.createElement('span'); preview.className = 'sc-dt-preview'; preview.style.cssText = `height:0;border-top:2px ${dash === 'dotted' ? 'dotted' : dash === 'dashed' ? 'dashed' : 'solid'} currentColor`; b.append(preview)
      b.setAttribute('aria-haspopup', 'listbox'); b.setAttribute('aria-expanded', 'false'); add('dash', b)
    }
    if (caps.stroke) sep()
    add('lock', this.button('lock', locked ? 'unlock' : 'lock', t(locked ? 'draw.unlock' : 'draw.lock'), () => { this.apply(d => ({ locked: !d.locked })) }, { pressed: locked }))
    add('delete', this.button('delete', 'trash', t('draw.delete'), () => { const d = this.current(); if (d !== undefined && this.host.store.remove(d.id)) this.host.changed?.() }, { disabled: locked, danger: true }))
    const more = this.button('more', 'more', t('dt.more'), () => {
      this.toggle('more', into => {
        const list = this.doc.createElement('div'); list.className = 'sc-dt-list'
        const entry = (label: string, run: () => void, disabled = false): void => {
          const item = this.doc.createElement('button'); item.type = 'button'; item.className = 'sc-dt-item'; item.textContent = label; item.disabled = disabled
          item.addEventListener('click', () => { this.close(); run() }); list.append(item)
        }
        entry(t('dt.clone'), () => { this.clone() })
        entry(t('dt.hide'), () => { this.apply(() => ({ hidden: true })) })
        entry(t('dt.reset'), () => { this.apply(() => ({ style: null, ...(caps.freehand ? {} : {}) })) }, style === undefined || locked)
        into.append(list)
      }, more)
    })
    more.setAttribute('aria-haspopup', 'menu'); more.setAttribute('aria-expanded', 'false'); add('more', more)
    this.element.replaceChildren(...items)
    if (reopen !== null) this.buttons.get(reopen)?.click()
  }

  /** A copy slightly to the side, so it can be told from the original, selected and ready to move. */
  private clone (): void {
    const drawing = this.current()
    if (drawing === undefined) return
    const store = this.host.store
    let id = `${drawing.id}-copy`
    for (let n = 2; store.getSnapshot().drawings.some(item => item.id === id); n++) id = `${drawing.id}-copy-${n}`
    try {
      const copy = store.add({ ...drawing, id, locked: false, anchors: drawing.anchors.map(anchor => ({ ...anchor })) })
      store.select(copy.id)
    } catch (error) { console.warn('[super-chart] Drawing was not cloned', error) }
    this.host.changed?.()
  }
}
