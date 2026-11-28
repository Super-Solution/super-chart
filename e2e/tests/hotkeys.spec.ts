import { test, expect, openHarness, pageErrors } from './fixtures'

const mount = async (page: import('@playwright/test').Page, id: string): Promise<void> => {
  await page.evaluate(async (id) => {
    const { H } = window as any
    const { pro } = H.mount({ id, chart: {} })
    ;(window as any).pro = pro
    await H.ready(pro)
  }, id)
}

test('Alt+T arms the trend line, ? opens the list of shortcuts', async ({ page }) => {
  await openHarness(page)
  await mount(page, 'keys')
  const chart = page.locator('#keys .sc-chart [tabindex="0"]')
  await chart.focus()
  await page.keyboard.press('Alt+KeyT')
  await expect(page.locator('#keys [data-rail="group.lines"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('#keys [data-rail="group.lines"]')).toHaveAttribute('aria-label', /Trend line/)
  await page.keyboard.press('Escape')
  await page.keyboard.press('?')
  await expect(page.locator('#keys .sc-palette')).toBeVisible()
  await page.keyboard.press('Escape')
  expect(await pageErrors(page)).toEqual([])
})

test('Shift and drag measures between two bars without panning, and a plain press clears it', async ({ page }) => {
  await openHarness(page)
  await mount(page, 'measure')
  const box = (await page.locator('#measure .sc-chart [tabindex="0"]').boundingBox())!
  const view = async (): Promise<string> => JSON.stringify(await page.evaluate(() => (window as any).pro.chart.view.getSnapshot().viewport))
  const measure = async (): Promise<any> => await page.evaluate(() => (window as any).pro.chart.measure)
  const before = await view()
  await page.keyboard.down('Shift')
  await page.mouse.move(box.x + 300, box.y + 300); await page.mouse.down()
  await page.mouse.move(box.x + 520, box.y + 180, { steps: 6 }); await page.mouse.up()
  await page.keyboard.up('Shift')
  const m = await measure()
  expect(m).not.toBeNull()
  expect(m.to.price).toBeGreaterThan(m.from.price)
  expect(m.to.timestamp).toBeGreaterThan(m.from.timestamp)
  expect(await view()).toBe(before)
  await page.mouse.click(box.x + 600, box.y + 260)
  expect(await measure()).toBeNull()
  expect(await pageErrors(page)).toEqual([])
})

test('hovering an indicator row in the legend offers settings and remove', async ({ page }) => {
  await openHarness(page)
  await mount(page, 'legend')
  await page.evaluate(() => { (window as any).pro.chart.addIndicator({ name: 'MA', params: [20] }) })
  const box = (await page.locator('#legend .sc-chart [tabindex="0"]').boundingBox())!
  const actions = page.locator('#legend .sc-legend-actions')
  await expect(actions).toBeHidden()
  // Rows: the quote row first, then one row per price-pane indicator; the first sits about 17 px below the quote row.
  await page.mouse.move(box.x + 70, box.y + 36); await page.mouse.move(box.x + 74, box.y + 36)
  await expect(actions).toBeVisible()
  const count = async (): Promise<number> => await page.evaluate(() => (window as any).pro.chart.listIndicators().length)
  const before = await count()
  await actions.locator('button').nth(1).click()
  expect(await count()).toBe(before - 1)
  await expect(actions).toBeHidden()
  expect(await pageErrors(page)).toEqual([])
})
