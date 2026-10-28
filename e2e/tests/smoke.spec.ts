import { test, expect, openHarness, pageErrors } from './fixtures'

// Overlays from each group of the drawing rail that Super Chart itself adds
// (klinecharts has none of them).
const RAIL_SAMPLE = ['brush', 'fibonacciSegment', 'gannBox', 'xabcd', 'threeWaves', 'priceRange', 'text', 'anchoredVWAP', 'image', 'pitchfork']

for (const build of ['esm', 'umd'] as const) {
  test(`${build}: a chart mounts, draws candles and registers the drawing overlays`, async ({ page, kc }) => {
    await openHarness(page, kc, build)
    const state = await page.evaluate(async () => {
      const { H } = window as any
      const afterImport: string[] = [...H.KC.getSupportedOverlays()]
      const { pro, container } = H.mount()
      const chart = await H.ready(pro)
      return {
        bars: chart.getDataList().length,
        widgets: container.querySelectorAll('.klinecharts-pro-widget').length,
        canvases: container.querySelectorAll('canvas').length,
        added: afterImport.filter(n => !(H.kcOnlyOverlays as string[]).includes(n)),
        afterImport: afterImport.length,
        afterMount: H.KC.getSupportedOverlays().length,
        periodBar: container.querySelector('.klinecharts-pro-period-bar') !== null
      }
    })
    expect(state.bars).toBeGreaterThan(50)
    expect(state.widgets).toBe(1)
    expect(state.canvases).toBeGreaterThan(0)
    expect(state.added, 'importing the package registered the rail overlays').toEqual(expect.arrayContaining(RAIL_SAMPLE))
    expect(state.afterMount, 'mounting a chart registers nothing more').toBe(state.afterImport)
    expect(state.periodBar).toBe(true)
    expect(await pageErrors(page)).toEqual([])
  })
}

test('the ES and UMD builds register the same overlays', async ({ page, kc }) => {
  const added: Record<string, string[]> = {}
  for (const build of ['esm', 'umd'] as const) {
    await openHarness(page, kc, build)
    added[build] = await page.evaluate(() => {
      const { H } = window as any
      return (H.KC.getSupportedOverlays() as string[]).filter(n => !(H.kcOnlyOverlays as string[]).includes(n)).sort()
    })
  }
  expect(added.esm.length).toBeGreaterThan(RAIL_SAMPLE.length)
  expect(added.esm).toEqual(added.umd)
})
