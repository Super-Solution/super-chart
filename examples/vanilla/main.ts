/**
 * SUPer-Chart — minimal vanilla integration example (SC-191).
 *
 * Consumes the package through its real, published entry points (never
 * `../src`), so this typechecks against exactly what a host actually
 * installs — `bun install` in this directory resolves
 * `@zzyzxlabs/super-chart` from the package root one level up (via
 * `file:../..`), which npm/bun treat as an ordinary local package: they read
 * ITS package.json `exports`/`files`, the same map a registry install would.
 *
 * What earlier hosts (SupWallet, Broker, ProjectX) rediscovered by hand, and
 * why this example does NOT reproduce most of it any more:
 *   - An inline container height and a ResizeObserver calling `resize()`:
 *     no longer needed. `autoResize` defaults to true (its own
 *     ResizeObserver), and a container with no explicit height now falls
 *     back to a sane default with a console warning instead of the old
 *     bare `80vh`, both landed in earlier batches of this same stack.
 *   - A datafeed try/catch to show an error state: no longer needed either.
 *     `dataStates` (default true) already shows "No data"/an error banner
 *     with Retry on a rejecting `getHistoryKLineData`.
 *   - An equality guard before `setSymbol`/`setPeriod`: no longer needed.
 *     Both resolve `{ status: 'unchanged' }` on their own for an identical
 *     symbol/period — see `LoadResult` in the package's types.
 * What is still real, and shown below: constructing the chart, awaiting its
 * `ready` promise (not polling `getChart()`), and `dispose()` on teardown.
 *
 * The rest of this file demonstrates the batch's own additions: the command
 * registry (`execute`/`toToolDefinitions`), the drawings API, declarative
 * annotations, and layout save/restore.
 */
import {
  SuperChart,
  type ChartLayoutV1,
  type Datafeed,
  type Period,
  type SuperChartInstance,
  type SymbolInfo
} from '@zzyzxlabs/super-chart'
import '@zzyzxlabs/super-chart/style.css'
import type { KLineData } from 'klinecharts'

// A deterministic, offline synthetic series — no API key, stable for a demo.
function priceAt (i: number): number {
  return 100 + 25 * Math.sin(i / 40) + 10 * Math.sin(i / 11)
}
function periodMs (p: Pick<Period, 'multiplier' | 'timespan'>): number {
  const unit: Record<string, number> = { minute: 60_000, hour: 3_600_000, day: 86_400_000 }
  return p.multiplier * (unit[p.timespan] ?? 60_000)
}
function candle (i: number, span: number): KLineData {
  const o = priceAt(i)
  const c = priceAt(i + 1)
  return { timestamp: i * span, open: o, high: Math.max(o, c) + 1, low: Math.min(o, c) - 1, close: c, volume: 500 }
}

const SYMBOL: SymbolInfo = { ticker: 'SUPER-USDT', name: 'SuperCoin / Tether', pricePrecision: 2, volumePrecision: 0 }

const datafeed: Datafeed = {
  async searchSymbols (): Promise<SymbolInfo[]> {
    return [SYMBOL]
  },
  async getHistoryKLineData (_symbol, period, from, to): Promise<KLineData[]> {
    const span = periodMs(period)
    const start = Math.floor(from / span)
    const end = Math.floor(to / span)
    const out: KLineData[] = []
    for (let i = start; i < end; i++) out.push(candle(i, span))
    return out
  },
  subscribe () {},
  unsubscribe () {}
}

/** Mounts a chart into `container` and returns it plus a teardown function. */
export function mountExampleChart (container: HTMLElement): { chart: SuperChartInstance, dispose: () => void } {
  const chart = new SuperChart({
    container,
    symbol: SYMBOL,
    period: { multiplier: 1, timespan: 'hour', text: '1H' },
    datafeed,
    theme: 'dark',
    locale: 'en-US',
    // Opt-in additive features this batch adds; both default to off.
    commandPalette: true,
    layoutPersistKey: 'super-chart-example-vanilla:layout'
  })
  return { chart, dispose: () => { chart.dispose() } }
}

/** Demonstrates the AI/MCP command layer + drawings/annotations/layout APIs, once the chart has real data. */
export async function demonstrateApis (chart: SuperChartInstance): Promise<void> {
  await chart.ready

  // The command registry: every command this instance supports, and a
  // neutral, MCP-shaped tool list (destructive commands excluded by default).
  const commands = chart.getCommands()
  const tools = chart.toToolDefinitions()
  console.log(`${commands.length} commands, ${tools.length} of them in the default (non-destructive) tool set`)

  // execute() validates its own arguments and never throws.
  const setPeriodResult = await chart.execute({ id: 'chart.setPeriod', args: { period: '1H' } })
  console.log('setPeriod via execute():', setPeriodResult.ok)

  // Drawings: a horizontal level at the current close, addressed by id.
  const bars = chart.getBars({ limit: 1 })
  const drawingId = bars.length > 0
    ? chart.addDrawing({ tool: 'horizontalStraightLine', points: [{ time: bars[0].timestamp, price: bars[0].close }] })
    : null

  // Annotations: a declarative, upsertable layer — calling this again with
  // the SAME spec repaints nothing (see src/api/annotations.ts's diff).
  chart.setAnnotations('ai', [
    { key: 'resistance-1', kind: 'level', anchors: [{ time: Date.now(), price: (bars[0]?.close ?? 100) * 1.05 }], tone: 'bear' }
  ])

  // Layout: capture what the user (or this demo) put on the chart, then restore it.
  const layout: ChartLayoutV1 = chart.getLayout()
  console.log(`layout for ${layout.symbol}: ${layout.indicators.length} indicators, ${layout.drawings.length} drawings`)
  chart.applyLayout(layout)

  if (drawingId !== null) {
    chart.removeDrawing(drawingId)
  }
  chart.clearAnnotations('ai')
}
