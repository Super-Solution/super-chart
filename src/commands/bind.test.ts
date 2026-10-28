/**
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at

 * http://www.apache.org/licenses/LICENSE-2.0

 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { describe, expect, it, vi } from 'vitest'

import { execute, getCommands, toToolDefinitions, type CommandApis, type CommandBindingDeps } from './bind'
import { COMMAND_DESCRIPTORS } from './schema'
import type { ChartPro } from '../types'

function fakeApis (overrides: Partial<CommandApis> = {}): CommandApis {
  return {
    addDrawing: vi.fn(() => 'overlay_1'),
    updateDrawing: vi.fn(() => true),
    listDrawingTools: vi.fn(() => ['segment']),
    drawingLevelsAt: vi.fn(() => null),
    setAnnotations: vi.fn(() => ({ applied: [], rejected: [] })),
    getAnnotations: vi.fn(() => []),
    clearAnnotations: vi.fn(),
    getLayout: vi.fn(() => ({ v: 1, symbol: 'BTC-USDT', chartType: 'candle_solid', timezone: 'Etc/UTC', indicators: [], drawings: [] })),
    applyLayout: vi.fn(() => ({ skippedIndicators: [], drawingsApplied: true })),
    ...overrides
  }
}

function fakeChart (overrides: Partial<ChartPro> = {}): ChartPro {
  const replay = {
    start: vi.fn(() => true),
    step: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    exit: vi.fn(),
    getState: vi.fn(() => ({ active: true, index: 3, timestamp: 123, playing: false, speed: 1 }))
  }
  return {
    setSymbol: vi.fn(async s => await Promise.resolve({ status: 'loaded' as const, symbol: s, period: { multiplier: 1, timespan: 'minute', text: '1m' }, bars: 10 })),
    setPeriod: vi.fn(async p => await Promise.resolve({ status: 'loaded' as const, symbol: { ticker: 'X' }, period: typeof p === 'string' ? { multiplier: 1, timespan: 'minute', text: p } : p, bars: 10 })),
    setChartType: vi.fn(() => true),
    getChartType: vi.fn(() => 'candle_solid'),
    setTheme: vi.fn(),
    getTheme: vi.fn(() => 'light'),
    setTimezone: vi.fn(),
    getTimezone: vi.fn(() => 'Etc/UTC'),
    setLocale: vi.fn(),
    getLocale: vi.fn(() => 'en-US'),
    setLayoutMode: vi.fn(),
    getSizeClass: vi.fn(() => 'regular'),
    resetView: vi.fn(),
    scrollToLatest: vi.fn(),
    setPriceScale: vi.fn(),
    getPriceScale: vi.fn(() => ({ type: 'normal', reverse: false })),
    snapshot: vi.fn(() => ({ dataUrl: 'data:image/png;base64,', mime: 'image/png', width: 1, height: 1, pixelRatio: 1, symbol: { ticker: 'X' }, period: { multiplier: 1, timespan: 'minute', text: '1m' }, timezone: 'Etc/UTC', theme: 'light', visibleRange: { from: 0, to: 1, realFrom: 0, realTo: 1 } })),
    describe: vi.fn(() => ({ symbol: { ticker: 'X' }, period: { multiplier: 1, timespan: 'minute', text: '1m' }, chartType: 'candle_solid', locale: 'en-US', timezone: 'Etc/UTC', last: 1, change: 0, high: 1, low: 1, bars: 1, indicators: [] })),
    getState: vi.fn(() => ({ schema: 1 } as never)),
    undo: vi.fn(() => true),
    redo: vi.fn(() => false),
    addIndicator: vi.fn(() => ({ paneId: 'candle_pane', name: 'MA' })),
    removeIndicator: vi.fn(() => true),
    setIndicatorVisible: vi.fn(() => true),
    getIndicators: vi.fn(() => []),
    getIndicatorCatalog: vi.fn(() => [{ name: 'MA', title: 'MA', category: 'trend', pane: 'price', params: [], source: 'builtin', listed: true }]),
    getPeriods: vi.fn(() => [{ multiplier: 1, timespan: 'minute', text: '1m' }, { multiplier: 1, timespan: 'hour', text: '1H' }]),
    removeDrawing: vi.fn(),
    listDrawings: vi.fn(() => []),
    clearDrawings: vi.fn(),
    replay,
    ...overrides
  } as unknown as ChartPro
}

function deps (chart: ChartPro | null, apis = fakeApis()): CommandBindingDeps {
  return { getChart: () => chart, apis }
}

describe('execute (SC-123)', () => {
  it('never throws for an unknown command id', async () => {
    const result = await execute(deps(fakeChart()), { id: 'not.a.command' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_ARGUMENT')
      expect(result.error.field).toBe('id')
    }
  })

  it('rejects a schema violation before ever calling the chart', async () => {
    const chart = fakeChart()
    const result = await execute(deps(chart), { id: 'chart.setPeriod', args: {} }) // missing required 'period'
    expect(result.ok).toBe(false)
    expect(chart.setPeriod).not.toHaveBeenCalled()
  })

  it('is NOT_READY when the chart has not mounted (or was disposed)', async () => {
    const result = await execute(deps(null), { id: 'chart.resetView' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('NOT_READY')
  })

  it('awaits setSymbol\'s own load-settled promise (never resolves early)', async () => {
    let resolved = false
    const chart = fakeChart({
      setSymbol: vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 5))
        resolved = true
        return { status: 'loaded' as const, symbol: { ticker: 'ETH-USDT' }, period: { multiplier: 1, timespan: 'minute', text: '1m' }, bars: 1 }
      })
    })
    const result = await execute(deps(chart), { id: 'chart.setSymbol', args: { ticker: 'ETH-USDT' } })
    expect(resolved).toBe(true)
    expect(result.ok).toBe(true)
  })

  it('setChartType with an unknown type is a ChartError, not a thrown exception', async () => {
    const chart = fakeChart()
    const result = await execute(deps(chart), { id: 'chart.setChartType', args: { type: 'not-a-type' } })
    expect(result.ok).toBe(false)
    expect(chart.setChartType).not.toHaveBeenCalled()
  })

  it('setTheme with an unknown theme is rejected by the schema\'s own enum before the runner ever sees it', async () => {
    const chart = fakeChart()
    const result = await execute(deps(chart), { id: 'chart.setTheme', args: { theme: 'purple' } })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INVALID_ARGUMENT')
    expect(chart.setTheme).not.toHaveBeenCalled()
  })

  it('indicator.add surfaces UNKNOWN_INDICATOR when addIndicator returns null', async () => {
    const chart = fakeChart({ addIndicator: vi.fn(() => null) })
    const result = await execute(deps(chart), { id: 'indicator.add', args: { name: 'NotReal' } })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('UNKNOWN_INDICATOR')
  })

  it('drawing.add delegates to apis.addDrawing and surfaces its id', async () => {
    const apis = fakeApis()
    const result = await execute(deps(fakeChart(), apis), { id: 'drawing.add', args: { tool: 'segment', points: [{ time: 0, price: 1 }] } })
    expect(result.ok).toBe(true)
    expect(apis.addDrawing).toHaveBeenCalled()
    if (result.ok) expect(result.result).toEqual({ id: 'overlay_1' })
  })

  it('drawing.add with an unknown tool is UNKNOWN_DRAWING_TOOL', async () => {
    const apis = fakeApis({ addDrawing: vi.fn(() => null) })
    const result = await execute(deps(fakeChart(), apis), { id: 'drawing.add', args: { tool: 'nope', points: [{ time: 0 }] } })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('UNKNOWN_DRAWING_TOOL')
  })

  it('annotation.set delegates to apis.setAnnotations', async () => {
    const apis = fakeApis()
    await execute(deps(fakeChart(), apis), { id: 'annotation.set', args: { layer: 'ai', specs: [] } })
    expect(apis.setAnnotations).toHaveBeenCalledWith('ai', [])
  })

  it('layout.get / layout.apply delegate to the layout apis', async () => {
    const apis = fakeApis()
    const got = await execute(deps(fakeChart(), apis), { id: 'layout.get' })
    expect(got.ok).toBe(true)
    const layout = { v: 1, chartType: 'line', timezone: 'Etc/UTC', indicators: [], drawings: [] }
    await execute(deps(fakeChart(), apis), { id: 'layout.apply', args: { layout } })
    expect(apis.applyLayout).toHaveBeenCalledWith(layout)
  })

  it('replay.start/step/pause/exit reach the chart\'s replay controls', async () => {
    const chart = fakeChart()
    await execute(deps(chart), { id: 'replay.start' })
    expect(chart.replay.start).toHaveBeenCalled()
    await execute(deps(chart), { id: 'replay.step', args: { n: 2 } })
    expect(chart.replay.step).toHaveBeenCalledWith(2)
    await execute(deps(chart), { id: 'replay.pause' })
    expect(chart.replay.pause).toHaveBeenCalled()
    await execute(deps(chart), { id: 'replay.exit' })
    expect(chart.replay.exit).toHaveBeenCalled()
  })

  it('history.undo/redo report what the chart returns', async () => {
    const chart = fakeChart()
    const undo = await execute(deps(chart), { id: 'history.undo' })
    expect(undo).toEqual({ ok: true, result: { applied: true } })
    const redo = await execute(deps(chart), { id: 'history.redo' })
    expect(redo).toEqual({ ok: true, result: { applied: false } })
  })

  it('a runner that throws a plain Error is still returned as a result, never as a rejection', async () => {
    const chart = fakeChart({ resetView: vi.fn(() => { throw new Error('boom') }) })
    await expect(execute(deps(chart), { id: 'chart.resetView' })).resolves.toEqual(
      expect.objectContaining({ ok: false, error: expect.objectContaining({ message: expect.stringContaining('boom') }) })
    )
  })
})

describe('getCommands', () => {
  it('is the same static registry schema.ts exports', () => {
    expect(getCommands()).toBe(COMMAND_DESCRIPTORS)
  })
})

describe('toToolDefinitions', () => {
  it('sanitises every id to the MCP name charset', () => {
    const defs = toToolDefinitions(deps(fakeChart()), { include: COMMAND_DESCRIPTORS.map(c => c.id) })
    for (const d of defs) {
      expect(d.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/)
    }
    expect(defs.find(d => d.name === 'chart_set_chart_type')).toBeDefined()
  })

  it('excludes destructive commands and URL-loading drawing operations by default', () => {
    const apis = fakeApis({ listDrawingTools: vi.fn(() => ['segment', 'image']) })
    const defs = toToolDefinitions(deps(fakeChart(), apis))
    expect(defs.some(d => d.name.includes('drawing_clear_all'))).toBe(false)
    expect(defs.some(d => d.name.includes('drawing_remove'))).toBe(false)
    expect(defs.some(d => d.name === 'drawing_update')).toBe(false)
    expect(defs.find(d => d.name === 'drawing_add')?.inputSchema.properties?.tool.enum).toEqual(['segment'])
    expect(toToolDefinitions(deps(null, apis)).find(d => d.name === 'drawing_add')?.inputSchema.properties?.tool.enum).toEqual(['segment'])
  })

  it('`include` overrides the destructive exclusion; `exclude` removes from either set', () => {
    const withDestructive = toToolDefinitions(deps(fakeChart()), { include: ['drawing.clearAll'] })
    expect(withDestructive).toHaveLength(1)
    const withoutOne = toToolDefinitions(deps(fakeChart()), { exclude: ['chart.setSymbol'] })
    expect(withoutOne.some(d => d.name === 'chart_set_symbol')).toBe(false)
    expect(toToolDefinitions(deps(fakeChart()), { include: ['drawing.add', 'drawing.update'], exclude: ['drawing.update'] }).map(d => d.name)).toEqual(['drawing_add'])
    const imageApis = fakeApis({ listDrawingTools: vi.fn(() => ['segment', 'image']) })
    expect(toToolDefinitions(deps(fakeChart(), imageApis), { include: ['drawing.add'] })[0].inputSchema.properties?.tool.enum).toEqual(['segment', 'image'])
  })

  it('resolves a dynamic enum (periods) from the live instance', () => {
    const defs = toToolDefinitions(deps(fakeChart()), { include: ['chart.setPeriod'] })
    const schema = defs[0].inputSchema
    expect(schema.properties?.period.enum).toEqual(['1m', '1H'])
  })

  it('enumOverrides narrows but never widens a dynamic enum', () => {
    const chart = fakeChart({
      getIndicatorCatalog: vi.fn(() => [
        { name: 'MA', title: 'MA', category: 'trend', pane: 'price', params: [], source: 'builtin', listed: true },
        { name: 'EMA', title: 'EMA', category: 'trend', pane: 'price', params: [], source: 'builtin', listed: true },
        { name: 'BOLL', title: 'BOLL', category: 'volatility', pane: 'price', params: [], source: 'builtin', listed: true }
      ])
    })
    const defs = toToolDefinitions(deps(chart), {
      include: ['indicator.add'],
      enumOverrides: { 'indicator.add': { name: ['MA', 'NotInCatalog'] } }
    })
    // 'NotInCatalog' is not in the live catalogue, so it is dropped, not added.
    expect(defs[0].inputSchema.properties?.name.enum).toEqual(['MA'])
  })

  it('annotations/getters have readOnlyHint set correctly', () => {
    const defs = toToolDefinitions(deps(fakeChart()), { include: ['chart.snapshot', 'chart.setSymbol'] })
    const snapshot = defs.find(d => d.name === 'chart_snapshot')
    const setSymbol = defs.find(d => d.name === 'chart_set_symbol')
    expect(snapshot?.annotations.readOnlyHint).toBe(true)
    expect(setSymbol?.annotations.readOnlyHint).toBe(false)
  })
})
