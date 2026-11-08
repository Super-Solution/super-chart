import { beforeEach, describe, expect, it, vi } from 'vitest'

// The plugin's own logic (card registry, tool argument checks) against a stand-in engine: no DOM, no canvas.
const workspaces: FakeWorkspace[] = []
class FakeWorkspace {
  readonly indicators: Array<{ id: string, name: string, params: number[] }> = []
  private created = 0
  readonly ready = Promise.resolve({ status: 'ok' })
  readonly chart = {
    requestPaint: () => {},
    addLayer: () => () => {},
    getRegisteredIndicatorNames: () => ['MA', 'EMA'],
    listIndicators: () => this.indicators,
    removeIndicator: (id: string) => { this.indicators.splice(this.indicators.findIndex(i => i.id === id), 1) },
    addIndicator: (item: { name: string, params?: number[] }): string => {
      if (item.params?.[0] === 13) throw new Error('rejected')
      const id = `i${++this.created}`
      this.indicators.push({ id, name: item.name, params: item.params ?? [] })
      return id
    },
    setRenderOptions: () => {},
    view: { setMode: () => {} }
  }

  constructor (_host: unknown, readonly options: { symbol: { ticker: string }, period: unknown }) { workspaces.push(this) }
  registerIndicator (): void {}
  getState (): unknown { return { indicators: this.indicators, data: { count: 3, firstTimestamp: 1, lastTimestamp: 3 }, replay: { active: false } } }
  getSymbol (): unknown { return this.options.symbol }
  getPeriod (): unknown { return this.options.period }
  getBars (): unknown[] { return [] }
  dispose (): void {}
}
vi.mock('@supersolutions/super-chart-web', () => ({ ChartWorkspace: FakeWorkspace }))
vi.mock('@supersolutions/super-chart-web/annotations', () => ({
  EngineAnnotations: class {
    setAnnotations (): { applied: string[], rejected: never[] } { return { applied: [], rejected: [] } }
    getAnnotations (): never[] { return [] }
    setScope (): void {}
  }
}))

const { createChartChatPlugin } = await import('./index')

function element (): Record<string, unknown> {
  const node: Record<string, unknown> = { style: {}, setAttribute: () => {}, children: [] as unknown[], textContent: '' }
  node.replaceChildren = (...items: unknown[]) => { node.children = items }
  return node
}
function container (): { ownerDocument: { createElement: () => unknown }, replaceChildren: () => void } {
  return Object.assign(element(), { ownerDocument: { createElement: element } }) as never
}

const bars = [1, 2, 3].map(timestamp => ({ timestamp, open: 1, high: 2, low: 1, close: 2, volume: 1 }))
const spec = (id: string, ticker = 'BTC'): Record<string, unknown> => ({
  kind: 'super-chart.chart', id, symbol: { ticker }, period: { multiplier: 1, timespan: 'day', text: '1D' }, bars
})
const flush = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve() }
const context = { theme: 'light' as const }

describe('chart chat plugin', () => {
  beforeEach(() => { workspaces.length = 0 })

  async function setup (): Promise<{ run: (name: string, input?: unknown) => Promise<any>, mount: (id: string, ticker?: string) => Promise<{ destroy: () => void }> }> {
    const plugin = createChartChatPlugin()
    const mountCard = Object.values(plugin.mounts)[0]
    return {
      run: async (name, input) => await plugin.tools.find(tool => tool.name === name)!.run(input as never),
      mount: async (id, ticker) => { const m = mountCard(container() as never, spec(id, ticker) as never, context); await flush(); return m }
    }
  }

  it('keeps a newer card reachable when an older card with the same id is unmounted', async () => {
    const { run, mount } = await setup()
    const older = await mount('price', 'AAA')
    await mount('price', 'BBB')
    older.destroy()
    expect((await run('chart_state', { chartId: 'price' })).symbol.ticker).toBe('BBB')
    expect((await run('chart_state')).chartId).toBe('price')
  })

  it('forgets a chart once its own card is unmounted', async () => {
    const { run, mount } = await setup()
    const card = await mount('solo')
    card.destroy()
    await expect(run('chart_state', { chartId: 'solo' })).rejects.toThrow(/Unknown chartId/)
    await expect(run('chart_state')).rejects.toThrow(/No chart is on screen/)
  })

  it('checks tool arguments before touching the chart', async () => {
    const { run, mount } = await setup()
    await mount('c')
    await expect(run('chart_bars', { limit: 0 })).rejects.toThrow(/1 to 500/)
    await expect(run('chart_bars', { limit: 501 })).rejects.toThrow(/1 to 500/)
    await expect(run('chart_bars', { limit: 1.5 })).rejects.toThrow(/1 to 500/)
    await expect(run('chart_state', { chartId: 7 })).rejects.toThrow(/chartId must be a string/)
    await expect(run('chart_indicators', { add: [{ name: 'NOPE' }] })).rejects.toThrow(/Unknown indicator/)
    await expect(run('chart_indicators', { add: [{ name: 'MA', params: [Number.NaN] }] })).rejects.toThrow(/finite/)
    await expect(run('chart_replay', { action: 'jump' })).rejects.toThrow(/start, step or state/)
  })

  it('adds indicators all or nothing, and only removes what was there before', async () => {
    const { run, mount } = await setup()
    await mount('c')
    await run('chart_indicators', { add: [{ name: 'MA', params: [5] }] })
    // The second one is refused by the engine: the first of this call must not stay.
    await expect(run('chart_indicators', { add: [{ name: 'EMA', params: [9] }, { name: 'EMA', params: [13] }], remove: ['MA'] })).rejects.toThrow(/rejected/)
    expect((await run('chart_state')).indicators.map((i: { name: string }) => i.name)).toEqual(['MA'])
    // Replacing by name: the old MA goes, the one added in the same call stays.
    const replaced = await run('chart_indicators', { add: [{ name: 'MA', params: [20] }], remove: ['MA'] })
    expect(replaced.indicators.map((i: { params: number[] }) => i.params)).toEqual([[20]])
  })
})
