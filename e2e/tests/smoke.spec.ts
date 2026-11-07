import { test, expect, openHarness, pageErrors } from './fixtures'

for (const build of ['esm', 'umd'] as const) {
  test(`${build}: a chart mounts and draws candles`, async ({ page }) => {
    await openHarness(page, build)
    const state = await page.evaluate(async () => {
      const { H } = window as any
      const { pro, container } = H.mount()
      const chart = await H.ready(pro)
      return { bars: chart.dataPort.getDataList().length, widgets: container.querySelectorAll('[aria-label="Chart workspace"]').length,
        canvases: container.querySelectorAll('canvas').length, periodControl: container.querySelector('select[aria-label="Interval"]') !== null }
    })
    expect(state.bars).toBeGreaterThan(50)
    expect(state.widgets).toBe(1)
    expect(state.canvases).toBeGreaterThan(0)
    expect(state.periodControl).toBe(true)
    expect(await pageErrors(page)).toEqual([])
  })
}
