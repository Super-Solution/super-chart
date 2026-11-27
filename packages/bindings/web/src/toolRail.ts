import type { DrawingType } from '@supersolutions/super-chart-core'
import { createIcon, toolIconName } from './icons'

/** What the rail needs from its workspace. Everything else (which tool is armed, drawing history) stays there. */
export interface ToolRailHost {
  readonly doc: Document
  readonly win: Window & typeof globalThis
  /** Translated text for a catalogue key. */
  t: (key: string, params?: Readonly<Record<string, string | number>>) => string
  /** Run `apply` now and again whenever the locale changes. */
  bind: (apply: () => void) => void
  listen: (target: EventTarget, type: string, listener: EventListener) => void
  /** Every drawing tool, in catalogue order. */
  tools: readonly DrawingType[]
  /** The group a tool belongs to (a catalogue key such as `group.lines`). */
  groupOf: (type: DrawingType) => string
  toolLabel: (type: DrawingType) => string
  /** The person picked a tool, or `null` for the cursor. */
  choose: (tool: DrawingType | null) => void
}

/** Group order in the rail, and the tool each group offers first. Groups that no tool belongs to are left out. */
const GROUPS: ReadonlyArray<readonly [group: string, first: DrawingType]> = [
  ['group.lines', 'segment'], ['group.channels', 'parallel-channel'], ['group.fibonacci', 'fibonacci'],
  ['group.patterns', 'xabcd'], ['group.shapes', 'rectangle'], ['group.measurement', 'price-range'],
  ['group.annotations', 'text'], ['group.studies', 'anchored-vwap'], ['group.freehand', 'brush']
]

interface RailGroup {
  readonly group: string
  readonly tools: DrawingType[]
  readonly wrap: HTMLDivElement
  readonly main: HTMLButtonElement
  readonly more: HTMLButtonElement
  shown: DrawingType
}

/**
 * The vertical drawing toolbar: a cursor, then one button per tool group showing the tool you used last, with a small
 * arrow (or a right click, or Right Arrow) that opens the whole group. Pure DOM, driven by `ToolRailHost`, so the
 * workspace owns the chart state and a host that wants another toolbox can hide this part and build its own.
 */
export class ToolRail {
  readonly element: HTMLDivElement
  /** Toggles that change how every tool behaves (magnet, keep drawing). The workspace fills it. */
  readonly modes: HTMLDivElement
  /** The foot of the rail, for actions on the selected drawing. The workspace fills it. */
  readonly foot: HTMLDivElement
  private readonly doc: Document
  private readonly win: Window & typeof globalThis
  private readonly host: ToolRailHost
  private readonly cursor: HTMLButtonElement
  private readonly groups: RailGroup[] = []
  private readonly flyout: HTMLDivElement
  private open: RailGroup | null = null
  private active: DrawingType | null = null
  private disabled = false

  constructor (host: ToolRailHost) {
    this.host = host; this.doc = host.doc; this.win = host.win
    const doc = this.doc
    this.element = doc.createElement('div'); this.element.className = 'sc-rail'
    this.element.setAttribute('role', 'toolbar'); this.element.setAttribute('aria-orientation', 'vertical')
    host.bind(() => { this.element.setAttribute('aria-label', host.t('bar.tools')) })
    this.cursor = this.makeButton('sc-rail-tool', 'cursor')
    host.bind(() => { this.label(this.cursor, host.t('rail.cursor')) })
    this.cursor.dataset.rail = 'cursor'
    const list = doc.createElement('div'); list.className = 'sc-rail-list'
    list.append(this.cursor)
    for (const [group, first] of GROUPS) {
      const tools = host.tools.filter(type => host.groupOf(type) === group)
      if (tools.length === 0) continue
      const wrap = doc.createElement('div'); wrap.className = 'sc-rail-group'; wrap.dataset.group = group; wrap.dataset.tools = tools.join(' ')
      const shown = tools.includes(first) ? first : tools[0]
      const main = this.makeButton('sc-rail-tool', toolIconName(shown, group)); main.dataset.rail = group
      main.setAttribute('aria-haspopup', 'menu'); main.setAttribute('aria-expanded', 'false')
      const more = this.makeButton('sc-rail-more', 'chevron'); more.tabIndex = -1; more.setAttribute('aria-haspopup', 'menu'); more.setAttribute('aria-expanded', 'false')
      wrap.append(main, more)
      const entry: RailGroup = { group, tools, wrap, main, more, shown }
      this.groups.push(entry); list.append(wrap)
      host.bind(() => {
        const name = host.t(group)
        this.label(main, host.t('rail.pick', { tool: host.toolLabel(entry.shown), group: name }), host.toolLabel(entry.shown))
        this.label(more, host.t('rail.flyout', { group: name }))
      })
    }
    this.modes = doc.createElement('div'); this.modes.className = 'sc-rail-modes'
    this.foot = doc.createElement('div'); this.foot.className = 'sc-rail-foot'
    this.flyout = doc.createElement('div'); this.flyout.className = 'sc-flyout'; this.flyout.setAttribute('role', 'menu'); this.flyout.hidden = true
    this.element.append(list, this.modes, this.foot)
    this.setTabStop(0)
    host.listen(this.element, 'click', event => { this.onClick(event) })
    host.listen(this.element, 'contextmenu', event => { this.onContextMenu(event as MouseEvent) })
    host.listen(this.element, 'keydown', event => { this.onRailKey(event as KeyboardEvent) })
    host.listen(this.flyout, 'click', event => { this.onFlyoutClick(event) })
    host.listen(this.flyout, 'keydown', event => { this.onFlyoutKey(event as KeyboardEvent) })
    this.sync(null, false)
  }

  /** The element the workspace places beside the chart: the flyout floats over the stage, so it lives with the rail. */
  get flyoutElement (): HTMLDivElement { return this.flyout }
  get isOpen (): boolean { return this.open !== null }

  /** Reflect the armed tool; `disabled` while no chart is shown. Each group remembers the tool it last showed. */
  sync (active: DrawingType | null, disabled: boolean): void {
    this.active = active; this.disabled = disabled
    this.cursor.setAttribute('aria-pressed', String(active === null)); this.cursor.disabled = disabled
    for (const group of this.groups) {
      const armed = active !== null && group.tools.includes(active)
      if (armed && group.shown !== active) { group.shown = active; this.setIcon(group.main, toolIconName(active, group.group)) }
      group.main.setAttribute('aria-pressed', String(armed)); group.main.disabled = disabled; group.more.disabled = disabled
      group.wrap.dataset.armed = String(armed)
      const name = this.host.t(group.group)
      this.label(group.main, this.host.t('rail.pick', { tool: this.host.toolLabel(group.shown), group: name }), this.host.toolLabel(group.shown))
    }
    if (disabled) this.close(false)
  }

  close (restoreFocus = true): void {
    const group = this.open
    if (group === null) return
    this.open = null; this.flyout.hidden = true; this.flyout.replaceChildren()
    group.main.setAttribute('aria-expanded', 'false'); group.more.setAttribute('aria-expanded', 'false')
    if (restoreFocus) group.main.focus({ preventScroll: true })
  }

  contains (node: Node): boolean { return this.element.contains(node) || this.flyout.contains(node) }

  private makeButton (className: string, icon: string): HTMLButtonElement {
    const button = this.doc.createElement('button'); button.type = 'button'; button.className = `sc-button ${className}`
    button.append(createIcon(this.doc, icon))
    return button
  }

  private label (button: HTMLElement, text: string, title = text): void {
    if (button.title !== title) button.title = title
    button.setAttribute('aria-label', text)
  }

  private setIcon (button: HTMLElement, icon: string): void {
    const next = createIcon(this.doc, icon); const current = button.querySelector('.sc-icon')
    if (current !== null) current.replaceWith(next); else button.prepend(next)
  }

  private entryOf (target: EventTarget | null): RailGroup | null {
    if (!(target instanceof this.win.Element)) return null
    const wrap = target.closest<HTMLElement>('.sc-rail-group')
    return this.groups.find(group => group.wrap === wrap) ?? null
  }

  private onClick (event: Event): void {
    if (this.disabled || !(event.target instanceof this.win.Element)) return
    const button = event.target.closest('button'); if (button === null || button.disabled) return
    if (button === this.cursor) { this.close(false); this.host.choose(null); return }
    const group = this.entryOf(button); if (group === null) return
    if (button === group.more) { if (this.open === group) this.close(); else this.openFlyout(group, false); return }
    this.close(false)
    // The group button toggles: a second press on the armed tool hands the pointer back to the chart.
    this.host.choose(this.active !== null && group.tools.includes(this.active) ? null : group.shown)
  }

  private onContextMenu (event: MouseEvent): void {
    const group = this.entryOf(event.target)
    event.preventDefault()
    if (group !== null && !this.disabled) this.openFlyout(group, false)
  }

  private onRailKey (event: KeyboardEvent): void {
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return
    const stops = [this.cursor, ...this.groups.map(group => group.main)]
    const current = stops.findIndex(button => button === this.doc.activeElement)
    if (current < 0) return
    const group = this.groups.find(item => item.main === stops[current])
    let next = -1
    if (event.key === 'ArrowDown') next = (current + 1) % stops.length
    else if (event.key === 'ArrowUp') next = (current - 1 + stops.length) % stops.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = stops.length - 1
    else if (event.key === 'ArrowRight' && group !== undefined && !this.disabled) { event.preventDefault(); this.openFlyout(group, true); return }
    if (next < 0) return
    event.preventDefault(); this.setTabStop(next); stops[next].focus({ preventScroll: true })
  }

  /** One tab stop for the whole rail; the arrow keys move within it. */
  private setTabStop (index: number): void {
    const stops = [this.cursor, ...this.groups.map(group => group.main)]
    stops.forEach((button, i) => { button.tabIndex = i === index ? 0 : -1 })
  }

  private openFlyout (group: RailGroup, focus: boolean): void {
    this.close(false)
    const { host, doc } = this
    this.open = group
    const title = doc.createElement('div'); title.className = 'sc-flyout-title'; title.textContent = host.t(group.group)
    this.flyout.setAttribute('aria-label', host.t(group.group))
    const items = group.tools.map(type => {
      const item = doc.createElement('button'); item.type = 'button'; item.className = 'sc-flyout-item'; item.setAttribute('role', 'menuitemradio')
      item.dataset.tool = type; item.setAttribute('aria-checked', String(this.active === type)); item.tabIndex = -1
      const label = doc.createElement('span'); label.textContent = host.toolLabel(type)
      item.append(createIcon(doc, toolIconName(type, group.group)), label)
      return item
    })
    this.flyout.replaceChildren(title, ...items); this.flyout.hidden = false
    group.main.setAttribute('aria-expanded', 'true'); group.more.setAttribute('aria-expanded', 'true')
    // Beside the group's button, kept inside the stage: long groups scroll rather than leave the chart.
    const body = this.flyout.offsetParent instanceof this.win.HTMLElement ? this.flyout.offsetParent : null
    if (body !== null) {
      const bodyBox = body.getBoundingClientRect(), anchor = group.wrap.getBoundingClientRect()
      const maxHeight = Math.max(120, bodyBox.height - 8)
      this.flyout.style.maxHeight = `${maxHeight}px`
      const height = Math.min(this.flyout.offsetHeight, maxHeight)
      const top = Math.max(4, Math.min(anchor.top - bodyBox.top, bodyBox.height - height - 4))
      this.flyout.style.top = `${top}px`; this.flyout.style.left = `${this.element.offsetWidth + 4}px`
    }
    const selected = items.find(item => item.dataset.tool === this.active) ?? items.find(item => item.dataset.tool === group.shown) ?? items[0]
    if (focus) selected.focus({ preventScroll: true })
  }

  private onFlyoutClick (event: Event): void {
    if (!(event.target instanceof this.win.Element)) return
    const item = event.target.closest<HTMLElement>('.sc-flyout-item'), group = this.open
    if (item === null || group === null) return
    const tool = group.tools.find(type => type === item.dataset.tool); if (tool === undefined) return
    group.shown = tool; this.setIcon(group.main, toolIconName(tool, group.group))
    this.close(false); this.host.choose(tool)
  }

  private onFlyoutKey (event: KeyboardEvent): void {
    if (event.isComposing) return
    const items = [...this.flyout.querySelectorAll<HTMLButtonElement>('.sc-flyout-item')], current = items.findIndex(item => item === this.doc.activeElement)
    if (event.key === 'Escape' || event.key === 'ArrowLeft') { event.preventDefault(); event.stopPropagation(); this.close(); return }
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    if (step !== 0) { event.preventDefault(); items[(current + step + items.length) % items.length]?.focus({ preventScroll: true }) }
    else if (event.key === 'Home') { event.preventDefault(); items[0]?.focus({ preventScroll: true }) }
    else if (event.key === 'End') { event.preventDefault(); items[items.length - 1]?.focus({ preventScroll: true }) }
  }
}
