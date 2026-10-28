/** Hold-result keys belong to the plot, never to a chart control's focus navigation. */
const CONTROL_SELECTOR = [
  'button', 'a[href]', 'input', 'select', 'textarea', 'summary',
  '[contenteditable]:not([contenteditable="false"])',
  '[role="button"]', '[role="link"]', '[role="tab"]', '[role="checkbox"]',
  '[role="radio"]', '[role="switch"]', '[role="combobox"]', '[role="slider"]',
  '[role="spinbutton"]', '[role="menuitem"]', '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]', '[role="toolbar"]',
  '.klinecharts-pro-drawing-toolbar', '.klinecharts-pro-drawing-context-menu',
  '.klinecharts-pro-objects-panel', '.sc-draw-hold-controls'
].join(', ')

export function isHoldControlTarget (target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (element === null || typeof element.tagName !== 'string') return false
  // Native tags also work with small non-browser controller test targets.
  const tag = element.tagName.toLowerCase()
  if (['button', 'input', 'select', 'textarea', 'summary'].includes(tag) || element.isContentEditable) return true
  return typeof element.closest === 'function' && element.closest(CONTROL_SELECTOR) !== null
}

export function isHoldPlotTarget (target: EventTarget | null, plot: HTMLElement | null | undefined): boolean {
  if (plot === null || plot === undefined || isHoldControlTarget(target)) return false
  const node = target as Node | null
  return node !== null && typeof node.nodeType === 'number' && plot.contains(node)
}

/** The dispatcher separately verifies that document/default focus belongs to this chart. */
export function isHoldKeyTarget (target: EventTarget | null, root: HTMLElement, plot: HTMLElement | null | undefined): boolean {
  if (isHoldControlTarget(target)) return false
  const doc = root.ownerDocument
  if (target === null || target === doc || target === doc.body || target === doc.documentElement || target === doc.defaultView) return true
  return target === root || isHoldPlotTarget(target, plot)
}

/** Chrome is a sibling of the plot; observe its presses/focus without consuming either event. */
export function attachHoldFocusBoundary (root: HTMLElement, plot: () => HTMLElement | null | undefined, controller: {
  selection: (id: string | null) => void
  cancel: () => void
}): () => void {
  const doc = root.ownerDocument
  const origin = (e: Event): EventTarget | null => e.composedPath?.()[0] ?? e.target
  const press = (e: Event): void => {
    controller.selection(null)
    if (!isHoldPlotTarget(origin(e), plot())) controller.cancel()
  }
  const focus = (e: Event): void => {
    if (!isHoldKeyTarget(origin(e), root, plot())) controller.cancel()
  }
  doc.addEventListener('pointerdown', press, { capture: true })
  doc.addEventListener('focusin', focus, { capture: true })
  return () => {
    doc.removeEventListener('pointerdown', press, { capture: true })
    doc.removeEventListener('focusin', focus, { capture: true })
  }
}
