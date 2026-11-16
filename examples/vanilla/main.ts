import { SuperChart, type ChartWorkspace } from '@supersolutions/super-chart-web'
import { EngineAnnotations } from '@supersolutions/super-chart-web/annotations'
import { symbolKey } from '@supersolutions/super-chart-core'
import { createFeed, MARKETS } from '../_shared/feed'

const symbol = MARKETS[0]
const { datafeed } = createFeed()

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
