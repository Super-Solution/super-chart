# Workspace interface

The owned Web workspace uses a compact trading-chart layout by default. Market
and interval stay in the first row. Chart presentation and indicator editors open
above the chart instead of expanding the toolbar. Drawing commands remain in a
single horizontally scrollable row. Replay transport appears only during replay.
These are DOM-shell changes; the datafeed, raw-price calculations, indicators,
Canvas rendering and saved workspace document format keep their existing APIs.

## Customising the chrome

The root always has `sc-workspace`. Additional classes and scoped CSS variables
can be provided at construction, or CSS variables can be inherited from the host.
No stylesheet import, UI framework or global theme/storage key is required.

```ts
const workspace = new ChartWorkspace(host, {
  symbol, period, datafeed,
  ui: {
    className: 'broker-chart',
    density: 'comfortable', // optional; default is compact
    variables: {
      '--sc-accent': '#8dbdf5',
      '--sc-focus': '#8dbdf5',
      '--sc-control-height': '32px',
      '--sc-radius': '3px'
    }
  }
})
```

Use `chart.render` and `chart.layout` for the Canvas itself. Workspace CSS tokens
style the controls and panels; they do not silently override chart price colours,
precision, scale or rendering options. `ui` is runtime presentation, not part of
an exported workspace document. Custom values must be strings and property names
must start with `--sc-`. Dark native controls are the default; a host supplying a
light palette should also set `--sc-color-scheme: light`.

| Tokens | Purpose |
| --- | --- |
| `--sc-background`, `--sc-toolbar-background`, `--sc-panel-background` | Shell surfaces |
| `--sc-text`, `--sc-muted`, `--sc-accent`, `--sc-focus`, `--sc-danger` | Text and interaction colours |
| `--sc-border`, `--sc-control-border`, `--sc-panel-border`, `--sc-hover-border` | Boundaries |
| `--sc-control-background`, `--sc-hover-background`, `--sc-active-background`, `--sc-error-background` | Control and feedback surfaces |
| `--sc-font`, `--sc-font-size`, `--sc-color-scheme` | Typography and native controls |
| `--sc-control-height`, `--sc-touch-target` | Control sizes; coarse pointers default to 36px |
| `--sc-radius`, `--sc-panel-radius`, `--sc-panel-shadow` | Shape and panel elevation |

The stable styling hooks are `.sc-marketbar`, `.sc-drawingbar`, `.sc-menu-panel`,
`.sc-indicator-list`, `.sc-stage`, `.sc-footer`, `.sc-replay-controls`, `.sc-search`,
`.sc-button`, `.sc-select`, `.sc-input` and `.sc-field`. They are scoped under the
workspace root. A custom stylesheet can qualify them with the host's root class;
multiple workspaces can have different variables without sharing application state.

## Navigation defaults

Web charts now enable inertial panning by default and limit the viewport to
20–1200 visible candles (short histories remain usable). Hosts can change these
with `chart: { inertia: false, viewport: { minBars: 30, maxBars: 600 } }`.
The same bounds apply to wheel, pinch, keyboard and programmatic navigation;
reduced-motion preference disables coasting and wheel easing. Candle body width
scales with the available slot instead of stopping at 12px.

## Interaction details

- Chart settings contain chart type, original/Heikin Ashi prices, scale and axis
  reversal. Native selects retain keyboard operation. Failed presentation changes
  restore the controls to the actual chart state.
- Only one settings panel opens at a time. Escape closes it and returns focus to
  its summary; clicking outside closes it. Opening symbol search closes settings.
- Indicator parameters, pane and optional pane group have separate labels. Enter
  applies parameter edits. Pane grouping is enabled only for separate panes.
  Editor expansion and focus survive apply/show/hide; removing an indicator
  returns focus to the Indicators control. No indicators has an explicit state.
- All drawing types remain available, grouped into lines, shapes, channels,
  Fibonacci/Gann, patterns, measurement/risk, annotations, studies and freehand.
  Lock state is exposed as a pressed button; a locked drawing cannot be deleted.
- Symbol results separate ticker and description/exchange. Search has explicit
  busy, empty and retry states, keeps request cancellation and supports the
  existing arrow/Home/End/Enter/Escape navigation.
- Loading, empty and failed requests are visible in the chart stage, with the
  existing retry operation retained. Repeated unchanged load messages do not
  rewrite the status DOM for each live tick.
- Replay exposes the current bar index/length, UTC time and speed. Previous/next
  stop at the available boundaries. Keyboard focus moves into the transport on
  entry and back to the start control on exit, only when a focused control hides.
- PNG export disables repeated clicks while a snapshot is pending and restores
  the button after failure or success. Fullscreen exposes its current state.
- Focus rings, disabled states, pressed states, pointer targets and forced-colour
  handling are included. Layout changes do not add animation or new network calls.

This update adds no tests, fixtures, snapshots, dependencies or CI workflows.
Browser validation and any measured gains are reported separately; styling
changes alone are not evidence of faster rendering or complete legacy parity.

## Follow-up: navigation and resource controls

The Web viewport now leaves 12 bounded future slots by default. Set
`rightPaddingBars: 0` to keep the last candle at the edge. Empty slots contain no
market data and inspection returns null. A single-bar history has no inferred
time interval for future drawing anchors.

```ts
chart: {
  viewport: {
    minBars: 20, maxBars: 1200, rightPaddingBars: 12,
    minCandleSpacing: 1.5, maxCandleSpacing: 40
  },
  // Optional quality trade-off, applied separately to each live Canvas layer.
  resolution: { maxPixelRatio: 2, maxCanvasPixels: 2_000_000 },
  // Opt-in dense OHLC envelope painting; inspection still uses exact raw candles.
  render: { candleDensity: 'pixel-envelope' }
}
```

Density uses plot width and clamps the current view only when it exceeds the new
bounds. Resizing does not add navigation history. The time axis supports drag
zoom and double-click reset. Previous/next chart view controls and Alt+Left/Right
are distinct from drawing undo. Horizontal trackpad gestures pan; vertical ones
zoom. Touch long press enters persistent inspection; pinch takes over navigation.
Real touch-device acceptance remains outstanding.

The resolution options have no default cap. There are two full-size layers plus
a third only while drawings/preview exist; budget memory accordingly across
multiple charts. `maxCanvasPixels` is a **per-layer** pixel limit, not a JS heap or
GPU-allocation guarantee. PNG uses the chosen backing resolution. Reduced
resolution can blur output, so hosts must choose it explicitly.

## Optional drawing persistence

```ts
const workspace = new ChartWorkspace(host, {
  datafeed, symbol, period,
  drawingCache: {
    namespace: 'my-chart-panel',
    storage: window.localStorage,
    maxSymbols: 8,
    maxBytes: 2 * 1024 * 1024
  }
})
```

No browser storage is used by default. With an explicit host storage adapter,
completed edits are saved after 250ms of inactivity and synchronously before
changing market, reload or disposal. `saveDrawings()` lets the host flush before
its own navigation. The adapter must implement synchronous `getItem/setItem`
semantics; asynchronous adapters are rejected rather than treated as saved.
Namespaces isolate host panels; they are not an access-control mechanism.

Only acknowledged documents are evicted from the in-memory cache. A failed
write keeps the document, may exceed the memory budget and reports the error.
Handle the error/retry before disposing; disposal throws before destroying the
workspace if the current document could not be saved. The host owns retention
and quota in persistent storage. No stored drawings are deleted automatically.

Without storage, nonempty documents retain the existing in-memory lifetime;
empty market documents no longer accumulate. `getDrawingCacheStats()` reports
approximate UTF-16 string bytes, symbol count and unacknowledged documents.
This is not a whole-browser memory measurement.
