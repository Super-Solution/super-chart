import { test, expect, openHarness, pageErrors, pickTool } from './fixtures'

// Existing editor wrapper: retain model checks and restore its real shortcut
// and inline-text checks. This does not restore its old colour/CSS assertions.
test('drawing editor preserves locking, immutable anchors, shortcuts and inline text editing', async ({ page }) => {
  await openHarness(page)
  const result = await page.evaluate(async () => {
    const { H } = window as any
    const { pro } = H.mount({ id: 'drawing-editor' }), chart = await H.ready(pro), bar = pro.getBars().at(-1)
    ;(window as any).pro = pro
    const anchors = [{ timestamp: bar.timestamp, price: bar.close }]
    chart.drawings.add({ id: 'level', type: 'horizontal', anchors })
    anchors[0].price = -100
    const before = chart.drawings.exportJson()
    chart.drawings.update('level', { locked: true })
    const denied = chart.drawings.update('level', { anchors: [{ timestamp: bar.timestamp, price: -20 }] })
    const retained = chart.drawings.getSnapshot().drawings[0].anchors[0].price
    const removedLocked = chart.drawings.remove('level')
    chart.drawings.update('level', { hidden: true })
    const hidden = chart.drawings.getSnapshot().drawings[0].hidden
    chart.drawings.undo()
    const restoredVisible = !chart.drawings.getSnapshot().drawings[0].hidden
    chart.drawings.redo()
    const redone = chart.drawings.getSnapshot().drawings[0].hidden
    chart.drawings.importJson(before)
    return { denied, retained, want: bar.close, removedLocked, hidden, restoredVisible, redone, before, after: chart.drawings.exportJson() }
  })
  expect(result.denied).toBe(false)
  expect(result.retained).toBe(result.want)
  expect(result.removedLocked).toBe(false)
  expect(result.hidden).toBe(true)
  expect(result.restoredVisible).toBe(true)
  expect(result.redone).toBe(true)
  expect(result.after).toBe(result.before)

  // Existing drawing-editor-suite.js sections 19 and 22, with real keyboard
  // events and the owned textarea instead of upstream overlay-store hooks.
  const root = page.locator('#drawing-editor .sc-chart [tabindex="0"]')
  const bounds = (await root.boundingBox())!
  await pickTool(page, '#drawing-editor', 'segment')
  await page.mouse.move(bounds.x + 200, bounds.y + 160)
  await page.mouse.down()
  await page.mouse.move(bounds.x + 400, bounds.y + 160, { steps: 4 })
  await page.mouse.up()
  const id = await page.evaluate(() => (window as any).pro.chart.drawings.getSnapshot().selectedId)
  const exists = async () => await page.evaluate(id => (window as any).pro.chart.drawings.getSnapshot().drawings.some((item: any) => item.id === id), id)
  await root.press('Delete')
  expect(await exists()).toBe(false)
  await root.press('Control+z')
  expect(await exists()).toBe(true)
  await root.press('Control+Shift+z')
  expect(await exists()).toBe(false)
  await root.press('Control+z')
  expect(await exists()).toBe(true)
  await root.press('Control+y')
  expect(await exists()).toBe(false)
  await root.press('Control+z')
  expect(await exists()).toBe(true)

  await page.evaluate(() => { (window as any).promptCalled = false; window.prompt = () => { (window as any).promptCalled = true; return 'SHOULD NOT BE USED' } })
  await pickTool(page, '#drawing-editor', 'note')
  await page.mouse.click(bounds.x + 350, bounds.y + 220)
  const editor = root.getByRole('textbox', { name: 'Drawing text', exact: true })
  expect(await page.evaluate(() => (window as any).promptCalled)).toBe(false)
  await expect(editor).toBeFocused()
  await editor.fill('Hi there')
  await editor.press('Enter')
  const note = await page.evaluate(() => (window as any).pro.chart.drawings.getSnapshot().drawings.find((item: any) => item.type === 'note'))
  expect(note.text).toBe('Hi there')
  await expect(editor).toHaveCount(0)
  await page.mouse.dblclick(bounds.x + 358, bounds.y + 228)
  await expect(editor).toHaveValue('Hi there')
  await editor.press('Escape')
  await expect(editor).toHaveCount(0)
  expect(await page.evaluate(id => (window as any).pro.chart.drawings.getSnapshot().drawings.find((item: any) => item.id === id).text, note.id)).toBe('Hi there')
  expect(await pageErrors(page)).toEqual([])
})
