// Helpers for tests/motion-layers.spec.ts: a datafeed whose prices climb
// through 100,000 (so the price axis' label width changes while panning, the
// trigger for a frozen canvas layer), a per-frame layer probe (which scroll
// state each canvas was last painted from), rAF-paced synthetic drags and
// wheels, and a pixel scan that finds where a uniquely coloured drawing was
// actually painted.

export const HOUR = 3_600_000
const END = Math.floor(1_790_000_000_000 / HOUR) * HOUR

/**
 * `n` hourly bars that climb from ~60,000 through 100,000 over the newest
 * ~700 bars (seeded, deterministic). Volumes vary by three orders of
 * magnitude so the volume axis' labels change width too. `page` > 0 answers
 * history in pages of that many bars (after `delayMs`), like a real feed.
 */
export function crossingFeed ({ n = 3000, page = 0, delayMs = 20 } = {}) {
  let seed = 7
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646 }
  const all = []
  let p = 60_000
  for (let i = 0; i < n; i++) {
    const drift = i > n - 700 ? 0.0012 : 0.00002
    const o = p
    p = Math.max(1000, p * (1 + drift + (rnd() - 0.5) * 0.012))
    const hi = Math.max(o, p) * (1 + rnd() * 0.004)
    const lo = Math.min(o, p) * (1 - rnd() * 0.004)
    all.push({ timestamp: END - (n - 1 - i) * HOUR, open: o, high: hi, low: lo, close: p, volume: Math.round(Math.exp(4 + rnd() * 7)) })
  }
  const calls = []
  const datafeed = {
    async searchSymbols () { return [] },
    async getHistoryKLineData (_symbol, _period, from, to) {
      calls.push({ from, to })
      const upto = all.filter(b => b.timestamp < to)
      if (page > 0) await new Promise(resolve => setTimeout(resolve, delayMs))
      return (page > 0 ? upto.slice(Math.max(0, upto.length - page)) : upto).map(b => ({ ...b }))
    },
    subscribe () {},
    unsubscribe () {}
  }
  return { datafeed, calls, all }
}

export const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => resolve()))
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/** The chart's scroll position in px (moves 1:1 with a pan). */
export function scrollPos (chart) {
  const tss = chart.getChartStore().getTimeScaleStore()
  return tss.getLastBarRightSideDiffBarCount() * tss.getBarSpace().bar
}

/** Resolves once the scroll position and bar space have been still for `frames` frames (or after `maxMs`). */
export async function settle (chart, { frames = 4, maxMs = 3000 } = {}) {
  const t0 = performance.now()
  let last = `${scrollPos(chart)}|${chart.getBarSpace()}`
  let still = 0
  while (performance.now() - t0 < maxMs) {
    await nextFrame()
    const now = `${scrollPos(chart)}|${chart.getBarSpace()}`
    still = now === last ? still + 1 : 0
    last = now
    if (still >= frames) break
  }
  await nextFrame()
  await nextFrame()
}

// ---- layer probe -------------------------------------------------------------
// Installed BEFORE the chart mounts: every rAF callback records the frame's
// timestamp, and every canvas clear (klinecharts clears a canvas at the start
// of each repaint) records which scroll state that canvas is being painted
// from. `stats(t0, t1)` then replays the frames: a frame is TORN when two
// layers that share the time axis were showing different scroll states when
// it was painted (the candles and the drawings no longer line up), LAGGED
// when a layer showed an older state than the chart was in at the end of that
// frame's animation callbacks.

export function installLayerProbe () {
  if (window.__layerProbe !== undefined) return window.__layerProbe
  const origRaf = window.requestAnimationFrame.bind(window)
  const probe = { canvases: new Map(), draws: [], truth: new Map(), frameTs: 0, getTruth: null }
  window.requestAnimationFrame = cb => origRaf(ts => {
    probe.frameTs = ts
    try { cb(ts) } finally { if (probe.getTruth !== null) probe.truth.set(ts, probe.getTruth()) }
  })
  const origClear = CanvasRenderingContext2D.prototype.clearRect
  CanvasRenderingContext2D.prototype.clearRect = function (...args) {
    const info = probe.canvases.get(this.canvas)
    if (info !== undefined) probe.draws.push({ ts: probe.frameTs, id: info.id, s: info.state() })
    return origClear.apply(this, args)
  }
  window.__layerProbe = probe
  return probe
}

/** Maps every canvas layer of `chart` (after mount) to the state it depends on. */
export function watchLayers (chart) {
  const probe = window.__layerProbe
  const tss = chart.getChartStore().getTimeScaleStore()
  const x = () => `${tss.getLastBarRightSideDiffBarCount().toFixed(3)}|${tss.getBarSpace().bar.toFixed(4)}|${chart.getDataList().length}`
  const y = id => {
    const axis = chart.getDrawPaneById(id)?.getAxisComponent()
    const r = typeof axis?.getRange === 'function' ? axis.getRange() : (typeof axis?.getExtremum === 'function' ? { from: axis.getExtremum().min, to: axis.getExtremum().max } : null)
    return r === null ? '-' : `${Number(r.from).toFixed(4)}|${Number(r.to).toFixed(4)}`
  }
  probe.canvases.clear()
  const panes = chart.getAllDrawPanes().map(p => p.getId()).filter(id => id !== 'x_axis_pane')
  for (const id of panes) {
    const cs = chart.getDom(id, 'main')?.querySelectorAll('canvas') ?? []
    if (cs[0] !== undefined) probe.canvases.set(cs[0], { id: `${id}:main`, x: true, state: () => `${x()}#${y(id)}` })
    if (cs[1] !== undefined) probe.canvases.set(cs[1], { id: `${id}:overlay`, x: true, state: () => `${x()}#${y(id)}` })
  }
  const xs = chart.getDom('x_axis_pane', 'main')?.querySelectorAll('canvas') ?? []
  if (xs[0] !== undefined) probe.canvases.set(xs[0], { id: 'x_axis:main', x: true, state: () => x() })
  probe.getTruth = () => {
    const out = {}
    for (const info of probe.canvases.values()) out[info.id] = info.state()
    return out
  }
  return {
    ids: () => [...probe.canvases.values()].map(i => i.id),
    stats (t0, t1) {
      const frames = [...probe.truth.keys()].filter(t => t >= t0 && t <= t1).sort((a, b) => a - b)
      const shown = new Map()
      for (const d of probe.draws) if (d.ts < t0) shown.set(d.id, d.s)
      const byFrame = new Map()
      for (const d of probe.draws) { if (!byFrame.has(d.ts)) byFrame.set(d.ts, []); byFrame.get(d.ts).push(d) }
      let torn = 0
      let lagged = 0
      const example = []
      for (const f of frames) {
        for (const d of byFrame.get(f) ?? []) shown.set(d.id, d.s)
        const xStates = new Set()
        for (const info of probe.canvases.values()) {
          const s = shown.get(info.id)
          if (s !== undefined) xStates.add(s.split('#')[0])
        }
        let paneTear = false
        for (const id of panes) {
          const a = shown.get(`${id}:main`)
          const b = shown.get(`${id}:overlay`)
          if (a !== undefined && b !== undefined && a !== b) paneTear = true
        }
        if (xStates.size > 1 || paneTear) {
          torn++
          if (example.length === 0) example.push(Object.fromEntries(shown))
        }
        const truth = probe.truth.get(f)
        for (const info of probe.canvases.values()) {
          if (truth?.[info.id] !== undefined && shown.get(info.id) !== truth[info.id]) { lagged++; break }
        }
      }
      return { frames: frames.length, torn, lagged, example: example[0] }
    },
    /** Layers whose last paint is not the chart's current state. */
    stale () {
      const shown = new Map()
      for (const d of probe.draws) shown.set(d.id, d.s)
      const truth = probe.getTruth()
      return Object.keys(truth).filter(id => shown.get(id) !== truth[id]).map(id => ({ id, shown: shown.get(id), truth: truth[id] }))
    }
  }
}

// ---- synthetic input, one event per frame like a 60 Hz mouse ---------------

function fire (root, type, x, y, extra = {}) {
  const init = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, buttons: type.endsWith('up') ? 0 : 1, view: window, ...extra }
  const ev = type.startsWith('pointer') ? new PointerEvent(type, { pointerId: 1, pointerType: 'mouse', isPrimary: true, ...init }) : new MouseEvent(type, init)
  // Whatever is under the pointer, as a real mouse would hit (a pane's canvas).
  const target = document.elementFromPoint(x, y) ?? root
  target.dispatchEvent(ev)
}

/**
 * klinecharts ignores a mouse event that has no `sourceCapabilities` (every
 * synthetic one) within 500 ms of its last touch event — and that timestamp
 * starts at 0, so for the first 500 ms of a page every synthetic mouse event
 * is taken for a touch-compat one and dropped. Real input is unaffected.
 */
export async function pastTouchCompatWindow () {
  while (performance.now() < 700) await sleep(50)
}

/** Drag the candle pane by `dx` px over `frames` frames, then hold still `hold` frames and release. */
export async function drag (chart, container, { fromX = 0.3, dx, frames = 20, hold = 0, y = 0.5 }) {
  await pastTouchCompatWindow()
  const root = container.querySelector('.klinecharts-pro-widget > div')
  const r = chart.getDom('candle_pane', 'main').getBoundingClientRect()
  const x0 = r.left + r.width * fromX
  const yy = r.top + r.height * y
  root.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, clientX: x0, clientY: yy }))
  fire(root, 'mousemove', x0, yy, { buttons: 0 })
  await nextFrame()
  fire(root, 'pointerdown', x0, yy)
  fire(root, 'mousedown', x0, yy)
  let x = x0
  for (let i = 1; i <= frames; i++) {
    await nextFrame()
    x = x0 + dx * (i / frames)
    fire(root, 'pointermove', x, yy)
    fire(root, 'mousemove', x, yy)
  }
  for (let i = 0; i < hold; i++) {
    await nextFrame()
    fire(root, 'pointermove', x, yy)
    fire(root, 'mousemove', x, yy)
  }
  fire(root, 'pointerup', x, yy)
  fire(root, 'mouseup', x, yy)
}

/** `count` wheel events at `fx` (fraction of the candle pane's width), one every `every` frames (0 = all in one task). */
export async function wheel (chart, container, { fx = 0.5, count = 1, deltaY, deltaMode = 0, ctrlKey = false, every = 1 }) {
  const root = container.querySelector('.klinecharts-pro-widget > div')
  const r = chart.getDom('candle_pane', 'main').getBoundingClientRect()
  const x = r.left + r.width * fx
  const y = r.top + r.height * 0.5
  root.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, clientX: x, clientY: y }))
  fire(root, 'mousemove', x, y, { buttons: 0 })
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < every; k++) await nextFrame()
    const target = document.elementFromPoint(x, y) ?? root
    target.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, deltaX: 0, deltaY, deltaMode, ctrlKey, view: window }))
  }
  return { x, xInPane: x - r.left }
}

// ---- where a drawing was actually painted ------------------------------------

/** A vertical line drawn by a host-registered template (not a klinecharts built-in), in `color`. */
export function registerHostMark (KC, name, color) {
  KC.registerOverlay({
    name,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: ({ coordinates, bounding }) => {
      const p = coordinates[0]
      if (p === undefined) return []
      return [{ type: 'line', attrs: { coordinates: [{ x: p.x, y: 0 }, { x: p.x, y: bounding.height }] }, styles: { color, size: 2 }, ignoreEvent: true }]
    }
  })
}

/**
 * The x (CSS px, pane-relative) of the painted pixels on one row of `canvas`
 * that match `rgb` (within `tol` per channel), or null if none.
 */
export function paintedX (canvas, rowFraction, rgb, tol = 40) {
  const dpr = canvas.width / Math.max(1, canvas.clientWidth)
  const row = Math.floor(canvas.height * rowFraction)
  const { data } = canvas.getContext('2d').getImageData(0, row, canvas.width, 1)
  let sum = 0
  let n = 0
  for (let i = 0; i < canvas.width; i++) {
    const r = data[i * 4]
    const g = data[i * 4 + 1]
    const b = data[i * 4 + 2]
    const a = data[i * 4 + 3]
    if (a > 100 && Math.abs(r - rgb[0]) <= tol && Math.abs(g - rgb[1]) <= tol && Math.abs(b - rgb[2]) <= tol) { sum += i; n++ }
  }
  return n === 0 ? null : (sum / n + 0.5) / dpr
}

/** Canvases whose backing store no longer matches their CSS size (a layer that stopped repainting after a resize). */
export function mismatchedCanvases (container) {
  const out = []
  for (const c of container.querySelectorAll('canvas')) {
    if (c.clientWidth === 0 || c.clientHeight === 0) continue
    const expected = Math.round(c.clientWidth * devicePixelRatio)
    if (Math.abs(c.width - expected) > 1) out.push({ css: c.clientWidth, backing: c.width })
  }
  return out
}
