import type { HoldStatus } from './controller'
import './guide.less'

const examples = [
  ['Trend line', 'M8 35L54 11', 'Straight stroke'], ['Ray', 'M8 35L54 11', 'Into price axis'],
  ['Horizontal', 'M6 24H58', 'Flat near wick'], ['Vertical', 'M32 5V43', 'Upright stroke'],
  ['Rectangle', 'M10 10H54V38H10Z', 'Four sides'], ['Ellipse', 'M55 24C55 7 9 7 9 24C9 41 55 41 55 24', 'Round loop'],
  ['Fibonacci', 'M10 10V38H54V10', 'Three sides'], ['Path', 'M6 33L18 19L30 29L44 10L58 18', 'Sharp turns'],
  ['Arrow', 'M8 35L54 11L40 11', 'Short hook']
]
let sequence = 0

/** Instance-local, opt-in help. No automatic dialog or persistent storage. */
export function attachHoldGuide (root: HTMLElement, onOpen: () => void): {
  update: (status: HoldStatus) => void
  key: (e: KeyboardEvent) => boolean
  open: () => boolean
  dispose: () => void
} {
  const doc = root.ownerDocument
  const controls = doc.createElement('div')
  controls.className = 'sc-draw-hold-controls'
  const button = doc.createElement('button')
  button.type = 'button'
  button.className = 'sc-draw-hold-help'
  button.textContent = '?'
  button.setAttribute('aria-label', 'Draw by holding — help')
  button.title = 'Draw by holding'
  const panel = doc.createElement('section')
  panel.id = `sc-draw-hold-guide-${++sequence}`
  panel.className = 'sc-draw-hold-guide'
  panel.hidden = true
  panel.setAttribute('role', 'region')
  panel.setAttribute('aria-label', 'Draw by holding guide')
  button.setAttribute('aria-controls', panel.id)
  button.setAttribute('aria-expanded', 'false')
  const heading = doc.createElement('h3')
  heading.textContent = 'Draw by holding'
  const close = doc.createElement('button')
  close.type = 'button'
  close.className = 'sc-draw-hold-close'
  close.textContent = '×'
  close.setAttribute('aria-label', 'Close drawing guide')
  const intro = doc.createElement('p')
  intro.textContent = 'Hold for about ⅓ second, then draw one stroke. Drag immediately to pan.'
  const shortcuts = doc.createElement('p')
  shortcuts.textContent = 'End a line at the right price axis for a ray. A horizontal line near a candle wick snaps to its high or low. Draw three sides of a box for Fibonacci, or add a short hook for an arrow.'
  const grid = doc.createElement('div')
  grid.className = 'sc-draw-hold-examples'
  for (const [label, d, hint] of examples) {
    const cell = doc.createElement('div')
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', '0 0 64 48')
    svg.setAttribute('aria-hidden', 'true')
    const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', d)
    path.setAttribute('fill', 'none')
    path.setAttribute('stroke', 'currentColor')
    path.setAttribute('stroke-width', '2')
    path.setAttribute('stroke-linecap', 'round')
    path.setAttribute('stroke-linejoin', 'round')
    svg.append(path)
    const caption = doc.createElement('span')
    caption.textContent = label
    const description = doc.createElement('small')
    description.textContent = hint
    cell.append(svg, caption, description)
    grid.append(cell)
  }
  const tip = doc.createElement('p')
  tip.textContent = 'Tab changes the latest interpretation; Shift+Tab goes back. Escape removes the latest result. Scribble across unlocked drawings to erase them. Undo restores a drawing or an erased batch.'
  const status = doc.createElement('span')
  status.className = 'sc-draw-hold-status'
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')
  const setOpen = (open: boolean, focus = true): void => {
    panel.hidden = !open
    button.setAttribute('aria-expanded', String(open))
    if (open) { onOpen(); if (focus) close.focus({ preventScroll: true }) } else if (focus) button.focus({ preventScroll: true })
  }
  button.addEventListener('click', () => { setOpen(panel.hidden) })
  close.addEventListener('click', () => { setOpen(false) })
  const gotIt = doc.createElement('button')
  gotIt.type = 'button'
  gotIt.className = 'sc-draw-hold-got-it'
  gotIt.textContent = 'Got it'
  gotIt.addEventListener('click', () => { setOpen(false) })
  panel.append(heading, close, intro, grid, shortcuts, tip, gotIt)
  controls.append(status, button, panel)
  root.append(controls)
  return {
    update (s) {
      status.textContent = s.mode === 'drawing' ? s.label : s.mode === 'result' ? `${s.label}${s.alternatives ? ' · Tab alternate · Esc remove' : ''}` : ''
      controls.dataset.state = s.mode
    },
    key (e) {
      if (panel.hidden || (e.key !== 'Escape' && e.key !== 'Esc')) return false
      e.preventDefault()
      setOpen(false)
      return true
    },
    open: () => !panel.hidden,
    dispose () { controls.remove() }
  }
}
