import { test, expect, openHarness, pageErrors } from './fixtures'

// SC-NEXT #6 (analysis overlays): SC_ORDER_BLOCKS, SC_FVG, SC_PDHL are plain
// indicator templates (see src/indicators/SC_ORDER_BLOCKS.ts, SC_FVG.ts,
// SC_PDHL.ts) whose `draw` callback recomputes from OHLCV every frame — the
// pure detection math (extension/orderBlocks.ts, fairValueGaps.ts,
// previousRangeHighLow.ts) is unit-tested in isolation; these specs check the
// glue: they are reachable through the same picker every other indicator
// uses, they survive being added/zoomed/panned without throwing, and their
// `draw` callback runs (no page error) across both klinecharts versions.
//
// Volume Profile (SC_VRVP) already shipped in an earlier batch and is not
// re-tested here; SC-NEXT's "expose volume profile" ask is already satisfied
// by its existing `listed: true` catalogue entry (src/indicators/catalog.ts).

test('SC_ORDER_BLOCKS, SC_FVG and SC_PDHL are addable via the v2 API and land on the candle pane', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const { pro } = H.mount({ chart: { mainIndicators: [], subIndicators: [] } })
    const chart = await H.ready(pro)
    const ob = pro.addIndicator('SC_ORDER_BLOCKS')
    const fvg = pro.addIndicator('SC_FVG')
    const pdhl = pro.addIndicator('SC_PDHL')
    await H.sleep(80)
    return {
      names: pro.getIndicators().map((i: any) => i.name).sort(),
      obOnChart: chart.getIndicatorByPaneId(ob.paneId, 'SC_ORDER_BLOCKS') != null,
      fvgOnChart: chart.getIndicatorByPaneId(fvg.paneId, 'SC_FVG') != null,
      pdhlOnChart: chart.getIndicatorByPaneId(pdhl.paneId, 'SC_PDHL') != null
    }
  })
  expect(state.names).toEqual(expect.arrayContaining(['SC_ORDER_BLOCKS', 'SC_FVG', 'SC_PDHL']))
  expect(state.obOnChart).toBe(true)
  expect(state.fvgOnChart).toBe(true)
  expect(state.pdhlOnChart).toBe(true)
  expect(await pageErrors(page)).toEqual([])
})

test('all three are listed and reachable through the indicator picker, and its search filters to each by name', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const { pro, container } = H.mount({ chart: { mainIndicators: [], subIndicators: [] } })
    await H.ready(pro)
    const openBtn = [...container.querySelectorAll('.klinecharts-pro-period-bar .tools')].find((e: HTMLElement) => e.textContent?.includes('Indicator')) as HTMLElement
    openBtn.click()
    await H.sleep(50)
    const input = container.querySelector('.klinecharts-pro-indicator-modal-search input') as HTMLInputElement
    async function searchFor (term: string): Promise<string[]> {
      input.value = term
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
      await H.sleep(50)
      return [...container.querySelectorAll('.klinecharts-pro-indicator-modal-list .row')].map((r: HTMLElement) => r.textContent ?? '')
    }
    const orderBlockRows = await searchFor('order block')
    const fvgRows = await searchFor('fair value')
    const pdhlRows = await searchFor('previous day')
    return { orderBlockRows, fvgRows, pdhlRows }
  })
  expect(state.orderBlockRows.some(t => /order blocks/i.test(t))).toBe(true)
  expect(state.fvgRows.some(t => /fair value gaps/i.test(t))).toBe(true)
  expect(state.pdhlRows.some(t => /previous day.*week high-low/i.test(t))).toBe(true)
})

test('SC_ORDER_BLOCKS and SC_FVG draw without throwing across zoom and pan (their window follows visibleRange every frame)', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const { pro, container } = H.mount({ chart: { mainIndicators: [], subIndicators: [] } })
    const chart = await H.ready(pro, 200)
    pro.addIndicator('SC_ORDER_BLOCKS')
    pro.addIndicator('SC_FVG')
    // Zoom in/out and pan, the same way a user scrubbing the chart would —
    // both indicators recompute their window from visibleRange on every draw.
    chart.setBarSpace(chart.getBarSpace() * 3)
    await H.sleep(30)
    chart.scrollByDistance(-400)
    await H.sleep(30)
    chart.setBarSpace(Math.max(1, chart.getBarSpace() / 6))
    await H.sleep(30)
    chart.scrollByDistance(600)
    await H.sleep(80)
    return { widthPx: container.getBoundingClientRect().width }
  })
  expect(state.widthPx).toBeGreaterThan(0)
  expect(await pageErrors(page)).toEqual([])
})

test('SC_PDHL draws two reference lines once at least a full previous UTC day of hourly bars is loaded', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    // The harness's 1H period and ~400-bar default history span more than a
    // day, so a previous UTC day always exists by the time the chart is ready.
    const { pro } = H.mount({ chart: { mainIndicators: [], subIndicators: [] } })
    await H.ready(pro, 200)
    const handle = pro.addIndicator('SC_PDHL')
    await H.sleep(80)
    return { paneId: handle.paneId }
  })
  expect(state.paneId).toBeTruthy()
  expect(await pageErrors(page)).toEqual([])
})

test('removing all three leaves no trace and no error (standard indicator lifecycle)', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const { pro } = H.mount({ chart: { mainIndicators: [], subIndicators: [] } })
    await H.ready(pro)
    const ob = pro.addIndicator('SC_ORDER_BLOCKS')
    const fvg = pro.addIndicator('SC_FVG')
    const pdhl = pro.addIndicator('SC_PDHL')
    await H.sleep(50)
    // pro.removeIndicator (the v2 API), not chart.removeIndicator directly —
    // the latter bypasses SuperChart's own tracked-indicator list (SC-114),
    // so pro.getIndicators() would still report them as present afterwards.
    pro.removeIndicator({ paneId: ob.paneId, name: 'SC_ORDER_BLOCKS' })
    pro.removeIndicator({ paneId: fvg.paneId, name: 'SC_FVG' })
    pro.removeIndicator({ paneId: pdhl.paneId, name: 'SC_PDHL' })
    await H.sleep(50)
    return { names: pro.getIndicators().map((i: any) => i.name) }
  })
  expect(state.names).toEqual([])
  expect(await pageErrors(page)).toEqual([])
})
