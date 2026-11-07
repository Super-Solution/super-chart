import { test, expect, openHarness, pageErrors } from './fixtures'

// SC-188: "." and "./lite" are one build, so they share the SuperScript language
// registry and the figures, whichever loads first. Loaded as ES modules, the way
// hosts' bundlers load them.

test('lite loaded after the full entry shares its registry and keeps its image figure', async ({ page, kc }) => {
  await openHarness(page, kc)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const { pro } = H.mount()
    const chart = await H.ready(pro)
    const figureBefore = H.KC.getFigureClass('imageFig')
    const lite = await import('/dist/lite.js' as string)
    const figureAfter = H.KC.getFigureClass('imageFig')
    const lang = { id: 'x-e2e', name: 'X', compile: () => ({ meta: { title: 'x' }, run: () => ({ meta: { title: 'x' }, plots: [] }) }) }
    lite.registerLanguage(lang)
    let bridged = 'ok'
    try { H.SC.registerScriptIndicator({ name: 'X_E2E', source: '', language: 'x-e2e' }) } catch (e) { bridged = String(e) }

    // An image placed after lite loaded still repaints the chart when it loads.
    let resizes = 0
    const resize = chart.resize.bind(chart)
    chart.resize = () => { resizes++; resize() }
    const dl = chart.getDataList()
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    chart.createOverlay({ name: 'image', extendData: png, points: [{ timestamp: dl[dl.length - 30].timestamp, value: dl[dl.length - 30].high + 5 }, { timestamp: dl[dl.length - 10].timestamp, value: dl[dl.length - 10].low - 5 }] })
    for (let i = 0; i < 40 && resizes === 0; i++) await H.sleep(50)
    chart.resize = resize
    return {
      sameGetLanguage: lite.getLanguage === H.SC.getLanguage,
      visibleThroughPro: H.SC.listLanguages().some((l: any) => l.id === 'x-e2e'),
      bridged,
      sameFigure: figureBefore !== null && figureBefore === figureAfter,
      resizes
    }
  })
  expect(state).toMatchObject({ sameGetLanguage: true, visibleThroughPro: true, bridged: 'ok', sameFigure: true })
  expect(state.resizes).toBeGreaterThan(0)
  expect(await pageErrors(page)).toEqual([])
})
