# Workspace interface

The owned Web workspace ships a default look aligned with the established
trading-chart layout: a top bar (symbol, intervals, chart type, indicators,
objects, then undo/redo, view history, snapshot, fullscreen on the right), a
**left tool rail** with the drawing tools grouped under icons, the chart, and a
slim footer. Chart presentation and indicator editors open above the chart
instead of expanding the toolbar. Replay transport appears only during replay.
These are DOM-shell changes; the datafeed, raw-price calculations, indicators,
Canvas rendering and saved workspace document format keep their existing APIs.

The default is a preset, not a fixed design. Everything about it is one of three
levels, from least to most work: **tokens** (`--sc-*` CSS variables and
`registerWorkspaceTheme`), **parts** (switch pieces off), and **slots / the API**
(replace a piece with your own element). Nothing in the default needs forking.

## The left tool rail

The rail holds a cursor and one button per tool group (lines, channels,
Fibonacci & Gann, patterns & waves, shapes & curves, measurement & risk,
annotations, data studies, freehand). Each group button shows the tool you used
last in that group and arms it; pressing it again hands the pointer back to the
chart. The small arrow on its right edge, a right click, a long press on touch,
or Right Arrow opens the whole group in a flyout. The rail is one tab stop; the
arrow keys move within it, Enter or Space chooses, Escape closes the flyout and
returns focus.

Below the groups are two modes and the actions on the selection:

| Control | Does |
| --- | --- |
| Magnet | While on, a point you place or drag snaps to the open, high, low or close of a bar within 24 px (`chart.setDrawingMagnet(true)`; off by default). Whole-drawing moves never snap. |
| Keep drawing | Re-arms the tool after each completed drawing; Escape ends it. Built on `chart.onToolComplete(reason)`, where `reason` is `'completed'` or `'cancelled'`. |
| Lock / Delete | Act on the selected drawing. |
| Remove all | Removes every unlocked drawing in one undoable step. |

The rail shows at `regular` and `compact` widths; `narrow` keeps the Tools
button and the compact dropdown. To use the dropdown everywhere, switch the rail
off: `ui: { parts: { toolRail: false } }`. To build your own toolbox, switch it
off, set tools with `workspace.chart.setDrawingTool(type | null)` and put your
element in a slot. The rail's DOM is stable styling surface: `.sc-rail`,
`.sc-rail-group[data-group][data-tools]`, `.sc-rail-tool`, `.sc-rail-more`,
`.sc-flyout`, `.sc-flyout-item[data-tool]`.

Find the chart element with `.sc-chart`; a bare `[tabindex="0"]` now matches the
rail's tab stop first.

## Host styles

Every button, select, input and summary in the chrome resets `text-transform`,
`letter-spacing`, `word-spacing` and `font-family`, so a host's global `button`
rule (uppercase, wide tracking, a monospace face) does not reach it. A rule that
is more specific than `.sc-workspace button`, or `!important`, still wins: that
is the host's choice. Set `--sc-font` for the chrome's typeface.

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
| `--sc-control-height`, `--sc-touch-target`, `--sc-bar-height` | Control and bar sizes (32px, 40px on coarse pointers, 44px) |
| `--sc-icon-size`, `--sc-rail-icon-size`, `--sc-rail-width` | Icon sizes (18px, 22px) and the rail width (48px) |
| `--sc-button-background`, `--sc-button-border` | Bar buttons are flat (transparent) by default; set these for filled or outlined buttons |
| `--sc-radius`, `--sc-radius-small`, `--sc-panel-radius`, `--sc-panel-shadow` | Shape and panel elevation (6px, 4px, 8px) |

The stable styling hooks are `.sc-marketbar`, `.sc-drawingbar`, `.sc-menu-panel`,
`.sc-indicator-list`, `.sc-stage`, `.sc-footer`, `.sc-replay-controls`, `.sc-search`,
`.sc-button`, `.sc-select`, `.sc-input`, `.sc-field`, `.sc-body`, `.sc-rail` and `.sc-history`. They are scoped under the
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

## Layout, headless mode and slots

```ts
new ChartWorkspace(host, {
  datafeed, symbol, period,
  ui: {
    layout: 'auto',        // 'auto' | 'regular' | 'compact' | 'narrow'
    intervals: 'auto',     // 'auto' | 'bar' | 'select'
    headless: false,       // canvas only
    parts: { symbol: false }, // switch single parts off
    slots: { 'header-end': myElement }
  }
})
```

- `layout` is a size class for the chrome. `regular` has labelled tools, `compact`
  shows icons and moves secondary actions into a More menu, `narrow` also folds
  the drawing tools behind a Tools button and shows the intervals as one
  dropdown. `auto` follows the workspace's own width (`LAYOUT_BREAKPOINTS`:
  narrow below 560px, compact below 780px), not the window's. `getLayout()`
  returns the class in effect. With the rail, `compact` also moves undo/redo into
  More; `narrow` has no rail.
- `intervals: 'select'` renders the period list as a dropdown at any width;
  `'bar'` keeps buttons; `'auto'` picks the bar unless the layout is `narrow`.
- `headless: true` removes the market bar, drawing bar, footer, status, notice and
  replay controls. Loading, replay, drawings, the command palette (keyboard) and
  the API keep working. `parts` switches off one piece at a time
  (`WORKSPACE_PARTS`: `symbol`, `intervals`, `presentation`, `indicators`,
  `objects`, `drawingBar`, `toolRail`, `footer`, `scaleBar`, `commands`); `headless` is all of
  them. `toolRail: false` keeps the drawing bar but puts the tools back in its dropdown.
- `getSlot(name)` returns a host-owned element in one of six named places
  (`WORKSPACE_SLOTS`: `header-start`, `header-end`, `drawing-start`, `drawing-end`,
  `footer-start`, `footer-end`). The workspace never styles or reads its content
  and removes it on `dispose()`. `ui.slots` mounts nodes at construction.
- `ui` can change after construction with `setUi({ headless, layout, intervals,
  parts })`; `className`, `density` and `variables` stay construction-time.

## Symbol search interception

`search.onRequest(request)` is called whenever the search would open: the symbol
button, a letter typed on the chart, the command palette, or `openSymbolSearch()`.
Return `true` to say the host handled it (for example it opened its own picker and
will call `setSymbol` later); the built-in panel then stays closed. Any other
return lets the built-in panel open. A throwing handler is reported in the notice
line and the built-in panel opens, so a bug never leaves the person without
search. `request.trigger` says which entry point asked and `request.query` carries
the typed text. `ui.parts.symbol = false` hides the button when the host has its
own picker.

## Command palette, context menu and object tree

- Ctrl/Cmd+K (or `openCommandPalette(query?)`) opens a searchable list of built-in
  commands (symbol search, reload, themes, intervals, chart types, scale modes, view,
  drawing tools, undo/redo, indicators, replay, PNG) and the host's. `registerCommand(command)` returns a
  remover; registering the same `id` replaces. A command's `when()` can hide it,
  `run` may be async. `listCommands()` returns what is currently available.
  `commands: { enabled: false }` removes the palette and its shortcut;
  `shortcut: false` keeps the palette but drops Ctrl/Cmd+K.
- Right-click on the chart opens a menu. Over a drawing it offers lock/unlock and
  delete (a locked drawing cannot be deleted); everywhere it offers fit the price
  scale, reset the view, jump to the latest bar, remove all drawings (when there
  are some), open the command palette and open symbol search. `contextMenu: { items }`
  appends host entries after a divider; `contextMenu: false` leaves the browser's
  own menu alone. The `target` passed to `items` carries the drawing id and the
  price/time under the pointer.
- The object tree (Objects) lists indicators, drawings and host annotations with
  show/hide, lock and remove. Host annotations are listed read-only: the host owns
  them.

## Scale bar

Beside the chart-settings panel's percent, log and reverse options, the scale bar
has **Auto** (return to the automatic price range after a manual range) and
**UTC** (toggle between UTC and the browser's time zone for axis and crosshair
labels). Both are also palette commands.

## Locales and themes

```ts
import { registerLocale, registerWorkspaceTheme } from '@supersolutions/super-chart-web'

registerLocale('ja', { 'tool.trend-line': 'トレンドライン' /* any subset */ })
registerWorkspaceTheme('midnight', { base: 'dark', /* chrome and canvas overrides */ })
new ChartWorkspace(host, { datafeed, symbol, period, locale: 'ja', theme: 'midnight' })
```

`en` and `zh-TW` ship. A registered locale may be partial: missing keys fall back
to English, and an unknown key never throws. `setLocale` and `setTheme` change a
live workspace; the saved workspace document records the theme (`dark` or
`light`), never a host-defined theme's colours. Registries are module-global:
register before constructing, and use distinct names.

## Hold to draw

`chart: { drawByHolding: true }` (or `{ holdMs, erase }`) turns on a pen gesture
on the chart. Press and keep the pointer still for `holdMs` (default 333ms,
within an 8px slop): the cursor changes and a status line says it is armed.
Then draw. On release the stroke is recognized into the most likely shape: trend
line, horizontal or vertical segment, ray, arrow, rectangle, ellipse, circle or
triangle. The best guess is added as an ordinary drawing (undoable); **Tab** cycles
through the other candidates and **Esc** removes it. A zig-zag scribble erases the
unlocked drawings it crosses (`erase: false` disables that). A stroke too small
or too ambiguous reports `unrecognized` and draws nothing. A press that moves
before the hold elapses stays a normal pan. Events arrive through
`onHoldDraw` / `setHoldDrawListener` for hosts that want to react. The recognizer
itself is pure (`recognizeStroke` in core) and runs without a DOM.

## Host annotations

`workspace.annotations` is the scoped annotation layer. Besides the built-in
`level`, `zone` and `marker` there are templates: `trend`, `ray`, `fibonacci`
(`params.levels`, `params.extend`, `params.prices`) and `plan` (entry, target,
stop; shows reward:risk and refuses an inconsistent plan). `registerTemplate`
adds your own: a pure function from projected anchors to a bounded list of
figures; the layer validates, clips, themes and paints, so a faulty template
loses only its own annotation. A `level` with `draggable: true` can be grabbed
by the person; the chart emits `start`, `move`, `commit` or `cancel` through
`onAnnotationIntent`, and never edits the annotation itself. The host validates
the price and writes it back with `setAnnotations`. See
[API-LAYERS.md](API-LAYERS.md) and [TRADE-HEADS.md](TRADE-HEADS.md).
