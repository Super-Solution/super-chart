import { test, expect, openHarness, pageErrors } from './fixtures'

// SC-010's version-specific leg: a two-line SuperScript indicator, as SupWallet's
// StudioChart registers one, drawn on the price pane. On klinecharts 9.8.12
// this used to crash the draw loop (SC-002: the bridge passed incomplete line
// styles and 9.8.12's line merging reads `styles.dashedValue[0]`); it now
// draws both lines on every version. More in superscript.spec.ts.
test('a two-line SuperScript indicator draws both lines without errors', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    let registered = 'ok'
    try {
      H.SC.registerScriptIndicator({
        name: 'E2E_TWO_LINES',
        source: [
          '// @title Two lines',
          'plot(sma(close, 5), title="Fast", color="#ff00ff", lineWidth=2)',
          'plot(sma(close, 20), title="Slow", color="#00e5ff", lineWidth=2)'
        ].join('\n')
      })
    } catch (e) {
      registered = String(e)
    }
    const { pro } = H.mount({ chart: { theme: 'light' } })
    const chart = await H.ready(pro)
    const paneId = chart.createIndicator('E2E_TWO_LINES', true, { id: 'candle_pane' })
    await H.sleep(400)
    const indicator = chart.getIndicatorByPaneId('candle_pane', 'E2E_TWO_LINES')
    const result: Array<Record<string, unknown>> = indicator?.result ?? []
    const last = result[result.length - 1] ?? {}
    const count = (r: number, g: number, b: number): number => {
      let n = 0
      for (const canvas of chart.getDom('candle_pane', 'main').querySelectorAll('canvas')) {
        const data = (canvas as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, (canvas as HTMLCanvasElement).width, (canvas as HTMLCanvasElement).height).data
        for (let i = 0; i < data.length; i += 4) {
          if (Math.abs(data[i] - r) < 40 && Math.abs(data[i + 1] - g) < 40 && Math.abs(data[i + 2] - b) < 40 && data[i + 3] > 200) n++
        }
      }
      return n
    }
    return {
      registered,
      paneId,
      bars: chart.getDataList().length,
      results: result.length,
      finiteLast: Object.values(last).filter(v => typeof v === 'number' && Number.isFinite(v)).length,
      fast: count(255, 0, 255),
      slow: count(0, 229, 255)
    }
  })
  const errors = await pageErrors(page)
  expect(state.registered, 'registerScriptIndicator').toBe('ok')
  expect(state.paneId, 'createIndicator put it on the price pane').toBe('candle_pane')
  expect(state.results, 'one result per bar').toBe(state.bars)
  expect(state.finiteLast, 'both lines have a value on the last bar').toBe(2)
  expect(errors).toEqual([])
  expect(state.fast, 'pixels in the Fast line colour').toBeGreaterThan(300)
  expect(state.slow, 'pixels in the Slow line colour').toBeGreaterThan(300)
})
