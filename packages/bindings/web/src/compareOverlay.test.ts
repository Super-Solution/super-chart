import { describe, expect, it } from 'vitest'
import type { IndicatorDefinition, MarketBar, SymbolInfo } from '@supersolutions/super-chart-core'
import { CompareOverlays, MAX_COMPARES, type CompareHost } from './compareOverlay'

const symbol = (ticker: string): SymbolInfo => ({ ticker, pricePrecision: 2 }) as SymbolInfo
const bar = (i: number, close: number): MarketBar => ({ timestamp: i * 60_000, open: close, high: close, low: close, close, volume: 1 })

function setup (): { overlays: CompareOverlays, calls: string[], definitions: Map<string, IndicatorDefinition>, instances: Map<string, { id: string, name: string, visible: boolean }>, clock: { now: number }, fetches: { count: number } } {
  const definitions = new Map<string, IndicatorDefinition>(), instances = new Map<string, { id: string, name: string, visible: boolean }>(), calls: string[] = [], clock = { now: 0 }, fetches = { count: 0 }
  let next = 0
  const chart = {
    getBars: () => [bar(0, 100), bar(1, 101), bar(2, 102)],
    registerIndicator: (definition: IndicatorDefinition) => { definitions.set(definition.name, definition); calls.push(`register ${definition.name}`) },
    unregisterIndicator: (name: string) => { calls.push(`unregister ${name}`); return definitions.delete(name) },
    addIndicator: (spec: { name: string }) => { const id = `i${++next}`; instances.set(id, { id, name: spec.name, visible: true }); return id },
    removeIndicator: (id: string) => instances.delete(id),
    listIndicators: () => [...instances.values()],
    updateIndicator: (id: string, changes: { visible?: boolean }) => { const item = instances.get(id); if (item === undefined) return false; if (changes.visible !== undefined) item.visible = changes.visible; return true }
  }
  const host = {
    datafeed: { getHistoryKLineData: async () => { fetches.count++; return [bar(0, 10), bar(1, 11), bar(2, 12)] } },
    chart, market: () => ({ symbol: symbol('MAIN'), period: { multiplier: 1, timespan: 'minute', text: '1m' } }), report: () => {}, now: () => clock.now
  } as unknown as CompareHost
  return { overlays: new CompareOverlays(host), calls, definitions, instances, clock, fetches }
}

describe('CompareOverlays', () => {
  it('adds a rebased line indicator, once per symbol, and refuses the chart\'s own market', async () => {
    const { overlays, definitions, instances } = setup()
    const id = await overlays.add(symbol('ETH'))
    expect(await overlays.add(symbol('ETH'))).toBe(id)
    expect(instances.size).toBe(1)
    const rows = [...definitions.values()][0].calculate([bar(0, 100), bar(1, 100), bar(2, 100)], [])
    expect(rows.map(row => Math.round(row.c ?? 0))).toEqual([100, 110, 120])
    await expect(overlays.add(symbol('MAIN'))).rejects.toThrow(/already shown/)
  })
  it('limits how many markets are compared', async () => {
    const { overlays } = setup()
    for (let i = 0; i < MAX_COMPARES; i++) await overlays.add(symbol(`S${i}`))
    await expect(overlays.add(symbol('ONE_MORE'))).rejects.toThrow(/At most/)
  })
  it('forgets a comparison whose indicator was removed elsewhere, and unregisters its definition', async () => {
    const { overlays, instances, definitions } = setup()
    await overlays.add(symbol('ETH'))
    instances.clear(); overlays.reconcile()
    expect(overlays.list()).toEqual([])
    expect(definitions.size).toBe(0)
  })
  it('fetches the latest bars again only every 30 seconds, and the range at once', async () => {
    const { overlays, clock, fetches } = setup()
    await overlays.add(symbol('ETH'))
    expect(fetches.count).toBe(1)
    clock.now = 10_000; await overlays.refresh('tail'); expect(fetches.count).toBe(1)
    clock.now = 31_000; await overlays.refresh('tail'); expect(fetches.count).toBe(2)
    await overlays.refresh('range'); expect(fetches.count).toBe(3)
  })
})
