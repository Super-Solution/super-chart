# Super Chart

Owned financial chart renderer, Web workspace and shared React Native data core.
The 0.1 API replaces the former KLineChart-based application. There is no runtime
or peer dependency on KLineChart, KLineChart Pro, Solid, React or React Native.
The GitHub repository remains private; no release is published by a local build.

## Web

Install `@super-solution/super-chart`. Give the host an explicit height; the chart
uses ResizeObserver and the display's pixel ratio. No CSS or font download is
required. Imports work without a DOM; create Web instances in the browser.

```ts
import { SuperChart, type Datafeed, type MarketBar } from '@super-solution/super-chart'

// Connect your market-data service here. Timestamps are epoch milliseconds.
const history: MarketBar[] = []
const datafeed: Datafeed = {
  searchSymbols: async () => [{ ticker: 'SUI-USDC', pricePrecision: 4 }],
  getHistoryKLineData: async () => ({ bars: history, noData: true }),
  subscribe: () => {},
  unsubscribe: () => {}
}
const host = document.createElement('div')
host.style.height = '600px'
document.body.append(host)
const workspace = new SuperChart(host, {
  datafeed,
  symbol: { ticker: 'SUI-USDC', pricePrecision: 4 },
  period: { multiplier: 1, timespan: 'minute', text: '1m' },
  chart: { indicators: [{ name: 'MA', params: [20] }, { name: 'VOL' }] }
})
const result = await workspace.ready
console.log(result.status, workspace.getBars({ limit: 1 }))
// On component unmount:
workspace.dispose()
```

`SuperChart` is an alias of `ChartWorkspace`. Use `EngineChart(host, options)`
when the application supplies its own controls and feed lifecycle. Neither
constructor accepts the old `{ container, ... }` signature.

- Fourteen price series styles, plus Heikin Ashi display; indicators use raw OHLC.
- Linear, logarithmic, percentage and reversed price scales; editable price range.
- Continuous pan/pinch/wheel zoom, keyboard navigation, optional reduced-motion-aware
  inertia, draggable pane boundaries and price axis. Double-click restores auto sizing.
- Seven incremental built-ins: MA, EMA, BOLL, VOL, MACD, RSI and KDJ. Instances can
  change parameters, visibility and pane grouping without recreating the chart.
- All 65 drawing tools, including Gann/waves, positions, VWAP, profiles, local
  raster images and freehand strokes, with selection, anchor/body editing, lock/hide,
  bounded undo/redo and validated JSON import/export.
- Abortable market loading/search, cached history, older-page backoff, coalesced live
  updates and replay. Awaitable load results describe actual applied data, errors,
  superseding requests, cancellation and disposal.
- Keyboard symbol search and optional recent-market persistence, timed replay,
  period-close countdown, indicator settings and validated workspace JSON restore.
- PNG snapshots and Web fullscreen when the browser supports it.

## Optional entries

These modules are excluded from the default chart dependency graph. Import them
when needed; they do not register global engine plugins.

| Entry | Purpose |
| --- | --- |
| `/indicators` | 15 technical and 19 classic indicator definitions |
| `/scripts` | Bounded SuperScript-to-owned-indicator adapter |
| `/annotations` | Symbol-scoped level, zone and marker layers, separate from user undo |
| `/overlays` | Visible-range volume profile, fair-value gaps and order-block heuristics |
| `/superscript` | Server-safe compiler/runtime, diagnostics and host-supplied AI helpers |
| `/core` | Normalization, TA, loader/replay, incremental series, viewport and geometry |
| `/native` | Shared core/owned model plus native lifecycle adapters; host owns rendering/gestures |

```ts
import { EngineChart } from '@super-solution/super-chart'
import { TECHNICAL_INDICATOR_DEFINITIONS } from '@super-solution/super-chart/indicators'
import { createEngineScriptIndicator } from '@super-solution/super-chart/scripts'

const host = document.createElement('div')
host.style.height = '600px'
const chart = new EngineChart(host)
for (const definition of TECHNICAL_INDICATOR_DEFINITIONS) chart.registerIndicator(definition)
chart.addIndicator({ name: 'SC_ATR', pane: 'separate' })
const script = createEngineScriptIndicator({
  name: 'MY_SMA',
  source: '// @overlay\nlength = input(20, minval=1, maxval=200)\nplot(sma(close, length), title="Average")'
})
const attachment = script.attach(chart)
attachment.setParams({ length: 40 })
attachment.dispose()
script.dispose()
chart.dispose()
```

The script adapter supports declared line, histogram and circle plots. Unsupported
constructs and resource-limit violations fail explicitly. It is a synchronous
bounded evaluator, not a security sandbox or an interruptible worker. Arbitrary
JavaScript is never enabled by this adapter. `/superscript` retains the explicit
host-controlled language registry; do not register its JavaScript adapter for
untrusted input.

React Native shares data, calculations, viewport, drawing model and geometry.
The Web Canvas renderer and browser pointer handlers are not a native renderer.
No Worker, OffscreenCanvas, WASM or WebGPU performance claim is made.

## Migration and limits

This is an intentional API break from 0.0.x. `getChart()`, arbitrary upstream
plugins, `KLineChartPro`, `/lite`, `/commands`, legacy CSS paths and private engine
escape hatches are removed. See [the migration guide](docs/OWNED-API-MIGRATION.md)
and [implementation notes](docs/OWNED-ENGINE.md) before changing a consumer.

The [drawing catalog](docs/OWNED-DRAWING-CATALOG.md) maps all 65 former tools to the
owned API. Workspace JSON preserves market, indicators, drawings and presentation;
it does not serialize executable plugins or credentials. The old command palette,
schema and localized chrome are not emulated. Classic indicator formulas have documented conventions;
they are not claimed to be numerically identical to every old upstream formula.
AVP is omitted until turnover/volume units are explicit. Volume profile estimates
activity across candle ranges, not trade prints; order blocks are heuristics.

Initial calculations over very large histories can still block a frame. Optional
custom indicators fully recalculate after data changes. Measured warm live-frame
costs and module sizes are recorded with their workload limits in the implementation
notes; they are not production-device FPS guarantees.

## Development

`bun install --frozen-lockfile --ignore-scripts`, then `bun run build`.
The build validates the packed package and its existing consumer checks. Run relevant
existing unit/browser validation for affected behavior. No automatic test pipeline
is added. Ask the owner before adding tests, assertions, fixtures or snapshots.

`bun run dev -- --host 127.0.0.1 --port 5187` serves `/demo/workspace.html`
and `/demo/engine.html`, using synthetic local data. No exchange credentials are needed.

License: Apache-2.0. Retained code and notices in LICENSE/NOTICE preserve applicable
upstream attribution. Removing the engine dependency does not remove those notices.
