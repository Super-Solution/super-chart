import { test, expect, openHarness, pageErrors } from './fixtures'

// Existing period and realtime interaction contracts using the owned controls.
test('a period-bar click changes the period and loads that period', async ({ page }) => {
  await openHarness(page)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const { pro, container, feed } = H.mount()
    await H.ready(pro)
    const interval = container.querySelector('select[aria-label="Interval"]') as HTMLSelectElement
    interval.value = [...interval.options].find(option => option.text === 'D')!.value
    interval.dispatchEvent(new Event('change', { bubbles: true }))
    // The subscription follows the history request once its data is applied.
    for (let i = 0; i < 40 && feed.calls.subscribe.at(-1)?.period.timespan !== 'day'; i++) await H.sleep(50)
    return {
      period: pro.getPeriod(),
      requested: feed.calls.history.at(-1)?.period,
      resubscribed: feed.calls.subscribe.at(-1)?.period,
      selected: (container.querySelector('select[aria-label="Interval"]') as HTMLSelectElement).selectedOptions[0].textContent
    }
  })
  expect(state.period).toMatchObject({ multiplier: 1, timespan: 'day', text: 'D' })
  expect(state.requested).toMatchObject({ timespan: 'day' })
  expect(state.resubscribed).toMatchObject({ timespan: 'day' })
  expect(state.selected).toBe('D')
})

test('a realtime tick from datafeed.subscribe reaches the chart', async ({ page }) => {
  await openHarness(page)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const { pro, feed } = H.mount()
    const chart = await H.ready(pro)
    for (let i = 0; i < 40 && feed.calls.subscribe.length === 0; i++) await H.sleep(50)
    const last = chart.dataPort.getDataList().at(-1)
    const count = chart.dataPort.getDataList().length
    feed.tick({ ...last, close: 4321.5, high: Math.max(last.high, 4321.5) })
    feed.tick({ timestamp: last.timestamp + 3_600_000, open: 4321.5, high: 4400, low: 4300, close: 4350, volume: 10 })
    await H.sleep(100)
    const list = chart.dataPort.getDataList()
    return { before: count, after: list.length, updatedClose: list.at(-2).close, newClose: list.at(-1).close }
  })
  expect(state.after).toBe(state.before + 1)
  expect(state.updatedClose).toBe(4321.5)
  expect(state.newClose).toBe(4350)
})

test('the Fibonacci retracement draws the standard levels', async ({ page }) => {
  await openHarness(page)
  const levels = await page.evaluate(async () => {
    const { H } = window as any
    const { pro } = H.mount()
    const chart = await H.ready(pro)
    const bars = pro.getBars()
    const drawing = chart.drawings.add({ id: 'fib', type: 'fibonacci', anchors: [{ timestamp: bars.at(-80).timestamp, price: 200 }, { timestamp: bars.at(-20).timestamp, price: 100 }] })
    const geometry = H.SC.projectDrawing(drawing, (timestamp: number, price: number) => ({ x: timestamp === drawing.anchors[0].timestamp ? 100 : 300, y: 300 - price }), { left: 0, top: 0, right: 400, bottom: 400 })
    // Retain the original case's two-decimal numeric precision. Owned figures
    // enumerate 0% -> 100%; as before, 100% belongs to the first anchor (200).
    return geometry.primitives.filter((item: any) => item.kind === 'text').map((item: any) => Number(item.price.toFixed(2)))
  })
  expect(levels).toEqual([100, 123.6, 138.2, 150, 161.8, 178.6, 200])
  expect(await pageErrors(page)).toEqual([])
})
