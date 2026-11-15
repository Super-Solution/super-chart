/** Small stroke icons for the compact and narrow chrome. Inline SVG, `currentColor`, no network and no font. */
const PATHS: Readonly<Record<string, string>> = {
  undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'm15 14 5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3',
  unlock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 7.5-2',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  back: 'm14 6-6 6 6 6',
  forward: 'm10 6 6 6-6 6',
  latest: 'M5 6l6 6-6 6M13 6l6 6-6 6',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15.5 9.5h.01',
  fullscreen: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  exitFullscreen: 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  tools: 'M4 20 15 9M13 5l6 6M16 2l6 6-4 4-6-6z',
  objects: 'M12 3 3 8l9 5 9-5zM3 13l9 5 9-5M3 17l9 5 9-5',
  indicators: 'M3 17l5-6 4 3 6-8 3 3M3 21h18',
  chart: 'M4 20V10M10 20V4M16 20v-8M22 20H2',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5',
  command: 'M8 8h8v8H8zM8 8V6a2 2 0 1 0-2 2h2zM16 8V6a2 2 0 1 1 2 2h-2zM8 16v2a2 2 0 1 1-2-2h2zM16 16v2a2 2 0 1 0 2-2h-2z'
}

export type IconName = keyof typeof PATHS

/** One icon as a detached SVG element, hidden from assistive technology (the button carries the label). */
export function createIcon (doc: Document, name: IconName): SVGSVGElement {
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '16'); svg.setAttribute('height', '16')
  svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false'); svg.classList.add('sc-icon')
  const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', PATHS[name] ?? PATHS.more)
  svg.append(path)
  return svg
}
