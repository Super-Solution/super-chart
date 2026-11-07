import { SuperChart, type ChartWorkspace } from '@supersolutions/super-chart-web'
import { EngineAnnotations } from '@supersolutions/super-chart-web/annotations'
import { symbolKey, type Datafeed, type MarketBar, type Period } from '@supersolutions/super-chart-core'

const symbol = { ticker: 'SYNTHETIC', name: 'Local example', pricePrecision: 2 }
const periodMs = (period: Period): number => period.multiplier * (period.timespan === 'hour' ? 3_600_000 : 60_000)
const datafeed: Datafeed = {
  searchSymbols: async () => [symbol],
  getHistoryKLineData: async (_symbol, period, _from, to) => {
    const step = periodMs(period), end = Math.floor(to / step)
    const bars: MarketBar[] = Array.from({ length: 200 }, (_, i) => {
      const index = end - 200 + i, open = 100 + Math.sin(index / 11), close = 100 + Math.sin((index + 1) / 11)
      return { timestamp: index * step, open, close, high: Math.max(open, close) + 1, low: Math.min(open, close) - 1, volume: 500 }
    })
    return { bars, noData: true }
  },
  subscribe: () => {}, unsubscribe: () => {}
}

export function mountExampleChart (container: HTMLElement): { chart: ChartWorkspace, dispose: () => void } {
  container.style.height = '600px'
  const chart = new SuperChart(container, { datafeed, symbol, period: { multiplier: 1, timespan: 'hour', text: '1h' } })
  return { chart, dispose: () => chart.dispose() }
}

export async function demonstrateApis (workspace: ChartWorkspace): Promise<void> {
  const outcome = await workspace.ready
  if (outcome.status !== 'loaded') return
  const bars = workspace.getBars({ limit: 1 })
  if (bars.length === 0) return
  const bar = bars[0]
  workspace.chart.drawings.add({ id: 'reference', type: 'horizontal', anchors: [{ timestamp: bar.timestamp, price: bar.close }] })
  const document = workspace.chart.drawings.exportJson()
  workspace.chart.drawings.importJson(document)
  const annotations = new EngineAnnotations({ symbol: symbolKey(workspace.getSymbol()), onChange: () => workspace.chart.requestPaint() })
  const detach = workspace.chart.addLayer(annotations)
  annotations.setAnnotations('host', [{ key: 'reference', kind: 'level', anchors: [{ time: bar.timestamp, price: bar.close }], tone: 'accent' }])
  // This example releases the host layer before another market can be selected.
  detach()
  workspace.chart.drawings.remove('reference')
}
