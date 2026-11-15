import { ChartWorkspace } from '@supersolutions/super-chart-web'
import { EngineAnnotations } from '@supersolutions/super-chart-web/annotations'
import { symbolKey, type Datafeed, type MarketBar, type SymbolInfo } from '@supersolutions/super-chart-core'

// Seeded hourly random walk, no live ticks: every load paints the same prices,
// so screenshots of the two themes (and of different builds) compare like for like.
// Times end at the last closed hour, because the loader refuses bars from the future.
const STEP = 3_600_000, COUNT = 140, END = Math.floor(Date.now() / STEP) * STEP - STEP
function seededBars (): MarketBar[] {
  let seed = 41, price = 41
  const random = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647
  const bars: MarketBar[] = []
  for (let i = 0; i < COUNT; i++) {
    const open = price
    const close = i % 13 === 9 ? open : open + (random() - 0.47) * 0.11
    const high = Math.max(open, close) + random() * 0.055, low = Math.min(open, close) - random() * 0.055
    bars.push({ timestamp: END - (COUNT - 1 - i) * STEP, open, high, low, close, volume: Math.round(800 + random() * 1600 + Math.abs(close - open) * 20000) })
    price = close
  }
  return bars
}
const BARS = seededBars()
const symbol: SymbolInfo = { ticker: 'SUI-USDC', name: 'SUI / USDC', exchange: 'OKX', pricePrecision: 4 }
const feed: Datafeed = {
  searchSymbols: async () => [symbol],
  getHistoryKLineData: async () => ({ bars: BARS, noData: true }),
  subscribe: () => {},
  unsubscribe: () => {}
}

const VISIBLE = 90
async function mount (id: string, theme: 'light' | 'dark'): Promise<void> {
  const workspace = new ChartWorkspace(document.getElementById(id)!, {
    datafeed: feed,
    symbol,
    period: { multiplier: 1, timespan: 'hour', text: '1h' },
    theme,
    countdown: { enabled: false },
    chart: {
      count: VISIBLE,
      indicators: [{ name: 'MA', params: [5] }, { name: 'MA', params: [20] }, { name: 'MA', params: [60] }, { name: 'VOL' }, { name: 'MACD' }],
      render: { timeZone: 'UTC' }
    }
  } as ConstructorParameters<typeof ChartWorkspace>[1])
  const outcome = await workspace.ready
  if (outcome.status !== 'loaded') return

  const shown = BARS.slice(-VISIBLE), offset = BARS.length - VISIBLE
  const pick = (from: number, to: number, better: (a: MarketBar, b: MarketBar) => boolean): number => {
    let best = from
    for (let i = from; i < to; i++) if (better(shown[i], shown[best])) best = i
    return best
  }
  // Your drawing: a trend line under two swing lows.
  const a = pick(0, 25, (x, y) => x.low < y.low), b = pick(40, 70, (x, y) => x.low < y.low)
  workspace.chart.drawings.add({ id: 'trend', type: 'trend-line', anchors: [{ timestamp: shown[a].timestamp, price: shown[a].low }, { timestamp: shown[b].timestamp, price: shown[b].low }] })

  // The assistant's marks, each at an exact price taken from the bars (never rounded):
  // support at the lowest low, supply across the peak bar's upper wick, a breakout at a high.
  const low = pick(10, 80, (x, y) => x.low < y.low), support = shown[low].low
  const peak = pick(10, 50, (x, y) => x.high > y.high)
  const top = shown[peak].high, bottom = Math.max(shown[peak].open, shown[peak].close)
  const breakout = pick(VISIBLE - 15, VISIBLE, (x, y) => x.close > y.close)
  const annotations = new EngineAnnotations({ symbol: symbolKey(workspace.getSymbol()), theme, pricePrecision: symbol.pricePrecision, onChange: () => workspace.chart.requestPaint() })
  workspace.chart.addLayer(annotations)
  annotations.setAnnotations('agent', [
    { key: 'support', kind: 'level', anchors: [{ time: shown[0].timestamp, price: support }], tone: 'bull', text: `Support ${support.toFixed(4)}` },
    { key: 'supply', kind: 'zone', anchors: [{ time: BARS[offset + Math.max(0, peak - 6)].timestamp, price: top }, { time: BARS[offset + Math.min(VISIBLE - 1, peak + 8)].timestamp, price: bottom }], tone: 'bear', text: `Supply ${bottom.toFixed(4)}–${top.toFixed(4)}` },
    { key: 'breakout', kind: 'marker', anchors: [{ time: shown[breakout].timestamp, price: shown[breakout].high }], tone: 'accent', text: 'Breakout' }
  ])
}
void mount('dark', 'dark')
void mount('light', 'light')
