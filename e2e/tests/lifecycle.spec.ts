import { test, expect, openHarness, pageErrors } from './fixtures'

// Existing lifecycle cases migrated to the owned workspace. Upstream disposal
// monkey-patching is retired with that runtime; no compatibility facade remains.
test('dispose empties the container, and a remount leaves exactly one chart (10 cycles)', async ({ page }) => {
  await openHarness(page)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const { pro, container } = H.mount({ id: 'cycle' })
    await H.ready(pro)
    const canvasesFirst = container.querySelectorAll('canvas').length
    pro.dispose()
    const afterDispose = container.childElementCount
    const cycles: Array<{ widgets: number, canvases: number }> = []
    for (let i = 0; i < 10; i++) {
      const { pro: again } = H.mount({ chart: { container } })
      await H.ready(again)
      cycles.push({ widgets: container.querySelectorAll('[aria-label="Chart workspace"]').length, canvases: container.querySelectorAll('canvas').length })
      again.dispose()
    }
    return { canvasesFirst, afterDispose, cycles, left: container.childElementCount }
  })
  expect(state.afterDispose).toBe(0)
  expect(state.cycles.every(c => c.widgets === 1 && c.canvases === state.canvasesFirst), JSON.stringify(state.cycles)).toBe(true)
  expect(state.left).toBe(0)
  expect(await pageErrors(page)).toEqual([])
})

test('after dispose owned mutating methods reject use; dispose is idempotent', async ({ page }) => {
  await openHarness(page)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const { pro } = H.mount()
    await H.ready(pro)
    pro.dispose()
    const calls: Array<[string, unknown[]]> = [
      ['setSymbol', [{ ticker: 'X' }]], ['setPeriod', [{ multiplier: 1, timespan: 'day', text: 'D' }]],
      ['reload', []], ['cancelLoad', []], ['startReplay', []], ['stepReplay', []], ['exitReplay', []]
    ]
    const thrown = calls.map(([name, args]) => {
      try { pro[name](...args); return { name, rejected: false } } catch { return { name, rejected: true } }
    })
    let second = 'ok'
    try { pro.dispose() } catch (error) { second = String(error) }
    return { thrown, second }
  })
  for (const result of state.thrown) expect(result.rejected, result.name).toBe(true)
  expect(state.second).toBe('ok')
})

test('an unknown chart type is refused at runtime (JSON callers bypass the types)', async ({ page }) => {
  await openHarness(page)
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const { pro } = H.mount()
    await H.ready(pro)
    const before = pro.chart.getRenderOptions().chartType
    let rejected = false
    try { pro.chart.setRenderOptions({ chartType: 'lin' }) } catch { rejected = true }
    return { rejected, before, after: pro.chart.getRenderOptions().chartType }
  })
  expect(state.rejected).toBe(true)
  expect(state.after).toBe(state.before)
})

test('a workspace with its legend title, watermark and fold can save itself and restore with all three intact', async ({ page }) => {
  await openHarness(page)
  await page.evaluate(async () => {
    const { H } = window as any
    const { pro } = H.mount({ id: 'doc' })
    ;(window as any).pro = pro
    await H.ready(pro)
  })
  const result = await page.evaluate(async () => {
    const pro = (window as any).pro
    pro.setLegendCollapsed(true)
    const before = pro.chart.getRenderOptions()
    const saved = pro.exportDocument()
    const outcome = await pro.restoreDocument(saved)
    const after = pro.chart.getRenderOptions()
    return { outcome: outcome.status, title: [before.legendTitle, after.legendTitle], watermark: [before.watermark?.title, after.watermark?.title], fold: [before.legendCollapsed, after.legendCollapsed] }
  })
  expect(['loaded', 'unchanged']).toContain(result.outcome)
  expect(result.title[1]).toBe(result.title[0])
  expect(result.watermark[1]).toBe(result.watermark[0])
  expect(result.fold).toEqual([true, true])
})
