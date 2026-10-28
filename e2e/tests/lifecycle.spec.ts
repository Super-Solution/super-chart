import { test, expect, openHarness, pageErrors } from './fixtures'

// Chart lifecycle and the public API's guards: SC-005, SC-037, SC-131.
// Also runs on klinecharts 9.1.1 (project kc-9.1.1), the only version on which
// the SC-005 dispose bug shows (see playwright.config.ts).

test('dispose empties the container, and a remount leaves exactly one chart (10 cycles)', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const { pro, container } = H.mount({ id: 'cycle' })
    await H.ready(pro)
    const canvasesFirst = container.querySelectorAll('canvas').length
    pro.dispose()
    const afterDispose = {
      children: container.childElementCount,
      className: container.className,
      theme: container.getAttribute('data-theme'),
      headless: container.getAttribute('data-headless')
    }
    const cycles: Array<{ widgets: number, canvases: number }> = []
    for (let i = 0; i < 10; i++) {
      const again = new H.SC.SuperChart({
        container,
        symbol: { ticker: 'SUPER-USDT', pricePrecision: 2 },
        period: { multiplier: 1, timespan: 'hour', text: '1H' },
        datafeed: H.makeDatafeed().datafeed,
        subIndicators: ['VOL'],
        mainIndicators: []
      })
      await H.ready(again)
      cycles.push({ widgets: container.querySelectorAll('.klinecharts-pro-widget').length, canvases: container.querySelectorAll('canvas').length })
      again.dispose()
    }
    return { canvasesFirst, afterDispose, cycles, left: container.childElementCount }
  })
  expect(state.afterDispose).toEqual({ children: 0, className: 'chart', theme: null, headless: null })
  expect(state.cycles.every(c => c.widgets === 1 && c.canvases === state.canvasesFirst), JSON.stringify(state.cycles)).toBe(true)
  expect(state.left).toBe(0)
  expect(await pageErrors(page)).toEqual([])
})

test('after dispose every method throws ChartDisposedError; dispose is idempotent', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const { pro } = H.mount()
    await H.ready(pro)
    const disposedBefore = pro.isDisposed()
    pro.dispose()
    const calls: Array<[string, unknown[]]> = [
      ['setTheme', ['dark']], ['getTheme', []], ['setStyles', [{}]], ['getStyles', []], ['setLocale', ['en-US']],
      ['getLocale', []], ['setTimezone', ['Etc/UTC']], ['getTimezone', []], ['setSymbol', [{ ticker: 'X' }]],
      ['getSymbol', []], ['setPeriod', [{ multiplier: 1, timespan: 'day', text: 'D' }]], ['getPeriod', []], ['reload', []],
      ['describe', []]
    ]
    const thrown = calls.map(([name, args]) => {
      try { pro[name](...args); return { name, error: 'none' } } catch (e: any) {
        return { name, error: e.name, code: e.code, isClass: e instanceof H.SC.ChartDisposedError, mentions: String(e.message).includes(name) }
      }
    })
    let second = 'ok'
    try { pro.dispose() } catch (e) { second = String(e) }
    return { disposedBefore, thrown, chart: pro.getChart(), disposed: pro.isDisposed(), second }
  })
  expect(state.disposedBefore).toBe(false)
  for (const t of state.thrown) {
    expect(t, t.name).toEqual({ name: t.name, error: 'ChartDisposedError', code: 'DISPOSED', isClass: true, mentions: true })
  }
  expect(state.chart).toBeNull()
  expect(state.disposed).toBe(true)
  expect(state.second).toBe('ok')
})

test('an unknown theme or chart type is refused at runtime (JSON callers bypass the types)', async ({ page, kc }) => {
  await openHarness(page, kc)
  const warnings: string[] = []
  page.on('console', m => { if (m.type() === 'warning') warnings.push(m.text()) })
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const bad = H.mount({ chart: { theme: 'drak', chartType: 'lin' } })
    const chart = await H.ready(bad.pro)
    const fromCtor = { theme: bad.pro.getTheme(), attr: bad.container.getAttribute('data-theme'), candle: chart.getStyles().candle.type }
    const good = H.mount({ chart: { theme: 'dark' } })
    await H.ready(good.pro)
    good.pro.setTheme('drak')
    return { fromCtor, afterBadSet: { theme: good.pro.getTheme(), attr: good.container.getAttribute('data-theme') } }
  })
  expect(state.fromCtor).toEqual({ theme: 'light', attr: 'light', candle: 'candle_solid' })
  expect(state.afterBadSet).toEqual({ theme: 'dark', attr: 'dark' })
  expect(warnings.filter(w => w.includes('[super-chart] unknown')).length).toBe(3)
})

test('a teardown that throws still empties the container and leaves the chart disposed', async ({ page, kc }) => {
  // UMD build: its klinecharts is the `klinecharts` global, so the spec can make
  // klinecharts' own dispose() throw (as 9.1.1's did for an element).
  await openHarness(page, kc, 'umd')
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const { pro, container } = H.mount()
    await H.ready(pro)
    const original = H.KC.dispose
    H.KC.dispose = () => { throw new Error('teardown boom') }
    let first = 'none'
    try { pro.dispose() } catch (e) { first = String((e as Error).message) } finally { H.KC.dispose = original }
    let second = 'none'
    try { pro.dispose() } catch (e) { second = String(e) }
    let after = 'none'
    try { pro.getSymbol() } catch (e) { after = (e as Error).name }
    return { first, second, after, disposed: pro.isDisposed(), children: container.childElementCount, klass: container.classList.contains('klinecharts-pro') }
  })
  expect(state).toEqual({ first: 'teardown boom', second: 'none', after: 'ChartDisposedError', disposed: true, children: 0, klass: false })
})
