import { test, expect, openHarness, pageErrors } from './fixtures'

// SC-114 (shadow list), SC-115 (gear crash), SC-113 (search), SC-155/167
// (RSI/SMA route to SC_RSI/SC_SMA on engine paths, unchanged on the raw v1
// path). Runs on every klinecharts version in playwright.config.ts's matrix
// (9.7.2 and 9.8.12 by default).
//
// A tooltip icon (eye/gear/close) is drawn on the canvas, not a real DOM
// element, so there is nothing to click with a Playwright locator. The
// public `chart.executeAction()` only handles OnCrosshairChange (checked by
// reading klinecharts' own source) — for every other action, including
// OnTooltipIconClick, it silently does nothing, which would make a test
// built on it pass whether or not the click handler under test even runs.
// `chart.getChartStore().getActionStore().execute(type, data)` (inlined into
// each page.evaluate below, since a Node-side helper is not visible inside
// the browser) is the unexported call klinecharts' own canvas click handler
// makes internally, so this fires ChartProComponent's subscribeAction
// callback exactly as a real click would.

test('a host-created indicator shows checked in the picker and ticking it does not duplicate it (SC-114)', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const { pro, container } = H.mount({ chart: { mainIndicators: ['MA'], subIndicators: [] } })
    const chart = await H.ready(pro)
    // The host adds BOLL and MACD directly, the way SupWallet's MainChart/StudioChart do.
    chart.createIndicator('BOLL', true, { id: 'candle_pane' })
    const macdPaneId = chart.createIndicator('MACD')
    const before = pro.getIndicators()
    // Open the picker and tick the (already-checked) BOLL row.
    const openBtn = [...container.querySelectorAll('.klinecharts-pro-period-bar .tools')].find((e: HTMLElement) => e.textContent?.includes('Indicator')) as HTMLElement
    openBtn.click()
    await H.sleep(50)
    const rows = [...container.querySelectorAll('.klinecharts-pro-indicator-modal-list .row')] as HTMLElement[]
    const bollRow = rows.find(r => r.textContent?.includes('BOLL'))
    const bollChecked = bollRow?.querySelector('.klinecharts-pro-checkbox.checked') !== null
    bollRow?.click()
    await H.sleep(50)
    const after = pro.getIndicators()
    return {
      beforeNames: before.map((i: any) => i.name).sort(),
      bollOwnerBefore: before.find((i: any) => i.name === 'BOLL')?.owner,
      macdOwnerBefore: before.find((i: any) => i.name === 'MACD')?.owner,
      bollChecked,
      bollCountAfterClick: after.filter((i: any) => i.name === 'BOLL').length,
      macdPaneStillThere: chart.getIndicatorByPaneId(macdPaneId, 'MACD') != null
    }
  })
  expect(state.beforeNames).toEqual(expect.arrayContaining(['MA', 'BOLL', 'MACD']))
  expect(state.bollOwnerBefore, 'a host-created indicator is reported, not hidden').toBe('host')
  expect(state.macdOwnerBefore).toBe('host')
  expect(state.bollChecked, 'the picker shows the host-created BOLL as checked').toBe(true)
  expect(state.bollCountAfterClick, 'ticking an already-checked host row must not add a second instance').toBe(1)
  expect(state.macdPaneStillThere).toBe(true)
  expect(await pageErrors(page)).toEqual([])
})

test('closing an engine-added MA from its tooltip icon does not touch a host-added BOLL (SC-114)', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const { pro, container } = H.mount({ chart: { mainIndicators: ['MA'], subIndicators: [] } })
    const chart = await H.ready(pro)
    chart.createIndicator('BOLL', true, { id: 'candle_pane' })
    chart.getChartStore().getActionStore().execute(H.KC.ActionType.OnTooltipIconClick, { paneId: 'candle_pane', indicatorName: 'MA', iconId: 'close' })
    await H.sleep(50)
    return {
      names: pro.getIndicators().map((i: any) => i.name).sort(),
      openOk: (() => { (container.querySelector('.klinecharts-pro-period-bar .tools') as HTMLElement)?.click(); return true })()
    }
  })
  expect(state.names).toEqual(['BOLL'])
  expect(await pageErrors(page)).toEqual([])
})

test('the gear on a script indicator does not crash the chart, and other dialogs still open (SC-115)', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    // No declared inputs (registerScriptIndicator's default), so calcParams is
    // [] — exactly the case data.ts has no entry for, which is what crashed
    // getConfig(name).map before SC-115's fix.
    H.SC.registerScriptIndicator({ name: 'SC_E2E_TEST', source: 'plot(sma(close, 5))' })
    const { pro, container } = H.mount({ chart: { mainIndicators: [], subIndicators: [] } })
    const chart = await H.ready(pro)
    const paneId = chart.createIndicator('SC_E2E_TEST')
    let threw = false
    try {
      chart.getChartStore().getActionStore().execute(H.KC.ActionType.OnTooltipIconClick, { paneId, indicatorName: 'SC_E2E_TEST', iconId: 'setting' })
    } catch (e) { threw = true }
    await H.sleep(50)
    const settingModalOpenedRightAway = container.querySelector('.klinecharts-pro-indicator-setting-modal-content') !== null
    // Close it, then confirm the picker (a different dialog) still opens.
    const closeIcon = container.querySelector('.klinecharts-pro-modal .close-icon') as SVGElement
    closeIcon?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await H.sleep(50)
    const openBtn = [...container.querySelectorAll('.klinecharts-pro-period-bar .tools')].find((e: HTMLElement) => e.textContent?.includes('Indicator')) as HTMLElement
    openBtn.click()
    await H.sleep(50)
    const pickerOpen = container.querySelector('.klinecharts-pro-indicator-modal-list') !== null
    return { threw, settingModalOpenedRightAway, pickerOpen, stillThere: chart.getIndicatorByPaneId(paneId, 'SC_E2E_TEST') != null }
  })
  expect(state.threw).toBe(false)
  expect(state.settingModalOpenedRightAway, 'the settings modal opens (with a generic/empty form) instead of crashing').toBe(true)
  expect(state.pickerOpen, 'the indicator picker still opens after the gear click').toBe(true)
  expect(state.stillThere).toBe(true)
  expect(await pageErrors(page)).toEqual([])
})

test('the picker search filters by name (SC-113)', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const { pro, container } = H.mount({ chart: { mainIndicators: [], subIndicators: [] } })
    await H.ready(pro)
    const openBtn = [...container.querySelectorAll('.klinecharts-pro-period-bar .tools')].find((e: HTMLElement) => e.textContent?.includes('Indicator')) as HTMLElement
    openBtn.click()
    await H.sleep(50)
    const input = container.querySelector('.klinecharts-pro-indicator-modal-search input') as HTMLInputElement
    const before = container.querySelectorAll('.klinecharts-pro-indicator-modal-list .row').length
    input.value = 'rsi'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await H.sleep(50)
    const after = [...container.querySelectorAll('.klinecharts-pro-indicator-modal-list .row')] as HTMLElement[]
    return { before, afterCount: after.length, afterNames: after.map(r => r.textContent) }
  })
  expect(state.before).toBeGreaterThan(state.afterCount)
  expect(state.afterCount).toBeGreaterThan(0)
  expect(state.afterNames.every(t => /rsi/i.test(t ?? ''))).toBe(true)
})

test('the picker routes RSI/MACD/SMA to SC_RSI/SC_MACD/SC_SMA; a raw v1 createIndicator call is unaffected (SC-155/160/167)', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const { pro, container } = H.mount({ chart: { mainIndicators: [], subIndicators: [] } })
    const chart = await H.ready(pro)
    // Engine path: the v2 API (what the picker itself calls after a click).
    const handle = pro.addIndicator('RSI')
    // v1/raw path: a host calling getChart().createIndicator directly.
    const rawPaneId = chart.createIndicator('RSI')
    return {
      handleName: handle?.name,
      onChart: chart.getIndicatorByPaneId(handle.paneId, 'SC_RSI') != null,
      rawIsBuiltin: chart.getIndicatorByPaneId(rawPaneId, 'RSI') != null,
      neitherCrossed: chart.getIndicatorByPaneId(handle.paneId, 'RSI') == null && chart.getIndicatorByPaneId(rawPaneId, 'SC_RSI') == null
    }
  })
  expect(state.handleName).toBe('SC_RSI')
  expect(state.onChart).toBe(true)
  expect(state.rawIsBuiltin, 'a direct v1 createIndicator("RSI") keeps the built-in until the lockstep wallet PR').toBe(true)
  expect(state.neitherCrossed).toBe(true)
})
