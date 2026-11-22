# Super Chart

Financial charting for people and agents: a renderer-free core, the SuperScript
indicator language, a Canvas workspace for the browser, and a super-chat plugin
that lets an agent put a chart in a conversation and mark it up.

There is no runtime or peer dependency on KLineChart, Solid, React or React
Native. Nothing is published by a local build.

## Packages

Dependencies only point down. Install the layers you need.

| Package | What it is | Depends on |
| --- | --- | --- |
| `@supersolutions/super-chart-core` | Market data contracts, loader/replay, series and TA, indicators, drawings, frame and workspace models, React Native lifecycle. No DOM. Subpaths `/native`, `/indicators` | none |
| `@supersolutions/super-chart-superscript` | SuperScript compiler/runtime, host-supplied AI helpers, script-to-indicator bridge (`/scripts`). Runs in plain Node | core |
| `@supersolutions/super-chart-web` | Canvas chart engine and workspace UI, annotations (`/annotations`), market overlays (`/overlays`) | core |
| `@supersolutions/super-chart-react` | `SuperChart` React component and `useWorkspaceEvent`; React is a peer dependency | core, web |
| `@supersolutions/super-chart-chat-plugin` | `super-chart.chart` card plus the agent tools, as a super-chat plugin | core, web, `@supersolutions/super-protocol` |

Folders group packages by role, and a new framework or language is one more
folder: `packages/core`, `packages/superscript`, `packages/bindings/web` (one
folder per UI framework), `packages/integrations/chat-plugin`, and
`backends/<language>/` for server-side ports of the kernels (Go and Python ports,
tested against `conformance/`). npm names do not depend on the
folder.

All five are GPL-3.0-or-later (commercial licence available). The plugin
interface itself lives in the Apache-2.0
[`@supersolutions/super-protocol`](https://github.com/Super-Solution/super-chat/tree/main/packages/protocol),
so an Apache host such as super-chat can load this plugin without linking GPL
code. See [docs/PACKAGES.md](docs/PACKAGES.md) for the layering rules and the
mapping from the old `@super-solution/super-chart` imports.

## Web

Give the host an explicit height; the chart uses ResizeObserver and the display's
pixel ratio. No CSS or font download is needed. Imports work without a DOM;
create Web instances in the browser.

```ts
import { SuperChart } from '@supersolutions/super-chart-web'
import type { Datafeed, MarketBar } from '@supersolutions/super-chart-core'

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

`SuperChart` is an alias of `ChartWorkspace`. Use `EngineChart(host, options)` when
the application supplies its own controls and feed lifecycle.

### React

```tsx
import { SuperChart } from '@supersolutions/super-chart-react'

// Create the datafeed outside the component (or memoize it): a new one mounts a new chart.
<SuperChart datafeed={datafeed} symbol={symbol} period="15m" theme="dark"
  onMarketChange={event => save(event)} style={{ height: 600 }} />
```

Symbol, period, theme, locale and `ui` follow the props; the ref is the
`ChartWorkspace`. Safe under Strict Mode and server rendering. Full example:
[examples/react](examples/react/README.md).

### Chrome, commands and interaction

The workspace chrome adapts to its own width (`ui.layout`: `auto`, `regular`,
`compact`, `narrow`), can be removed (`ui.headless`, `ui.parts`) or extended
(`getSlot`), and has a command palette (Ctrl/Cmd+K, `registerCommand`), a
right-click menu, an object tree, intervals as a bar or a dropdown, host
interception of the symbol search (`search.onRequest`), registered locales
(`registerLocale`) and themes (`registerWorkspaceTheme`). Hold the pointer still
on the chart (`drawByHolding`) and draw a shape: it is recognized into a line,
ray, rectangle, ellipse or triangle, and a scribble erases drawings. Host marks
(levels, zones, markers, trend lines, Fibonacci, trade plans, custom templates)
go through the annotation layer; a draggable level only emits an intent event, the
host decides what the new price means. See [docs/WORKSPACE-UI.md](docs/WORKSPACE-UI.md)
and [docs/API-LAYERS.md](docs/API-LAYERS.md).

- Fourteen price series styles, plus Heikin Ashi display; indicators use raw OHLC.
- Linear, logarithmic, percentage and reversed price scales; editable price range.
- Continuous pan/pinch/wheel zoom, keyboard navigation, optional reduced-motion-aware
  inertia, draggable pane boundaries and price axis.
- Seven incremental built-ins (MA, EMA, BOLL, VOL, MACD, RSI, KDJ); 15 technical and
  19 classic definitions in core's `/indicators`.
- All 65 drawing tools with selection, editing, lock/hide, bounded undo/redo and
  validated JSON import/export, a `drawingsChange` event, and optional server sync of
  the person's drawings (`/sync` in core and web; [protocol](docs/SYNC-PROTOCOL.md),
  [usage](docs/WORKSPACE-UI.md#saving-drawings-to-a-server)).
- Abortable market loading/search, cached history, older-page backoff, coalesced live
  updates, replay, period-close countdown and validated workspace JSON restore.
- PNG snapshots and fullscreen when the browser supports it.

## In a chat

```ts
import { installChatPlugin } from '@supersolutions/super-chat-plugin'
import { createChartChatPlugin } from '@supersolutions/super-chart-chat-plugin'

installChatPlugin(registry, createChartChatPlugin({
  resolveFeed: id => feeds[id] // optional: lets cards say `feed: { id }` instead of carrying bars
}))
```

An agent shows a `super-chart.chart` card (inline bars or a registered feed) and
then reads or changes it with seven tools: `chart_state`, `chart_bars`,
`chart_set_market`, `chart_annotate`, `chart_clear_annotations`,
`chart_indicators`, `chart_replay`. Annotations are validated twice (protocol and
engine) and the tool result says which keys were applied or rejected. See
[docs/CHAT-PLUGIN.md](docs/CHAT-PLUGIN.md).

## SuperScript and analyses

```ts
import { EngineChart } from '@supersolutions/super-chart-web'
import { TECHNICAL_INDICATOR_DEFINITIONS } from '@supersolutions/super-chart-core/indicators'
import { createEngineScriptIndicator } from '@supersolutions/super-chart-superscript/scripts'

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
JavaScript is never enabled by this adapter; do not register the JavaScript
language adapter of `super-chart-superscript` for untrusted input.

`super-chart-web/overlays` adds visible-range volume profile, fair-value gaps and
order-block heuristics; `super-chart-web/annotations` adds symbol-scoped level, zone
and marker layers separate from user undo.

React Native shares data, calculations, viewport, drawing model and geometry through
`super-chart-core` and `/native`. The Web Canvas renderer and pointer handlers are not
a native renderer. No Worker, OffscreenCanvas, WASM or WebGPU performance claim is made.

## Migration and limits

This is an intentional API break from 0.0.x. `getChart()`, arbitrary upstream plugins,
`KLineChartPro`, `/lite`, `/commands`, `DefaultDatafeed`, legacy CSS paths and private
engine escape hatches are removed. See [the migration guide](docs/OWNED-API-MIGRATION.md)
and [implementation notes](docs/OWNED-ENGINE.md) before changing a consumer.

The [drawing catalog](docs/OWNED-DRAWING-CATALOG.md) maps all 65 former tools to the
owned API. Workspace JSON preserves market, indicators, drawings and presentation; it
does not serialize executable plugins or credentials. The old command palette, schema
and localized chrome are not emulated; agents drive the chart through the plugin tools
instead. AVP is omitted until turnover/volume units are explicit. Volume profile
estimates activity across candle ranges, not trade prints; order blocks are heuristics.

The workspace chrome is dark by default. Pass `theme: 'light'` or call
`workspace.setTheme('light')` for matching light controls and canvas colours. Presets
use the same `--sc-*` variables as the default UI; `WORKSPACE_CHROME_VARS` lists their
names. Customize through host CSS or `ui.variables` (for example `--sc-background`,
`--sc-text`, `--sc-control-background`), and use `chart.render` for canvas colours.
Constructor `ui.variables` and `chart.render` values override the chosen preset;
calling `setTheme` later replaces its chrome and canvas colours. The chat plugin
passes its card theme through. Initial calculations over very large histories can
still block a frame.

## Development

`npm install`, then `npm run build` (esbuild + one bundled `.d.ts` per entry, then
`scripts/check-package.mjs`: manifests, layering, banned dependencies, packed
contents, plain-Node import of the server-safe entries). `npm run typecheck`,
`npm test`, `npm run lint`. Browser cases: `cd e2e && npx playwright test`.

`npm run dev` serves `/demo/workspace.html` and `/demo/engine.html` with synthetic
local data. `npm run examples` opens [`examples/`](examples/README.md): runnable web and React
examples and a playground, against the sources in your checkout; they are not published.
The chat plugin additionally needs `@supersolutions/super-protocol`.
Ask the owner before adding tests, assertions, fixtures or snapshots (AGENTS.md).

License: GPL-3.0-or-later; commercial licence available. See LICENSE and NOTICE.
