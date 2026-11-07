import { test, expect, openHarness, pageErrors } from './fixtures'

// Restores the original segment/Escape and create-once brush checks through
// the owned input controller. Magnet/stay-mode rail contracts remain separate.
test('drawing input creates one segment, cancels with Escape and commits a brush stroke once', async ({ page }) => {
  await openHarness(page)
  await page.evaluate(async () => {
    const { H } = window as any
    const { pro } = H.mount({ id: 'drawing-input' })
    ;(window as any).pro = pro
    await H.ready(pro)
  })
  const root = page.locator('#drawing-input [tabindex="0"]')
  const bounds = (await root.boundingBox())!
  const tools = page.locator('#drawing-input select[aria-label="Drawing tool"]')
  await tools.selectOption('segment')
  await page.mouse.move(bounds.x + 250, bounds.y + 90)
  await page.mouse.down()
  await page.mouse.move(bounds.x + 450, bounds.y + 160, { steps: 6 })
  await page.mouse.up()
  const first = await page.evaluate(() => (window as any).pro.chart.drawings.getSnapshot().drawings)
  expect(first.length).toBe(1)
  expect(first[0].type).toBe('segment')
  expect(first[0].anchors.length).toBe(2)
  await tools.selectOption('rectangle')
  await page.mouse.move(bounds.x + 300, bounds.y + 110)
  await page.mouse.down()
  await page.mouse.move(bounds.x + 500, bounds.y + 180, { steps: 4 })
  await page.keyboard.press('Escape')
  await page.mouse.up()
  expect(await page.evaluate(() => (window as any).pro.chart.drawings.getSnapshot().drawings)).toEqual(first)

  // Existing drawing-input-suite.js section 9: one creation per stroke,
  // no per-move removal/recreation, and selection after release.
  await page.evaluate(() => {
    const state = window as any, store = state.pro.chart.drawings
    const add = store.add.bind(store), remove = store.remove.bind(store)
    state.brushCalls = { add: 0, remove: 0 }
    store.add = (...args: any[]) => { state.brushCalls.add++; return add(...args) }
    store.remove = (...args: any[]) => { state.brushCalls.remove++; return remove(...args) }
    state.restoreDrawingMethods = () => { store.add = add; store.remove = remove }
  })
  await tools.selectOption('brush')
  await page.mouse.move(bounds.x + 150, bounds.y + 240)
  await page.mouse.down()
  await page.mouse.move(bounds.x + 230, bounds.y + 180, { steps: 8 })
  await page.mouse.up()
  const brush = await page.evaluate(() => {
    const state = window as any, snapshot = state.pro.chart.drawings.getSnapshot()
    state.restoreDrawingMethods()
    return { calls: state.brushCalls, selected: snapshot.drawings.find((item: any) => item.type === 'brush')?.id === snapshot.selectedId }
  })
  expect(brush.calls).toEqual({ add: 1, remove: 0 })
  expect(brush.selected).toBe(true)
  expect(await pageErrors(page)).toEqual([])
})
