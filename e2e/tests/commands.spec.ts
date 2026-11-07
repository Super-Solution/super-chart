import { test, expect, openHarness, pageErrors } from './fixtures'

// Existing command behaviour now uses the new public API directly. The removed
// generic command palette and drawing-cross notification API are not simulated.
test('chart type, market load and indicator add/remove use the owned public API', async ({ page }) => {
  await openHarness(page)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const { pro } = H.mount({ chart: { chart: { indicators: [] } } }), chart = await H.ready(pro)
    chart.setRenderOptions({ chartType: 'area' })
    const load = await pro.setMarket({ ticker: 'ETH', pricePrecision: 2 }, 'D')
    const id = chart.addIndicator({ name: 'RSI' }), added = chart.listIndicators().map((item: any) => item.name)
    chart.removeIndicator(id)
    return { chartType: chart.getRenderOptions().chartType, load: load.status, ticker: pro.getSymbol().ticker, period: pro.getPeriod().timespan, added, removed: chart.listIndicators().length }
  })
  expect(state.chartType).toBe('area')
  expect(state.load).toBe('loaded')
  expect(state.ticker).toBe('ETH')
  expect(state.period).toBe('day')
  expect(state.added).toEqual(['RSI'])
  expect(state.removed).toBe(0)
  expect(await pageErrors(page)).toEqual([])
})

test('replay start, step and exit reach the workspace playback controller', async ({ page }) => {
  await openHarness(page)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const { pro } = H.mount()
    await H.ready(pro)
    const before = pro.getBars().length
    pro.startReplay(20)
    const start = pro.getBars().length
    pro.stepReplay(3)
    const step = pro.getBars().length
    pro.exitReplay()
    return { before, start, step, after: pro.getBars().length, active: pro.getReplayState().active }
  })
  expect(state.start).toBe(21)
  expect(state.step).toBe(24)
  expect(state.after).toBe(state.before)
  expect(state.active).toBe(false)
  expect(await pageErrors(page)).toEqual([])
})

test('a future drawing and a drawing spanning into the future retain nonzero projected width (SC-135)', async ({ page }) => {
  await openHarness(page)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const { pro } = H.mount(), chart = await H.ready(pro)
    const bars = pro.getBars(), last = bars.at(-1), hour = 3600000
    const a = chart.drawings.add({ id: 'future', type: 'rectangle', anchors: [{ timestamp: last.timestamp + 5 * hour, price: last.close - 5 }, { timestamp: last.timestamp + 20 * hour, price: last.close + 5 }] })
    const b = chart.drawings.add({ id: 'spanning', type: 'rectangle', anchors: [{ timestamp: bars.at(-10).timestamp, price: last.close - 5 }, { timestamp: last.timestamp + 15 * hour, price: last.close + 5 }] })
    let frame: any
    chart.addLayer({ update: (value: any) => { frame = value }, paint: () => {} })
    await H.sleep(80)
    const width = (drawing: any) => Math.abs(frame.project(drawing.anchors[0].timestamp, drawing.anchors[0].price).x - frame.project(drawing.anchors[1].timestamp, drawing.anchors[1].price).x)
    return { futureWidth: width(a), spanningWidth: width(b), barSpace: frame.model.geometry.plotWidth / (frame.snapshot.viewport.i1 - frame.snapshot.viewport.i0) }
  })
  expect(state.futureWidth).toBeGreaterThan(state.barSpace * 5)
  expect(state.spanningWidth).toBeGreaterThan(state.barSpace * 5)
})

test('a drawing keeps its projected width during replay and its anchors after exit (SC-178)', async ({ page }) => {
  await openHarness(page)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const { pro } = H.mount(), chart = await H.ready(pro), bars = pro.getBars()
    const indexA = Math.floor(bars.length * 0.1), indexB = Math.floor(bars.length * 0.95)
    const drawing = chart.drawings.add({ id: 'segment', type: 'segment', anchors: [{ timestamp: bars[indexA].timestamp, price: bars[indexA].close }, { timestamp: bars[indexB].timestamp, price: bars[indexB].close }] })
    const before = JSON.stringify(drawing.anchors)
    let frame: any
    chart.addLayer({ update: (value: any) => { frame = value }, paint: () => {} })
    pro.startReplay(Math.floor(bars.length * 0.6))
    await H.sleep(80)
    const width = Math.abs(frame.project(drawing.anchors[0].timestamp, drawing.anchors[0].price).x - frame.project(drawing.anchors[1].timestamp, drawing.anchors[1].price).x)
    const barSpace = frame.model.geometry.plotWidth / (frame.snapshot.viewport.i1 - frame.snapshot.viewport.i0)
    pro.exitReplay()
    return { width, barSpace, gap: indexB - indexA, before, after: JSON.stringify(chart.drawings.getSnapshot().drawings[0].anchors) }
  })
  expect(state.width).toBeGreaterThan(state.barSpace * state.gap * 0.5)
  expect(state.after).toBe(state.before)
})

test('drawings are scoped to their own symbol and restored on return (SC-121)', async ({ page }) => {
  await openHarness(page)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const { pro } = H.mount(), chart = await H.ready(pro), bar = pro.getBars().at(-1)
    chart.drawings.add({ id: 'owned', type: 'horizontal', anchors: [{ timestamp: bar.timestamp, price: bar.close }] })
    const before = chart.drawings.exportJson(), symbol = pro.getSymbol()
    await pro.setSymbol({ ticker: 'OTHER', pricePrecision: 2 })
    const otherCount = chart.drawings.getSnapshot().drawings.length
    await pro.setSymbol(symbol)
    return { before, otherCount, after: chart.drawings.exportJson() }
  })
  expect(state.otherCount).toBe(0)
  expect(state.after).toBe(state.before)
})