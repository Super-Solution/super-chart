// SPDX-License-Identifier: GPL-3.0-or-later
import { rebaseCompare, symbolKey, type CompareBar, type Datafeed, type HistoryResult, type IndicatorDefinition, type MarketBar, type Period, type SymbolInfo } from '@supersolutions/super-chart-core'
import type { EngineChart } from './chart'

/** Lines of the other markets: distinct from the up and down colours and from each other. */
export const COMPARE_COLORS: readonly string[] = Object.freeze(['#e040fb', '#ff9800', '#00bcd4', '#ffd54f', '#8d6e63', '#9ccc65'])
/** The most markets laid over one chart. */
export const MAX_COMPARES = 6
/** How often the other markets' latest bars are fetched again while the chart is open. */
const TAIL_REFRESH_MS = 30_000

export interface CompareInfo { readonly id: string, readonly symbol: SymbolInfo }

export interface CompareHost {
  readonly datafeed: Datafeed
  readonly chart: EngineChart
  readonly market: () => { readonly symbol: SymbolInfo, readonly period: Period }
  /** Report a failure the person can read (the host shows it as the notice). */
  readonly report: (error: unknown) => void
  readonly now: () => number
}

interface Compare { readonly id: string, readonly symbol: SymbolInfo, readonly name: string, readonly color: string, readonly calculate: IndicatorDefinition['calculate'], bars: CompareBar[], indicatorId: string, fetchedAt: number }

/**
 * Other markets drawn on the chart's own price scale, rebased to start at the same price so the lines show relative
 * performance. Each is a custom line indicator, so it lives in the Indicators list, the legend and the Objects tree like any
 * other (hide, remove) and needs nothing special from the engine. The bars come from the host's datafeed for the range
 * the chart has loaded; they are fetched again when the market changes or older bars load, and every 30 seconds for the
 * latest bars (the feed's one live subscription belongs to the chart's own market, so compare lines are not streamed).
 */
export class CompareOverlays {
  private readonly compares = new Map<string, Compare>()
  private generation = 0
  private disposed = false

  constructor (private readonly host: CompareHost) {}

  list (): CompareInfo[] { return [...this.compares.values()].map(item => ({ id: item.id, symbol: { ...item.symbol } })) }

  async add (symbol: SymbolInfo): Promise<string> {
    if (this.disposed) throw new Error('Chart workspace is disposed')
    const key = symbolKey(symbol)
    if (key === symbolKey(this.host.market().symbol)) throw new Error(`${symbol.ticker} is the market already shown`)
    for (const item of this.compares.values()) if (symbolKey(item.symbol) === key) return item.id
    if (this.compares.size >= MAX_COMPARES) throw new Error(`At most ${MAX_COMPARES} markets can be compared`)
    const bars = await this.fetch(symbol)
    if (this.disposed) throw new Error('Chart workspace is disposed')
    const name = `Compare ${symbol.ticker}${symbol.exchange === undefined || symbol.exchange === '' ? '' : ` · ${symbol.exchange}`}`
    const color = COMPARE_COLORS[this.compares.size % COMPARE_COLORS.length]
    const compare: Compare = {
      id: `compare-${key}`,
      symbol: { ...symbol },
      name,
      color,
      bars,
      indicatorId: '',
      fetchedAt: this.host.now(),
      calculate: (main) => rebaseCompare(main, compare.bars).map(value => ({ c: value }))
    }
    this.host.chart.registerIndicator({ name, pane: 'price', figures: [{ key: 'c', title: symbol.ticker, type: 'line', color, lineWidth: 1.5 }], calculate: compare.calculate })
    try { compare.indicatorId = this.host.chart.addIndicator({ name }) } catch (error) { this.host.chart.unregisterIndicator(name, compare.calculate); throw error }
    this.compares.set(compare.id, compare)
    return compare.id
  }

  remove (id: string): boolean {
    const compare = this.compares.get(id)
    if (compare === undefined) return false
    this.compares.delete(id)
    try { this.host.chart.removeIndicator(compare.indicatorId) } catch { /* already gone */ }
    this.host.chart.unregisterIndicator(compare.name, compare.calculate)
    return true
  }

  /** Drop compares whose indicator the person removed in the Indicators list or the legend. */
  reconcile (): void {
    if (this.compares.size === 0) return
    const live = new Set(this.host.chart.listIndicators().map(indicator => indicator.id))
    for (const compare of [...this.compares.values()]) if (!live.has(compare.indicatorId)) this.remove(compare.id)
  }

  /** Fetch every compare's bars again for the range now loaded. `tail` refreshes only when 30 seconds have passed. */
  async refresh (reason: 'range' | 'tail'): Promise<void> {
    if (this.disposed || this.compares.size === 0) return
    const generation = ++this.generation, now = this.host.now()
    const due = [...this.compares.values()].filter(item => reason === 'range' || now - item.fetchedAt >= TAIL_REFRESH_MS)
    // The market the chart shows may have become one of the compares: it is the chart's own line now.
    const own = symbolKey(this.host.market().symbol)
    for (const compare of due) if (symbolKey(compare.symbol) === own) this.remove(compare.id)
    await Promise.all(due.filter(item => this.compares.has(item.id)).map(async compare => {
      try {
        const bars = await this.fetch(compare.symbol)
        if (this.disposed || generation !== this.generation || !this.compares.has(compare.id)) return
        compare.bars = bars; compare.fetchedAt = this.host.now()
        // A visibility change is what makes the engine calculate this indicator again.
        const chart = this.host.chart, visible = chart.listIndicators().find(item => item.id === compare.indicatorId)?.visible ?? true
        chart.updateIndicator(compare.indicatorId, { visible: !visible }); chart.updateIndicator(compare.indicatorId, { visible })
      } catch (error) {
        compare.fetchedAt = this.host.now()
        this.host.report(error)
      }
    }))
  }

  dispose (): void { this.disposed = true; this.compares.clear() }

  private async fetch (symbol: SymbolInfo): Promise<CompareBar[]> {
    const { period } = this.host.market(), main = this.host.chart.getBars()
    const first = main[0], last = main[main.length - 1]
    if (first === undefined || last === undefined) throw new Error('Load the chart before comparing')
    const controller = new AbortController()
    const answer: MarketBar[] | HistoryResult = await this.host.datafeed.getHistoryKLineData(symbol, period, first.timestamp, last.timestamp + 1, { signal: controller.signal, firstDataRequest: true, countBack: Math.min(main.length, 5000) })
    const raw = Array.isArray(answer) ? answer : answer.bars
    const bars: CompareBar[] = []
    for (const bar of raw) if (Number.isFinite(bar.timestamp) && Number.isFinite(bar.close)) bars.push({ timestamp: bar.timestamp, close: bar.close })
    bars.sort((a, b) => a.timestamp - b.timestamp)
    if (bars.length === 0) throw new Error(`No ${period.text} bars for ${symbol.ticker} in the range shown`)
    return bars
  }
}
