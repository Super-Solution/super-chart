import { test, expect, openHarness, pageErrors } from './fixtures'

// API v2 core: PR 5 (data-api-core). SC-023 (Promise<LoadResult>, ready),
// SC-130 (getState/getContext), SC-031 (search reject shows Retry, no
// unhandled rejection), SC-003 (ResizeObserver follows the container, not
// only the window).

test('setPeriod resolves "loaded" after the new data is drawn; ready resolves once', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const { pro } = H.mount()
    await pro.ready
    await H.ready(pro)
    const before = pro.getChart().getDataList().length
    const result = await pro.setPeriod('D')
    await H.sleep(50)
    const after = pro.getChart().getDataList()
    return {
      before,
      result,
      afterLen: after.length,
      lastPeriodMultiplier: pro.getPeriod().multiplier,
      lastPeriodTimespan: pro.getPeriod().timespan,
      loadState: pro.getLoadState()
    }
  })
  expect(state.result.status).toBe('loaded')
  expect(state.result.bars).toBeGreaterThan(0)
  expect(state.afterLen).toBeGreaterThan(0)
  expect(state.lastPeriodTimespan).toBe('day')
  expect(state.loadState.status).toBe('idle')
  expect(state.loadState.loaded.period.timespan).toBe('day')
  expect(await pageErrors(page)).toEqual([])
})

test('setSymbol/setPeriod in the same tick resolve together, and an unreadable period string resolves "invalid" instead of hanging', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const { pro } = H.mount()
    await H.ready(pro)
    const p1 = pro.setSymbol({ ticker: 'OTHER-USDT', pricePrecision: 2 })
    const p2 = pro.setPeriod('D')
    const [r1, r2] = await Promise.all([p1, p2])
    const invalid = await pro.setPeriod('4 hours')
    return { r1, r2, invalid, symbol: pro.getSymbol().ticker, period: pro.getPeriod() }
  })
  expect(state.r1.status).toBe('loaded')
  expect(state.r2).toEqual(state.r1)
  expect(state.symbol).toBe('OTHER-USDT')
  expect(state.period.timespan).toBe('day')
  expect(state.invalid.status).toBe('invalid')
  expect(state.invalid.error.code).toBe('INVALID_PERIOD')
  expect(await pageErrors(page)).toEqual([])
})

test('getState is a JSON round trip and reflects chart type; getContext gives the visible bars', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const { pro } = H.mount()
    await H.ready(pro)
    const s1 = pro.getState()
    const roundTrip = JSON.parse(JSON.stringify(s1))
    pro.setStyles({ candle: { type: 'area' } })
    const s2 = pro.getState()
    const ctx = pro.getContext()
    return { s1, roundTrip, chartType1: s1.chartType, chartType2: s2.chartType, ctx }
  })
  expect(state.roundTrip).toEqual(state.s1)
  expect(state.s1.schema).toBe(1)
  expect(state.chartType1).not.toBe(state.chartType2)
  expect(state.chartType2).toBe('area')
  expect(state.ctx.bars.length).toBeGreaterThan(0)
  expect(state.ctx.symbol).toBe('SUPER-USDT')
})

test('a rejecting searchSymbols shows an error row with Retry, not an endless spinner, and recovers (SC-031)', async ({ page, kc }) => {
  await openHarness(page, kc)
  await page.evaluate(async () => {
    const { H } = window as any
    const mounted = H.mount({ id: 'search-reject' })
    await H.ready(mounted.pro)
    let reject = true
    mounted.feed.datafeed.searchSymbols = async () => {
      if (reject) { throw new Error('search down') }
      return [{ ticker: 'FOUND-USDT' }]
    }
    ;(window as any).__searchFeed = { setOk: () => { reject = false } }
  })
  await page.locator('#search-reject .symbol').click()
  const input = page.locator('#search-reject .klinecharts-pro-symbol-search-modal-input input')
  await input.fill('anything')
  await input.dispatchEvent('change')
  const errorRow = page.locator('#search-reject .klinecharts-pro-symbol-search-modal-error')
  const retryButton = errorRow.locator('button')
  await expect(errorRow).toBeVisible()
  await expect(retryButton).toBeVisible()
  expect(await pageErrors(page)).toEqual([])
  // Retry, after the feed recovers: the error row is gone and results render.
  await page.evaluate(() => { (window as any).__searchFeed.setOk() })
  await retryButton.click()
  await expect(errorRow).toHaveCount(0)
  await expect(page.locator('#search-reject .klinecharts-pro-symbol-search-modal-list li')).toContainText('FOUND-USDT')
  expect(await pageErrors(page)).toEqual([])
})

test('the chart follows its container size, not only the window (SC-003)', async ({ page, kc }) => {
  await openHarness(page, kc)
  const result = await page.evaluate(async () => {
    const { H } = window as any
    const { pro, container } = H.mount({ id: 'resize-test' })
    await H.ready(pro)
    const canvasBefore = container.querySelector('canvas')
    const widthBefore = canvasBefore.width
    container.style.width = '600px'
    await H.sleep(200)
    const canvasAfter = container.querySelector('canvas')
    return { widthBefore, widthAfter: canvasAfter.width }
  })
  expect(result.widthAfter).not.toBe(result.widthBefore)
  expect(await pageErrors(page)).toEqual([])
})
