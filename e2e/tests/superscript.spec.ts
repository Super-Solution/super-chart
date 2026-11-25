import { test, expect, openHarness, pageErrors } from './fixtures'

// Existing script behaviour migrated to the optional owned bridge. No pixel
// colour/legend-format assertions and no arbitrary-language engine registry.
const TWO_LINES = '// @overlay\nplot(sma(close, 5) * 1.03, title="Fast")\nplot(sma(close, 20) * 0.97, title="Slow")'

test('script lines and MA remain present whichever is created first (SC-002, SC-156)', async ({ page }) => {
  await openHarness(page)
  const state = await page.evaluate(async source => {
    const { H } = window as any, { createEngineScriptIndicator } = await import('/dist/scripts.js')
    const out = []
    for (const order of ['script-first', 'ma-first']) {
      const { pro } = H.mount({ chart: { chart: { indicators: [] } } })
      const chart = await H.ready(pro), script = createEngineScriptIndicator({ name: 'E2E_ORDER', source })
      let scriptId: string, maId: string
      if (order === 'script-first') { scriptId = script.attach(chart).id; maId = chart.addIndicator({ name: 'MA', params: [20] }) }
      else { maId = chart.addIndicator({ name: 'MA', params: [20] }); scriptId = script.attach(chart).id }
      let frame: any
      chart.addLayer({ update: (value: any) => { frame = value }, paint: () => {} })
      await H.sleep(80)
      const values = frame.inspect(frame.model.xPositions[frame.model.xPositions.length - 1]).indicators
      out.push({ script: Object.values(values[scriptId]).filter(Number.isFinite).length, ma: Object.values(values[maId]).filter(Number.isFinite).length })
    }
    return out
  }, TWO_LINES)
  expect(await pageErrors(page)).toEqual([])
  for (const result of state) {
    expect(result.script).toBe(2)
    expect(result.ma).toBeGreaterThan(0)
  }
})

test('a histogram grows from zero while a line remains available (SC-157, SC-156)', async ({ page }) => {
  await openHarness(page)
  const result = await page.evaluate(async () => {
    const { H } = window as any, { createEngineScriptIndicator } = await import('/dist/scripts.js')
    const script = createEngineScriptIndicator({ name: 'E2E_HIST', source: 'd = close - sma(close, 20)\nplot(d, title="Hist", type="histogram")\nplot(d * 0.5, title="Half")' })
    const { pro } = H.mount({ chart: { chart: { indicators: [] } } }), chart = await H.ready(pro)
    const attachment = script.attach(chart)
    let frame: any
    chart.addLayer({ update: (value: any) => { frame = value }, paint: () => {} })
    await H.sleep(80)
    const pane = frame.panes.find((item: any) => item.id === `indicator:${attachment.id}`), row = frame.inspect(frame.model.xPositions[frame.model.xPositions.length - 1]).indicators[attachment.id]
    return { base: script.definition.figures[0].base, zeroOnPane: pane.scale.y(0) >= pane.frame.model.geometry.top && pane.scale.y(0) <= pane.frame.model.geometry.bottom,
      histogram: row.p0, half: row.p1 }
  })
  expect(result.base).toBe(0)
  expect(result.zeroOnPane).toBe(true)
  expect(result.half).toBeCloseTo(result.histogram * 0.5, 8)
  expect(await pageErrors(page)).toEqual([])
})

test('non-finite script arithmetic keeps the axis finite and preserves gaps (SC-158)', async ({ page }) => {
  await openHarness(page)
  const state = await page.evaluate(async () => {
    const { H } = window as any, { createEngineScriptIndicator } = await import('/dist/scripts.js')
    const script = createEngineScriptIndicator({ name: 'E2E_INF_SS', source: '// @overlay\nplot(close + 1 / (bar_index % 50 - 7))' })
    const { pro } = H.mount(), chart = await H.ready(pro)
    script.attach(chart)
    let frame: any
    chart.addLayer({ update: (value: any) => { frame = value }, paint: () => {} })
    await H.sleep(80)
    const bars = pro.getBars(), rows = script.definition.calculate(bars, script.definition.params)
    return { y: frame.project(bars.at(-1).timestamp, bars.at(-1).close).y,
      nonFinite: rows.filter((row: any) => typeof row.p0 === 'number' && !Number.isFinite(row.p0)).length,
      gaps: rows.filter((row: any) => row.p0 === null).length }
  })
  expect(Number.isFinite(state.y)).toBe(true)
  expect(state.nonFinite).toBe(0)
  expect(state.gaps).toBeGreaterThan(0)
  expect(await pageErrors(page)).toEqual([])
})

test('script indicators retain their pane and receive symbol changes (SC-164, SC-165)', async ({ page }) => {
  await openHarness(page)
  const state = await page.evaluate(async () => {
    const { H } = window as any, { createEngineScriptIndicator } = await import('/dist/scripts.js')
    const { pro } = H.mount(), chart = await H.ready(pro)
    const script = createEngineScriptIndicator({ name: 'E2E_PRICE', source: 'plot(close)' }), attachment = script.attach(chart)
    let frame: any
    chart.addLayer({ update: (value: any) => { frame = value }, paint: () => {} })
    await H.sleep(80)
    const before = chart.listIndicators().find((item: any) => item.id === attachment.id)
    await pro.setSymbol({ ticker: 'NEXT', pricePrecision: 5 })
    await H.sleep(80)
    return { before, after: chart.listIndicators().find((item: any) => item.id === attachment.id), value: frame.inspect(frame.model.xPositions[frame.model.xPositions.length - 1]).indicators[attachment.id].p0, close: pro.getBars().at(-1).close }
  })
  expect(state.after).toEqual(state.before)
  expect(state.value).toBe(state.close)
  expect(await pageErrors(page)).toEqual([])
})

test('script inputs change an indicator in place and invalid source leaves it alone (SC-165, SC-166)', async ({ page }) => {
  await openHarness(page)
  const state = await page.evaluate(async () => {
    const { H } = window as any, { createEngineScriptIndicator } = await import('/dist/scripts.js')
    const { pro } = H.mount(), chart = await H.ready(pro)
    const script = createEngineScriptIndicator({ name: 'E2E_LEN', source: 'len = input(3, title="Length", minval=1)\nplot(sma(close, len))' })
    const attachment = script.attach(chart)
    let frame: any
    chart.addLayer({ update: (value: any) => { frame = value }, paint: () => {} })
    await H.sleep(80)
    const bars = pro.getBars(), mean = (n: number) => bars.slice(-n).reduce((sum: number, bar: any) => sum + bar.close, 0) / n
    const read = () => frame.inspect(frame.model.xPositions[frame.model.xPositions.length - 1]).indicators[attachment.id].p0
    const d3 = [chart.listIndicators().find((item: any) => item.id === attachment.id).params, read(), mean(3)]
    let invalid = 'none'
    try { createEngineScriptIndicator({ name: 'E2E_LEN', source: 'plot(nope)' }) } catch (error) { invalid = (error as Error).name }
    const afterInvalid = read()
    attachment.setParams([10]); await H.sleep(80)
    const d10 = [read(), mean(10)]
    const set = attachment.setParams({ len: 20 }); await H.sleep(80)
    const d20 = [set, read(), mean(20)]
    return { d3, d10, d20, invalid, afterInvalid, id: attachment.id, ids: chart.listIndicators().map((item: any) => item.id), schema: script.inputs }
  })
  expect(state.invalid).toBe('SuperScriptError')
  expect(state.afterInvalid).toBe(state.d3[1])
  expect(state.ids).toContain(state.id)
  expect(state.d3[0]).toEqual([3])
  expect(state.d3[1]).toBeCloseTo(state.d3[2], 8)
  expect(state.d10[0]).toBeCloseTo(state.d10[1], 8)
  expect(state.d20[0]).toEqual([20])
  expect(state.d20[1]).toBeCloseTo(state.d20[2], 8)
  expect(state.schema).toEqual([{ id: 'len', title: 'Length', defval: 3, min: 1, type: 'int' }])
  expect(await pageErrors(page)).toEqual([])
})

test('a script cannot take a builtin name; only SuperScript is evaluated (SC-139)', async ({ page }) => {
  await openHarness(page)
  const state = await page.evaluate(async () => {
    const { H } = window as any, { createEngineScriptIndicator } = await import('/dist/scripts.js')
    const { pro } = H.mount(), chart = await H.ready(pro)
    let rejected = false
    try { createEngineScriptIndicator({ name: 'RSI', source: 'plot(close)' }).attach(chart) } catch { rejected = true }
    const id = chart.addIndicator({ name: 'RSI' })
    let javascriptRejected = false
    try { createEngineScriptIndicator({ name: 'JS', source: 'globalThis.alert("arbitrary JavaScript")' }) } catch { javascriptRejected = true }
    return { rejected, name: chart.listIndicators().find((item: any) => item.id === id).name, javascriptRejected }
  })
  expect(state.rejected).toBe(true)
  expect(state.name).toBe('RSI')
  expect(state.javascriptRejected).toBe(true)
  expect(await pageErrors(page)).toEqual([])
})

test('buildChartContext sends the bars on screen, including zoomed-out buckets (SC-137)', async ({ page }) => {
  await openHarness(page)
  const state = await page.evaluate(async () => {
    const { H } = window as any, { buildChartContext } = await import('/dist/superscript.js')
    const { pro } = H.mount(), chart = await H.ready(pro)
    const parts = { chart: { getDataList: () => pro.getBars(), getVisibleRange: () => { const v = chart.view.getSnapshot().viewport; return { from: Math.floor(v.i0), to: Math.ceil(v.i1) + 1 } } }, symbol: pro.getSymbol(), period: pro.getPeriod() }
    chart.view.setViewport({ i0: 100, i1: 199 })
    const ctx = buildChartContext(parts), bars = pro.getBars()
    chart.view.setViewport({ i0: 0, i1: bars.length - 1 })
    const zoomed = buildChartContext(parts, { maxBars: 100 })
    return { got: [ctx.bars[0].timestamp, ctx.bars.at(-1).timestamp], want: [bars[100].timestamp, bars[199].timestamp], newest: bars.at(-1).timestamp,
      symbol: ctx.symbol, period: ctx.period, bucket: ctx.format.bucket, zoomed: { rows: zoomed.bars.length, bucket: zoomed.format.bucket, first: zoomed.bars[0].timestamp, firstVisible: bars[0].timestamp, lastClose: zoomed.bars.at(-1).close, lastVisibleClose: bars.at(-1).close } }
  })
  expect(state.got).toEqual(state.want)
  expect(state.got[1]).toBeLessThan(state.newest)
  expect([state.symbol, state.period, state.bucket]).toEqual(['SUPER-USDT', '1H', 1])
  expect(state.zoomed.rows).toBeLessThanOrEqual(100)
  expect(state.zoomed.bucket).toBeGreaterThan(1)
  expect(state.zoomed.first).toBe(state.zoomed.firstVisible)
  expect(state.zoomed.lastClose).toBe(state.zoomed.lastVisibleClose)
  expect(await pageErrors(page)).toEqual([])
})

test('SupWallet StudioChart scripts run on the owned chart (SC-002)', async ({ page }) => {
  await openHarness(page)
  const result = await page.evaluate(async () => {
    const { H } = window as any, { createEngineScriptIndicator } = await import('/dist/scripts.js')
    const { pro } = H.mount(), chart = await H.ready(pro)
    const cross = createEngineScriptIndicator({ name: 'SUPER_SMACROSS', source: '// @title SuperScript SMA Cross\nfast = sma(close, 10)\nslow = sma(close, 30)\nplot(fast, title="Fast 10", color="#2962ff")\nplot(slow, title="Slow 30", color="#ff9800")' })
    const rsi = createEngineScriptIndicator({ name: 'SUPER_RSI', source: '// @title SuperScript RSI\nplot(rsi(close, 14), title="RSI 14", color="#ab47bc")' })
    const first = cross.attach(chart, { pane: 'price' }), second = rsi.attach(chart)
    let frame: any
    chart.addLayer({ update: (value: any) => { frame = value }, paint: () => {} })
    await H.sleep(80)
    const row = frame.inspect(frame.model.xPositions[frame.model.xPositions.length - 1]).indicators
    return { first: Object.values(row[first.id]), second: Object.values(row[second.id]) }
  })
  expect(result.first.filter(Number.isFinite).length).toBe(2)
  expect(result.second.filter(Number.isFinite).length).toBe(1)
  expect(await pageErrors(page)).toEqual([])
})