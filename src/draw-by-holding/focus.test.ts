import { describe, expect, it, vi } from 'vitest'
import { attachHoldFocusBoundary, isHoldControlTarget, isHoldKeyTarget, isHoldPlotTarget } from './focus'

// A tiny DOM surface keeps these focus/listener tests independent of a browser runner.
class ElementSurface {
  readonly nodeType = 1
  readonly tagName: string
  ownerDocument!: Document
  isContentEditable = false
  constructor (tag: string, readonly parent: ElementSurface | null = null, readonly attributes: Record<string, string> = {}) { this.tagName = tag.toUpperCase() }
  contains (node: Node): boolean {
    for (let at = node as unknown as ElementSurface | null; at !== null; at = at.parent) if (at === this) return true
    return false
  }

  closest (selector: string): ElementSurface | null {
    if (selector.split(',').some(raw => {
      const part = raw.trim()
      if (part === '[contenteditable]:not([contenteditable="false"])') return this.attributes.contenteditable !== undefined && this.attributes.contenteditable !== 'false'
      if (part.startsWith('.')) return (this.attributes.class ?? '').split(' ').includes(part.slice(1))
      const role = part.match(/^\[role="([^"]+)"\]$/)?.[1]
      if (role !== undefined) return this.attributes.role === role
      if (part === 'a[href]') return this.tagName === 'A' && this.attributes.href !== undefined
      return part.toUpperCase() === this.tagName
    })) return this
    return this.parent?.closest(selector) ?? null
  }
}

function surfaces (): { doc: Document, root: HTMLElement, plot: HTMLElement, child: HTMLElement, chrome: HTMLElement, emit: (type: string, target: EventTarget) => Event } {
  const events = new EventTarget()
  const body = new ElementSurface('body')
  const root = new ElementSurface('div', body)
  const plot = new ElementSurface('div', root)
  const child = new ElementSurface('canvas', plot)
  const chrome = new ElementSurface('div', root)
  const doc = Object.assign(events, { body, documentElement: new ElementSurface('html'), defaultView: {} }) as unknown as Document
  for (const element of [body, root, plot, child, chrome]) element.ownerDocument = doc
  return {
    doc,
    root: root as unknown as HTMLElement,
    plot: plot as unknown as HTMLElement,
    child: child as unknown as HTMLElement,
    chrome: chrome as unknown as HTMLElement,
    emit (type, target) {
      const event = new Event(type, { cancelable: true })
      Object.defineProperty(event, 'composedPath', { value: () => [target, doc] })
      events.dispatchEvent(event)
      return event
    }
  }
}

describe('hold focus boundary', () => {
  it('rejects native and ARIA controls, editable descendants, toolbar/Objects content and nested SVG icons', () => {
    const controls = [
      new ElementSurface('button'), new ElementSurface('a', null, { href: '#' }),
      ...['text', 'checkbox', 'range', 'radio', 'color', 'file', 'button'].map(type => new ElementSurface('input', null, { type })),
      new ElementSurface('select'), new ElementSurface('textarea'), new ElementSurface('summary'),
      ...['button', 'link', 'tab', 'checkbox', 'radio', 'switch', 'combobox', 'slider', 'spinbutton', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'toolbar'].map(role => new ElementSurface('div', null, { role })),
      new ElementSurface('div', null, { contenteditable: 'plaintext-only' }),
      ...['klinecharts-pro-drawing-toolbar', 'klinecharts-pro-drawing-context-menu', 'klinecharts-pro-objects-panel', 'sc-draw-hold-controls'].map(name => new ElementSurface('div', null, { class: name }))
    ]
    for (const control of controls) {
      expect(isHoldControlTarget(control as unknown as EventTarget)).toBe(true)
      expect(isHoldControlTarget(new ElementSurface('path', control) as unknown as EventTarget)).toBe(true)
    }
    expect(isHoldControlTarget(new ElementSurface('a') as unknown as EventTarget)).toBe(false)
    expect(isHoldControlTarget(new ElementSurface('div', null, { contenteditable: 'false' }) as unknown as EventTarget)).toBe(false)
  })
  it('allows only plot descendants, exact root or dispatcher-owned document/default focus', () => {
    const { doc, root, plot, child, chrome } = surfaces()
    for (const target of [null, doc, doc.body, doc.documentElement, doc.defaultView, root, plot, child]) expect(isHoldKeyTarget(target, root, plot)).toBe(true)
    expect(isHoldKeyTarget(chrome, root, plot)).toBe(false)
    const other = new ElementSurface('canvas') as unknown as EventTarget
    expect(isHoldKeyTarget(other, root, plot)).toBe(false)
    const button = new ElementSurface('button', plot as unknown as ElementSurface) as unknown as EventTarget
    expect(isHoldKeyTarget(button, root, plot)).toBe(false)
    expect(isHoldPlotTarget(button, plot)).toBe(false)
    expect(isHoldPlotTarget(child, plot)).toBe(true)
  })
  it('invalidates the latest on every press and cancels outside presses/focus without consuming UI events', () => {
    const { root, plot, child, chrome, emit } = surfaces()
    const controller = { selection: vi.fn(), cancel: vi.fn() }
    const off = attachHoldFocusBoundary(root, () => plot, controller)
    expect(emit('pointerdown', child).defaultPrevented).toBe(false)
    expect(controller.selection).toHaveBeenCalledWith(null)
    expect(controller.cancel).not.toHaveBeenCalled()
    expect(emit('pointerdown', chrome).defaultPrevented).toBe(false)
    expect(controller.cancel).toHaveBeenCalledOnce()
    emit('focusin', child)
    expect(controller.cancel).toHaveBeenCalledOnce()
    emit('focusin', chrome)
    expect(controller.cancel).toHaveBeenCalledTimes(2)
    off(); off()
    emit('pointerdown', chrome); emit('focusin', chrome)
    expect(controller.selection).toHaveBeenCalledTimes(2)
    expect(controller.cancel).toHaveBeenCalledTimes(2)
  })
})
