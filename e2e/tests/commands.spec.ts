import { test, expect, openHarness, pageErrors } from './fixtures'

// End-to-end coverage for the AI/MCP command layer, drawings/annotations/
// layout APIs, and the future-time/replay anchoring fix (SC-121/123/127/128/
// 135/178/180) against the BUILT dist/ in a real browser. Unit tests (src/
// api/*.test.ts, src/commands/*.test.ts) already cover the pure logic
// against fake charts; this file exists for what only a real klinecharts
// instance can show: actual rendered pixel widths, actual replay slicing,
// and actual keyboard focus.

test('execute(): setChartType, setSymbol/setPeriod resolve after load, and indicator add/remove', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const { pro } = H.mount({})
    await H.ready(pro)

    const typeResult = await pro.execute({ id: 'chart.setChartType', args: { type: 'area' } })
    const chartTypeAfter = pro.getChartType()

    const periodResult = await pro.execute({ id: 'chart.setPeriod', args: { period: 'D' } })
    const barsAfterPeriod = pro.getChart().getDataList().length

    const addResult = await pro.execute({ id: 'indicator.add', args: { name: 'MA', calcParams: [5, 10] } })
    const hasIndicator = pro.getIndicators().some((i: any) => i.name === 'MA')
    const removeResult = addResult.ok ? await pro.execute({ id: 'indicator.remove', args: addResult.result }) : null
    const hasIndicatorAfterRemove = pro.getIndicators().some((i: any) => i.name === 'MA')

    return {
      typeOk: typeResult.ok, chartTypeAfter,
      periodOk: periodResult.ok, periodStatus: periodResult.result?.status, barsAfterPeriod,
      addOk: addResult.ok, hasIndicator, removeOk: removeResult?.ok, hasIndicatorAfterRemove
    }
  })
  expect(state.typeOk).toBe(true)
  expect(state.chartTypeAfter).toBe('area')
  expect(state.periodOk).toBe(true)
  expect(state.periodStatus).toBe('loaded')
  expect(state.barsAfterPeriod).toBeGreaterThan(0)
  expect(state.addOk).toBe(true)
  expect(state.hasIndicator).toBe(true)
  expect(state.removeOk).toBe(true)
  expect(state.hasIndicatorAfterRemove).toBe(false)
  expect(await pageErrors(page)).toEqual([])
})

test('execute(): replay start/step/exit reach the same controller the replay bar drives', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const { pro } = H.mount({})
    await H.ready(pro)
    const startResult = await pro.execute({ id: 'replay.start' })
    const activeAfterStart = pro.replay.getState().active
    const indexAfterStart = pro.replay.getState().index
    const stepResult = await pro.execute({ id: 'replay.step', args: { n: 3 } })
    const indexAfterStep = pro.replay.getState().index
    const exitResult = await pro.execute({ id: 'replay.exit' })
    const activeAfterExit = pro.replay.getState().active
    return { startOk: startResult.ok, activeAfterStart, indexAfterStart, stepOk: stepResult.ok, indexAfterStep, exitOk: exitResult.ok, activeAfterExit }
  })
  expect(state.startOk).toBe(true)
  expect(state.activeAfterStart).toBe(true)
  expect(state.indexAfterStep).toBe(state.indexAfterStart + 3)
  expect(state.exitOk).toBe(true)
  expect(state.activeAfterExit).toBe(false)
})

test('addDrawing: a box entirely in the future, and one spanning past into the future, both render a non-zero width (SC-135)', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const { pro } = H.mount({})
    const chart = await H.ready(pro, 50)
    const bars = chart.getDataList()
    const last = bars[bars.length - 1]
    const period = pro.getPeriod()
    const spanMs = period.multiplier * 3_600_000 // the harness's period is 1H

    const futureId = pro.addDrawing({
      tool: 'rect',
      points: [
        { time: last.timestamp + 5 * spanMs, price: last.close - 5 },
        { time: last.timestamp + 20 * spanMs, price: last.close + 5 }
      ]
    })
    const spanningId = pro.addDrawing({
      tool: 'rect',
      points: [
        { time: bars[bars.length - 10].timestamp, price: last.close - 5 },
        { time: last.timestamp + 15 * spanMs, price: last.close + 5 }
      ]
    })

    const widthOf = (id: string): number => {
      const overlay = chart.getOverlayById(id)
      const pixels = chart.convertToPixel(overlay.points, { paneId: 'candle_pane' })
      return Math.abs(pixels[1].x - pixels[0].x)
    }
    return { futureWidth: widthOf(futureId), spanningWidth: widthOf(spanningId), barSpace: chart.getBarSpace() }
  })
  // A collapsed (clamped-to-last-bar) box would measure ~0px; a correct one
  // spans roughly (index delta) * barSpace. 15 bars apart at the least (the
  // spanning box) should be comfortably more than a couple of bar widths.
  expect(state.futureWidth).toBeGreaterThan(state.barSpace * 5)
  expect(state.spanningWidth).toBeGreaterThan(state.barSpace * 5)
})

test('replay: a drawing spanning the cursor keeps its width during replay, and its points are byte-identical after exit (SC-178)', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const { pro } = H.mount({})
    const chart = await H.ready(pro)
    const bars = chart.getDataList()
    // Relative to whatever this harness naturally loads (not a fixed count):
    // idxA well inside where replay's default 60% cursor will land, idxB well
    // beyond it — so a collapsed (clamped-to-cursor) render is unmistakable.
    const idxA = Math.max(1, Math.floor(bars.length * 0.1))
    const idxB = bars.length - Math.max(2, Math.floor(bars.length * 0.05))
    const id = pro.addDrawing({
      tool: 'segment',
      points: [
        { time: bars[idxA].timestamp, price: bars[idxA].close },
        { time: bars[idxB].timestamp, price: bars[idxB].close }
      ]
    })
    const pointsBefore = JSON.stringify(chart.getOverlayById(id).points)
    const barSpace = chart.getBarSpace()

    pro.replay.start()
    await H.sleep(30)
    const duringPoints = chart.getOverlayById(id).points
    const pixelsDuring = chart.convertToPixel(duringPoints, { paneId: 'candle_pane' })
    const widthDuring = Math.abs(pixelsDuring[1].x - pixelsDuring[0].x)

    pro.replay.exit()
    await H.sleep(30)
    const pointsAfter = JSON.stringify(chart.getOverlayById(id).points)

    return { widthDuring, barSpace, indexGap: idxB - idxA, pointsBefore, pointsAfter }
  })
  // The collapse bug renders this at 0-2 bars wide; the fix keeps it at
  // roughly indexGap bars wide (loose bound: still clearly not collapsed).
  expect(state.widthDuring).toBeGreaterThan(state.barSpace * (state.indexGap * 0.5))
  expect(state.pointsAfter).toBe(state.pointsBefore)
})

test('drawingLevelsAt on a log axis gives the geometric midpoint (SC-180)', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const { pro } = H.mount({})
    const chart = await H.ready(pro)
    pro.setPriceScale({ type: 'log' })
    const bars = chart.getDataList()
    const last = bars[bars.length - 1]
    const p0 = last.close
    const p1 = last.close * 4 // a clean x4 so the geometric mean is exactly 2x p0
    const id = pro.addDrawing({ tool: 'segment', points: [{ time: bars[bars.length - 5].timestamp, price: p0 }, { time: last.timestamp, price: p1 }] })
    const midTimestamp = Math.round((bars[bars.length - 5].timestamp + last.timestamp) / 2)
    const levels = pro.drawingLevelsAt(id, midTimestamp)
    return { levels, geometricMean: Math.sqrt(p0 * p1) }
  })
  expect(state.levels).not.toBeNull()
  expect(state.levels[0].price).toBeCloseTo(state.geometricMean, 0)
})

test('onDrawingCross fires once going up across a user drawing\'s level, on live ticks only (SC-180)', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const { pro, feed } = H.mount({})
    const chart = await H.ready(pro)
    const bars = chart.getDataList()
    const last = bars[bars.length - 1]
    const level = last.close + 10 // above the current close, so the first tick below it primes the comparison
    const id = pro.addDrawing({ tool: 'horizontalStraightLine', points: [{ time: last.timestamp, price: level }] })

    const events: any[] = []
    const off = pro.onDrawingCross((e: any) => { events.push(e) })
    // Prime: a tick below the level (no event yet — nothing to compare the FIRST sample against).
    feed.tick({ ...last, timestamp: last.timestamp + 3_600_000, close: level - 5, open: level - 6, high: level - 5, low: level - 6 })
    await H.sleep(80)
    // Cross up.
    feed.tick({ ...last, timestamp: last.timestamp + 2 * 3_600_000, close: level + 5, open: level - 1, high: level + 5, low: level - 1 })
    await H.sleep(80)
    // Stay above: no second event.
    feed.tick({ ...last, timestamp: last.timestamp + 3 * 3_600_000, close: level + 8, open: level + 5, high: level + 8, low: level + 5 })
    await H.sleep(80)
    off()

    return { events, id }
  })
  expect(state.events).toHaveLength(1)
  expect(state.events[0]).toMatchObject({ id: state.id, direction: 'up' })
})

test('layout: getLayout()/applyLayout() scope drawings to their own symbol — a layout saved on ticker A restores none on ticker B (SC-121)', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const { pro } = H.mount({ chart: { symbol: { ticker: 'TICKER-A', pricePrecision: 2 } } })
    await H.ready(pro)
    pro.addDrawing({ tool: 'horizontalStraightLine', points: [{ time: pro.getChart().getDataList()[0].timestamp, price: 123 }] })
    await pro.execute({ id: 'indicator.add', args: { name: 'MA' } })
    const layout = pro.getLayout()
    const drawingsOnA = layout.drawings.length

    await pro.setSymbol({ ticker: 'TICKER-B', pricePrecision: 2 })
    await H.sleep(30)
    pro.applyLayout(layout)
    await H.sleep(30)
    const drawingsOnB = pro.getDrawings().length
    const hasMAOnB = pro.getIndicators().some((i: any) => i.name === 'MA')

    return { drawingsOnA, drawingsOnB, hasMAOnB }
  })
  expect(state.drawingsOnA).toBe(1)
  expect(state.drawingsOnB).toBe(0)
  // Indicators are NOT symbol-scoped (they are chart-wide), so applyLayout still restores MA on B.
  expect(state.hasMAOnB).toBe(true)
})

test('the command palette opens only while the chart owns the key, and never hijacks a host Ctrl/Cmd+K when it does not (SC-123)', async ({ page, kc }) => {
  await openHarness(page, kc)
  const paletteSelector = '.klinecharts-pro-command-palette'
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const { pro, container } = H.mount({ chart: { commandPalette: true } })
    await H.ready(pro)

    let hostSawIt = 0
    window.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'k') hostSawIt++ })

    // Nothing focused, no prior press inside the chart: the chart must not
    // own this key, so the host's own Ctrl/Cmd+K listener still sees it.
    document.body.focus()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }))
    const openedWithoutFocus = container.querySelector('[class*="command-palette"]') !== null

    // Press inside the chart first (establishes "last press in chart"),
    // THEN Ctrl+K: the palette opens and the host's own listener never runs
    // for that keystroke (stopPropagation from the chart's own dispatcher).
    const kcRoot = container.querySelector('.klinecharts-pro-widget > div') as HTMLElement
    kcRoot.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 10, clientY: 10, button: 0, pointerId: 1 }))
    const hostCountBefore = hostSawIt
    kcRoot.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }))
    const openedWithFocus = document.querySelector('[class*="command-palette"]') !== null

    return { openedWithoutFocus, openedWithFocus, hostSawItForFocusedPress: hostSawIt - hostCountBefore, hostSawItTotal: hostSawIt }
  })
  expect(state.openedWithoutFocus).toBe(false)
  expect(state.openedWithFocus).toBe(true)
  expect(state.hostSawItForFocusedPress).toBe(0)
  expect(state.hostSawItTotal).toBe(1) // only the unfocused press reached the host listener
})
