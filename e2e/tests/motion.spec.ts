import { test, expect, openHarness, pageErrors } from './fixtures'
import type { Page } from '@playwright/test'

// SC-NEXT: motion (eased cursor-anchored wheel zoom, inertial pan, fade-in),
// the eight chart types with no native klinecharts CandleType (drawn by
// src/charttypes/customSeriesOverlay.ts), the grouped/favourited chart-type
// menu, visible-range High/Low price-axis tags and the UTC/local clock
// toggle. State assertions only (bar space, visible range, overlay presence/
// text, localStorage), never pixels.

/** Mount into a fresh host with this CSS text; returns its id. */
async function mountIn (page: Page, css: string, chart: Record<string, unknown> = {}, id = `h${Math.random().toString(36).slice(2, 8)}`): Promise<string> {
  await page.evaluate(async ({ css, chart, id }) => {
    const { H } = window as any
    const host = document.createElement('div')
    host.id = id
    host.style.cssText = css
    document.getElementById('charts')!.appendChild(host)
    ;(window as any)[id] = H.mount({ chart: { container: host, ...chart } })
    await H.ready((window as any)[id].pro)
    await H.sleep(60)
  }, { css, chart, id })
  return id
}

test('wheel zoom eases over several frames to the same target as before, anchored under the cursor', async ({ page, kc }) => {
  await openHarness(page, kc)
  const id = await mountIn(page, 'width: 900px; height: 520px')
  const host = page.locator(`#${id}`)
  const main = await host.locator('.klinecharts-pro-widget canvas').first().boundingBox()
  const cx = main!.x + main!.width / 2
  const cy = main!.y + main!.height / 2
  const before = await page.evaluate(id => (window as any)[id].pro.getChart().getBarSpace(), id)
  await page.mouse.move(cx, cy)
  const samples: number[] = []
  await page.mouse.wheel(0, -300) // zoom in (deltaY < 0)
  // Sample a few times while the ~220ms tween is in flight.
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(40)
    samples.push(await page.evaluate(id => (window as any)[id].pro.getChart().getBarSpace(), id))
  }
  await page.waitForTimeout(300) // let it finish
  const after = await page.evaluate(id => (window as any)[id].pro.getChart().getBarSpace(), id)
  expect(after).toBeGreaterThan(before)
  // Monotonically approaching the final value (eased, not one jump): at least
  // one sample strictly between `before` and `after`.
  expect(samples.some(s => s > before && s < after)).toBe(true)
  expect(await pageErrors(page)).toEqual([])
})

test('prefers-reduced-motion: wheel zoom reaches its target in the very next read, no intermediate frame needed', async ({ page, kc }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openHarness(page, kc)
  const id = await mountIn(page, 'width: 900px; height: 520px')
  const host = page.locator(`#${id}`)
  const main = await host.locator('.klinecharts-pro-widget canvas').first().boundingBox()
  const before = await page.evaluate(id => (window as any)[id].pro.getChart().getBarSpace(), id)
  await page.mouse.move(main!.x + main!.width / 2, main!.y + main!.height / 2)
  await page.mouse.wheel(0, -300)
  await page.waitForTimeout(30) // well under the ~220ms tween duration
  const after = await page.evaluate(id => (window as any)[id].pro.getChart().getBarSpace(), id)
  expect(after).toBeGreaterThan(before)
  expect(await pageErrors(page)).toEqual([])
})

/**
 * Drags the candle pane from left to right (into history, where there is
 * room to keep going) with the events a real mouse sends: pointerdown/
 * mousedown on whatever is under the pointer (a pane's canvas), then
 * pointermove + mousemove per step. klinecharts pans on the mouse events;
 * attachInertialPan (src/motion/inertialPan.ts) measures the release
 * velocity from how far the CHART moved, so a test that only sends pointer
 * events (the chart never pans) must not fling, and does not — see
 * motion-layers.spec.ts for that case. `chart.scrollByDistance` is
 * instrumented to count the fling's frames after release.
 * `stepMs` between moves controls the release velocity; the last move fires
 * just before 'up', so the pan is released while still "in motion" like a
 * real flick.
 */
async function flick (page: Page, id: string, stepMs: number): Promise<{ callsWhileDown: number, callsAfterUp: number[] }> {
  return await page.evaluate(async ({ id, stepMs }) => {
    // klinecharts drops synthetic mouse events in a page's first 500 ms
    // (it takes them for touch-compat events): see pages/motion-kit.js.
    while (performance.now() < 700) await new Promise(res => setTimeout(res, 50))
    const { pro, container } = (window as any)[id]
    const chart = pro.getChart()
    const calls: number[] = []
    let sinceUp = -1
    const original = chart.scrollByDistance.bind(chart)
    chart.scrollByDistance = (distance: number): void => {
      calls.push(distance)
      original(distance)
    }
    const kcRoot = container.querySelector('.klinecharts-pro-widget > div') as HTMLElement
    const r = (chart.getDom('candle_pane', 'main') as HTMLElement).getBoundingClientRect()
    const y = r.top + r.height / 2
    const start = r.left + 60
    const end = r.left + r.width - 40
    const at = (x: number): Element => document.elementFromPoint(x, y) ?? kcRoot
    const send = (type: string, x: number, buttons = 1): void => {
      const init = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons, view: window }
      at(x).dispatchEvent(type.startsWith('pointer') ? new PointerEvent(type, { ...init, pointerId: 1, pointerType: 'mouse' }) : new MouseEvent(type, init))
    }
    kcRoot.dispatchEvent(new MouseEvent('mouseenter', { clientX: start, clientY: y }))
    send('pointerdown', start)
    send('mousedown', start)
    const steps = 12
    for (let i = 1; i <= steps; i++) {
      await new Promise(res => setTimeout(res, stepMs))
      const x = start + ((end - start) * i) / steps
      send('pointermove', x)
      send('mousemove', x)
    }
    send('pointerup', end, 0)
    send('mouseup', end, 0)
    sinceUp = calls.length
    await new Promise(res => setTimeout(res, 500)) // let any fling run
    return { callsWhileDown: sinceUp, callsAfterUp: calls.slice(sinceUp) }
  }, { id, stepMs })
}

test('inertial pan: a fast release keeps calling scrollByDistance afterward, decaying to a stop', async ({ page, kc }) => {
  await openHarness(page, kc)
  const id = await mountIn(page, 'width: 900px; height: 520px')
  const { callsAfterUp } = await flick(page, id, 8) // ~8ms between steps: a fast flick
  expect(callsAfterUp.length).toBeGreaterThan(3)
  const total = callsAfterUp.reduce((a, b) => a + b, 0)
  expect(total).toBeGreaterThan(0) // net movement the same direction as the flick (dragged left-to-right)
  // Decaying, checked as first-half vs second-half totals rather than
  // sample-to-sample (a real rAF clock's frame-to-frame timing jitter can
  // make one single early frame smaller than one single late one even while
  // the underlying velocity strictly decays — src/motion/inertialPan.test.ts
  // already proves the exact per-sample decay against a fake, jitter-free clock).
  const half = Math.floor(callsAfterUp.length / 2)
  const firstHalf = callsAfterUp.slice(0, half).reduce((a, b) => a + Math.abs(b), 0)
  const secondHalf = callsAfterUp.slice(half).reduce((a, b) => a + Math.abs(b), 0)
  expect(firstHalf).toBeGreaterThan(secondHalf)
  expect(await pageErrors(page)).toEqual([])
})

test('a slow drag-and-stop does not fling: velocity below the threshold starts no inertia', async ({ page, kc }) => {
  await openHarness(page, kc)
  const id = await mountIn(page, 'width: 900px; height: 520px')
  const { callsAfterUp } = await flick(page, id, 120) // slow: well under minVelocity
  expect(callsAfterUp.length).toBe(0)
  expect(await pageErrors(page)).toEqual([])
})

test('reduced motion: a fast release starts no fling', async ({ page, kc }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openHarness(page, kc)
  const id = await mountIn(page, 'width: 900px; height: 520px')
  const { callsAfterUp } = await flick(page, id, 8)
  expect(callsAfterUp.length).toBe(0)
  expect(await pageErrors(page)).toEqual([])
})

const NEW_TYPES = ['heikin_ashi', 'volume_bars', 'columns', 'high_low', 'line_markers', 'step_line', 'hlc_area', 'baseline'] as const

for (const type of NEW_TYPES) {
  test(`chart type "${type}": selectable, renders without errors, hides the native candle where it should`, async ({ page, kc }) => {
    await openHarness(page, kc)
    const id = await mountIn(page, 'width: 900px; height: 520px')
    const result = await page.evaluate(async ({ id, type }) => {
      const { pro } = (window as any)[id]
      const chart = pro.getChart()
      pro.setChartType(type)
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
      const candleColor = chart.getStyles().candle.bar.upColor
      return { got: pro.getChartType(), candleColor, engineType: chart.getStyles().candle.type }
    }, { id, type })
    expect(result.got).toBe(type)
    if (type !== 'line_markers') {
      // The native candle is hidden (transparent) so the custom-series
      // overlay is the only thing visible, while the axis still auto-scales
      // from the real high/low (engine type stays a real CandleType).
      expect(result.candleColor).toBe('rgba(0,0,0,0)')
      expect(result.engineType).toBe('candle_solid')
    } else {
      expect(result.candleColor).not.toBe('rgba(0,0,0,0)')
      expect(result.engineType).toBe('area')
    }
    expect(await pageErrors(page)).toEqual([])
  })
}

test('the custom-series overlay tracks chartType (one id reused across switches) and actually paints (candle-pane canvas pixels change)', async ({ page, kc }) => {
  await openHarness(page, kc)
  const id = await mountIn(page, 'width: 900px; height: 520px')
  const pixelSample = async (): Promise<string> => await page.evaluate(id => {
    const { pro } = (window as any)[id]
    const dom = pro.getChart().getDom('candle_pane', 'main') as HTMLElement
    const canvas = dom.querySelector('canvas') as HTMLCanvasElement
    const ctx = canvas.getContext('2d')!
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    // A cheap content fingerprint: count of non-transparent pixels, coarse-bucketed.
    let painted = 0
    for (let i = 3; i < data.length; i += 4 * 37) if (data[i] > 0) painted++
    return String(painted)
  }, id)
  const kindOf = async (): Promise<{ kind: string | undefined, overlayCount: number }> => await page.evaluate(id => {
    const { pro } = (window as any)[id]
    const instances = pro.getChart().getChartStore().getOverlayStore().getInstances()
    const matches = instances.filter((o: any) => o.name === 'scCustomSeries')
    return { kind: matches[0]?.extendData?.kind, overlayCount: matches.length }
  }, id)

  const candleSolidPixels = await pixelSample()
  await page.evaluate(id => { (window as any)[id].pro.setChartType('columns') }, id)
  await page.waitForTimeout(80)
  const afterColumns = await kindOf()
  const columnsPixels = await pixelSample()
  await page.evaluate(id => { (window as any)[id].pro.setChartType('baseline') }, id)
  await page.waitForTimeout(80)
  const afterBaseline = await kindOf()

  expect(afterColumns).toEqual({ kind: 'columns', overlayCount: 1 })
  expect(afterBaseline).toEqual({ kind: 'baseline', overlayCount: 1 }) // same single instance, not a second one
  expect(columnsPixels).not.toBe(candleSolidPixels) // the pane actually redrew something different
  expect(await pageErrors(page)).toEqual([])
})

test('High/Low tags: an overlay shows the visible range\'s actual high and low, placed on those prices by the live axis (motion-layers.spec.ts checks the placement)', async ({ page, kc }) => {
  await openHarness(page, kc)
  const id = await mountIn(page, 'width: 900px; height: 520px')
  const read = await page.evaluate(id => {
    const { pro } = (window as any)[id]
    const chart = pro.getChart()
    const store = chart.getChartStore().getOverlayStore()
    const ov = store.getInstances().find((o: any) => o.name === 'scHighLowTags')
    const range = chart.getVisibleRange()
    const data = chart.getDataList().slice(Math.max(0, range.from), Math.min(chart.getDataList().length, range.to) + 1)
    return {
      text: [ov?.extendData?.highText, ov?.extendData?.lowText],
      expectHigh: Math.max(...data.map((d: any) => d.high)),
      expectLow: Math.min(...data.map((d: any) => d.low))
    }
  }, id)
  // Parse the formatted price text back to a number (formatPrice rounds to
  // the symbol's precision) rather than substring-matching a rounded
  // integer, which a value like 132.94 (rounds to 133, but the string
  // "132.94" does not contain "133") would fail on for no real reason.
  expect(Number(read.text[0])).toBeCloseTo(read.expectHigh, 1)
  expect(Number(read.text[1])).toBeCloseTo(read.expectLow, 1)
  expect(await pageErrors(page)).toEqual([])
})

test('the UTC/local clock toggle shows HH:MM:SS and switches label on click', async ({ page, kc }) => {
  await openHarness(page, kc)
  const id = await mountIn(page, 'width: 900px; height: 520px')
  const host = page.locator(`#${id}`)
  const clock = host.locator('.klinecharts-pro-clock')
  await expect(clock).toHaveCount(1)
  const first = (await clock.textContent())!
  expect(first).toMatch(/^\d{2}:\d{2}:\d{2} (UTC|Local)$/)
  await clock.click()
  const second = (await clock.textContent())!
  expect(second).toMatch(/^\d{2}:\d{2}:\d{2} (UTC|Local)$/)
  expect(first.split(' ')[1]).not.toBe(second.split(' ')[1])
  expect(await pageErrors(page)).toEqual([])
})

test('grouped chart-type menu: four groups, a starred favourite persists across a remount (localStorage)', async ({ page, kc }) => {
  await openHarness(page, kc)
  await page.evaluate(() => { localStorage.removeItem('klinecharts-pro-chart-type-favourites') })
  const id = await mountIn(page, 'width: 900px; height: 520px')
  const host = page.locator(`#${id}`)
  await host.locator('[data-tool="chartType"]').click()
  const groups = await page.locator('.klinecharts-pro-chart-type-group-label').allTextContents()
  expect(groups).toEqual(['Candles', 'Bars', 'Lines', 'Areas'])
  // Star "Bars".
  const barsRow = page.locator('.klinecharts-pro-chart-type-item', { has: page.locator('.chart-type-item', { hasText: /^Bars$/ }) })
  await barsRow.locator('.klinecharts-pro-chart-type-favourite').click()
  const saved = await page.evaluate(() => localStorage.getItem('klinecharts-pro-chart-type-favourites'))
  expect(JSON.parse(saved ?? '[]')).toContain('ohlc')
  expect(await pageErrors(page)).toEqual([])
})
