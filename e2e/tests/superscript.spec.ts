import { test, expect, openHarness, pageErrors } from './fixtures'
import type { Page } from '@playwright/test'

// SuperScript on the chart (batch 03), on every klinecharts version a host
// runs: script lines render with MA and the grid in either creation order
// (SC-002/SC-156), histograms grow from zero in the author's colour (SC-157),
// non-finite values keep the axis finite (SC-158), legends read "Title: value"
// with the right precision (SC-164), updateScriptIndicator changes an
// indicator in place (SC-165), inputs are calcParams (SC-166), and built-in
// names cannot be taken over (SC-139).

/**
 * Installs window.px(chart, paneId, color, tol): pixels of that CSS colour in a
 * pane's main canvases (alpha at least half the colour's own).
 */
async function installPixelCounter (page: Page): Promise<void> {
  await page.evaluate(() => {
    const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!
    const rgba = (color: string): number[] => {
      probe.clearRect(0, 0, 1, 1)
      probe.fillStyle = color
      probe.fillRect(0, 0, 1, 1)
      return [...probe.getImageData(0, 0, 1, 1).data]
    }
    (window as any).px = (chart: any, paneId: string, color: string, tol = 40): number => {
      const [r, g, b, a] = rgba(color)
      let n = 0
      for (const canvas of chart.getDom(paneId, 'main').querySelectorAll('canvas')) {
        const c = canvas as HTMLCanvasElement
        const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
        for (let i = 0; i < data.length; i += 4) {
          if (Math.abs(data[i] - r) < tol && Math.abs(data[i + 1] - g) < tol && Math.abs(data[i + 2] - b) < tol && data[i + 3] >= a / 2) n++
        }
      }
      return n
    }
  })
}

// Offset from MA5/MA20 so neither indicator hides the other's pixels.
const TWO_LINES = [
  '// @title Two lines',
  '// @overlay',
  'plot(sma(close, 5) * 1.03, title="Fast", color="#ff00ff", lineWidth=2)',
  'plot(sma(close, 20) * 0.97, title="Slow", color="#00e5ff", lineWidth=2)'
].join('\n')

test('script lines draw with MA and the grid, whichever is created first (SC-002, SC-156)', async ({ page, kc }) => {
  await openHarness(page, kc)
  await installPixelCounter(page)
  const state = await page.evaluate(async (source) => {
    const { H } = window as any
    const px = (window as any).px
    H.SC.registerScriptIndicator({ name: 'E2E_ORDER', source })
    const measure = async (order: 'ma-only' | 'script-first' | 'ma-first'): Promise<Record<string, number>> => {
      const { pro } = H.mount({ chart: { mainIndicators: [], subIndicators: [] } })
      const chart = await H.ready(pro)
      const styles = chart.getStyles()
      const ma = styles.indicator.lines[0].color as string
      const grid = styles.grid.horizontal.color as string
      if (order === 'script-first') chart.createIndicator('E2E_ORDER', true, { id: 'candle_pane' })
      chart.createIndicator('MA', true, { id: 'candle_pane' })
      if (order === 'ma-first') chart.createIndicator('E2E_ORDER', true, { id: 'candle_pane' })
      await H.sleep(400)
      return {
        ma: px(chart, 'candle_pane', ma, 12),
        grid: px(chart, 'candle_pane', grid, 6),
        fast: px(chart, 'candle_pane', '#ff00ff'),
        slow: px(chart, 'candle_pane', '#00e5ff')
      }
    }
    return { maOnly: await measure('ma-only'), scriptFirst: await measure('script-first'), maFirst: await measure('ma-first') }
  }, TWO_LINES)
  expect(await pageErrors(page)).toEqual([])
  for (const order of ['scriptFirst', 'maFirst'] as const) {
    const s = state[order]
    expect(s.fast, `${order}: Fast line pixels`).toBeGreaterThan(300)
    expect(s.slow, `${order}: Slow line pixels`).toBeGreaterThan(300)
    // The MA lines and the grid are drawn after a script too (9.8.12 used to stop the pane's draw at the script).
    expect(s.ma, `${order}: MA pixels vs MA alone (${state.maOnly.ma})`).toBeGreaterThan(state.maOnly.ma * 0.7)
    expect(s.grid, `${order}: grid pixels vs MA alone (${state.maOnly.grid})`).toBeGreaterThan(state.maOnly.grid * 0.7)
  }
})

test('a histogram grows from zero in the author\'s colour; a line after it keeps its colour (SC-157, SC-156)', async ({ page, kc }) => {
  // This phase put the largest negative bar outside the 9.7.2 canvas in CI.
  // Fix Date only: animation and paint timers must keep running.
  await page.clock.setFixedTime('2026-10-11T10:26:00Z')
  await openHarness(page, kc)
  await installPixelCounter(page)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const px = (window as any).px
    H.SC.registerScriptIndicator({
      name: 'E2E_HIST',
      source: [
        'd = close - sma(close, 20)',
        'plot(d, title="Hist", color="#ff0000", type="histogram")',
        'plot(d * 0.5, title="Half", color="#00ff00", lineWidth=2)'
      ].join('\n')
    })
    const { pro } = H.mount({ chart: { mainIndicators: [], subIndicators: [] } })
    const chart = await H.ready(pro)
    const paneId = chart.createIndicator('E2E_HIST', false)
    await H.sleep(400)
    const ind = chart.getIndicatorByPaneId(paneId, 'E2E_HIST')
    const result: Array<Record<string, number>> = ind.result
    const dl = chart.getDataList()
    const range = chart.getVisibleRange()
    const canvases = [...chart.getDom(paneId, 'main').querySelectorAll('canvas')] as HTMLCanvasElement[]
    if (canvases.length === 0) throw new Error('histogram pane has no canvas')
    const width = Math.min(...canvases.map(c => c.width))
    const x = (dataIndex: number): number => Math.round(chart.convertToPixel({ dataIndex, value: 0 }, { paneId }).x)
    // The range (even realFrom) can include clipped bar centres. Choose by
    // geometry, never by finding coloured pixels: missing bars must still fail.
    let neg = -1
    let pos = -1
    for (let i = Math.max(0, range.from); i < Math.min(range.to, dl.length); i++) {
      const v = result[i]?.p0
      const column = x(i)
      if (!Number.isFinite(v) || !Number.isFinite(column) || column < 0 || column >= width) continue
      if (v < 0 && (neg < 0 || v < result[neg].p0)) neg = i
      if (v > 0 && (pos < 0 || v > result[pos].p0)) pos = i
    }
    if (neg < 0 || pos < 0) throw new Error('histogram fixture needs sampleable negative and positive bars')
    const y = (dataIndex: number, value: number): number => chart.convertToPixel({ dataIndex, value }, { paneId }).y
    const redSpan = (dataIndex: number): number[] => {
      const column = x(dataIndex)
      let lo = Infinity
      let hi = -Infinity
      for (const c of canvases) {
        const data = c.getContext('2d')!.getImageData(column, 0, 1, c.height).data
        for (let yy = 0; yy < c.height; yy++) {
          const k = yy * 4
          if (data[k] > 200 && data[k + 1] < 60 && data[k + 2] < 60 && data[k + 3] > 200) { lo = Math.min(lo, yy); hi = Math.max(hi, yy) }
        }
      }
      return [lo, hi]
    }
    return {
      dpr: window.devicePixelRatio,
      range,
      negIndex: neg,
      negX: x(neg),
      posX: x(pos),
      width,
      paneHeight: chart.getDom(paneId, 'main').getBoundingClientRect().height,
      zero: y(neg, 0),
      negValue: y(neg, result[neg].p0),
      posValue: y(pos, result[pos].p0),
      neg: redSpan(neg),
      pos: redSpan(pos),
      red: px(chart, paneId, '#ff0000', 30),
      green: px(chart, paneId, '#00ff00', 30),
      figures: ind.figures.map((f: any) => [f.type, f.baseValue ?? null])
    }
  })
  expect(await pageErrors(page)).toEqual([])
  expect(state.dpr).toBe(1)
  expect(state.negX).toBeGreaterThanOrEqual(0)
  expect(state.negX).toBeLessThan(state.width)
  expect(state.posX).toBeGreaterThanOrEqual(0)
  expect(state.posX).toBeLessThan(state.width)
  expect(state.figures).toEqual([['bar', 0], ['line', null]])
  // Negative bar: from the zero line down to its value, not from the pane bottom.
  expect(Math.abs(state.neg[0] - state.zero), `negative bar starts at 0 (${JSON.stringify(state)})`).toBeLessThanOrEqual(2)
  expect(Math.abs(state.neg[1] - state.negValue), 'negative bar ends at its value').toBeLessThanOrEqual(2)
  // Positive bar: from its value down to the zero line, not to the pane bottom.
  expect(Math.abs(state.pos[0] - state.posValue), 'positive bar starts at its value').toBeLessThanOrEqual(2)
  expect(Math.abs(state.pos[1] - state.zero), 'positive bar ends at 0').toBeLessThanOrEqual(2)
  expect(state.pos[1]).toBeLessThan(state.paneHeight - 3)
  expect(state.red, 'bars in the script\'s colour').toBeGreaterThan(300)
  expect(state.green, 'the line after the histogram keeps its own colour').toBeGreaterThan(200)
})

test('NaN and ±Infinity from a script keep the axis finite and the candles drawn (SC-158)', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    // A language that returns non-finite numbers directly (the bridge's own guard),
    // and a SuperScript division by zero (the language's guard).
    H.SC.registerLanguage({
      id: 'e2e-nonfinite',
      name: 'X',
      compile: () => ({
        meta: { title: 'X' },
        run: (bars: any[]) => ({ meta: { title: 'X' }, plots: [{ id: 'p0', title: 'x', values: bars.map((b, i) => (i % 50 === 7 ? Infinity : i % 50 === 9 ? NaN : i % 50 === 11 ? -Infinity : b.close)) }] })
      })
    })
    H.SC.registerScriptIndicator({ name: 'E2E_INF_LANG', source: '', language: 'e2e-nonfinite' })
    H.SC.registerScriptIndicator({ name: 'E2E_INF_SS', source: '// @overlay\nplot(close + 1 / (bar_index % 50 - 7))' })
    const { pro } = H.mount({ chart: { mainIndicators: [], subIndicators: [] } })
    const chart = await H.ready(pro)
    chart.createIndicator('E2E_INF_LANG', true, { id: 'candle_pane' })
    chart.createIndicator('E2E_INF_SS', true, { id: 'candle_pane' })
    const sub = chart.createIndicator('E2E_INF_LANG', false)
    await H.sleep(400)
    const dl = chart.getDataList()
    const last = dl.length - 1
    const ys = [
      chart.convertToPixel({ dataIndex: last, value: dl[last].close }, { paneId: 'candle_pane' }).y,
      chart.convertToPixel({ dataIndex: last, value: dl[last].close }, { paneId: sub }).y
    ]
    const values = (chart.getIndicatorByPaneId('candle_pane', 'E2E_INF_LANG').result as Array<Record<string, unknown>>).map(r => r.p0)
    return { ys, nonFinite: values.filter(v => typeof v === 'number' && !Number.isFinite(v)).length, gaps: values.filter(v => v === undefined).length }
  })
  expect(await pageErrors(page)).toEqual([])
  for (const y of state.ys) expect(Number.isFinite(y), `candle close converts to a finite y (${JSON.stringify(state.ys)})`).toBe(true)
  expect(state.nonFinite).toBe(0)
  expect(state.gaps).toBeGreaterThan(0)
})

test('legends read "Title: value" in price precision for an overlay, 2 decimals below (SC-164)', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    // StudioChart's SUPER_SMACROSS (+ // @overlay) and SUPER_RSI, on a ~64k market.
    H.SC.registerScriptIndicator({
      name: 'E2E_SMACROSS',
      source: '// @title SuperScript SMA Cross\n// @overlay\nfast = sma(close, 10)\nslow = sma(close, 30)\nplot(fast, title="Fast 10", color="#2962ff")\nplot(slow, title="Slow 30", color="#ff9800")'
    })
    H.SC.registerScriptIndicator({ name: 'E2E_RSI', source: '// @title SuperScript RSI\nplot(rsi(close, 14), title="RSI 14", color="#ab47bc")' })
    const texts: string[] = []
    const fill = CanvasRenderingContext2D.prototype.fillText
    CanvasRenderingContext2D.prototype.fillText = function (text: string, x: number, y: number, w?: number) {
      texts.push(String(text))
      return w === undefined ? fill.call(this, text, x, y) : fill.call(this, text, x, y, w)
    }
    const container = document.createElement('div')
    container.className = 'chart'
    document.getElementById('charts')!.appendChild(container)
    const chart = H.KC.init(container)
    // 3, not 2: a price-precision legend must be told apart from the 2-decimal default.
    chart.setPriceVolumePrecision(3, 0)
    chart.applyNewData(Array.from({ length: 300 }, (_, i) => {
      const c = 64_000 + 400 * Math.sin(i / 9) + 150 * Math.sin(i / 2.7)
      return { timestamp: 1_700_000_000_000 + i * 3_600_000, open: c - 20, high: c + 60, low: c - 60, close: c, volume: 10 }
    }))
    chart.createIndicator('E2E_SMACROSS', true, { id: 'candle_pane' })
    const rsiPane = chart.createIndicator('E2E_RSI')
    await H.sleep(400)
    // klinecharts 9.8 gives a 'price' indicator the chart's precision when it is
    // created; 9.7 only when the host next sets it (the Pro does on every symbol change).
    const atCreate = chart.getIndicatorByPaneId('candle_pane', 'E2E_SMACROSS').precision
    chart.setPriceVolumePrecision(3, 0)
    texts.length = 0
    chart.resize()
    await H.sleep(300)
    CanvasRenderingContext2D.prototype.fillText = fill
    const series = [chart.getIndicatorByPaneId('candle_pane', 'E2E_SMACROSS'), chart.getIndicatorByPaneId(rsiPane, 'E2E_RSI')].map((i: any) => [i.series, i.precision])
    const after = (title: string): string | undefined => texts[texts.indexOf(title) + 1]
    return { atCreate, texts: texts.slice(0, 80), fast: after('Fast 10: '), slow: after('Slow 30: '), rsi: after('RSI 14: '), series, glued: texts.some(t => /^(Fast 10|Slow 30|RSI 14)\d/.test(t)) }
  })
  expect(await pageErrors(page)).toEqual([])
  expect(state.glued).toBe(false)
  expect(state.fast, JSON.stringify(state.texts)).toMatch(/^6[34],?\d{3}\.\d{3}$/)
  expect(state.slow).toMatch(/^6[34],?\d{3}\.\d{3}$/)
  expect(state.rsi).toMatch(/^\d{1,3}\.\d{2}$/)
  expect(state.series).toEqual([['price', 3], ['normal', 2]])
  if (kc === '9.8.12') expect(state.atCreate, 'price precision at creation').toBe(3)
})

test('updateScriptIndicator moves a script between its own precision and the price precision, and symbol changes still reach it (SC-164, SC-165)', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const SUB = '// @title P\nplot(close, title="Close")'
    const OVERLAY = '// @title P\n// @overlay\nplot(close, title="Close")'
    H.SC.registerScriptIndicator({ name: 'E2E_PREC', source: SUB })
    const container = document.createElement('div')
    container.className = 'chart'
    document.getElementById('charts')!.appendChild(container)
    const chart = H.KC.init(container)
    chart.setPriceVolumePrecision(3, 0)
    chart.applyNewData(Array.from({ length: 200 }, (_, i) => {
      const c = 64_000 + 400 * Math.sin(i / 9) + 0.123456 * i
      return { timestamp: 1_700_000_000_000 + i * 3_600_000, open: c - 20, high: c + 60, low: c - 60, close: c, volume: 10 }
    }))
    const paneId = chart.createIndicator('E2E_PREC')
    await H.sleep(300)
    const read = (): [string, number] => { const i = chart.getIndicatorByPaneId(paneId, 'E2E_PREC'); return [i.series, i.precision] }
    const steps: Array<[string, [string, number]]> = [['created', read()]]
    const update = async (label: string, source: string): Promise<void> => {
      H.SC.updateScriptIndicator(chart, { name: 'E2E_PREC', source })
      await H.sleep(250)
      steps.push([label, read()])
    }
    await update('to overlay', OVERLAY)
    await update('back to a sub-pane script', SUB)
    await update('to overlay again', OVERLAY)
    // A symbol change: klinecharts syncs price-series indicators unless their precision was pinned.
    chart.setPriceVolumePrecision(5, 0)
    const texts: string[] = []
    const fill = CanvasRenderingContext2D.prototype.fillText
    CanvasRenderingContext2D.prototype.fillText = function (text: string, x: number, y: number, w?: number) {
      texts.push(String(text))
      return w === undefined ? fill.call(this, text, x, y) : fill.call(this, text, x, y, w)
    }
    chart.resize()
    await H.sleep(300)
    CanvasRenderingContext2D.prototype.fillText = fill
    steps.push(['symbol change to 5 decimals', read()])
    return { steps, legend: texts[texts.indexOf('Close: ') + 1], texts: texts.slice(0, 60) }
  })
  expect(await pageErrors(page)).toEqual([])
  expect(state.steps).toEqual([
    ['created', ['normal', 2]],
    ['to overlay', ['price', 3]],
    ['back to a sub-pane script', ['normal', 2]],
    ['to overlay again', ['price', 3]],
    ['symbol change to 5 decimals', ['price', 5]]
  ])
  expect(state.legend, JSON.stringify(state.texts)).toMatch(/^6[34],?\d{3}\.\d{5}$/)
})

test('updateScriptIndicator changes an indicator in place; inputs are calcParams (SC-165, SC-166)', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    H.SC.registerScriptIndicator({ name: 'E2E_T10', source: '// @title V42\nplot(close*0+42)' })
    const { pro } = H.mount({ chart: { mainIndicators: [], subIndicators: ['VOL'] } })
    const chart = await H.ready(pro)
    const paneId = chart.createIndicator('E2E_T10', false)
    await H.sleep(300)
    const read = (): any => {
      const ind = chart.getIndicatorByPaneId(paneId, 'E2E_T10')
      return { last: ind.result[ind.result.length - 1], figures: ind.figures.length, shortName: ind.shortName }
    }
    const before = read()
    let invalid = 'no error'
    try { H.SC.updateScriptIndicator(chart, { name: 'E2E_T10', source: 'plot(nope)' }) } catch (e) { invalid = String((e as Error).name) }
    await H.sleep(200)
    const afterInvalid = read()
    H.SC.updateScriptIndicator(chart, { name: 'E2E_T10', source: '// @title V78\nplot(close*0+7)\nplot(close*0+8)' })
    await H.sleep(300)
    const after = read()
    // The same through the Pro's chart, as a host does.
    H.SC.updateScriptIndicator(pro.getChart(), { name: 'E2E_T10', source: '// @title V9\nplot(close*0+9)' }, paneId)
    await H.sleep(300)
    const viaPro = read()
    const panes = [...chart.getIndicatorByPaneId().keys()]

    // Inputs: calcParams drive the script.
    H.SC.registerScriptIndicator({ name: 'E2E_LEN', source: 'len = input(3, title="Length", minval=1)\nplot(sma(close, len))' })
    const lenPane = chart.createIndicator('E2E_LEN', false)
    await H.sleep(300)
    const dl = chart.getDataList()
    const mean = (n: number): number => dl.slice(dl.length - n).reduce((a: number, b: any) => a + b.close, 0) / n
    const lenLast = (): number => { const r = chart.getIndicatorByPaneId(lenPane, 'E2E_LEN').result; return r[r.length - 1].p0 }
    const d3 = [chart.getIndicatorByPaneId(lenPane, 'E2E_LEN').calcParams, lenLast(), mean(3)]
    chart.overrideIndicator({ name: 'E2E_LEN', calcParams: [10] }, lenPane)
    await H.sleep(300)
    const d10 = [lenLast(), mean(10)]
    const set = H.SC.setScriptIndicatorParams(chart, 'E2E_LEN', { len: 20 }, lenPane)
    await H.sleep(300)
    const d20 = [set, lenLast(), mean(20)]
    return { paneId, before, invalid, afterInvalid, after, viaPro, panes, d3, d10, d20, schema: H.SC.getScriptInputSchema('E2E_LEN') }
  })
  expect(await pageErrors(page)).toEqual([])
  expect(state.before).toEqual({ last: { p0: 42 }, figures: 1, shortName: 'V42' })
  expect(state.invalid).toBe('SuperScriptError')
  expect(state.afterInvalid, 'an invalid script leaves the indicator alone').toEqual(state.before)
  expect(state.after).toEqual({ last: { p0: 7, p1: 8 }, figures: 2, shortName: 'V78' })
  expect(state.viaPro).toEqual({ last: { p0: 9 }, figures: 1, shortName: 'V9' })
  expect(state.panes, 'same pane: no new pane was created').toContain(state.paneId)
  expect(state.d3[0]).toEqual([3])
  expect(state.d3[1]).toBeCloseTo(state.d3[2], 8)
  expect(state.d10[0]).toBeCloseTo(state.d10[1], 8)
  expect(state.d20[0]).toEqual([20])
  expect(state.d20[1]).toBeCloseTo(state.d20[2], 8)
  expect(state.schema).toEqual([{ id: 'len', title: 'Length', defval: 3, min: 1, type: 'int' }])
})

test('a script cannot take a built-in\'s name, and only SuperScript runs by default (SC-139)', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    let code = 'none'
    try { H.SC.registerScriptIndicator({ name: 'RSI', source: 'plot(close)' }) } catch (e) { code = (e as any).code }
    const { pro } = H.mount({ chart: { mainIndicators: [], subIndicators: [] } })
    const chart = await H.ready(pro)
    const paneId = chart.createIndicator('RSI')
    await H.sleep(200)
    return {
      code,
      rsiFigures: chart.getIndicatorByPaneId(paneId, 'RSI').figures.map((f: any) => f.key),
      languages: H.SC.listLanguages().map((l: any) => l.id)
    }
  })
  expect(await pageErrors(page)).toEqual([])
  expect(state.code).toBe('NAME_TAKEN')
  expect(state.rsiFigures).toEqual(['rsi1', 'rsi2', 'rsi3'])
  expect(state.languages).toEqual(['superscript'])
})

test('buildChartContext sends the bars on screen: scrolled back, and zoomed out into buckets (SC-137)', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const { pro } = H.mount({ chart: { mainIndicators: [], subIndicators: [] } })
    const chart = await H.ready(pro)
    chart.scrollByDistance(900)
    await H.sleep(400)
    let dl = chart.getDataList()
    let vr = chart.getVisibleRange()
    const ctx = H.SC.buildChartContext(pro)
    const scrolled = {
      got: [ctx.bars[0].timestamp, ctx.bars[ctx.bars.length - 1].timestamp],
      want: [dl[vr.from].timestamp, dl[Math.min(vr.to, dl.length) - 1].timestamp],
      newest: dl[dl.length - 1].timestamp,
      symbol: ctx.symbol,
      period: ctx.period,
      bucket: ctx.format.bucket
    }
    chart.setBarSpace(2)
    await H.sleep(400)
    dl = chart.getDataList()
    vr = chart.getVisibleRange()
    const zoomed = H.SC.buildChartContext(pro, { maxBars: 100 })
    const rows = zoomed.bars
    return {
      scrolled,
      zoomed: {
        rows: rows.length,
        visible: Math.min(vr.to, dl.length) - vr.from,
        first: rows[0].timestamp,
        firstVisible: dl[vr.from].timestamp,
        lastClose: rows[rows.length - 1].close,
        lastVisibleClose: dl[Math.min(vr.to, dl.length) - 1].close,
        bucket: zoomed.format.bucket
      }
    }
  })
  expect(await pageErrors(page)).toEqual([])
  expect(state.scrolled.got).toEqual(state.scrolled.want)
  expect(state.scrolled.got[1], 'scrolled back: not the newest bar').toBeLessThan(state.scrolled.newest)
  expect([state.scrolled.symbol, state.scrolled.period, state.scrolled.bucket]).toEqual(['SUPER-USDT', '1H', 1])
  expect(state.zoomed.visible, 'zoomed out far enough to need buckets').toBeGreaterThan(100)
  expect(state.zoomed.rows).toBeLessThanOrEqual(100)
  expect(state.zoomed.bucket).toBeGreaterThan(1)
  expect(state.zoomed.first).toBe(state.zoomed.firstVisible)
  expect(state.zoomed.lastClose).toBe(state.zoomed.lastVisibleClose)
})

test('SupWallet StudioChart\'s two scripts, verbatim, draw on the Pro chart (SC-002)', async ({ page, kc }) => {
  await openHarness(page, kc)
  await installPixelCounter(page)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const px = (window as any).px
    // frontend/sup-wallet/apps/web/src/components/strategy/StudioChart.tsx, ensureSuperScript()
    H.SC.registerScriptIndicator({
      name: 'SUPER_SMACROSS',
      source: `
        // @title SuperScript SMA Cross
        fast = sma(close, 10)
        slow = sma(close, 30)
        plot(fast, title="Fast 10", color="#2962ff")
        plot(slow, title="Slow 30", color="#ff9800")
      `
    })
    H.SC.registerScriptIndicator({
      name: 'SUPER_RSI',
      source: `
        // @title SuperScript RSI
        plot(rsi(close, 14), title="RSI 14", color="#ab47bc")
      `
    })
    const { pro } = H.mount({ chart: { mainIndicators: ['MA'], subIndicators: ['VOL'] } })
    const chart = await H.ready(pro)
    chart.createIndicator('SUPER_SMACROSS', true, { id: 'candle_pane' })
    const rsiPane = chart.createIndicator('SUPER_RSI')
    await H.sleep(500)
    const grid = chart.getStyles().grid.horizontal.color
    return {
      fast: px(chart, 'candle_pane', '#2962ff', 30),
      slow: px(chart, 'candle_pane', '#ff9800', 30),
      rsi: px(chart, rsiPane, '#ab47bc', 30),
      rsiGrid: px(chart, rsiPane, grid, 6)
    }
  })
  expect(await pageErrors(page)).toEqual([])
  expect(state.fast, 'Fast 10').toBeGreaterThan(300)
  expect(state.slow, 'Slow 30').toBeGreaterThan(300)
  expect(state.rsi, 'RSI 14').toBeGreaterThan(300)
  expect(state.rsiGrid, 'the RSI pane keeps its grid').toBeGreaterThan(100)
})
