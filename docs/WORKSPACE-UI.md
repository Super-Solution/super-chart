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
| Magnet | While on, a point you place or drag snaps to the open, high, low or close of a bar within 24 px (`chart.setDrawingMagnet(true)`; off by default). Whole-drawing moves never snap. Holding **Ctrl** (Command on a Mac) flips it while held: snap with the magnet off, place freely with it on. |
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

## The crosshair

The crosshair follows the pointer freely on both axes; it does not jump to the
nearest candle. Its price tag shows the price under the pointer (in the pane the
pointer is in; the other panes show only the vertical line), while the OHLC
readout and the time tag still name the bar beside it.

While a drawing tool is armed and the magnet is in effect (the toggle above, or
Ctrl held), the crosshair moves to the open, high, low or close the next point
would land on, so you see where it will snap before you click. It keeps following
the pointer during the press-drag and click-move-click placements. With no tool
armed Ctrl does nothing to the crosshair. `getDrawingMagnet()` reports the toggle,
not the momentary Ctrl state.

## The Powered by Super Chart badge

Every chart carries a small "Powered by Super Chart" badge in its bottom-left
corner, linking to <https://supersolution.io> (new tab, `rel="noopener"`). It is
part of the chart itself, so it is there with every layout, with `headless`, and
without the workspace chrome, and **there is no option to turn it off**.

At rest it is a faint, translucent glass bubble holding the Super Chart mark; hover
or keyboard focus opens it to show the words. It sits in the empty corner where the
price gutter meets the time axis, takes pointer events only on itself, follows the
chart's light or dark theme, and is a real focusable link with an accessible name.
Its DOM is `a.sc-powered`.

The badge shares its row with the time axis, so the chart keeps that row clear of it:
the first time label (and the crosshair's time tag) never starts left of the badge
plus a gap of its own inset, 30px from the chart's left edge. A label whose tick sits
closer to the edge than that is moved right to the clearance instead of running under
the badge. Hovering the badge opens it over the row for as long as the pointer is on it.

## The selection toolbar

Selecting a drawing shows a floating toolbar over it, like TradingView's. It is
built from what the drawing actually draws, so a trend line offers colour, width
and dash, a rectangle adds fill and opacity, a text note adds text colour, and a
brush or highlighter offers width only. Every drawing also gets lock, delete and
a "more" menu (clone, hide, reset style).

- It follows the drawing while you pan or zoom, takes itself out of the way while
  you press on the chart, flips below the drawing when there is no room above,
  and stays inside the plot. The grip on its left moves it for the rest of that
  selection.
- A locked drawing keeps the lock button and loses the editing controls.
- Style lives on the drawing: `Drawing.style` is `{ color, fillColor, fillOpacity,
  textColor, width, dash: 'solid' | 'dashed' | 'dotted' }`, every field optional
  and `#rrggbb` / `#rrggbbaa` for colours. Set it with `chart.drawings.add({ ...,
  style })` or `chart.drawings.update(id, { style })` (`style: null` resets it).
  It round-trips through the version-1 JSON export. An older reader rejects the
  unknown `style` key, so upgrade readers before writers.
- Resolution order: the drawing's `style`, then the chart's drawing options, then
  the theme. Nothing here is hard-wired to the toolbar; a host that wants its own
  editor can switch the part off and drive `style` itself.
- Off: `ui: { parts: { drawingToolbar: false } }`. DOM and CSS surface: `.sc-dt`,
  `.sc-dt-button[data-control]`, `.sc-dt-pop`, `.sc-dt-chip`, `.sc-dt-item`.
- Box tools (rectangle, ellipse and friends) have eight handles: corners resize
  both sides, edge handles resize one. Drawing a two-point tool also works as
  click, move, click; position tools place a ready-made long or short with one
  click, which you then shape with the handles.

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

Wheel and trackpad gestures no longer lock to one of four directions. Each event
is split into a pan part and a zoom part; the weaker part is dropped only when it
is less than about 0.41 times the stronger (a 22.5 degree cone, so eight
directions with the diagonals free). Moving from a vertical scale to a
horizontal pan, or back, takes effect on the next event with no hold-off, and a
real diagonal does both at once.

History loads ahead of the viewport. When the left edge is within about one and a
half screens of the oldest loaded bar, the next page is requested (a single
request at a time), so a pan rarely reaches the end of the data. Tune with
`prefetchBars` on `EngineChart` / `chart: { prefetchBars }` (a number of bars;
`0` waits for the edge).

## Interaction details

- Chart settings contain chart type, price mode (original prices, Heikin Ashi, Renko,
  line break, range bars, Kagi), scale and axis
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

## Saving drawings to a server

`drawingCache` is local and synchronous. To keep a person's drawings on a server (so they follow the person to another
device), use the workspace's three small pieces and the sync client in `@supersolutions/super-chart-core/sync`:

- `workspace.on('drawingsChange', e)` fires when the shown market's drawings change: `e.origin` is `'edit'` for the
  person's own work (draw, move, delete, undo) and `'imported'` for `importDrawings()`. Selection and hover do not fire it.
  Loading a market, and `restoreDocument()`, do not fire it either.
- `workspace.exportDrawings()` returns the shown market's drawings as one JSON document. `importDrawings(json)` replaces
  them; the whole document is checked first, and a bad one changes nothing. Both throw until a market has loaded.
- `DocumentSync` keeps a document in step with a backend that speaks [the sync protocol](SYNC-PROTOCOL.md): writes after a quiet
  moment, retries while offline, keeps unsaved edits in a journal you give it (so a reload does not lose them), and
  never overwrites a newer version: both sides' texts are handed to you as a conflict.

`bindDrawingSync` in `@supersolutions/super-chart-web/sync` connects the two and does nothing else:

```ts
import { DocumentSync, createHttpTransport, mergeDrawingDocuments } from '@supersolutions/super-chart-core/sync'
import { bindDrawingSync } from '@supersolutions/super-chart-web/sync'

const sync = new DocumentSync({
  transport: createHttpTransport({ baseUrl: 'https://api.example.com/v1/docs', headers: async () => ({ authorization: `Bearer ${await token()}` }) }),
  journal: window.localStorage, namespace: 'my-app',
  // Without this, a conflict waits for sync.resolve(id, 'local' | 'remote' | mergedText) and `sync.on('conflict', ...)`.
  conflict: c => (c.remote === null ? 'local' : mergeDrawingDocuments(c.local, c.remote))
})
const binding = bindDrawingSync(workspace, sync, { onError: error => reportToUser(error) })
// ... binding.dispose() when the workspace is destroyed; the sync (and its journal) stays yours.
```

What it does: each edit is saved under `drawings/<symbol key>`; when a market finishes loading its drawings are pulled and
shown (never over an edit that has not been saved); a device that already had drawings and finds none on the server uploads
them as the first version. `mergeDrawingDocuments` keeps both sides' drawings and prefers this device's version of one both
have; it cannot tell a drawing deleted on the other device from one never made there, so a deletion made elsewhere can
come back, and a host that must honour deletions asks the person instead (leave `conflict` at its default).

Drawings of a symbol are shared across its periods, as in `drawingCache`. Annotations written by the host (`/annotations`)
are not drawings and are not synced.

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

### Colour-blind safe themes

`theme: 'dark-colorblind'` and `theme: 'light-colorblind'` (also `render.theme` on `EngineChart`, and in the
command palette) keep the dark or light surfaces and swap the green/red market colours for the Okabe-Ito
blue/orange pair, which holds in the common forms of colour-vision deficiency. The same set colours volume bars,
zones, annotation tones and the indicator lines (which move off blue and orange so they do not read as candles).
Measured on the token values: up and down hold 5.2:1 or better against the chart surface and the price text on
their fills 5.2:1 or better; simulated deuteranopia, protanopia and tritanopia (Machado 2009) put the up/down
colours 85 to 111 CIELAB units apart, against 17 to 36 for green/red under protanopia and deuteranopia.
Colour is still not the only cue: `hollow-candles` and `hollow-down-candles` separate direction by fill.

## Reading the chart without seeing it

The chart region is a focusable group with an accessible description, `describe()` on `EngineChart`
and `ChartWorkspace.chart`: how many bars are in view, the time span, the last bar's open/high/low/close and
its change against the bar before, and the visible indicators. It refreshes at most about once a second while a
feed ticks and is never announced by itself, so a live chart does not chatter.

Shift+Left / Shift+Right step the crosshair bar by bar (the first press lands on the last bar in view). Each step is
announced through a polite live region (time, open, high, low, close, change, volume), the view pans when the next bar
is out of sight, and the crosshair stays on that bar until the pointer moves or Escape is pressed. Unshifted arrows still
pan. `descriptions` on the chart options (the workspace fills it from its locale: `en`, `zh-TW`) replaces the wording.

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

## Price-driven styles

The price mode control, `setPriceMode(mode, options)` and the command palette offer four styles that make one
mark per price move instead of one per time bar: `renko`, `line-break`, `range` and `kagi`. Marks are ordinary
candles (a Renko brick has no wick; Kagi is drawn as a step line), so indicators, volume, drawings, the crosshair and the
keyboard reading work on them. The time axis is no longer evenly spaced in time.

| Style | Rule |
| --- | --- |
| Renko | Traditional, closing prices. Bricks sit on a lattice of `size` anchored at the first close rounded down. A brick in the trend's direction needs a close one brick beyond the last brick; a reversal needs two. A close that jumps several bricks makes them all. |
| Line break | `lines` deep (default 3), closing prices. The first line joins the first two different closes. A close beyond the last line's close extends the trend; a close beyond the high or low of the last `lines` lines reverses it. Every line opens at the previous line's close, reversals included. |
| Range bars | Every finished bar spans exactly `size`. Inside each source bar the path is open, low, high, close for an up bar and open, high, low, close for a down bar (OHLC cannot say which came first, so this is an approximation; tick data would be exact). The next bar opens at the previous close. The bar still forming is the last one. |
| Kagi | Fixed reversal amount `size`, closing prices. One bar per vertical line, from the previous turning point to its current end. Line thickness (yang/yin) is not drawn. |

`size` is the brick, the range or the Kagi reversal in price units. Without one it is the 14-bar average true range of
the loaded bars, measured when the mode is chosen or a symbol loads and then kept, so it does not drift with every
tick. Pass `options.size` to fix it. A source bar that makes more marks than it has milliseconds throws a
`RangeError` that asks for a larger size, and a size that would make millions of marks is refused.

Limits, deliberately:

- A style is computed from the history that is loaded. It does not load older pages (older marks depend on every
  bar before them), and the view stays where it is while live ticks arrive: new marks are appended and the forming
  mark is replaced, with no reset.
- Replay needs the real bars: starting it in a price-driven style throws, and a style cannot be chosen during replay.
- The mode is not part of a saved workspace document.
- Volume of the source bars is shared out over the marks they made; bars that made no mark yet wait for the next one.
- The transforms are pure and exported from `@supersolutions/super-chart-core` (`toRenko`, `toLineBreak`,
  `toRangeBars`, `toKagi`, `deriveBars`, `averageTrueRange`), and `createDerivedSeriesPort` is the adapter the
  workspace uses between its loader and the chart, for hosts that build their own.
