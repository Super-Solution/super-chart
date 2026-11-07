import { test, expect, openHarness, pageErrors } from './fixtures'

// Existing loader contracts, migrated to the owned workspace and chart data port.
const KIT = '/e2e/pages/loader-kit.js'

test('SC-016: a setSymbol during the initial load draws the final pair, and later changes still load', async ({ page }) => {
  await openHarness(page)
  const state = await page.evaluate(async (kit) => {
    const K = await import(kit)
    const { pro, feed } = K.mountDeferred()
    await K.until(() => feed.history.length === 1)
    pro.setSymbol({ ticker: 'ETH', pricePrecision: 2 })
    await K.until(() => feed.history.length === 2)
    feed.answer(1)
    await K.sleep(50)
    feed.answer(0) // the stale SUPER answer arrives last
    await K.until(() => feed.log.length === 1)
    await K.sleep(100)
    const chart = pro.chart
    const first = { shown: K.tickerShown(chart), symbol: pro.getSymbol().ticker }
    // It used to fetch nothing after this point: every later change was ignored.
    pro.setSymbol({ ticker: 'BTC', pricePrecision: 2 })
    await K.until(() => feed.history.length === 3)
    feed.answer(2)
    await K.until(() => K.tickerShown(chart) === 'BTC')
    pro.setPeriod({ multiplier: 1, timespan: 'day', text: 'D' })
    await K.until(() => feed.history.length === 4)
    feed.answer(3)
    await K.until(() => feed.log.length === 5)
    return { first, fetched: feed.fetched(), log: feed.log, shown: K.tickerShown(chart), period: pro.getPeriod().text }
  }, KIT)
  expect(state.first).toEqual({ shown: 'ETH', symbol: 'ETH' })
  expect(state.fetched).toEqual(['SUPER-USDT 1H', 'ETH 1H', 'BTC 1H', 'BTC D'])
  expect(state.log).toEqual(['sub ETH 1H', 'unsub ETH 1H', 'sub BTC 1H', 'unsub BTC 1H', 'sub BTC D'])
  expect(state.shown).toBe('BTC')
  expect(state.period).toBe('D')
  expect(await pageErrors(page)).toEqual([])
})

test('SC-016: setSymbol and setPeriod in the same tick load the final pair once', async ({ page }) => {
  await openHarness(page)
  const state = await page.evaluate(async (kit) => {
    const K = await import(kit)
    const { pro, feed } = K.mountDeferred({ periods: [{ multiplier: 1, timespan: 'hour', text: '1H' }, { multiplier: 4, timespan: 'hour', text: '4H' }] })
    await K.until(() => feed.history.length === 1)
    feed.answer(0)
    await K.until(() => feed.log.length === 1)
    pro.setSymbol({ ticker: 'ETH', pricePrecision: 2 })
    pro.setPeriod({ multiplier: 4, timespan: 'hour', text: '4H' })
    await K.until(() => feed.history.length === 2)
    await K.sleep(150)
    feed.answer(1)
    await K.until(() => feed.log.length === 3)
    return { fetched: feed.fetched(), log: feed.log, shown: K.tickerShown(pro.chart) }
  }, KIT)
  expect(state.fetched).toEqual(['SUPER-USDT 1H', 'ETH 4H'])
  expect(state.log).toEqual(['sub SUPER-USDT 1H', 'unsub SUPER-USDT 1H', 'sub ETH 4H'])
  expect(state.shown).toBe('ETH')
})

test('SC-016: two period clicks 50 ms apart and a third later all load; the last one is drawn', async ({ page }) => {
  await openHarness(page)
  const state = await page.evaluate(async (kit) => {
    const K = await import(kit)
    const periods = [{ multiplier: 1, timespan: 'hour', text: '1H' }, { multiplier: 4, timespan: 'hour', text: '4H' }, { multiplier: 1, timespan: 'day', text: 'D' }]
    const { pro, container, feed } = K.mountDeferred({ periods })
    await K.until(() => feed.history.length === 1)
    feed.answer(0)
    await K.until(() => feed.log.length === 1)
    const click = text => {
      const select = container.querySelector('select[aria-label="Interval"]')
      select.value = [...select.options].find(option => option.text === text).value
      select.dispatchEvent(new Event('change', { bubbles: true }))
    }
    click('4H')
    await K.sleep(50)
    click('D')
    await K.until(() => feed.history.length === 3)
    feed.answer(2)
    feed.answer(1)
    await K.until(() => feed.log.length === 3)
    click('1H')
    await K.until(() => feed.history.length === 4)
    feed.answer(3)
    await K.until(() => feed.log.length === 5)
    const list = pro.chart.dataPort.getDataList()
    return {
      fetched: feed.fetched(),
      step: list.at(-1).timestamp - list.at(-2).timestamp,
      selected: container.querySelector('select[aria-label="Interval"]').selectedOptions[0].textContent
    }
  }, KIT)
  expect(state.fetched).toEqual(['SUPER-USDT 1H', 'SUPER-USDT 4H', 'SUPER-USDT D', 'SUPER-USDT 1H'])
  expect(state.step).toBe(3_600_000)
  expect(state.selected).toBe('1H')
})

test('SC-016: a symbol change during a scroll-back load never mixes the two symbols', async ({ page }) => {
  await openHarness(page)
  const state = await page.evaluate(async (kit) => {
    const K = await import(kit)
    const { pro, feed } = K.mountDeferred()
    await K.until(() => feed.history.length === 1)
    feed.answer(0)
    await K.until(() => feed.log.length === 1)
    const chart = pro.chart
    K.scrollToStart(chart)
    await K.until(() => feed.history.length === 2)
    pro.setSymbol({ ticker: 'ETH', pricePrecision: 2 })
    await K.until(() => feed.history.length === 3)
    feed.answer(1) // the SUPER page arrives after the switch
    await K.sleep(100)
    feed.answer(2, 120)
    await K.until(() => feed.log.length === 3)
    await K.sleep(100)
    const list = chart.dataPort.getDataList()
    return { n: list.length, allEth: list.every(b => Math.abs(b.close / 3000 - 1) < 0.05), second: feed.history[1] }
  }, KIT)
  expect(state.n).toBe(120)
  expect(state.allEth).toBe(true)
})

test('SC-026: an identical setSymbol or setPeriod refetches nothing and keeps the view; "4h" selects 4H; a new priceCurrency refetches', async ({ page }) => {
  await openHarness(page)
  const state = await page.evaluate(async (kit) => {
    const K = await import(kit)
    const periods = [{ multiplier: 1, timespan: 'hour', text: '1H' }, { multiplier: 4, timespan: 'hour', text: '4H' }]
    const { pro, container, feed } = K.mountDeferred({ periods })
    await K.until(() => feed.history.length === 1)
    feed.answer(0)
    await K.until(() => feed.log.length === 1)
    const chart = pro.chart
    chart.view.setViewport({ i0: 150, i1: 250 }) // off the right edge, and not so far left that it pages back
    await K.sleep(50)
    const range = JSON.stringify(chart.view.getSnapshot().viewport)
    pro.setSymbol({ ticker: 'SUPER-USDT', pricePrecision: 2, volumePrecision: 0 })
    pro.setPeriod({ multiplier: 1, timespan: 'hour', text: '1H' })
    await K.sleep(150)
    const same = { fetches: feed.history.length, rangeKept: JSON.stringify(chart.view.getSnapshot().viewport) === range }
    pro.setPeriod('4h')
    await K.until(() => feed.history.length === 2)
    feed.answer(1)
    await K.until(() => feed.log.length === 3)
    const shorthand = { period: pro.getPeriod(), selected: container.querySelector('select[aria-label="Interval"]').selectedOptions[0].textContent }
    pro.setSymbol({ ticker: 'SUPER-USDT', pricePrecision: 2, volumePrecision: 0, priceCurrency: 'USD' })
    await K.until(() => feed.history.length === 3)
    return { same, shorthand, fetched: feed.fetched() }
  }, KIT)
  expect(state.same).toEqual({ fetches: 1, rangeKept: true })
  expect(state.shorthand).toEqual({ period: { multiplier: 4, timespan: 'hour', text: '4H' }, selected: '4H' })
  expect(state.fetched).toEqual(['SUPER-USDT 1H', 'SUPER-USDT 4H', 'SUPER-USDT 4H'])
})

test('SC-017 / SC-034: rejected loads expose error state and Retry; the next change and retry each fetch once', async ({ page }) => {
  await openHarness(page)
  const state = await page.evaluate(async (kit) => {
    const K = await import(kit)
    const { pro, container, feed } = K.mountDeferred()
    await K.until(() => feed.history.length === 1)
    feed.history[0].reject(new Error('feed down'))
    await K.until(() => pro.getStatus().state === 'error')
    const failed = { error: pro.getLoadState().error?.message, bars: pro.getBars().length }
    pro.setPeriod({ multiplier: 1, timespan: 'day', text: 'D' })
    await K.until(() => feed.history.length === 2)
    await K.sleep(100)
    const afterChange = feed.history.length
    feed.history[1].reject(new Error('still down'))
    await K.until(() => pro.getStatus().state === 'error')
    ;[...container.querySelectorAll('button')].find(button => button.textContent === 'Retry').click()
    await K.until(() => feed.history.length === 3)
    const loadingWhileRetrying = pro.getStatus().state === 'loading'
    feed.answer(2)
    await K.until(() => feed.log.length === 1)
    return { failed, afterChange, loadingWhileRetrying, fetched: feed.fetched(), recovered: { status: pro.getStatus().state, bars: pro.getBars().length } }
  }, KIT)
  expect(state.failed).toEqual({ error: 'feed down', bars: 0 })
  expect(state.afterChange).toBe(2)
  expect(state.loadingWhileRetrying).toBe(true)
  expect(state.fetched).toEqual(['SUPER-USDT 1H', 'SUPER-USDT D', 'SUPER-USDT D'])
  expect(state.recovered).toEqual({ status: 'ready', bars: 300 })
  expect(await pageErrors(page)).toEqual([])
})

test('SC-034: loading keeps market controls usable; empty history has an explicit empty state', async ({ page }) => {
  await openHarness(page)
  const state = await page.evaluate(async (kit) => {
    const K = await import(kit)
    const { pro, container, feed } = K.mountDeferred()
    await K.until(() => feed.history.length === 1)
    const loading = { status: pro.getStatus().state, intervalEnabled: !container.querySelector('select[aria-label="Interval"]').disabled }
    feed.history[0].resolve([])
    await pro.ready
    return { loading, empty: { status: pro.getStatus().state, bars: pro.getBars().length } }
  }, KIT)
  expect(state.loading).toEqual({ status: 'loading', intervalEnabled: true })
  expect(state.empty).toEqual({ status: 'empty', bars: 0 })
})

test('SC-034: live bars after empty history leave the empty state', async ({ page }) => {
  await openHarness(page)
  const state = await page.evaluate(async (kit) => {
    const K = await import(kit)
    const { pro, feed } = K.mountDeferred()
    await K.until(() => feed.history.length === 1)
    feed.history[0].resolve([])
    await K.until(() => pro.getStatus().state === 'empty')
    await K.until(() => feed.log.length === 1)
    const t0 = K.align(Date.now(), K.HOUR) - 2 * K.HOUR
    for (let i = 0; i < 3; i++) feed.tick({ timestamp: t0 + i * K.HOUR, open: 100, high: 103, low: 99, close: 100 + i, volume: 1 })
    await K.until(() => pro.getBars().length === 3)
    return { bars: pro.getBars().length, status: pro.getStatus().state }
  }, KIT)
  expect(state).toEqual({ bars: 3, status: 'ready' })
})

test('SC-019: week, month and year request ranges are forward and in range', async ({ page }) => {
  await openHarness(page)
  const state = await page.evaluate(async (kit) => {
    const K = await import(kit)
    const out = {}
    for (const period of [{ multiplier: 1, timespan: 'week', text: 'W' }, { multiplier: 1, timespan: 'month', text: 'M' }, { multiplier: 1, timespan: 'year', text: 'Y' }]) {
      const { feed } = K.mountDeferred({ period, periods: [period] })
      await K.until(() => feed.history.length === 1)
      const h = feed.history[0]
      out[period.text] = { from: new Date(h.from).toISOString(), forward: h.from <= h.to, toIsNow: Math.abs(h.to - Date.now()) < 60_000 }
    }
    return out
  }, KIT)
  const now = new Date()
  expect(state.W.forward && state.M.forward && state.Y.forward).toBe(true)
  expect(state.W.toIsNow && state.M.toIsNow && state.Y.toIsNow).toBe(true)
  // 500 weeks back is about 9.6 years (it was 1979); 500 calendar months back
  // from the first of a month; 500 years is before 1970 and clamps to 0.
  expect(state.W.from.slice(0, 7)).toBe(new Date(now.getTime() - 500 * 604_800_000).toISOString().slice(0, 7))
  expect(state.M.from).toBe(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 500, 1)).toISOString())
  expect(state.Y.from).toBe('1970-01-01T00:00:00.000Z')
})

test('SC-024: a feed that ignores the range adds no duplicates and paging stops; an exclusive-`to` feed misses no bar', async ({ page }) => {
  await openHarness(page)
  const state = await page.evaluate(async (kit) => {
    const K = await import(kit)
    // Range-ignoring: every request gets the same latest window.
    const a = K.mountDeferred()
    await K.until(() => a.feed.history.length === 1)
    const window = K.bars('SUPER-USDT', { multiplier: 1, timespan: 'hour' }, K.align(Date.now(), K.HOUR), 300)
    a.feed.history[0].resolve(window)
    await K.until(() => a.feed.log.length === 1)
    const chartA = a.pro.chart
    K.scrollToStart(chartA)
    await K.until(() => a.feed.history.length === 2)
    a.feed.history[1].resolve(window)
    await K.until(() => !a.pro.getLoadState().loadingMore)
    // Paging has stopped: scrolling to the start again asks for nothing.
    for (let i = 0; i < 3; i++) {
      K.scrollToStart(chartA)
      await K.frame()
      await K.sleep(100)
    }
    const tsA = chartA.dataPort.getDataList().map(b => b.timestamp)
    // Exclusive: bars strictly before `to`.
    const b = K.mountDeferred()
    await K.until(() => b.feed.history.length === 1)
    b.feed.answer(0, 300)
    await K.until(() => b.feed.log.length === 1)
    const chartB = b.pro.chart
    const first = chartB.dataPort.getDataList()[0].timestamp
    K.scrollToStart(chartB)
    await K.until(() => b.feed.history.length === 2)
    const h = b.feed.history[1]
    h.resolve(K.bars('SUPER-USDT', { multiplier: 1, timespan: 'hour' }, h.to - K.HOUR, 100))
    await K.until(() => chartB.dataPort.getDataList().length > 300)
    const tsB = chartB.dataPort.getDataList().map(b => b.timestamp)
    return {
      a: { total: tsA.length, unique: new Set(tsA).size, requests: a.feed.history.length },
      b: { to: h.to, first, total: tsB.length, missing: tsB.filter((t, i) => i > 0 && t - tsB[i - 1] !== K.HOUR).length }
    }
  }, KIT)
  expect(state.a.total).toBe(300)
  expect(state.a.unique).toBe(300)
  expect(state.a.requests).toBe(2) // the empty page ended paging
  expect(state.b.to).toBe(state.b.first)
  expect(state.b.total).toBe(400)
  expect(state.b.missing).toBe(0)
})

test('SC-001 / SC-029: a 30-tick burst is one updateDataBatch and retains the latest tick; an array updates both bars', async ({ page }) => {
  await openHarness(page)
  const state = await page.evaluate(async (kit) => {
    const K = await import(kit)
    const { pro, feed } = K.mountDeferred()
    await K.until(() => feed.history.length === 1)
    feed.answer(0)
    await K.until(() => feed.log.length === 1)
    const chart = pro.chart
    const calls = K.countCalls(chart, 'updateDataBatch')
    const last = chart.dataPort.getDataList().at(-1)
    await K.frame()
    for (let i = 0; i < 30; i++) feed.tick({ ...last, high: 130, close: 100 + i })
    const beforeFrame = calls.n
    await K.frame()
    await K.frame()
    const burst = { beforeFrame, passes: calls.n, close: chart.dataPort.getDataList().at(-1).close, n: chart.dataPort.getDataList().length }
    feed.tick([{ ...last, high: 113, close: 111.5 }, { ...last, timestamp: last.timestamp + K.HOUR, high: 113, close: 112 }])
    await K.frame()
    await K.frame()
    const list = chart.dataPort.getDataList()
    return { burst, array: { n: list.length, prev: list.at(-2).close, last: list.at(-1).close } }
  }, KIT)
  expect(state.burst).toEqual({ beforeFrame: 0, passes: 1, close: 129, n: 300 })
  expect(state.array).toEqual({ n: 301, prev: 111.5, last: 112 })
})

test('SC-006: a tick from a superseded subscription is not applied; dispose unsubscribes and applies no pending tick', async ({ page }) => {
  await openHarness(page)
  const state = await page.evaluate(async (kit) => {
    const K = await import(kit)
    const { pro, feed } = K.mountDeferred()
    await K.until(() => feed.history.length === 1)
    feed.answer(0)
    await K.until(() => feed.log.length === 1)
    const staleTick = feed.listeners[0]
    pro.setSymbol({ ticker: 'BBB', pricePrecision: 2 })
    await K.until(() => feed.history.length === 2)
    feed.answer(1)
    await K.until(() => feed.log.length === 3)
    const chart = pro.chart
    const last = chart.dataPort.getDataList().at(-1)
    staleTick({ ...last, close: 100 })
    staleTick({ ...last, timestamp: last.timestamp + K.HOUR, close: 100 })
    await K.frame()
    await K.frame()
    const stale = { shown: K.tickerShown(chart), n: chart.dataPort.getDataList().length }
    const calls = K.countCalls(chart, 'updateDataBatch')
    feed.tick({ ...last, close: 5100 })
    pro.dispose()
    await K.frame()
    await K.frame()
    return { stale, afterDispose: calls.n, log: feed.log }
  }, KIT)
  expect(state.stale).toEqual({ shown: 'BBB', n: 300 })
  expect(state.afterDispose).toBe(0)
  expect(state.log).toEqual(['sub SUPER-USDT 1H', 'unsub SUPER-USDT 1H', 'sub BBB 1H', 'unsub BBB 1H'])
})

test('SC-018 / SC-012: replay buffers live ticks, steps forward without a rebuild, and a symbol switch ends it', async ({ page }) => {
  await openHarness(page)
  const state = await page.evaluate(async (kit) => {
    const K = await import(kit)
    const { pro, feed } = K.mountDeferred()
    await K.until(() => feed.history.length === 1)
    feed.answer(0)
    await K.until(() => feed.log.length === 1)
    const chart = pro.chart, last = pro.getBars().at(-1)
    pro.startReplay(180)
    const inReplay = pro.getBars().length, head = pro.getBars().at(-1).timestamp
    feed.tick({ ...last, high: 152, close: 150 })
    feed.tick({ ...last, high: 152, timestamp: last.timestamp + K.HOUR, close: 151 })
    await K.frame(); await K.frame()
    const buffered = { n: pro.getBars().length, head: pro.getBars().at(-1).timestamp === head }
    const rebuilds = K.countCalls(chart, 'applyNewData')
    for (let i = 0; i < 5; i++) pro.stepReplay()
    const stepped = { rebuilds: rebuilds.n, n: pro.getBars().length }
    pro.exitReplay()
    const list = pro.getBars(), exited = { n: list.length, prev: list.at(-2).close, last: list.at(-1).close }
    pro.startReplay(180)
    pro.setSymbol({ ticker: 'ETH', pricePrecision: 2 })
    await K.until(() => feed.history.length === 2)
    const replayEnded = !pro.getReplayState().active
    feed.answer(1)
    await K.until(() => feed.log.length === 3)
    return { inReplay, buffered, stepped, exited, replayEnded, shown: K.tickerShown(chart), n: pro.getBars().length }
  }, KIT)
  expect(state.inReplay).toBe(181)
  expect(state.buffered).toEqual({ n: state.inReplay, head: true })
  expect(state.stepped).toEqual({ rebuilds: 0, n: state.inReplay + 5 })
  expect(state.exited).toEqual({ n: 301, prev: 150, last: 151 })
  expect(state.replayEnded).toBe(true)
  expect(state.shown).toBe('ETH')
  expect(state.n).toBe(300)
  expect(await pageErrors(page)).toEqual([])
})

test('SC-018: scroll-back during replay extends the replay, and exit keeps the older bars', async ({ page }) => {
  await openHarness(page)
  const state = await page.evaluate(async (kit) => {
    const K = await import(kit)
    const { pro, container, feed } = K.mountDeferred()
    await K.until(() => feed.history.length === 1)
    feed.answer(0, 300)
    await K.until(() => feed.log.length === 1)
    const chart = pro.chart
    pro.startReplay(180)
    await K.sleep(50)
    const head = chart.dataPort.getDataList().at(-1).timestamp
    K.scrollToStart(chart)
    await K.until(() => feed.history.length === 2)
    const h = feed.history[1]
    h.resolve(K.bars('SUPER-USDT', { multiplier: 1, timespan: 'hour' }, h.to - K.HOUR, 50))
    await K.until(() => chart.dataPort.getDataList().length > 181)
    const during = { n: chart.dataPort.getDataList().length, head: chart.dataPort.getDataList().at(-1).timestamp === head }
    pro.stepReplay()
    await K.sleep(50)
    const stepHead = chart.dataPort.getDataList().at(-1).timestamp - head
    pro.exitReplay()
    await K.sleep(50)
    const ts = chart.dataPort.getDataList().map(b => b.timestamp)
    return { during, stepHead, total: ts.length, contiguous: ts.every((t, i) => i === 0 || t - ts[i - 1] === K.HOUR) }
  }, KIT)
  expect(state.during).toEqual({ n: 181 + 50, head: true })
  expect(state.stepHead).toBe(3_600_000)
  expect(state.total).toBe(350)
  expect(state.contiguous).toBe(true)
})

test('SC-030: a tick after a gap is held, one backfill fills the hole, and the bars are contiguous', async ({ page }) => {
  await openHarness(page)
  const state = await page.evaluate(async (kit) => {
    const K = await import(kit)
    const { pro, feed } = K.mountDeferred()
    await K.until(() => feed.history.length === 1)
    const lastTs = K.align(Date.now(), K.HOUR) - 5 * K.HOUR // the feed is 5 hours behind
    // 300 bars fill the view, so the only request after the first is the backfill.
    feed.history[0].resolve(K.bars('SUPER-USDT', { multiplier: 1, timespan: 'hour' }, lastTs, 300))
    await K.until(() => feed.log.length === 1)
    const chart = pro.chart
    feed.tick({ timestamp: lastTs + 5 * K.HOUR, open: 100, high: 101, low: 99, close: 100.5, volume: 1 })
    await K.until(() => feed.history.length === 2)
    await K.frame()
    const held = chart.dataPort.getDataList().at(-1).timestamp === lastTs
    const h = feed.history[1]
    h.resolve(K.bars('SUPER-USDT', { multiplier: 1, timespan: 'hour' }, lastTs + 4 * K.HOUR, 300))
    await K.until(() => chart.dataPort.getDataList().at(-1).timestamp === lastTs + 5 * K.HOUR)
    const ts = chart.dataPort.getDataList().map(b => b.timestamp)
    return { held, from: h.from === lastTs, requests: feed.history.length, tail: ts.slice(-7).map(t => (t - lastTs) / K.HOUR), contiguous: ts.every((t, i) => i === 0 || t - ts[i - 1] === K.HOUR) }
  }, KIT)
  expect(state.held).toBe(true)
  expect(state.from).toBe(true)
  expect(state.requests).toBe(2)
  expect(state.tail).toEqual([-1, 0, 1, 2, 3, 4, 5])
  expect(state.contiguous).toBe(true)
})

test('SC-030: a feed whose own history has holes (a market that closes) gets no backfill; the bar after a gap is appended at once', async ({ page }) => {
  await openHarness(page)
  const state = await page.evaluate(async (kit) => {
    const K = await import(kit)
    const { pro, feed } = K.mountDeferred()
    await K.until(() => feed.history.length === 1)
    const hour = { multiplier: 1, timespan: 'hour' }
    const lastTs = K.align(Date.now(), K.HOUR) - 5 * K.HOUR
    // Closed for 10 hours overnight, and 5 hours behind now.
    feed.history[0].resolve([...K.bars('SUPER-USDT', hour, lastTs - 20 * K.HOUR, 200), ...K.bars('SUPER-USDT', hour, lastTs, 10)])
    await K.until(() => feed.log.length === 1)
    const chart = pro.chart
    feed.tick({ timestamp: lastTs + 5 * K.HOUR, open: 100, high: 101, low: 99, close: 100.5, volume: 1 })
    await K.until(() => chart.dataPort.getDataList().at(-1).timestamp === lastTs + 5 * K.HOUR, 3000, 'the bar after the gap appended')
    await K.sleep(100)
    return { requests: feed.history.length, n: chart.dataPort.getDataList().length }
  }, KIT)
  expect(state).toEqual({ requests: 1, n: 211 })
})
