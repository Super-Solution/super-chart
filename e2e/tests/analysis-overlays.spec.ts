import { test, expect, openHarness, pageErrors } from './fixtures'

// Existing optional-analysis lifecycle, paging geometry and previous-period
// reference cases. The removed searchable legacy picker is not recreated.
test('owned order-block/FVG layers and previous-day levels attach to the chart', async ({ page }) => {
  await openHarness(page)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const { createMarketOverlayLayer } = await import('/dist/overlays.js')
    const { TECHNICAL_INDICATOR_DEFINITIONS } = await import('/dist/indicators.js')
    const { pro } = H.mount(), chart = await H.ready(pro)
    if (!chart.getRegisteredIndicatorNames().includes('SC_PDHL')) chart.registerIndicator(TECHNICAL_INDICATOR_DEFINITIONS.find((definition: any) => definition.name === 'SC_PDHL'))
    const id = chart.addIndicator({ name: 'SC_PDHL' })
    const layer = createMarketOverlayLayer({ orderBlocks: true, fairValueGaps: true })
    chart.addLayer(layer)
    await H.sleep(80)
    return { name: chart.listIndicators().find((item: any) => item.id === id).name, status: layer.getSnapshot().status }
  })
  expect(state.name).toBe('SC_PDHL')
  expect(['ready', 'empty']).toContain(state.status.orderBlocks)
  expect(['ready', 'empty']).toContain(state.status.fairValueGaps)
  expect(await pageErrors(page)).toEqual([])
})

test('order blocks and fair-value gaps paint across owned pan and zoom', async ({ page }) => {
  await openHarness(page)
  const state = await page.evaluate(async () => {
    const { H } = window as any, { createMarketOverlayLayer } = await import('/dist/overlays.js')
    const { pro, container } = H.mount(), chart = await H.ready(pro)
    chart.addLayer(createMarketOverlayLayer({ orderBlocks: true, fairValueGaps: true }))
    chart.view.zoom(3); await H.sleep(30)
    chart.view.pan(-30); await H.sleep(30)
    chart.view.zoom(1 / 6); await H.sleep(30)
    chart.view.pan(60); await H.sleep(80)
    return { widthPx: container.getBoundingClientRect().width }
  })
  expect(state.widthPx).toBeGreaterThan(0)
  expect(await pageErrors(page)).toEqual([])
})

test('SC_PDHL retains previous-day reference lines on hourly bars', async ({ page }) => {
  await openHarness(page)
  const state = await page.evaluate(async () => {
    const { H } = window as any, { TECHNICAL_INDICATOR_DEFINITIONS } = await import('/dist/indicators.js')
    const { pro } = H.mount(), chart = await H.ready(pro, 200)
    if (!chart.getRegisteredIndicatorNames().includes('SC_PDHL')) chart.registerIndicator(TECHNICAL_INDICATOR_DEFINITIONS.find((definition: any) => definition.name === 'SC_PDHL'))
    const id = chart.addIndicator({ name: 'SC_PDHL' })
    await H.sleep(80)
    return { pane: chart.listIndicators().find((item: any) => item.id === id).pane }
  })
  expect(state.pane).toBe('price')
  expect(await pageErrors(page)).toEqual([])
})

test('removing optional analyses releases the layer and indicator', async ({ page }) => {
  await openHarness(page)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const { createMarketOverlayLayer } = await import('/dist/overlays.js')
    const { TECHNICAL_INDICATOR_DEFINITIONS } = await import('/dist/indicators.js')
    const { pro } = H.mount({ chart: { chart: { indicators: [] } } }), chart = await H.ready(pro)
    if (!chart.getRegisteredIndicatorNames().includes('SC_PDHL')) chart.registerIndicator(TECHNICAL_INDICATOR_DEFINITIONS.find((definition: any) => definition.name === 'SC_PDHL'))
    const id = chart.addIndicator({ name: 'SC_PDHL' }), layer = createMarketOverlayLayer({ orderBlocks: true, fairValueGaps: true })
    const remove = chart.addLayer(layer)
    await H.sleep(80)
    remove(); chart.removeIndicator(id)
    return { names: chart.listIndicators().map((item: any) => item.name), released: layer.getSnapshot() }
  })
  expect(state.names).toEqual([])
  expect(state.released).toBeNull()
  expect(await pageErrors(page)).toEqual([])
})