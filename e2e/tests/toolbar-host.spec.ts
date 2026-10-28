import { test, expect, openHarness, pageErrors } from './fixtures'

// SC-NEXT #4: the top bar's header host slot (a host's own symbol selector,
// mounted in place of the built-in symbol button) and the Indicators tool's
// active-count badge.

test('headerSlot: a detached host Node replaces the built-in symbol button, and stays live (a host can still mutate it)', async ({ page, kc }) => {
  await openHarness(page, kc)
  const id = await page.evaluate(async () => {
    const { H } = window as any
    const container = document.createElement('div')
    container.id = 'headerslot1'
    container.style.cssText = 'width:1000px;height:520px'
    document.getElementById('charts')!.appendChild(container)
    const slot = document.createElement('button')
    slot.id = 'my-symbol-picker'
    slot.textContent = 'BTC-USDT ▾'
    const { pro } = H.mount({ chart: { container, headerSlot: slot } })
    await H.ready(pro)
    ;(window as any).headerslot1 = { pro, slot }
    return 'headerslot1'
  })
  const host = page.locator(`#${id}`)
  // The host's own element is there, in the bar, and the built-in symbol button is gone.
  await expect(host.locator('#my-symbol-picker')).toHaveCount(1)
  await expect(host.locator('#my-symbol-picker')).toHaveText('BTC-USDT ▾')
  await expect(host.locator('.klinecharts-pro-period-bar .symbol')).toHaveCount(0)
  await expect(host.locator('.klinecharts-pro-header-slot')).toHaveCount(1)
  // The exact same element (a live reference), not a clone: the host can still update it.
  await page.evaluate(() => { (window as any).headerslot1.slot.textContent = 'ETH-USDT ▾' })
  await expect(host.locator('#my-symbol-picker')).toHaveText('ETH-USDT ▾')
  expect(await pageErrors(page)).toEqual([])
})

test('headerSlot: a Node already attached elsewhere is cloned, not moved (its original owner keeps it)', async ({ page, kc }) => {
  await openHarness(page, kc)
  const id = await page.evaluate(async () => {
    const { H } = window as any
    const container = document.createElement('div')
    container.id = 'headerslot2'
    container.style.cssText = 'width:1000px;height:520px'
    document.getElementById('charts')!.appendChild(container)
    const original = document.createElement('span')
    original.id = 'already-on-page'
    original.textContent = 'shared'
    document.body.appendChild(original) // attached to the page BEFORE mount
    const { pro } = H.mount({ chart: { container, headerSlot: original } })
    await H.ready(pro)
    return 'headerslot2'
  })
  const host = page.locator(`#${id}`)
  // Two copies now exist: the original where it always was, and a clone in the slot.
  await expect(page.locator('body > #already-on-page')).toHaveCount(1)
  await expect(host.locator('.klinecharts-pro-header-slot #already-on-page')).toHaveCount(1)
  expect(await pageErrors(page)).toEqual([])
})

test('no headerSlot: the built-in symbol button is exactly as before', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const { pro } = H.mount({})
    await H.ready(pro)
    return {
      hasSymbol: !!document.querySelector('.klinecharts-pro-period-bar .symbol'),
      hasSlot: !!document.querySelector('.klinecharts-pro-header-slot')
    }
  })
  expect(state).toEqual({ hasSymbol: true, hasSlot: false })
  expect(await pageErrors(page)).toEqual([])
})

test('Indicators badge: shows the active-indicator count and updates live', async ({ page, kc }) => {
  await openHarness(page, kc)
  const id = await page.evaluate(async () => {
    const { H } = window as any
    const container = document.createElement('div')
    container.id = 'badgechart'
    container.style.cssText = 'width:1000px;height:520px'
    document.getElementById('charts')!.appendChild(container)
    const { pro } = H.mount({ chart: { container, mainIndicators: ['MA'], subIndicators: ['VOL'] } })
    await H.ready(pro)
    ;(window as any).badgechart = pro
    return 'badgechart'
  })
  const host = page.locator(`#${id}`)
  const badge = host.locator('[data-tool="indicators"] .badge')
  await expect(badge).toHaveText('2') // MA + VOL
  await expect(host.locator('[data-tool="indicators"]')).toHaveAttribute('aria-label', /\(2\)/)
  // The v2 addIndicator() (not a raw getChart().createIndicator() call) is
  // what notifies the engine's own indicator-change tracking — the same
  // "one thing the chart itself cannot answer on its own" limitation
  // src/indicators/state.ts documents for host-added indicators in general,
  // not something specific to this badge.
  await page.evaluate(id => { (window as any)[id].addIndicator('BOLL') }, id)
  await page.waitForTimeout(100)
  await expect(badge).toHaveText('3')
  expect(await pageErrors(page)).toEqual([])
})

test('Indicators badge: no badge at all with zero indicators (never shows "0")', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const { pro } = H.mount({ chart: { mainIndicators: [], subIndicators: [] } })
    await H.ready(pro)
    return !!document.querySelector('[data-tool="indicators"] .badge')
  })
  expect(state).toBe(false)
  expect(await pageErrors(page)).toEqual([])
})
