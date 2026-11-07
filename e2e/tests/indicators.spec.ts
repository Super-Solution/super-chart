import { test, expect, openHarness, pageErrors } from './fixtures'

// Existing ownership-isolation case. No upstream private action store is used.
test('removing a configured MA leaves a host-added BOLL intact (SC-114)', async ({ page }) => {
  await openHarness(page)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const { pro, container } = H.mount({ chart: { chart: { indicators: [{ name: 'MA' }] } } })
    const chart = await H.ready(pro)
    chart.addIndicator({ name: 'BOLL' })
    ;[...container.querySelectorAll('button')].find(button => button.getAttribute('aria-label')?.startsWith('Remove MA'))!.click()
    return chart.listIndicators().map((item: any) => item.name)
  })
  expect(state).toEqual(['BOLL'])
  expect(await pageErrors(page)).toEqual([])
})