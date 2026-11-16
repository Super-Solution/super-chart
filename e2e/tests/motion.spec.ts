import { test, expect, openHarness, pageErrors } from './fixtures'
import type { Page } from '@playwright/test'

// Existing motion and custom-series cases migrated to fractional owned views.
// Removed tween timing, clock text, favourites and native-candle transparency
// implementation assertions are not contracts of the new engine.
async function mount (page: Page): Promise<{ x: number, y: number, width: number, height: number }> {
  await page.evaluate(async () => {
    const { H } = window as any
    const { pro } = H.mount({ id: 'motion', chart: { chart: { inertia: true, indicators: [], prefetchBars: 0 } } })
    ;(window as any).pro = pro
    await H.ready(pro)
    pro.chart.view.setViewport({ i0: 100, i1: 199 })
    await H.sleep(50)
  })
  return (await page.locator('#motion .sc-chart [tabindex="0"]').boundingBox())!
}

async function flick (page: Page, hold: number): Promise<number[]> {
  const bounds = await mount(page)
  await page.mouse.move(bounds.x + 250, bounds.y + 120)
  await page.mouse.down()
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(bounds.x + 250 + i * 12, bounds.y + 120)
    await page.waitForTimeout(8)
  }
  if (hold > 0) await page.waitForTimeout(hold)
  await page.mouse.up()
  await page.evaluate(() => {
    const chart = (window as any).pro.chart
    let previous = chart.view.getSnapshot().viewport.i0
    ;(window as any).coast = []
    chart.view.subscribe(() => {
      const next = chart.view.getSnapshot().viewport.i0
      ;(window as any).coast.push(previous - next)
      previous = next
    })
  })
  await page.waitForTimeout(500)
  return await page.evaluate(() => (window as any).coast)
}

test('wheel zoom stays anchored under the cursor while viewing older bars', async ({ page }) => {
  await openHarness(page)
  const bounds = await mount(page)
  const before = await page.evaluate(() => (window as any).pro.chart.view.getSnapshot().viewport)
  const cx = bounds.x + 300, cy = bounds.y + 120
  await page.mouse.move(cx, cy)
  await page.mouse.wheel(0, -100)
  await page.waitForTimeout(80)
  const state = await page.evaluate(before => {
    const chart = (window as any).pro.chart, after = chart.view.getSnapshot().viewport
    // Geometry is public through EngineLayer; no upstream time-scale store.
    return new Promise<any>(resolve => {
      const remove = chart.addLayer({ update(frame: any) {
        const ratio = (300 - frame.model.geometry.left) / frame.model.geometry.plotWidth
        resolve({ before, after, anchorBefore: before.i0 + ratio * (before.i1 - before.i0), anchorAfter: after.i0 + ratio * (after.i1 - after.i0) })
        queueMicrotask(remove)
      }, paint() {} })
    })
  }, before)
  expect(state.after.i1 - state.after.i0).toBeLessThan(state.before.i1 - state.before.i0)
  expect(Math.abs(state.anchorAfter - state.anchorBefore)).toBeLessThanOrEqual(1)
  expect(state.after.i1).toBeLessThan(300)
  expect(await pageErrors(page)).toEqual([])
})

test('inertial pan continues after a fast release and decays', async ({ page }) => {
  await openHarness(page)
  const after = await flick(page, 0)
  expect(after.length).toBeGreaterThan(3)
  expect(after.reduce((sum, value) => sum + value, 0)).toBeGreaterThan(0)
  const half = Math.floor(after.length / 2)
  expect(after.slice(0, half).reduce((sum, value) => sum + Math.abs(value), 0)).toBeGreaterThan(after.slice(half).reduce((sum, value) => sum + Math.abs(value), 0))
  expect(await pageErrors(page)).toEqual([])
})

test('a drag held still before release starts no inertia', async ({ page }) => {
  await openHarness(page)
  expect((await flick(page, 120)).length).toBe(0)
  expect(await pageErrors(page)).toEqual([])
})

test('reduced motion prevents a fast release from starting inertia', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openHarness(page)
  expect((await flick(page, 0)).length).toBe(0)
  expect(await pageErrors(page)).toEqual([])
})

for (const type of ['heikin-ashi', 'volume-bars', 'columns', 'high-low', 'line-markers', 'step-line', 'hlc-area', 'baseline'] as const) {
  test(`chart type "${type}" selects and renders without errors`, async ({ page }) => {
    await openHarness(page)
    const state = await page.evaluate(async type => {
      const { H } = window as any
      const { pro } = H.mount(), chart = await H.ready(pro)
      if (type === 'heikin-ashi') chart.view.setMode(type)
      else chart.setRenderOptions({ chartType: type })
      await H.sleep(60)
      return type === 'heikin-ashi' ? chart.view.getSnapshot().mode : chart.getRenderOptions().chartType
    }, type)
    expect(state).toBe(type)
    expect(await pageErrors(page)).toEqual([])
  })
}