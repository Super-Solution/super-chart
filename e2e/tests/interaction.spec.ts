import { test, expect, openHarness, pageErrors } from './fixtures'

// Behaviour the node unit tests could not see (they survived mutation in the
// SC-183 check): the period bar, realtime ticks, Settings > Restore default,
// and the Fibonacci retracement's levels.

test('a period-bar click changes the period and loads that period', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const { pro, container, feed } = H.mount()
    await H.ready(pro)
    const day = [...container.querySelectorAll('.klinecharts-pro-period-bar .period')].find(e => e.textContent === 'D') as HTMLElement
    day.click()
    // The subscription follows the history request once its data is applied.
    for (let i = 0; i < 40 && feed.calls.subscribe.at(-1)?.period.timespan !== 'day'; i++) await H.sleep(50)
    return {
      period: pro.getPeriod(),
      requested: feed.calls.history.at(-1)?.period,
      resubscribed: feed.calls.subscribe.at(-1)?.period,
      selected: container.querySelector('.klinecharts-pro-period-bar .period.selected')?.textContent
    }
  })
  expect(state.period).toMatchObject({ multiplier: 1, timespan: 'day', text: 'D' })
  expect(state.requested).toMatchObject({ timespan: 'day' })
  expect(state.resubscribed).toMatchObject({ timespan: 'day' })
  expect(state.selected).toBe('D')
})

test('a realtime tick from datafeed.subscribe reaches the chart', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const { pro, feed } = H.mount()
    const chart = await H.ready(pro)
    for (let i = 0; i < 40 && feed.calls.subscribe.length === 0; i++) await H.sleep(50)
    const last = chart.getDataList().at(-1)
    const count = chart.getDataList().length
    feed.tick({ ...last, close: 4321.5, high: Math.max(last.high, 4321.5) })
    feed.tick({ timestamp: last.timestamp + 3_600_000, open: 4321.5, high: 4400, low: 4300, close: 4350, volume: 10 })
    await H.sleep(100)
    const list = chart.getDataList()
    return { before: count, after: list.length, updatedClose: list.at(-2).close, newClose: list.at(-1).close }
  })
  expect(state.after).toBe(state.before + 1)
  expect(state.updatedClose).toBe(4321.5)
  expect(state.newClose).toBe(4350)
})

test('Settings: a toggle changes the chart and Restore default reverts it', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const { pro, container } = H.mount()
    const chart = await H.ready(pro)
    const initial = chart.getStyles().candle.priceMark.high.show
    const settings = [...container.querySelectorAll('.klinecharts-pro-period-bar .item.tools')].find(e => e.textContent?.trim() === 'Setting') as HTMLElement
    settings.click()
    await H.sleep(100)
    const modal = container.querySelector('.klinecharts-pro-setting-modal-content') as HTMLElement
    const labels = [...modal.querySelectorAll(':scope > span')] as HTMLElement[]
    const label = labels.find(s => /high/i.test(s.textContent ?? ''))!
    ;(label.nextElementSibling as HTMLElement).click()
    await H.sleep(50)
    const toggled = chart.getStyles().candle.priceMark.high.show
    const restore = [...container.querySelectorAll('.klinecharts-pro-modal .klinecharts-pro-button')].find(b => /restore/i.test(b.textContent ?? '')) as HTMLElement
    restore.click()
    await H.sleep(50)
    return { initial, toggled, restored: chart.getStyles().candle.priceMark.high.show, modalClosed: container.querySelector('.klinecharts-pro-setting-modal-content') === null }
  })
  expect(state.toggled).toBe(!state.initial)
  expect(state.restored).toBe(state.initial)
  expect(state.modalClosed).toBe(true)
})

test('the Fibonacci retracement draws the standard levels', async ({ page, kc }) => {
  await openHarness(page, kc)
  const texts = await page.evaluate(async () => {
    const { H } = window as any
    const { pro } = H.mount()
    const chart = await H.ready(pro)
    const dl = chart.getDataList()
    const id = chart.createOverlay({ name: 'fibonacciSegment', points: [{ timestamp: dl[dl.length - 80].timestamp, value: 200 }, { timestamp: dl[dl.length - 20].timestamp, value: 100 }] })
    const overlay = chart.getOverlayById(id)
    const Overlay = H.KC.getOverlayClass('fibonacciSegment')
    const template = new Overlay()
    const figures = template.createPointFigures({
      overlay,
      coordinates: [{ x: 100, y: 100 }, { x: 300, y: 300 }],
      precision: { price: 2, volume: 0 }
    })
    return figures.find((f: any) => f.type === 'text').attrs.map((a: any) => a.text)
  })
  expect(texts).toEqual(['200.00 (100.0%)', '178.60 (78.6%)', '161.80 (61.8%)', '150.00 (50.0%)', '138.20 (38.2%)', '123.60 (23.6%)', '100.00 (0.0%)'])
  expect(await pageErrors(page)).toEqual([])
})
