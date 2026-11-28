> **Package split.** Imports below are written for the old single package. Since the split into `super-chart-core`, `-superscript`, `-web` and `-chat-plugin`, use the mapping in [PACKAGES.md](PACKAGES.md).

# Owned API migration

This local 0.1 candidate replaces the KLineCharts base engine and Pro wrapper with an owned
renderer and host API. It is a breaking API change, not a drop-in implementation
of `KLineChartPro`, `getChart()`, or the old plugin registry. Existing hosts must
migrate explicitly; old overlay documents are not silently interpreted as new
ones. The SupWallet monorepo is not changed by this package rewrite.

## Entries

| Import | Purpose |
| --- | --- |
| `@super-solution/super-chart` | Web `ChartWorkspace` (`SuperChart` alias), lower-level `EngineChart`, drawings, price scales and engine types |
| `/core` | Renderer-free data normalization, loader, market keys, TA, replay, realtime series/view and financial geometry |
| `/native` | Injected React Native AppState/reconnect lifecycle adapter; no bundled native renderer or gestures |
| `/indicators` | Explicit optional technical/classic indicator definitions |
| `/scripts` | Bounded SuperScript-to-owned-indicator bridge |
| `/annotations` | Owned scoped level, zone, marker and template (trend, ray, Fibonacci, plan, host-registered) annotation layer, with draggable-level intent events |
| `@supersolutions/super-chart-react` | Optional React component over `ChartWorkspace` (new in 0.2.0) |
| `/overlays` | Optional volume profile, fair-value gap and order-block layer |
| `/superscript` | Pure language runtime, TA helpers and AI helpers; JavaScript requires deliberate language registration |

`/lite`, `/commands`, `/style.css` and `/dist/*` are removed. No global engine
registry is populated on import. The workspace creates its own scoped DOM styles;
there is no required stylesheet/font import. Importing the package is safe without
a DOM; constructing a Web chart still requires a live document and Canvas 2D.

## Host API map

| Old usage / responsibility | Owned replacement |
| --- | --- |
| `new SuperChart({ container, ... })` / `KLineChartPro` | `new ChartWorkspace(host, { datafeed, symbol, period, chart?, loader?, search?, countdown? })`; `SuperChart` is an alias of this constructor |
| `getChart()` and private upstream stores | `workspace.chart`, an `EngineChart` with its own documented methods; upstream stores are gone |
| Fire-and-forget market switches | Await `ready`, `setSymbol`, `setPeriod`, `setMarket` or `reload` and inspect the returned outcome |
| Load/spinner state | `getLoadState()` distinguishes requested and actually applied markets; `getStatus()` exposes loader status |
| Data/state snapshot | `getBars({ limit? })`, `getState()`, `getReplayState()` return owned snapshots |
| Event subscription | `on/off` with `marketChange`, `loadState`, `loadResult`, `dataChange`, `replayChange`; `on` returns an unsubscribe function |
| Replay controls | `startReplay(index?)`, `startReplayAt(epochMilliseconds)`, `stepReplay(delta)`, `playReplay(speed?)`, `pauseReplay()`, `setReplaySpeed(speed)`, `exitReplay()`; no additional historical feed subscription |
| Bar-close countdown | Workspace `countdown` options; market-local daily/calendar boundaries and an explicit exchange-close callback when needed |
| Search and recent symbols | Abortable search, keyboard navigation and type-to-search; `search` options provide bounded in-memory recents or an explicit host storage namespace |
| Apply data without workspace controls | `EngineChart.setData`, `prependData`, `update`, `updateBatch`, or attach a loader through `dataPort` |
| Pan/zoom/follow control | `chart.view` owns viewport operations; pointer/wheel/keyboard input is attached by `EngineChart` |
| Theme/chart-type engine presets | `chart.setRenderOptions(...)`; rendering colors/font/chart type are explicit owned options |
| Price scale/pane sizing | `chart.setLayout({ priceScale, priceRatio, paneWeights })`; pane boundaries also support resizing by pointer |
| Global indicator registration | `chart.registerIndicator(definition)`, then `addIndicator(spec)`; registration alone performs no calculation |
| Indicator settings/visibility/grouping | `updateIndicator(id, { params, pane, paneId, visible })`, `listIndicators()`, `removeIndicator(id)` |
| Replace indicator configuration | `validateIndicatorReplacement(specs)` and `replaceIndicators(specs)` validate the complete set before changing instances |
| Script indicator registry bridge | `createEngineScriptIndicator(...).attach(chart)` from `/scripts`; dispose the attachment to release its instance |
| Arbitrary overlay plugin hooks | Explicit `EngineLayer` with `update/paint/dispose`, attached through `chart.addLayer(layer)` |
| User drawings | `chart.drawings` (`DrawingStore`) and `chart.setDrawingTool(type)` |
| Annotation API | `EngineAnnotations` from `/annotations`, attached as a layer; call `setScope` when market changes and `requestPaint` when the model changes. `ChartWorkspace` owns one as `workspace.annotations` and manages scope and theme itself |
| `registerOverlay` (custom shapes) | `workspace.annotations.registerTemplate({ name, anchors, create })`: a pure function from projected anchors to figures; the layer validates, clips and paints. Not a hook into a canvas or a store |
| Overlay drag callbacks | `draggable` level plus `workspace.onAnnotationIntent(listener)`: `start`, `move`, `commit`, `cancel`. The chart never edits the spec; the host validates and writes the new price |
| Hold-to-draw / shape recognition | `chart: { drawByHolding: true }`; `recognizeStroke` (core) is the pure recognizer |
| Command palette, context menu, object tree | Built in: `registerCommand`, `openCommandPalette`, `contextMenu.items`, the Objects panel |
| i18n and theme registries | `registerLocale`, `registerWorkspaceTheme`, `locale` / `theme` options, `setLocale` / `setTheme` |
| Header slots, headless, compact layout | `ui.slots` / `getSlot`, `ui.headless`, `ui.parts`, `ui.layout`, `ui.intervals` |
| Intercept the built-in symbol search | `search.onRequest(request)` returns `true` when the host handled it |
| Save/restore a workspace | `exportDocument()` and `await restoreDocument(json)` use a strict owned version-1 JSON schema; storage remains host-controlled |
| Image export | `await chart.snapshot()` returns a PNG Blob after decoding retained image drawings, excluding the cursor, selection handles and edits in progress |
| Teardown | `workspace.dispose()` stops the loader before disposing the chart; an independently constructed chart has its own `dispose()` |

### Minimal workspace

```ts
import { ChartWorkspace } from '@super-solution/super-chart'
import type { Datafeed } from '@super-solution/super-chart/core'

declare const host: HTMLElement
declare const datafeed: Datafeed
const workspace = new ChartWorkspace(host, {
  datafeed,
  symbol: { ticker: 'BTC-USDT', pricePrecision: 2 },
  period: { multiplier: 15, timespan: 'minute', text: '15m' }
})
const outcome = await workspace.ready
if (outcome.status === 'error') console.error(outcome.message)
// Later, when the host unmounts:
workspace.dispose()
```

Loading outcomes are `loaded`, `unchanged`, `superseded`, `error`, `cancelled` or
`disposed`. `loaded` means data has actually been applied, including a successful
empty response (`bars: 0`); it does not mean a trade, live connection or market is
valid. Calls within one microtask coalesce into one final market request. Cached
bars may be applied internally while refresh remains loading; the workspace
keeps the plot hidden until the requested pair is ready. Cached application does
not settle the Promise. `cancelLoad()` aborts pending work, releases its loader and
cache, and prevents late responses from applying. A retry makes a new request.

Events are frozen snapshots delivered on a microtask, preventing listeners from
interrupting a loader application. If a listener starts another load, its event
payload still describes the original event; current getters may already describe
the next requested market. Synchronous argument errors throw before a request.
Network/application failures are returned as an `error` outcome.

### Replay, countdown and search

Timed replay advances one real loaded bar every `600 / speed` milliseconds. It
does not synthesize prices or race through missed timers after a stalled tab.
Pause, market changes, cancellation and disposal stop playback; hiding the page
pauses it without automatically restarting. Timestamps are epoch milliseconds.
Replay buffers incoming data through the existing loader and reveals only the
selected history to indicators, drawings and optional layers.

The countdown is a period-boundary estimate unless the symbol carries a
`session` (see [WORKSPACE-UI.md](WORKSPACE-UI.md#trading-sessions)), in which
case it ends at the real session close. Without one, intraday intervals use elapsed time; daily and longer intervals advance the
symbol's local calendar, including DST. Stale bars, replay, unavailable data and
ambiguous/nonexistent calendar boundaries hide the countdown. Configure
`countdown.closeTimestamp(market, lastBar)` for holidays or early closes; return
`null` when that boundary is unknown; the host's value wins over the schedule.
`countdown.enabled: false` disables it.

Search recents use canonical market identity, including venue/market fields, not
the ticker alone. They are kept only in memory unless the host explicitly supplies
`search.persistKey`; `search.storage` can supply a host-owned storage adapter.
Arrow keys navigate current results, Enter selects only a result for the current
query, and Escape closes the dialog. A printable alphanumeric key while the chart
has focus opens search. Configured interval objects and shorthand such as `4H`
are accepted; an unconfigured interval requires the feed's `resolvePeriod`.

### Workspace documents

`exportDocument()` saves the settled market, period, display mode, render/layout
options, indicator instances and retained drawings. It excludes executable code,
feeds, callbacks, credentials, transient selection and undo history. The host
chooses where and whether to store the returned JSON; there is no implicit global
layout storage.

`restoreDocument()` validates the schema and registered indicator parameters and
decodes local image resources before requesting the saved market. Its generation
guards prevent a superseded restore from applying settings to a different market.
Unknown properties, invalid prices/parameters and unsupported versions are
rejected rather than coerced. Optional custom indicators must already be registered
by the host. Successful restoration replaces drawing history and synchronizes
the workspace controls with the restored presentation.

`parseWorkspaceDocument()` performs detached validation without loading a feed or
executing custom code. Lower-level hosts can use `chart.restoreConfiguration()`;
they remain responsible for market binding and `prepareDrawingImages()` before
applying image documents. `getState()` is an observation snapshot, not a document
accepted by `restoreDocument()`.

## Supported calculations and rendering

The base engine registers seven indicators: MA, EMA, BOLL, VOL, MACD, RSI and KDJ.
The optional packs provide 34 more definitions (41 total):

- Technical: SC_RSI, SC_MACD, SC_SMA, SC_ATR, SC_ATR_BANDS, SC_KELTNER,
  SC_DONCHIAN, SC_VWAP, SC_STOCH, SC_STOCHRSI, SC_MFI, SC_BBP,
  SC_SUPERTREND, SC_ICHIMOKU, SC_PDHL. Later releases add more names to the optional technical pack (0.13 adds
  SC_AROON, SC_CMF, SC_ADL, SC_FORCE, SC_VORTEX, SC_TSI, SC_ULTIMATE, SC_ZIGZAG, SC_PIVOTS and SC_CHANDELIER;
  see [OWNED-ENGINE.md](OWNED-ENGINE.md)); `TECHNICAL_INDICATOR_NAMES` is the current list.
- Classic: CCI, DMI, CR, PSY, DMA, TRIX, OBV, VR, WR, MTM, EMV, ROC,
  PVT, AO, SAR, BIAS, BRAR, SMA, BBI.

Definitions describe actual owned formulas and parameters; similarly named
upstream indicators do not imply identical initialization, smoothing, output keys
or every upstream option. Indicators use revealed raw OHLCV even when the price
series displays Heikin-Ashi. The seven base indicators have incremental tail
paths; optional/script/custom calculations may recompute the revealed history.

Fifteen price render types are available through `ENGINE_CHART_TYPES`: candles,
hollow-candles, outline-candles, hollow-down-candles, ohlc, volume-bars, columns,
high-low, line, line-markers, step-line, area, hlc-area, baseline and point-figure
(the last needs `pointFigureBox` and is normally set by the point and figure price mode). Heikin-Ashi is
a separate data display mode. Horizontal spacing is category spacing; time gaps
are not proportional wall-clock gaps. Linear/log/percentage and reversed price
scales are supported, with optional explicit raw-price bounds.

`render.timeZone` is the viewer's display zone. Workspace supplies the actual
`render.timespan` and `render.symbolTimezone` from its period and symbol. Day,
week, month and year labels use the market session zone (default UTC); intraday
labels use the display zone, with seconds preserved for second-period feeds.
Hosts constructing `EngineChart` directly supply these market options themselves.

All 65 tools from the previous drawing rail now have owned implementations in
`DRAWING_TYPES`; [the drawing catalog](OWNED-DRAWING-CATALOG.md) maps their names,
anchors and semantics. These include lines/channels, multi-anchor patterns,
Fibonacci/Gann constructions, text, local images, brush/highlighter, position
measurements, regression, anchored VWAP and volume profiles. This preserves the
functional catalog without promising identical upstream pixels or plugin APIs.
Drawings support selection, anchor/body editing, locking, visibility, shared
undo/redo and strict version-1 JSON import/export. Incomplete gestures are discarded
on cancellation; a completed freehand stroke creates one undo operation.
ChartWorkspace keeps drawings per market in memory across market switches.

The workspace's own tool picker is a left rail with grouped icons and flyouts
(see [Workspace interface](WORKSPACE-UI.md)); the old `<select>` is still there
as `ui: { parts: { toolRail: false } }`, and in the `narrow` layout. The rail adds
a **magnet** (`chart.setDrawingMagnet`) and **keep drawing**; both were features
of the previous rail. Still not carried over, and not claimed: per-drawing style
editing (colour, width, dash), hide-all, favourite tools and per-tool hotkeys.
A selected brush or highlighter stroke no longer shows an editing handle at each
sample point (it moves as one body), and `onToolComplete` now receives
`'completed'` or `'cancelled'`.

Images accept bounded local static PNG/JPEG/WebP files. SVG, animation and remote
URLs are rejected. Image decoding has per-image and per-chart limits, and bitmap
resources are released when unused or disposed. A snapshot waits for its retained
images; if drawings change during preparation it reports an error rather than
silently exporting an incomplete image. Freehand paths retain timestamp/price
anchors with adaptive sampling bounded to 2048 points. The entire drawing document
is bounded to 8 MiB; workspace documents have their own complete-schema bound.

Volume profile is an estimate distributing reported candle volume across its
high/low range, not trade-by-price data. FVG/order-block features preserve the
owned heuristic and use a bounded scan; a too-wide window explicitly shows
unavailable status instead of silently truncating zones. They are chart analysis,
not execution signals or evidence of profitability.

## Deliberately unsupported legacy behavior

- Upstream `Chart`, `ChartStore`, pane/time/price store access, figure registries,
  `registerOverlay` as a canvas/store hook (annotation templates replace the common uses), callback-driven overlay steps and arbitrary upstream plugins.
- Old raw overlay/figure serialization. Convert meaningful timestamps/prices to
  the new drawing or annotation schema in the host; invalid data is rejected.
- Freehand-to-shape recognition of the Brush and Highlighter tools: they retain
  the stroke. Recognition is opt-in through hold-to-draw (`drawByHolding`), which
  produces ordinary drawings.
- The old command-registry facade (the new `registerCommand` is a separate,
  smaller API), the old Pro editor panels and any chrome not listed in
  `WORKSPACE-UI.md`.
- Automatic global layout storage and restoration of arbitrary old Pro JSON.
  The owned workspace document API is explicit and does not restore executable
  plugin/layer code or feed subscriptions from serialized data.
- Old oscillator reference-line styling and implicit aliases. Optional script
  horizontal lines and explicit host annotations have owned implementations.
- An embedded native Canvas renderer. React Native reuses core models/data/TA and
  its lifecycle adapter while the host retains native drawing and gestures.
- Running arbitrary JavaScript in the owned chart script bridge. `/scripts` accepts
  SuperScript only and rejects unsupported/ignored syntax. Line, bar, circle and
  horizontal-line plots are supported; script step/area/cross plots, secondary
  symbols/timeframes and unbounded calculations are rejected. Synchronous
  resource ceilings are not an isolation sandbox or an interruptible timeout.

`/superscript` separately retains explicit language registration for hosts that
already own that trust boundary; registering `JavaScriptLanguage` permits code
execution. Do not register it for untrusted source. Optional AI helpers remain
host-invoked; the chart does not make automatic paid model requests.

## Defaults that changed after 0.13 (workspace)

These change what a workspace looks like with no options. Each has an option that brings the old behaviour back.

| Default | Was | Now | To keep the old one |
|---|---|---|---|
| Price axis | left | right | `layout.priceScale.side: 'left'` |
| Volume | its own pane | a band over the bottom of the price pane | add `VOL` with `pane: 'separate'` |
| Candle body | hollow up candles | solid | `chartType: 'hollow-candles'` |
| Footer | the clock and zone only | quick ranges (1D … all), clock, zone, `%`, log, Auto | `parts: { footer: false }` or the footer slots |
| Indicator catalog | the 7 built-ins | built-ins, the technical pack and the classic pack (about 60) | `indicators: { catalog: false }` |
| Drawing colour | ink (white on dark) | the `drawing` token (blue) | `color` render option, or a theme with `drawing` set to ink |
| First Lines tool and `Alt+T` | `trend-line` (ran on past both points) | `segment`, labelled Trend line; `trend-line` is labelled Extended line | `chart.setDrawingTool('trend-line')` |
| Background watermark | none | symbol and "name, interval", very faint | `render: { watermark: null }` |
| `compact` size class | below 780px | below 1040px (the market bar is one row at every width) | `ui: { layout: 'regular' }` |
| Chat plugin fibonacci mark | level 0 at the first anchor | level 0 at the second anchor, like the drawing tool (a retracement reads from where the move ended) | swap the two anchors |
