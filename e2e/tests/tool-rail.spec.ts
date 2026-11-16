import { test, expect, openHarness, pageErrors, pickTool } from './fixtures'

const mount = async (page: import('@playwright/test').Page, id: string, workspace: Record<string, unknown> = {}): Promise<void> => {
  await page.evaluate(async ([id, workspace]) => {
    const { H } = window as any
    const { pro } = H.mount({ id, chart: workspace })
    ;(window as any).pro = pro
    await H.ready(pro)
  }, [id, workspace] as const)
}
const drawings = async (page: import('@playwright/test').Page): Promise<any[]> => await page.evaluate(() => (window as any).pro.chart.drawings.getSnapshot().drawings)

test('the left rail arms a tool by group button or flyout, shows which one, and hands back to the cursor', async ({ page }) => {
  await openHarness(page)
  await mount(page, 'rail')
  const rail = page.locator('#rail .sc-rail')
  await expect(rail).toBeVisible()
  await expect(page.locator('#rail select[aria-label="Drawing tool"]')).toBeHidden()
  const cursor = rail.locator('[data-rail="cursor"]'), lines = rail.locator('[data-rail="group.lines"]')
  await expect(cursor).toHaveAttribute('aria-pressed', 'true')
  await lines.click()
  await expect(lines).toHaveAttribute('aria-pressed', 'true')
  await expect(cursor).toHaveAttribute('aria-pressed', 'false')
  await lines.click() // a second press on the armed group puts the cursor back
  await expect(cursor).toHaveAttribute('aria-pressed', 'true')
  // The flyout lists the whole group; choosing from it arms that tool and the group button now shows it.
  await pickTool(page, '#rail', 'ray')
  await expect(lines).toHaveAttribute('aria-pressed', 'true')
  await expect(lines).toHaveAttribute('aria-label', /Ray/)
  await expect(page.locator('#rail .sc-flyout')).toBeHidden()
  const box = (await page.locator('#rail .sc-chart [tabindex="0"]').boundingBox())!
  await page.mouse.move(box.x + 200, box.y + 160); await page.mouse.down()
  await page.mouse.move(box.x + 380, box.y + 100, { steps: 5 }); await page.mouse.up()
  expect((await drawings(page)).map(item => item.type)).toEqual(['ray'])
  await expect(cursor).toHaveAttribute('aria-pressed', 'true') // the tool disarms after one drawing
  expect(await pageErrors(page)).toEqual([])
})

test('the flyout is keyboard operable: Right Arrow opens it, arrows move, Enter chooses, Escape closes and returns focus', async ({ page }) => {
  await openHarness(page)
  await mount(page, 'rail-keys')
  const rail = page.locator('#rail-keys .sc-rail')
  await rail.locator('[data-rail="cursor"]').focus()
  await page.keyboard.press('ArrowDown') // first group
  await page.keyboard.press('ArrowRight')
  const flyout = page.locator('#rail-keys .sc-flyout')
  await expect(flyout).toBeVisible()
  await expect(flyout.locator('.sc-flyout-item:focus')).toHaveCount(1) // the tool shown on the group is focused first
  await page.keyboard.press('Escape')
  await expect(flyout).toBeHidden()
  await expect(rail.locator('[data-rail="group.lines"]')).toBeFocused()
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter')
  await expect(flyout).toBeHidden()
  expect(await page.evaluate(() => (window as any).pro.chart.getDrawingMagnet())).toBe(false)
  await expect(rail.locator('[data-rail="group.lines"]')).toHaveAttribute('aria-pressed', 'true')
})

test('keep drawing re-arms the tool after each drawing and Escape ends it; remove-all clears in one undo step', async ({ page }) => {
  await openHarness(page)
  await mount(page, 'rail-stay')
  const chart = page.locator('#rail-stay .sc-chart [tabindex="0"]'), box = (await chart.boundingBox())!
  await pickTool(page, '#rail-stay', 'segment')
  await page.locator('#rail-stay button[aria-label="Keep drawing"]').click()
  for (const y of [120, 200]) {
    await page.mouse.move(box.x + 160, box.y + y); await page.mouse.down()
    await page.mouse.move(box.x + 340, box.y + y + 20, { steps: 4 }); await page.mouse.up()
  }
  expect((await drawings(page)).length).toBe(2)
  await expect(page.locator('#rail-stay [data-rail="group.lines"]')).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Escape')
  await expect(page.locator('#rail-stay [data-rail="cursor"]')).toHaveAttribute('aria-pressed', 'true')
  await page.locator('#rail-stay button[aria-label="Remove all drawings"]').click()
  expect(await drawings(page)).toEqual([])
  await page.evaluate(() => (window as any).pro.chart.drawings.undo())
  expect((await drawings(page)).length).toBe(2)
})

test('the magnet snaps a placed point to a real open, high, low or close', async ({ page }) => {
  await openHarness(page)
  await mount(page, 'rail-magnet')
  await page.locator('#rail-magnet button[aria-label="Magnet"]').click()
  expect(await page.evaluate(() => (window as any).pro.chart.getDrawingMagnet())).toBe(true)
  // Aim a few pixels away from the last bar's high.
  const near = await page.evaluate(() => {
    const pro = (window as any).pro, chart = pro.chart, bar = chart.getBars().at(-2)
    const frame = (chart as any).frame, p = frame.project(bar.timestamp, bar.high)
    const host = document.querySelector('#rail-magnet .sc-chart [tabindex="0"]')!.getBoundingClientRect()
    return { x: host.x + p.x + 4, y: host.y + p.y - 6, bar }
  })
  await pickTool(page, '#rail-magnet', 'horizontal')
  await page.mouse.click(near.x, near.y)
  const [line] = await drawings(page)
  expect(line.type).toBe('horizontal')
  expect(line.anchors[0].price).toBe(near.bar.high)
  expect(line.anchors[0].timestamp).toBe(near.bar.timestamp)
})

test('parts.toolRail false brings back the tool dropdown, and the chrome ignores a host stylesheet that shouts at every button', async ({ page }) => {
  await openHarness(page)
  await page.addStyleTag({ content: 'button,select,input{text-transform:uppercase;letter-spacing:.3em;font-family:monospace}' })
  await mount(page, 'rail-off', { ui: { parts: { toolRail: false } } })
  await expect(page.locator('#rail-off .sc-rail')).toBeHidden()
  const select = page.locator('#rail-off select[aria-label="Drawing tool"]')
  await expect(select).toBeVisible()
  await select.selectOption('segment')
  expect(await page.evaluate(() => (window as any).pro.chart.getDrawingMagnet())).toBe(false)
  const style = await page.locator('#rail-off .sc-symbol').evaluate(node => { const s = getComputedStyle(node); return { transform: s.textTransform, spacing: s.letterSpacing, family: s.fontFamily } })
  // A global element rule (the usual reset or brand stylesheet) must not reach the workspace's own controls.
  expect(style.transform).toBe('none')
  expect(style.spacing === 'normal' || style.spacing === '0px').toBe(true)
  expect(style.family).not.toContain('monospace')
})
