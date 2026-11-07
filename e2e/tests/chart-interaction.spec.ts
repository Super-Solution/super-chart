import { test, expect, openHarness, pageErrors } from './fixtures'

// Existing input and market-control cases. Legacy theme/legend/icon and removed
// engine-option contracts are retired; these use the new public engine API.
test('wheel over the main pane and the price axis zooms the owned viewport', async ({ page }) => {
  await openHarness(page)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const { pro, container } = H.mount()
    const chart = await H.ready(pro)
    // Data readiness precedes the first geometry/paint frame used by pointer input.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const root = container.querySelector('[tabindex="0"]') as HTMLElement
    const span = () => { const v = chart.view.getSnapshot().viewport; return v.i1 - v.i0 }
    const r = root.getBoundingClientRect(), before = span()
    const wheel = (x: number) => root.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: x, clientY: r.top + r.height / 3, deltaY: -100 }))
    wheel(r.left + r.width / 2)
    await H.sleep(60)
    const afterMain = span()
    wheel(r.right - 10)
    await H.sleep(60)
    return { before, afterMain, afterAxis: span() }
  })
  expect(state.afterMain).toBeLessThan(state.before)
  expect(state.afterAxis).toBeLessThan(state.afterMain)
  expect(await pageErrors(page)).toEqual([])
})

test('keyboard navigation pans older, zooms out and follows the newest bar', async ({ page }) => {
  await openHarness(page)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const { pro, container } = H.mount()
    const chart = await H.ready(pro)
    const root = container.querySelector('[tabindex="0"]') as HTMLElement
    root.focus()
    const key = (key: string) => root.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key }))
    const before = chart.view.getSnapshot().viewport
    key('ArrowLeft')
    const older = chart.view.getSnapshot().viewport
    key('-')
    const zoomed = chart.view.getSnapshot().viewport
    key('Home')
    const latest = chart.view.getSnapshot()
    return { moved: before.i0 - older.i0, zoomedOut: zoomed.i1 - zoomed.i0 > older.i1 - older.i0, atEnd: latest.viewport.i1 === latest.length - 1 }
  })
  expect(state.moved).toBeGreaterThan(0)
  expect(state.zoomedOut).toBe(true)
  expect(state.atEnd).toBe(true)
  expect(await pageErrors(page)).toEqual([])
})

test('a key typed into a host input outside the chart is untouched by chart navigation', async ({ page }) => {
  await openHarness(page)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const { pro } = H.mount()
    await H.ready(pro)
    const input = document.getElementById('hostinput') as HTMLInputElement
    input.focus()
    const before = JSON.stringify(pro.chart.view.getSnapshot().viewport)
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: '-' }))
    return { after: JSON.stringify(pro.chart.view.getSnapshot().viewport), before, activeIsInput: document.activeElement === input }
  })
  expect(state.activeIsInput).toBe(true)
  expect(state.after).toBe(state.before)
  expect(await pageErrors(page)).toEqual([])
})

test('the follow-latest button returns from older history to the newest bar', async ({ page }) => {
  await openHarness(page)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const { pro, container } = H.mount()
    const chart = await H.ready(pro)
    chart.view.pan(-100)
    ;[...container.querySelectorAll('button')].find(button => button.textContent === 'Follow latest')!.click()
    const snapshot = chart.view.getSnapshot()
    return { atLatest: snapshot.viewport.i1 === snapshot.length - 1 }
  })
  expect(state.atLatest).toBe(true)
  expect(await pageErrors(page)).toEqual([])
})

test('scale controls and the owned scale API agree for log, percentage and reverse', async ({ page }) => {
  await openHarness(page)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const { pro, container } = H.mount()
    await H.ready(pro)
    const scale = container.querySelector('select[aria-label="Price scale"]') as HTMLSelectElement
    const set = (value: string) => { scale.value = value; scale.dispatchEvent(new Event('change', { bubbles: true })) }
    set('log')
    const afterLog = pro.chart.getLayoutOptions().priceScale
    set('linear')
    const afterToggleOff = pro.chart.getLayoutOptions().priceScale
    pro.chart.setLayout({ priceScale: { mode: 'percentage' } })
    const afterApi = pro.chart.getLayoutOptions().priceScale
    ;[...container.querySelectorAll('button')].find(button => button.textContent === 'Reverse scale')!.click()
    return { afterLog, afterToggleOff, afterApi, afterInvert: pro.chart.getLayoutOptions().priceScale }
  })
  expect(state.afterLog.mode).toBe('log')
  expect(state.afterToggleOff.mode).toBe('linear')
  expect(state.afterApi.mode).toBe('percentage')
  expect(state.afterInvert.reversed).toBe(true)
  expect(await pageErrors(page)).toEqual([])
})

test('symbol search selects the second result by keyboard and Escape closes the dialog', async ({ page }) => {
  await openHarness(page)
  await page.evaluate(async () => {
    const { H } = window as any
    const mounted = H.mount({ id: 'search', feed: { search: [{ ticker: 'FIRST' }, { ticker: 'SECOND' }] } })
    ;(window as any).pro = mounted.pro
    await H.ready(mounted.pro)
  })
  const host = page.locator('#search')
  await host.getByRole('button', { name: 'SUPER-USDT', exact: true }).click()
  const input = host.locator('[role=dialog] input')
  await expect(input).toBeFocused()
  await host.getByRole('button', { name: 'SECOND', exact: true }).waitFor()
  // Native focus starts in the input, so the first Down focuses row one.
  await input.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  expect(await page.evaluate(() => (window as any).pro.getSymbol().ticker)).toBe('SECOND')
  await expect(host.locator('[role=dialog]')).toBeHidden()
  await host.getByRole('button', { name: 'SECOND', exact: true }).click()
  await host.locator('[role=dialog] input').press('Escape')
  await expect(host.locator('[role=dialog]')).toBeHidden()
  expect(await pageErrors(page)).toEqual([])
})

test('type-to-search opens from the focused chart and continues typing in the input', async ({ page }) => {
  await openHarness(page)
  await page.evaluate(async () => {
    const { H } = window as any
    const { pro, container } = H.mount({ id: 'typing' })
    await H.ready(pro)
    ;(container.querySelector('[tabindex="0"]') as HTMLElement).focus()
  })
  await page.keyboard.type('et')
  const input = page.locator('#typing [role=dialog] input')
  const opened = await input.evaluate(element => document.activeElement === element && (element as HTMLInputElement).value === 'et')
  expect(opened).toBe(true)
  expect(await pageErrors(page)).toEqual([])
})

test('replay starts at a selected bar through the owned timestamp API', async ({ page }) => {
  await openHarness(page)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const { pro } = H.mount()
    const chart = await H.ready(pro)
    pro.startReplay()
    const range = chart.view.getSnapshot().viewport
    const index = Math.floor((range.i0 + range.i1) / 2)
    // The owned host takes an explicit timestamp; it has no armed pick UI.
    pro.startReplayAt(pro.getBars()[index].timestamp)
    const selected = pro.getReplayState()
    pro.exitReplay()
    return { index: selected.index, dataLength: pro.getBars().length, active: selected.active }
  })
  expect(state.active).toBe(true)
  expect(state.index).toBeGreaterThanOrEqual(0)
  expect(state.index).toBeLessThan(state.dataLength)
  expect(await pageErrors(page)).toEqual([])
})

test('bar countdown ticks, survives clearing drawings and hides during replay', async ({ page }) => {
  await openHarness(page)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const hour = 3_600_000
    const nowHour = Math.floor(Date.now() / hour) * hour
    const bars = Array.from({ length: 60 }, (_, index) => ({
      timestamp: nowHour - (59 - index) * hour,
      open: 100, high: 101, low: 99, close: 100.5, volume: 10
    }))
    const datafeed = {
      async searchSymbols () { return [] },
      async getHistoryKLineData () { return bars },
      subscribe () {},
      unsubscribe () {}
    }
    const { pro, container } = H.mount({ chart: { datafeed } })
    const chart = await H.ready(pro)
    const countdowns = () => [...container.querySelectorAll('[role="toolbar"][aria-label="Chart playback"] span[title]')].filter(node => node.textContent !== '')
    await H.sleep(1100)
    const before = countdowns(), firstText = before[0]?.textContent
    await H.sleep(1100)
    const secondText = countdowns()[0]?.textContent
    // Countdown is workspace chrome, independent of the editable drawing store.
    chart.drawings.clear()
    await H.sleep(50)
    const survivedWipe = countdowns().length === 1
    pro.startReplay(30)
    return { count: before.length, textChanged: firstText !== secondText, survivedWipe, hiddenDuringReplay: countdowns().length === 0 }
  })
  expect(state.count).toBe(1)
  expect(state.textChanged).toBe(true)
  expect(state.survivedWipe).toBe(true)
  expect(state.hiddenDuringReplay).toBe(true)
  expect(await pageErrors(page)).toEqual([])
})
