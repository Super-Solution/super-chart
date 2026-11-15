# API layers: which object do I hold?

Super Chart has four things a host can hold. They stack; pick the lowest one that does what you need, and go up only
when you want what the next one adds. Nothing below knows about anything above it.

```
ChartWorkspace   chrome (toolbar, search, palette, menus, replay, status), loader, document, annotations   ── DOM
   │ owns
   ├── DataLoader     history paging, live ticks, replay, retries, caches            ── no DOM (core)
   └── EngineChart    canvas layers, gestures, drawings, indicators, layers           ── DOM canvas
          │ hosts
          └── EngineLayer   your own paint code (annotations are one)
```

| You want | Hold | Package |
| --- | --- | --- |
| A finished chart screen: market and interval controls, symbol search, drawing tools, indicators, replay, save and restore | `ChartWorkspace` (`SuperChart` is its alias) | `-web`; in React, `<SuperChart>` from `-react` |
| Only the canvas: your own toolbar, your own data plumbing, or a card inside another UI | `EngineChart` (import from `-web/engine` for the smallest bundle) | `-web` |
| The data pipeline without any UI: history paging, live ticks, replay, retries, caching, in a worker or on a server | `DataLoader` (and the pure models: `RealtimeSeries`, `RealtimeView`, `DrawingStore`, `EngineIndicators`) | `-core` |
| Marks over the chart that are yours (levels, zones, trend lines, trade plans, anything you register) | `EngineAnnotations` as a layer; `workspace.annotations` already exists | `-web/annotations` |

## ChartWorkspace

Owns an `EngineChart` (`workspace.chart`) and a `DataLoader`, and wires them to the chrome. You give it a `Datafeed`, a
symbol and a period; it loads, shows status, pages older history when the person scrolls, subscribes to live ticks, and
saves the person's drawings per market. Everything the chrome does is also a method, so a host can drive it without
the chrome (`ui: { headless: true }`).

- **Market**: `setMarket`, `setSymbol`, `setPeriod`, `reload`, `cancelLoad`. Same-tick calls share one final request.
- **State and events**: `getLoadState`, `getState`, `getStatus`, `on('marketChange' | 'loadState' | 'loadResult' | 'dataChange' | 'replayChange')`.
- **Document**: `exportDocument` and `restoreDocument`: one strictly validated JSON string. See
  [the persistence example](../examples/workspace-persistence/README.md) for the save, upgrade, invalidate and sync flow.
- **Chrome**: `setTheme`, `setLocale`, `setUi` (headless, layout, intervals, parts), `getSlot`, `registerCommand`,
  `openCommandPalette`, `openSymbolSearch`. See [WORKSPACE-UI.md](WORKSPACE-UI.md).
- **Marks**: `annotations` (a ready `EngineAnnotations`, scoped to the displayed market) and `onAnnotationIntent`.
- **Lifecycle**: `dispose()` stops requests, subscriptions, timers and listeners and removes the DOM. It is safe to call
  twice. Create one per host element; do not share an element.

## EngineChart

The canvas: three layers (main, drawing, cursor), pan/zoom/inspect gestures, the drawing store (65 tools), indicators,
price scale, render options, replay-safe data application. It has no toolbar and no loader: *you* call
`setData`, `prependData`, `update`. Use it when the data does not come from a `Datafeed` (a card in a chat, a static
screenshot, a native shell) or when you build your own chrome.

- Data in: `setData`, `prependData`, `update`, `updateBatch`. Data is normalized once at this boundary.
- State: `view` (viewport, mode), `drawings` (the store), `listIndicators`, `getRenderOptions`, `getLayoutOptions`,
  `getMetrics` (frame counters).
- Interaction: `setDrawingTool`, `setDrawByHolding`, `pointAt` and `drawingAt` (hit tests for your own menus).
- Extension: `addLayer(layer)` returns a remover. A layer paints shapes on the main canvas and words above the drawings.
- `dispose()` removes the canvases, listeners and layers.

## DataLoader (core)

The loader is what makes a `Datafeed` into a chart's data: first page, older pages on demand with backoff, live ticks
coalesced per frame, replay, a bounded history cache and abortable requests. `ChartWorkspace` builds one for you; build
your own when you want the behaviour without the canvas (tests, workers, a native renderer). It talks to a
`ChartDataPort` (`EngineChart.dataPort` is one), never to the DOM.

## Rules that hold at every layer

- **Raw prices are the data.** Heikin Ashi, log scale and percent scale are display transforms; nothing derived is
  written back.
- **Hosts own what is theirs.** The chart never moves a host annotation, never sends an order and never persists code.
  A drag on a `draggable` level emits an intent; the host validates and writes.
- **Failures stay local.** A template that throws, a listener that throws or a feed that fails reports through events and
  status; it does not stop the chart.
- **Create in the browser, dispose on unmount.** Constructors touch the DOM; do not create them during server rendering
  (the React component creates its workspace in an effect for this reason).
