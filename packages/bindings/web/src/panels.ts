/** DOM for the workspace's floating panels: command palette and context menu. Styled by `.sc-*` rules in workspaceStyle.ts. */
import { filterCommands, type WorkspaceCommand } from './commands'
import type { Translator } from './i18n'

export interface PaletteHost {
  readonly doc: Document
  readonly root: HTMLElement
  readonly t: () => Translator
  readonly commands: () => WorkspaceCommand[]
  readonly listen: (target: EventTarget, type: string, listener: EventListener) => void
  /** Run a command and surface its error; the palette closes first. */
  readonly run: (command: WorkspaceCommand) => void
  readonly closeOthers: () => void
}

/** Searchable command list (combobox + listbox). One instance per workspace. */
export class CommandPalette {
  readonly panel: HTMLDivElement
  private readonly input: HTMLInputElement
  private readonly list: HTMLUListElement
  private readonly status: HTMLDivElement
  private readonly title: HTMLHeadingElement
  private shown: WorkspaceCommand[] = []
  private active = 0
  private returnFocus: HTMLElement | null = null

  constructor (private readonly host: PaletteHost) {
    const { doc } = host
    this.panel = doc.createElement('div'); this.panel.className = 'sc-search sc-palette'; this.panel.hidden = true
    this.panel.setAttribute('role', 'dialog')
    this.title = doc.createElement('h2')
    const header = doc.createElement('div'); header.className = 'sc-panel-header'
    const close = doc.createElement('button'); close.type = 'button'; close.className = 'sc-button'; close.dataset.paletteClose = 'true'
    header.append(this.title, close)
    this.input = doc.createElement('input'); this.input.type = 'text'; this.input.className = 'sc-input sc-search-input'
    this.input.autocomplete = 'off'; this.input.spellcheck = false
    this.input.setAttribute('role', 'combobox'); this.input.setAttribute('aria-expanded', 'true'); this.input.setAttribute('aria-autocomplete', 'list')
    this.list = doc.createElement('ul'); this.list.className = 'sc-search-results'; this.list.setAttribute('role', 'listbox'); this.list.id = `sc-palette-${Math.random().toString(36).slice(2, 8)}`
    this.input.setAttribute('aria-controls', this.list.id)
    this.status = doc.createElement('div'); this.status.className = 'sc-search-status'; this.status.setAttribute('role', 'status')
    this.panel.append(header, this.input, this.status, this.list)
    host.listen(this.input, 'input', () => { this.active = 0; this.render() })
    host.listen(this.panel, 'keydown', event => this.key(event as KeyboardEvent))
    host.listen(close, 'click', () => this.close())
    host.listen(this.list, 'click', event => {
      const item = event.target instanceof host.doc.defaultView!.Element ? event.target.closest<HTMLElement>('[data-index]') : null
      if (item !== null) this.choose(Number(item.dataset.index))
    })
    this.applyText()
  }

  get isOpen (): boolean { return !this.panel.hidden }

  /** Re-read translated text after a locale change. */
  applyText (): void {
    const t = this.host.t()
    this.panel.setAttribute('aria-label', t('palette.title')); this.title.textContent = t('palette.title')
    this.input.placeholder = t('palette.placeholder'); this.input.setAttribute('aria-label', t('palette.placeholder'))
    this.list.setAttribute('aria-label', t('palette.results'))
    const close = this.panel.querySelector<HTMLButtonElement>('[data-palette-close]')
    if (close !== null) close.textContent = t('search.close')
    if (this.isOpen) this.render()
  }

  open (query = ''): void {
    this.host.closeOthers()
    const active = this.host.doc.activeElement
    this.returnFocus = active instanceof this.host.doc.defaultView!.HTMLElement ? active : null
    this.input.value = query; this.active = 0; this.panel.hidden = false; this.render(); this.input.focus()
  }

  close (restoreFocus = true): void {
    if (this.panel.hidden) return
    this.panel.hidden = true
    if (restoreFocus) this.returnFocus?.focus({ preventScroll: true })
    this.returnFocus = null
  }

  private render (): void {
    const t = this.host.t()
    this.shown = filterCommands(this.host.commands(), this.input.value)
    this.active = Math.min(this.active, Math.max(0, this.shown.length - 1))
    this.status.textContent = this.shown.length === 0 ? t('palette.empty') : ''
    const items: HTMLLIElement[] = []
    let group: string | undefined
    this.shown.forEach((command, index) => {
      if (this.input.value.trim() === '' && command.group !== undefined && command.group !== group) {
        group = command.group
        const heading = this.host.doc.createElement('li'); heading.className = 'sc-palette-group'; heading.setAttribute('role', 'presentation'); heading.textContent = group; items.push(heading)
      }
      const item = this.host.doc.createElement('li'); item.id = `${this.list.id}-${index}`; item.dataset.index = String(index)
      item.setAttribute('role', 'option'); item.setAttribute('aria-selected', String(index === this.active)); item.className = 'sc-palette-item'
      const label = this.host.doc.createElement('span'); label.textContent = command.title
      item.append(label)
      if (command.shortcut !== undefined) { const key = this.host.doc.createElement('kbd'); key.textContent = command.shortcut; item.append(key) }
      items.push(item)
    })
    this.list.replaceChildren(...items)
    this.syncActive()
  }

  private syncActive (): void {
    const options = this.list.querySelectorAll<HTMLElement>('[role=option]')
    options.forEach((option, index) => option.setAttribute('aria-selected', String(index === this.active)))
    const current = options[this.active]
    if (current !== undefined) { this.input.setAttribute('aria-activedescendant', current.id); current.scrollIntoView?.({ block: 'nearest' }) } else this.input.removeAttribute('aria-activedescendant')
  }

  private choose (index: number): void {
    const command = this.shown[index]
    if (command === undefined) return
    this.close(false)
    this.host.run(command)
  }

  private key (event: KeyboardEvent): void {
    if (event.isComposing) return
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(); return }
    if (event.key === 'Enter' && event.target === this.input) { event.preventDefault(); this.choose(this.active); return }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const count = this.shown.length
      if (count > 0) { this.active = (this.active + (event.key === 'ArrowDown' ? 1 : count - 1)) % count; this.syncActive() }
    } else if ((event.key === 'Home' || event.key === 'End') && event.ctrlKey) {
      event.preventDefault(); this.active = event.key === 'Home' ? 0 : Math.max(0, this.shown.length - 1); this.syncActive()
    }
  }
}

export interface ContextMenuItem {
  readonly id: string
  readonly label: string
  readonly run?: () => void
  readonly disabled?: boolean
  /** Danger styling for destructive entries. */
  readonly danger?: boolean
  /** A divider is drawn before this item. */
  readonly separator?: boolean
}

export interface ContextMenuHost {
  readonly doc: Document
  readonly root: HTMLElement
  readonly t: () => Translator
  readonly listen: (target: EventTarget, type: string, listener: EventListener) => void
  readonly onRun: (item: ContextMenuItem) => void
}

/** Right-click menu positioned inside the workspace root. */
export class ContextMenu {
  readonly element: HTMLDivElement
  constructor (private readonly host: ContextMenuHost) {
    this.element = host.doc.createElement('div'); this.element.className = 'sc-context-menu'; this.element.hidden = true; this.element.setAttribute('role', 'menu')
    host.listen(this.element, 'keydown', event => this.key(event as KeyboardEvent))
    host.listen(this.element, 'click', event => {
      const button = event.target instanceof host.doc.defaultView!.Element ? event.target.closest<HTMLButtonElement>('button[data-id]') : null
      if (button === null || button.disabled) return
      const item = this.items.find(entry => entry.id === button.dataset.id)
      this.close(); if (item !== undefined) host.onRun(item)
    })
  }

  private items: readonly ContextMenuItem[] = []
  private returnFocus: HTMLElement | null = null
  get isOpen (): boolean { return !this.element.hidden }

  /** `x` and `y` are client coordinates; the menu is clamped inside the workspace. */
  open (items: readonly ContextMenuItem[], x: number, y: number, label: string): void {
    this.items = items.filter(item => item.label.trim() !== '')
    if (this.items.length === 0) return
    const active = this.host.doc.activeElement
    this.returnFocus = active instanceof this.host.doc.defaultView!.HTMLElement ? active : null
    this.element.setAttribute('aria-label', label)
    this.element.replaceChildren(...this.items.map(item => {
      const button = this.host.doc.createElement('button')
      button.type = 'button'; button.className = 'sc-button sc-menu-item'; button.textContent = item.label; button.dataset.id = item.id
      button.setAttribute('role', 'menuitem'); button.disabled = item.disabled === true; button.tabIndex = -1
      if (item.danger === true) button.classList.add('sc-danger')
      if (item.separator === true) button.dataset.separator = 'true'
      return button
    }))
    this.element.hidden = false
    const rect = this.host.root.getBoundingClientRect(), width = this.element.offsetWidth, height = this.element.offsetHeight
    const left = Math.max(0, Math.min(x - rect.left, Math.max(0, rect.width - width))), top = Math.max(0, Math.min(y - rect.top, Math.max(0, rect.height - height)))
    this.element.style.left = `${left}px`; this.element.style.top = `${top}px`
    this.element.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true })
  }

  close (restoreFocus = true): void {
    if (this.element.hidden) return
    this.element.hidden = true; this.element.replaceChildren(); this.items = []
    if (restoreFocus) this.returnFocus?.focus({ preventScroll: true })
    this.returnFocus = null
  }

  private key (event: KeyboardEvent): void {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(); return }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    const buttons = [...this.element.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
    if (buttons.length === 0) return
    const at = buttons.indexOf(this.host.doc.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (at + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length
    buttons[next].focus({ preventScroll: true })
  }
}
