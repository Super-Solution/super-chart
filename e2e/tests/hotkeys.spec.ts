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
