import { test, expect, openHarness, pageErrors } from './fixtures'
import type { Page } from '@playwright/test'

// Motion bugs seen in production (2026-09-28): drawings stopped following a
// drag (a canvas layer froze after the price axis changed width mid-gesture),
// the chart shook and left stale frames while moving, and wheel zoom jumped
// back to the newest bar. Every test here asserts chart state or painted
// pixels, never "no error thrown". Helpers: pages/motion-kit.js.

const KIT = '/e2e/pages/motion-kit.js'
const MAGENTA = [255, 0, 255]
const CYAN = [0, 255, 255]

/** Mount a chart on the crossing feed (prices climb through 100,000). */
async function mountCrossing (page: Page, opts: { n?: number, pageSize?: number, probe?: boolean, chart?: Record<string, unknown> } = {}): Promise<void> {
  await page.evaluate(async ({ KIT, opts }) => {
    const K = await import(KIT)
    if (opts.probe === true) K.installLayerProbe()
    const { H } = window as any
    const feed = K.crossingFeed({ n: opts.n ?? 3000, page: opts.pageSize ?? 0 })
    const container = document.createElement('div')
    container.style.cssText = 'width: 1000px; height: 600px'
    document.getElementById('charts')!.appendChild(container)
    const mounted = H.mount({ chart: { container, datafeed: feed.datafeed, mainIndicators: ['MA'], subIndicators: ['VOL'], ...opts.chart } })
    const chart = await H.ready(mounted.pro, 100)
    await H.sleep(120)
    ;(window as any).T = { K, H, pro: mounted.pro, container, chart, feed, layers: opts.probe === true ? K.watchLayers(chart) : null }
  }, { KIT, opts })
}

/** A built-in drawing (magenta) and a host-template drawing (cyan), each a vertical line at a bar. */
async function addMarks (page: Page, barsBack: [number, number] = [40, 70]): Promise<void> {
  await page.evaluate(({ barsBack }) => {
    const { T } = window as any
    const list = T.chart.getDataList()
    T.K.registerHostMark(T.H.KC, 'e2eHostMark', '#00ffff')
    const a = list[list.length - 1 - barsBack[0]]
    const b = list[list.length - 1 - barsBack[1]]
    T.marks = [
      { rgb: [255, 0, 255], timestamp: a.timestamp, id: T.chart.createOverlay({ name: 'verticalStraightLine', lock: true, points: [{ timestamp: a.timestamp, value: a.close }], styles: { line: { color: '#ff00ff', size: 2 } } }) },
      { rgb: [0, 255, 255], timestamp: b.timestamp, id: T.chart.createOverlay({ name: 'e2eHostMark', lock: true, points: [{ timestamp: b.timestamp, value: b.close }] }) }
    ]
  }, { barsBack })
}

/** For each mark: where it was painted on the candle pane's overlay layer vs where the chart says it is now. */
async function markPositions (page: Page): Promise<Array<{ painted: number | null, expected: number }>> {
  return await page.evaluate(() => {
    const { T } = window as any
    const overlay = T.chart.getDom('candle_pane', 'main').querySelectorAll('canvas')[1] as HTMLCanvasElement
    return T.marks.map((m: any) => ({
      painted: T.K.paintedX(overlay, 0.5, m.rgb),
      expected: T.chart.convertToPixel({ timestamp: m.timestamp }, { paneId: 'candle_pane' }).x
    }))
  })
}

test('drawings (built-in and host template) follow a real mouse pan and fling while the price axis changes width; no layer freezes', async ({ page, kc }) => {
  await openHarness(page, kc)
  await mountCrossing(page)
  await addMarks(page)
  const pane = await page.evaluate(() => {
    const r = (window as any).T.chart.getDom('candle_pane', 'main').getBoundingClientRect()
    return { left: r.left, top: r.top, width: r.width, height: r.height }
  })
  const y = pane.top + pane.height * 0.62
  const widths = new Set<number>()
  const failures: string[] = []
  // Back and forth across the 100,000 boundary: a slow pan, then a flick.
  const gestures: Array<[number, number, number]> = [[0.25, 0.8, 30], [0.25, 0.8, 30], [0.8, 0.25, 30], [0.3, 0.75, 4], [0.8, 0.3, 4], [0.75, 0.25, 30]]
  const pos = async (): Promise<number> => await page.evaluate(() => { const { T } = window as any; return T.K.scrollPos(T.chart) })
  for (const [i, [from, to, steps]] of gestures.entries()) {
    const before = await pos()
    await page.mouse.move(pane.left + pane.width * from, y)
    await page.mouse.down()
    await page.mouse.move(pane.left + pane.width * to, y, { steps })
    await page.mouse.up()
    await page.evaluate(async () => { const { T } = window as any; await T.K.settle(T.chart) })
    if (Math.abs((await pos()) - before) < 100) failures.push(`gesture ${i}: the chart did not pan`)
    widths.add(await page.evaluate(() => (window as any).T.chart.getSize('candle_pane', 'main').width))
    // Move both drawings onto bars now on screen: a layer that stopped
    // repainting shows them where they were (or not at all).
    await page.evaluate(async () => {
      const { T } = window as any
      const range = T.chart.getVisibleRange()
      const list = T.chart.getDataList()
      T.marks.forEach((m: any, k: number) => {
        const bar = list[Math.floor(range.from + (range.to - range.from) * (k === 0 ? 0.35 : 0.65))]
        m.timestamp = bar.timestamp
        T.chart.overrideOverlay({ id: m.id, points: [{ timestamp: bar.timestamp, value: bar.close }] })
      })
      await T.K.settle(T.chart)
    })
    for (const [k, m] of (await markPositions(page)).entries()) {
      if (m.painted === null || Math.abs(m.painted - m.expected) > 2) failures.push(`gesture ${i}, mark ${k}: painted at ${String(m.painted)}, chart says ${m.expected.toFixed(1)}`)
    }
    const frozen = await page.evaluate(() => { const { T } = window as any; return T.K.mismatchedCanvases(T.container) })
    if (frozen.length > 0) failures.push(`gesture ${i}: ${frozen.length} canvas(es) stopped following their size: ${JSON.stringify(frozen)}`)
  }
  expect(failures, `candle pane widths seen: ${[...widths].join(', ')}`).toEqual([])
  expect(await pageErrors(page)).toEqual([])
})

test('a queued repaint never swallows a resize: every layer keeps repainting after the chart is resized mid-frame', async ({ page, kc }) => {
  await openHarness(page, kc)
  await mountCrossing(page)
  await addMarks(page)
  const result = await page.evaluate(async () => {
    const { T } = window as any
    const { chart, container, K } = T
    // 1) A repaint is already queued (the drawings changed) when the pane
    //    changes size in the same task.
    chart.overrideOverlay({ id: T.marks[0].id, styles: { line: { color: '#ff00ff', size: 2 } } })
    container.style.width = '963px'
    chart.resize()
    await K.nextFrame(); await K.nextFrame(); await K.nextFrame()
    // 2) The size changes first, and a later ResizeObserver callback in the
    //    same frame asks for a repaint (a host observer calling resize(), or
    //    an overlay update from one).
    const ro = new ResizeObserver(() => { chart.overrideOverlay({ id: T.marks[1].id, lock: true }) })
    ro.observe(container)
    container.style.width = '1000px'
    chart.resize()
    await K.nextFrame(); await K.nextFrame(); await K.nextFrame()
    ro.disconnect()
    // Now move the chart: every layer must repaint where the chart is.
    chart.scrollByDistance(-120)
    await K.settle(chart)
    return { mismatched: K.mismatchedCanvases(container) }
  })
  expect(result.mismatched).toEqual([])
  for (const m of await markPositions(page)) {
    expect(m.painted).not.toBeNull()
    expect(Math.abs((m.painted ?? -99) - m.expected)).toBeLessThanOrEqual(2)
  }
  expect(await pageErrors(page)).toEqual([])
})

test('every painted frame shows candles, drawings and axes from the same scroll state, during a pan, a fling and a zoom', async ({ page, kc }) => {
  await openHarness(page, kc)
  await mountCrossing(page, { probe: true })
  await addMarks(page)
  const result = await page.evaluate(async () => {
    const { T } = window as any
    const { chart, container, K, layers } = T
    const out: Record<string, unknown> = {}
    const run = async (name: string, fn: () => Promise<void>): Promise<void> => {
      const p0 = K.scrollPos(chart)
      const b0 = chart.getBarSpace()
      const t0 = performance.now()
      await fn()
      await K.settle(chart)
      const s = layers.stats(t0, performance.now())
      out[name] = { torn: s.torn, lagged: s.lagged, frames: s.frames, stale: layers.stale().length, example: s.example, moved: Math.abs(K.scrollPos(chart) - p0), zoomed: chart.getBarSpace() / b0 }
    }
    for (let i = 0; i < 3; i++) await run(`pan${i}`, async () => { await K.drag(chart, container, { dx: 380, frames: 24, hold: 12 }) })
    await run('fling', async () => { await K.drag(chart, container, { fromX: 0.7, dx: -300, frames: 5 }) })
    await run('wheel', async () => { await K.wheel(chart, container, { fx: 0.4, count: 4, deltaY: 100, every: 3 }) })
    await run('back', async () => { await K.drag(chart, container, { fromX: 0.2, dx: 500, frames: 30, hold: 12 }) })
    return out
  })
  // The gestures really moved the chart (a test that moves nothing has no torn frames either).
  for (const name of ['pan0', 'pan1', 'pan2', 'fling', 'back']) expect((result[name] as any).moved, name).toBeGreaterThan(150)
  expect((result.wheel as any).zoomed).toBeLessThan(0.75)
  for (const [name, r] of Object.entries(result) as Array<[string, any]>) {
    expect({ name, torn: r.torn, stale: r.stale }, JSON.stringify(r.example)).toEqual({ name, torn: 0, stale: 0 })
  }
  // The fling and the eased zoom step inside the same frame that paints them,
  // so no frame shows a layer one step behind the chart.
  expect((result.fling as any).lagged).toBe(0)
  expect((result.wheel as any).lagged).toBe(0)
  expect(await pageErrors(page)).toEqual([])
})

test('wheel zoom deep in history stays there, anchored on the bar under the cursor (no jump back to the newest bar)', async ({ page, kc }) => {
  await openHarness(page, kc)
  await mountCrossing(page)
  const pane = await page.evaluate(async () => {
    const { T } = window as any
    const n = T.chart.getDataList().length
    T.chart.scrollToDataIndex(n - 900)
    await T.K.settle(T.chart)
    const r = T.chart.getDom('candle_pane', 'main').getBoundingClientRect()
    return { left: r.left, top: r.top, width: r.width, height: r.height, n }
  })
  const cx = pane.left + pane.width * 0.4
  const cy = pane.top + pane.height * 0.5
  const barUnder = async (): Promise<number> => await page.evaluate(x => {
    const { T } = window as any
    return T.chart.convertFromPixel([{ x }], { paneId: 'candle_pane' })[0].timestamp
  }, pane.width * 0.4)
  const initialOffset = await page.evaluate(() => (window as any).T.chart.getChartStore().getTimeScaleStore().getInitialOffsetRightDistance?.() ?? null)
  const barSpaceBefore = await page.evaluate(() => (window as any).T.chart.getBarSpace())
  const anchor = await barUnder()
  await page.mouse.move(cx, cy)
  for (const dy of [-100, -100, -100, 100]) {
    await page.mouse.wheel(0, dy)
    await page.waitForTimeout(60)
  }
  await page.evaluate(async () => { const { T } = window as any; await T.K.settle(T.chart) })
  const after = await page.evaluate(() => {
    const { T } = window as any
    return { range: T.chart.getVisibleRange(), barSpace: T.chart.getBarSpace(), initialOffset: T.chart.getChartStore().getTimeScaleStore().getInitialOffsetRightDistance?.() ?? null }
  })
  expect(after.barSpace / barSpaceBefore).toBeCloseTo(1.21, 2) // net two 10% notches in
  expect(after.range.to).toBeLessThan(pane.n - 500) // still deep in history
  const anchorAfter = await barUnder()
  expect(Math.abs(anchorAfter - anchor)).toBeLessThanOrEqual(3_600_000) // the same bar (within one) stays under the cursor
  expect(after.initialOffset).toBe(initialOffset) // the default right gap ("go to latest") is untouched
  expect(await pageErrors(page)).toEqual([])
})

test('wheel deltas zoom in proportion: a trackpad stream, one burst and a line-mode notch land on the same predictable bar space', async ({ page, kc }) => {
  await openHarness(page, kc)
  await mountCrossing(page)
  const r = await page.evaluate(async () => {
    const { T } = window as any
    const { chart, container, K } = T
    const reset = async (): Promise<number> => { chart.setBarSpace(8); await K.settle(chart); return chart.getBarSpace() }
    const ratio = async (fn: () => Promise<unknown>): Promise<number> => { const b = await reset(); await fn(); await K.settle(chart); return chart.getBarSpace() / b }
    return {
      // 40 pixel-mode events of -4px (a trackpad), one per frame: 160px in total.
      stream: await ratio(async () => { await K.wheel(chart, container, { count: 40, deltaY: -4, every: 1 }) }),
      // The same 160px arriving in one task.
      burst: await ratio(async () => { await K.wheel(chart, container, { count: 40, deltaY: -4, every: 0 }) }),
      // One Firefox-style line-mode notch (3 lines).
      line: await ratio(async () => { await K.wheel(chart, container, { count: 1, deltaY: -3, deltaMode: 1 }) }),
      // One Chrome/Windows mouse notch.
      notch: await ratio(async () => { await K.wheel(chart, container, { count: 1, deltaY: -100 }) })
    }
  })
  const expected160 = Math.pow(1.1, 1.6) // 100px of wheel = one 10% notch
  expect(r.stream).toBeGreaterThan(expected160 - 0.03)
  expect(r.stream).toBeLessThan(expected160 + 0.03)
  expect(Math.abs(r.burst - r.stream)).toBeLessThan(0.02)
  expect(r.line).toBeCloseTo(1.1, 2)
  expect(r.notch).toBeCloseTo(1.1, 2)
  expect(await pageErrors(page)).toEqual([])
})

test('no fling after a drag a drawing consumed, or after holding still before release', async ({ page, kc }) => {
  await openHarness(page, kc)
  await mountCrossing(page)
  const pane = await page.evaluate(async () => {
    const { T } = window as any
    const r = T.chart.getDom('candle_pane', 'main').getBoundingClientRect()
    // A horizontal line through the middle of the pane: pressing on it grabs the drawing, not the chart.
    const mid = T.chart.convertFromPixel([{ x: r.width / 2, y: r.height / 2 }], { paneId: 'candle_pane' })[0]
    T.chart.createOverlay({ name: 'horizontalStraightLine', lock: true, points: [{ timestamp: mid.timestamp, value: mid.value }] })
    await T.K.settle(T.chart)
    return { left: r.left, top: r.top, width: r.width, height: r.height, lineY: T.chart.convertToPixel({ value: mid.value }, { paneId: 'candle_pane' }).y }
  })
  const pos = async (): Promise<number> => await page.evaluate(() => { const { T } = window as any; return T.K.scrollPos(T.chart) })
  // 1) Fast drag that starts on the drawing: the chart never moved, so nothing may fling.
  const before1 = await pos()
  await page.mouse.move(pane.left + pane.width * 0.7, pane.top + pane.lineY)
  await page.mouse.down()
  await page.mouse.move(pane.left + pane.width * 0.3, pane.top + pane.lineY, { steps: 4 })
  await page.mouse.up()
  await page.waitForTimeout(400)
  expect(await pos()).toBeCloseTo(before1, 3)
  // 2) Fast drag on empty chart, then hold still for 120ms before releasing.
  const y = pane.top + pane.height * 0.2
  await page.mouse.move(pane.left + pane.width * 0.3, y)
  await page.mouse.down()
  await page.mouse.move(pane.left + pane.width * 0.7, y, { steps: 4 })
  await page.waitForTimeout(120)
  const held = await pos()
  await page.mouse.up()
  await page.waitForTimeout(400)
  expect(await pos()).toBeCloseTo(held, 3)
  expect(await pageErrors(page)).toEqual([])
})

test('scroll-back paging never fades the chart out (a new symbol still fades in once); the price axis never shrinks while panning back and forth', async ({ page, kc }) => {
  await openHarness(page, kc)
  await mountCrossing(page, { n: 4000, pageSize: 500 })
  const r = await page.evaluate(async () => {
    const { T } = window as any
    const { chart, container, K, feed } = T
    const widget = container.querySelector('.klinecharts-pro-widget') as HTMLElement
    const fades: string[] = []
    // triggerFadeIn writes opacity 0 then 1 in the same task, so the observer
    // only ever sees the final value: count the records whose OLD value was 0.
    const mo = new MutationObserver(records => {
      for (const rec of records) if (/opacity:\s*0(;|$)/.test(rec.oldValue ?? '')) fades.push(rec.oldValue ?? '')
    })
    mo.observe(widget, { attributes: true, attributeFilter: ['style'], attributeOldValue: true })
    const widths: number[] = []
    let sampling = true
    ;(function sample () { if (!sampling) return; widths.push(chart.getSize('candle_pane', 'main').width); requestAnimationFrame(sample) })()
    const pagesBefore = feed.calls.length
    for (let i = 0; i < 5; i++) { await K.drag(chart, container, { fromX: 0.1, dx: 800, frames: 20, hold: 10 }); await K.settle(chart) }
    for (let i = 0; i < 5; i++) { await K.drag(chart, container, { fromX: 0.9, dx: -800, frames: 20, hold: 10 }); await K.settle(chart) }
    sampling = false
    const fadesWhilePanning = fades.length
    // A new series still fades in (the intended SC-NEXT #1 behaviour).
    await T.pro.setSymbol({ ticker: 'OTHER-USDT', pricePrecision: 2, volumePrecision: 0 })
    await K.settle(chart)
    mo.disconnect()
    let shrinks = 0
    for (let i = 1; i < widths.length; i++) if (widths[i] > widths[i - 1]) shrinks++ // the main area grows when the axis shrinks
    return { pages: feed.calls.length - pagesBefore, fades: fadesWhilePanning, fadesOnNewSymbol: fades.length - fadesWhilePanning, shrinks, distinct: [...new Set(widths)] }
  })
  expect(r.pages).toBeGreaterThan(0) // the pan really paged in history
  expect(r.fades).toBe(0)
  expect(r.fadesOnNewSymbol).toBe(1)
  expect(r.shrinks, `candle pane widths seen: ${JSON.stringify(r.distinct)}`).toBe(0)
  expect(await pageErrors(page)).toEqual([])
})

test('High/Low tags sit on the live price axis in the very next frame after a pan (they no longer ease behind it)', async ({ page, kc }) => {
  await openHarness(page, kc)
  await mountCrossing(page)
  const r = await page.evaluate(async () => {
    const { T } = window as any
    const { chart, K } = T
    const tagY = (): { drawn: number | null, axis: number } => {
      const ov = chart.getChartStore().getOverlayStore().getInstances().find((o: any) => o.name === 'scHighLowTags')
      const d = ov?.extendData ?? {}
      const range = chart.getVisibleRange()
      const list = chart.getDataList().slice(Math.max(0, range.from), range.to)
      const high = Math.max(...list.map((b: any) => b.high))
      const axis = chart.convertToPixel({ value: high }, { paneId: 'candle_pane' }).y
      // Where the tag template paints: from the price (new shape) or the stored pixel (old shape).
      const drawn = typeof d.high === 'number' ? chart.convertToPixel({ value: d.high }, { paneId: 'candle_pane' }).y : (typeof d.highY === 'number' ? d.highY : null)
      return { drawn, axis }
    }
    const out = []
    for (const dist of [-400, 300, -250]) {
      chart.scrollByDistance(dist)
      await K.nextFrame()
      await K.nextFrame()
      out.push(tagY())
    }
    return out
  })
  for (const t of r) {
    expect(t.drawn).not.toBeNull()
    expect(Math.abs((t.drawn ?? -999) - t.axis)).toBeLessThanOrEqual(0.5)
  }
  expect(await pageErrors(page)).toEqual([])
})
