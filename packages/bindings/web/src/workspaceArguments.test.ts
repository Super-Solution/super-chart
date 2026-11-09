import { describe, expect, it } from 'vitest'
import { ChartWorkspace } from './workspace'

// Constructor misuse is reported by name, before any DOM work, so these run without a browser.
const symbol = { ticker: 'X', pricePrecision: 2 }
const period = { multiplier: 1, timespan: 'hour', text: '1H' }
const host = { ownerDocument: { defaultView: null } } as unknown as HTMLElement
const make = (hostArg: unknown, options: unknown): (() => unknown) => () => new ChartWorkspace(hostArg as HTMLElement, options as never)

describe('ChartWorkspace argument checks', () => {
  it('names a missing or non-element host', () => {
    expect(make(null, { symbol, period })).toThrow(/host HTMLElement/)
    expect(make(undefined, { symbol, period })).toThrow(/host HTMLElement/)
    expect(make({}, { symbol, period })).toThrow(/host HTMLElement/)
  })

  it('names missing options', () => {
    expect(make(host, undefined)).toThrow(/needs options/)
    expect(make(host, null)).toThrow(/needs options/)
  })

  it('names a missing or incomplete datafeed', () => {
    expect(make(host, { symbol, period })).toThrow(/getHistoryKLineData/)
    expect(make(host, { symbol, period, datafeed: {} })).toThrow(/getHistoryKLineData/)
    expect(make(host, { symbol, period, datafeed: { getHistoryKLineData: 'no' } })).toThrow(/getHistoryKLineData/)
  })

  it('still reaches the document check with a valid datafeed', () => {
    const datafeed = { getHistoryKLineData: async () => [], searchSymbols: async () => [], subscribe: () => {}, unsubscribe: () => {} }
    expect(make(host, { symbol, period, datafeed })).toThrow(/active document/)
  })
})
