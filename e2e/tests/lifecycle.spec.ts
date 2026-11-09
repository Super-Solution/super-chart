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

test('a colour the canvas cannot parse is refused and a misspelt render option is reported once', async ({ page }) => {
  await openHarness(page)
  const warnings: string[] = []
  page.on('console', message => { if (message.type() === 'warning') warnings.push(message.text()) })
  const state = await page.evaluate(async () => {
    const { H } = window as any
    const { pro } = H.mount()
    await H.ready(pro)
    const attempt = (options: unknown): string | null => { try { pro.chart.setRenderOptions(options); return null } catch (error) { return (error as Error).message } }
    const before = pro.chart.getRenderOptions().up
    const bad = attempt({ up: 'not-a-colour' })
    const wrongType = attempt({ down: 12 })
    const after = pro.chart.getRenderOptions().up
    const accepted = [attempt({ up: '#26a69a' }), attempt({ down: 'rgb(239, 83, 80)' }), attempt({ grid: 'rgba(0,0,0,0.1)' }), attempt({ background: 'transparent' }), attempt({ line: 'tomato' })]
    const typo = attempt({ upColor: '#fff' })
    const typoAgain = attempt({ upColor: '#fff' })
    return { before, bad, wrongType, after, accepted, typo, typoAgain }
  })
  expect(state.bad).toMatch(/Render option up is not a CSS colour/)
  expect(state.wrongType).toMatch(/Render option down is not a CSS colour/)
  expect(state.after).toBe(state.before)
  expect(state.accepted).toEqual([null, null, null, null, null])
  expect([state.typo, state.typoAgain]).toEqual([null, null])
  expect(warnings.filter(text => text.includes('unknown render option "upColor"'))).toHaveLength(1)
})
