/** Small stroke icons for the compact and narrow chrome. Inline SVG, `currentColor`, no network and no font. */
/** A small anchor ring, centred at x, y. */
const dot = (x: number, y: number): string => `M${x - 1.8} ${y}a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0-3.6 0`
const zigzag = (...p: number[]): string => `M${p[0]} ${p[1]}` + p.slice(2).reduce<string>((out, v, i) => out + (i % 2 === 0 ? ` L${v}` : ` ${v}`), '')

const TOOL_ICONS: Readonly<Record<string, string>> = {
  'tool:trend-line': `M6 18 18 6${dot(5, 19)}${dot(19, 5)}`,
  'tool:segment': `M6 18 18 6${dot(5, 19)}${dot(19, 5)}`,
  'tool:ray': `M6 18 20 4M16.5 4H20v3.5${dot(5, 19)}`,
  'tool:arrow': 'M5 19 18 6M10 6h8v8',
  'tool:horizontal': `M3 12h6.2M14.8 12H21${dot(12, 12)}`,
  'tool:horizontal-ray': `M7.8 12H21${dot(6, 12)}`,
  'tool:horizontal-segment': `M7.8 12h8.4${dot(6, 12)}${dot(18, 12)}`,
  'tool:vertical': `M12 3v6.2M12 14.8V21${dot(12, 12)}`,
  'tool:vertical-ray': `M12 7.8V21${dot(12, 6)}`,
  'tool:vertical-segment': `M12 7.8v8.4${dot(12, 6)}${dot(12, 18)}`,
  'tool:price-line': 'M3 12h12M15 8h6v8h-6z',
  'tool:price-label': 'M4 7h11l5 5-5 5H4z',
  'tool:rectangle': 'M5 6h14v12H5z',
  'tool:rotated-rectangle': 'M5 11l8-6 6 8-8 6z',
  'tool:ellipse': 'M12 6c4.4 0 8 2.7 8 6s-3.6 6-8 6-8-2.7-8-6 3.6-6 8-6z',
  'tool:circle': 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z',
  'tool:triangle': 'M12 5l8 14H4z',
  'tool:parallelogram': 'M8 6h12l-4 12H4z',
  'tool:arc': 'M4 18a8 8 0 0 1 16 0',
  'tool:curve': 'M4 18C8 4 15 4 20 14',
  'tool:double-curve': 'M3 12c3-8 6-8 9 0s6 8 9 0',
  'tool:parallel-channel': 'M4 13 16 5M8 20 20 12',
  'tool:disjoint-channel': 'M4 12 16 6M8 20 20 10',
  'tool:price-channel': 'M4 8h16M4 16h16',
  'tool:regression-trend': 'M4 18 20 6M4 13 14 6M10 21 20 14',
  'tool:pitchfork': 'M3 21 12 12M7 7l13 13M12 3l9 9M3 12l9 9',
  'tool:schiff-pitchfork': 'M3 21 12 12M7 7l13 13M12 3l9 9M3 12l9 9',
  'tool:modified-schiff-pitchfork': 'M3 21 12 12M7 7l13 13M12 3l9 9M3 12l9 9',
  'tool:fibonacci': `M3 5h18M3 10h18M3 15h18M3 20h18M6 20 18 5`,
  'tool:fibonacci-extension': 'M3 5h18M3 11h18M3 17h18M5 20l5-10 4 6',
  'tool:fibonacci-line': 'M3 5h18M3 10h18M3 15h18M3 20h18',
  'tool:fibonacci-circle': 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  'tool:fibonacci-spiral': 'M12 12a2 2 0 0 1 2-2 4 4 0 0 1 4 4 6 6 0 0 1-6 6 8 8 0 0 1-8-8 10 10 0 0 1 10-10',
  'tool:fibonacci-fan': 'M4 20 20 4M4 20 20 10M4 20 20 15',
  'tool:fibonacci-time-zone': 'M5 4v16M9 4v16M14 4v16M21 4v16',
  'tool:fibonacci-arcs': 'M4 20A16 16 0 0 1 20 4M4 20a10 10 0 0 1 10-10M4 20a5 5 0 0 1 5-5',
  'tool:gann-box': 'M4 4h16v16H4zM4 4l16 16M20 4 4 20M12 4v16M4 12h16',
  'tool:gann-fan': 'M4 20 20 4M4 20 20 9M4 20 20 14M4 20 14 4',
  'tool:gann-square': 'M4 4h16v16H4zM4 12h16M12 4v16M4 4l16 16',
  'tool:xabcd': zigzag(3, 17, 8, 6, 13, 14, 17, 3, 21, 17),
  'tool:abcd': zigzag(4, 18, 9, 6, 15, 16, 20, 5),
  'tool:three-waves': zigzag(3, 17, 8, 8, 13, 14, 19, 5),
  'tool:five-waves': zigzag(2, 19, 6, 11, 9, 15, 14, 5, 17, 10, 22, 4),
  'tool:eight-waves': zigzag(2, 19, 5, 12, 8, 16, 11, 8, 14, 13, 17, 6, 20, 10, 22, 4),
  'tool:any-waves': zigzag(3, 18, 7, 9, 11, 15, 16, 6, 21, 12),
  'tool:price-range': 'M12 4v16M8 8l4-4 4 4M8 16l4 4 4-4',
  'tool:time-range': 'M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4',
  'tool:price-time-range': 'M5 19V5h14M5 5l14 14M5 19h14',
  'tool:position-long': 'M4 4h16v8H4zM4 12h16v8H4zM8 8h8',
  'tool:position-short': 'M4 4h16v8H4zM4 12h16v8H4zM8 16h8',
  'tool:forecast': 'M4 18l6-6 4 3 6-9M16.5 6H20v3.5',
  'tool:text': 'M5 7V5h14v2M12 5v14M9 19h6',
  'tool:note': 'M6 4h8l4 4v12H6zM14 4v4h4M9 13h6M9 16h4',
  'tool:callout': 'M4 5h16v10h-8l-4 4v-4H4z',
  'tool:signpost': 'M12 3v18M6 5h10l3 3-3 3H6zM18 13H8l-3 3 3 3h10z',
  'tool:pin': 'M12 21s6-5.5 6-11a6 6 0 0 0-12 0c0 5.5 6 11 6 11zM12 7.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
  'tool:flag': 'M6 21V4M6 5h11l-2 4 2 4H6',
  'tool:image': 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15.5 9.5h.01',
  'tool:arrow-up': 'M12 20V5M6 11l6-6 6 6',
  'tool:arrow-down': 'M12 4v15M6 13l6 6 6-6',
  'tool:anchored-vwap': 'M5 4v16M5 15c4 0 5-7 9-7 3 0 4 3 6 3',
  'tool:fixed-range-volume-profile': 'M4 4v16M4 6h9M4 10h14M4 14h7M4 18h11',
  'tool:anchored-volume-profile': 'M4 4v16M4 6h9M4 10h14M4 14h7M4 18h11',
  'tool:brush': 'M15 4l5 5L9 20H4v-5zM13 6l5 5',
  'tool:highlighter': 'M13 3l8 8-7 7-8-8zM9 15l-5 5h5M5 21h15'
}
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
  pen: 'M4 20l1-4L16 5l3 3L8 19zM14 7l3 3',
  fill: 'M5 11 11 5l7 7-6 6zM4 20h6M19 14s2 2.4 2 3.8a2 2 0 0 1-4 0c0-1.4 2-3.8 2-3.8z',
  text: 'M5 7V4h14v3M12 4v16M9 20h6',
  copy: 'M9 9h10v11H9zM5 15V4h10',
  eyeOff: 'M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6zM4 4l16 16',
  grip: 'M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01',
  tools: 'M4 20 15 9M13 5l6 6M16 2l6 6-4 4-6-6z',
  objects: 'M12 3 3 8l9 5 9-5zM3 13l9 5 9-5M3 17l9 5 9-5',
  indicators: 'M3 17l5-6 4 3 6-8 3 3M3 21h18',
  chart: 'M4 20V10M10 20V4M16 20v-8M22 20H2',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5',
  command: 'M8 8h8v8H8zM8 8V6a2 2 0 1 0-2 2h2zM16 8V6a2 2 0 1 1 2 2h-2zM8 16v2a2 2 0 1 1-2-2h2zM16 16v2a2 2 0 1 0 2-2h-2z',
  camera: 'M4 8h4l2-3h4l2 3h4v11H4zM12 10.5a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  chevron: 'm9 6 6 6-6 6',
  chevronDown: 'm6 9 6 6 6-6',
  settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 4v6M9 14v6',
  magnet: 'M5 4h4v8a3 3 0 0 0 6 0V4h4v8a7 7 0 0 1-14 0zM5 8h4M15 8h4',
  keep: 'M4 12a8 8 0 0 1 14-5.3M20 4v4h-4M20 12a8 8 0 0 1-14 5.3M4 20v-4h4',
  eraser: 'M7 20h12M5 14l8-8 6 6-6 6H9zM8.5 10.5l6 6',
  cursor: 'M6 3.5 18.5 11l-5.7 1.6L10.5 19z',
  // Drawing tools. A dot marks an anchor the person places; the stroke is what the tool draws.
  ...TOOL_ICONS,
  'group.lines': TOOL_ICONS['tool:trend-line'],
  'group.shapes': TOOL_ICONS['tool:rectangle'],
  'group.channels': TOOL_ICONS['tool:parallel-channel'],
  'group.fibonacci': TOOL_ICONS['tool:fibonacci'],
  'group.patterns': TOOL_ICONS['tool:xabcd'],
  'group.measurement': TOOL_ICONS['tool:price-range'],
  'group.annotations': TOOL_ICONS['tool:text'],
  'group.studies': TOOL_ICONS['tool:anchored-vwap'],
  'group.freehand': TOOL_ICONS['tool:brush']
}

export type IconName = string

/** The icon name for a drawing tool; tools without their own glyph share their group's. */
export function toolIconName (type: string, group: string): IconName { return `tool:${type}` in PATHS ? `tool:${type}` : group }

/** One icon as a detached SVG element, hidden from assistive technology (the button carries the label). */
export function createIcon (doc: Document, name: IconName): SVGSVGElement {
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '16'); svg.setAttribute('height', '16')
  svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.75')
  svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false'); svg.classList.add('sc-icon')
  const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', PATHS[name] ?? PATHS.more)
  svg.append(path)
  return svg
}
