> Private development **v0.0.52** in `Super-Solution/super-chart`, based on the imported v0.0.40 snapshot. Shared Web/React Native data lifecycle and computation are available through `./core` and `./native`; rendering and gestures remain host-specific. See [shared-core scope and measurements](docs/SHARED-CORE.md) and [shared loader/lifecycle](docs/SHARED-LOADER.md) and [opt-in native lifecycle](docs/NATIVE-LIFECYCLE.md). [Phase 4](docs/AXIS-KEY-PERFORMANCE.md) reduces repeated axis-key computation; [phase 5](docs/LATEST-HIT-PERFORMANCE.md) removes unused latest-hit history. [Phase 6](docs/SHARED-CANDLE-TRANSFORM.md) shares the Heikin Ashi transform without per-bar check arrays. No package has been published and no automatic CI/release workflow is installed.

<div align="center">

# SUPer-Chart

**A TradingView-grade financial charting engine — with built-in AI and the SuperScript language.**

Maintained by [ZzyzxLabs](https://github.com/ZzyzxLabs). Built on [KLineChart](https://github.com/klinecharts) · Apache-2.0

</div>

---

## What is this

SUPer-Chart is our own, fully-maintained charting engine for the Sup/ZZYZX products. It is a fork of
[KLineChart Pro](https://github.com/klinecharts/pro) (Apache-2.0) — a mature, high-performance candlestick
engine — that we extend in three directions the upstream doesn't cover:

1. **TradingView-grade UX** — the goal is parity with TradingView's *feel*: drawing tools, indicators,
   multi-pane, symbol search, periods, timezones, screenshots. Pro already ships most of this; we polish
   and fill the gaps.
2. **SuperScript** — our own indicator/strategy language (Pine-flavoured), with a pluggable runtime so
   other languages (JavaScript today) plug into the same pipeline and render through the same chart bridge.
3. **AI, first-class** — natural-language → SuperScript, and on-chart market analysis, behind a small
   model-agnostic seam so the host wires whichever model it wants (Claude, a self-hosted endpoint, …).

> **Why fork instead of depend?** We need to evolve the engine itself — new overlays, the SuperScript
> runtime, AI hooks deep in the chart — not just configure it from the outside. Owning the fork lets us do
> that while staying current with upstream (we track the fork point and cherry-pick fixes).

## Status

🚧 **v0 — foundation.** This is the initial fork + the first cut of the two ZzyzxLabs layers.

| Area | State |
| --- | --- |
| KLineChart Pro engine (`SuperChart` / `KLineChartPro`) | ✅ inherited from upstream fork |
| SuperScript runtime (moving averages, oscillators, volatility, signals, pivots, `input()`, `plot()`) | ✅ v0 |
| Pluggable language registry (SuperScript; a JavaScript adapter a host opts into) | ✅ v0 |
| Script → on-chart indicator bridge (`registerScriptIndicator`) | ✅ v0 |
| AI seam (`AIClient`, `nlToSuperScript`, `nlToSuperScriptChecked`, `buildChartContext`, `analyzeChart`) | ✅ v0 (interface + HTTP client) |
| Full TradingView parity, more built-ins, backtesting, AI side-panel UI | ⏳ roadmap |

## Install

The package is private. It is published only to GitHub Packages, for this organisation:

```bash
# .npmrc (the token needs read:packages)
@zzyzxlabs:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GH_PACKAGES_TOKEN}
```

```bash
npm install @zzyzxlabs/super-chart klinecharts@^9
```

`klinecharts` is a peer dependency: `^9.7.2`, that is 9.7.2 or a later 9.x. Super Chart is built and tested
against 9.8.12 (what SupWallet resolves) and 9.7.2 (Broker's pin). klinecharts 10 is not supported yet; a plain
`npm install klinecharts` would fetch it, so keep the `@^9`.

In this repository, SupWallet installs a committed tarball instead, so no install needs a registry credential:
`"@zzyzxlabs/super-chart": "file:../../vendor/zzyzxlabs-super-chart-<version>.tgz"` (see `MAINTAINING.md`).

## Quick start

```ts
import { SuperChart, type Datafeed } from "@zzyzxlabs/super-chart";
import "@zzyzxlabs/super-chart/style.css"; // or "@zzyzxlabs/super-chart/dist/klinecharts-pro.css"

declare const myDatafeed: Datafeed; // your implementation, see "Datafeed" below

const chart = new SuperChart({
  container: "container", // an element id (no '#'), or the HTMLElement itself
  symbol: { ticker: "BTC-USDT", name: "Bitcoin / Tether", pricePrecision: 2 },
  period: { multiplier: 15, timespan: "minute", text: "15m" },
  datafeed: myDatafeed,
  theme: "dark",
  locale: "en-US",
});

// Later: chart.dispose();
```

`SuperChart` is the public name of the engine (it is the KLineChart-Pro base class we extend). The original
`KLineChartPro` export is kept as an alias for drop-in compatibility.

Construct the chart in the browser (for example in an effect). Importing the package needs no DOM, so a
server-rendered file that a bundler builds (Next, webpack, Vite, Bun) can import it; constructing a chart without
a DOM throws a clear error. Plain Node, without a bundler, cannot load `.`: klinecharts 9.7 and 9.8 point Node at
their UMD file, which Node loads as an ES module without klinecharts' functions, so registering the overlays on import
fails. Node tools (MCP servers, backends, scripts) use `@zzyzxlabs/super-chart/superscript`.

## Entry points

| Import | What it is |
| --- | --- |
| `@zzyzxlabs/super-chart` | The full engine (`SuperChart` and its chrome) plus everything below. Registers Super Chart's drawing overlays when it loads. |
| `@zzyzxlabs/super-chart/lite` | No chart chrome: `chartStyles`, SuperScript, `registerScriptIndicator`, the AI helpers and `registerExtensionOverlays()`. For hosts that drive a `klinecharts` chart themselves. Registers nothing on import. |
| `@zzyzxlabs/super-chart/superscript` | The SuperScript runtime and AI helpers with no klinecharts and no DOM: runs in plain Node (MCP tools, backends). Only SuperScript runs by default; any other language must be registered through this entry first. |
| `@zzyzxlabs/super-chart/commands` | The AI/MCP command registry's DOM-free descriptors (`COMMAND_DESCRIPTORS`, `getCommandDescriptors()`, `findCommandDescriptor()`, `validateAgainstSchema()`) — no klinecharts, no Solid, no DOM. For a server that only needs to list or validate tool schemas (an MCP gateway) without ever constructing a chart. Also re-exported from `./lite`. |
| `@zzyzxlabs/super-chart/style.css` | The chrome CSS. Same file as `@zzyzxlabs/super-chart/dist/klinecharts-pro.css`, which keeps working. |

The package is tree-shakeable (`"sideEffects"` lists only the `.` bundles and CSS): importing `chartStyles`
from `./lite` costs about 1.3 KB minified in a webpack production build.

`require()` of `.` resolves to a CommonJS build (`dist/klinecharts-pro.cjs`), for bundlers and test runners that use
the `require` condition. It is a separate copy of the engine with its own language registry and figures: do not mix
it with imports of `./lite` or `./superscript` in one program.

## Options

`new SuperChart(options)` takes one object. See `ChartProOptions` in `src/types.ts`.

| Option | Default | What it does |
| --- | --- | --- |
| `container` | (required) | An element id (no `#`), or an `HTMLElement`. |
| `symbol` | (required) | The `SymbolInfo` to show. |
| `period` | (required) | The `Period` to show. |
| `datafeed` | (required) | Your `Datafeed` (see below). |
| `theme` | `'light'` | `'light'` or `'dark'` (`THEMES`). An unknown value is ignored with a console warning. |
| `locale` | `'zh-CN'` | `'zh-CN'` or `'en-US'`; add more with `loadLocales`. |
| `chartType` | `'candle_solid'` | One of `CHART_TYPES`: `candle_solid`, `candle_stroke`, `candle_up_stroke` (hollow), `candle_down_stroke`, `ohlc` (bars), `line`, `area`. |
| `styles` | `{}` | klinecharts styles merged over the theme. They are kept: every `setTheme` applies the new theme and then these again. A `candle.type` here is the initial chart type when `chartType` is not given; it is not kept as a style. |
| `themeStyles` | `{}` | `{ light?, dark? }`: styles for one theme only, applied over `styles` whenever that theme is current. |
| `canvasTheme` | `true` | The engine paints the canvas from its own palette and the chrome's CSS variables (see [Languages and themes](#languages-and-themes)). `false` keeps klinecharts' built-in light/dark colours for candles, grid, axes, crosshair and drawing defaults; the canvas font, the line/area series in the accent and the ripple-off stay. |
| `canvasFont` | see below | Font family list for all canvas text. Default: `--sc-font-numeric` on the chart element if set, else `"Helvetica Neue", "Segoe UI", Roboto, Arial, "Noto Sans", sans-serif` (`CANVAS_FONT`). Read once, at mount. |
| `watermark` | none | Text (shown as text, never parsed as HTML), a `Node`, or a function returning a `Node` (called once per chart). A `Node` that is already attached anywhere (the page, another chart) is deep-cloned, which drops its event listeners; pass a detached `Node` or a function to keep a live element. The empty `.klinecharts-pro-watermark` element is always there for host CSS. |
| `drawingBarVisible` | `true` | Show the drawing rail on the left. |
| `drawByHolding` | `false` | `true` or `{ delayMs?: number, guide?: boolean }`: hold still for 333 ms, then draw one stroke. Immediate drags pan normally. The help button opens an instance-local guide; `guide: false` hides it. |
| `drawingToolbar` | `true` | Show the floating toolbar that edits a selected drawing, and enable its Delete / Backspace / Escape shortcuts (see [Editing drawings](#editing-drawings)). Set `false` to turn both off. |
| `headless` | `false` | Render only the chart canvas, without the period/symbol bar. |
| `parts` | all `true` | Remove single controls: `{ toolbar, railToggle, symbol, periods, chartType, indicators, replay, timezone, settings, screenshot, fullscreen }` (`CHART_PARTS`), e.g. `{ symbol: false }` for a host with its own symbol picker. `toolbar: false` is like `headless`. With every part on, the chrome is what it always was. Change them later with `setParts()`. |
| `layout` | `'auto'` | How the chrome fits its width (see [Sizing and layout](#sizing-and-layout)): `'auto'`, or a forced `'regular'`, `'compact'` or `'narrow'` (`LAYOUT_MODES`). |
| `fullscreen` | `'auto'` | `'auto'`: the browser's full screen, else the chart maximised inside the page. `'native'`: the browser's only. `'pseudo'`: always inside the page. `false`: no full screen and no button. |
| `onFullscreenChange` | none | `({ mode: 'native' \| 'pseudo' \| null }) => void`, called whenever the chart enters or leaves full screen, whatever caused it. |
| `periods` | 1m 5m 15m 1H 2H 4H D W M Y | The periods on the top bar. |
| `timezone` | `'Asia/Shanghai'` | An IANA time zone. |
| `mainIndicators` | `['MA']` | Indicators on the price pane. |
| `subIndicators` | `['VOL']` | Indicators in their own panes. |
| `dataStates` | `true` | The chart's own empty and error states: "No data" for an empty history (until live bars arrive), and a banner with Retry when the history request fails. `false` turns both off (for hosts that show their own status line); `{ empty, error }` relabels them. The progress bar while loading is always shown. |
| `tickThrottleMs` | `0` | Live bars are applied once per animation frame. Above 0: at most once per that many ms, which adds up to that much latency. |
| `commandPalette` | `false` | A searchable Ctrl/Cmd+K list of the command registry (see [API](#api)). `{ hotkey: { key } }` picks a different key. Opens only while this chart owns the key. |
| `onLayoutChange` | none | `() => void`, called (debounced) whenever anything `getLayout()` reads changes: an indicator add/remove/param change, a drawing create/restyle/lock/hide/reorder/move, or a chart-type/timezone change. |
| `layoutPersistKey` | none | Opt-in: a `localStorage` key under which the chart auto-saves (on `onLayoutChange`) and, once on mount, restores its own layout (see `getLayout()`/`applyLayout()`). Off by default. |

## API

`new SuperChart(options)` returns a `SuperChartInstance`:

| Method | What it does |
| --- | --- |
| `setTheme(theme)` / `getTheme()` | `'light'` or `'dark'`. An unknown theme is ignored with a warning. |
| `setStyles(styles, { theme }?)` / `getStyles()` | klinecharts styles, applied now and kept over the theme (they survive `setTheme`). With `{ theme }` they are kept for that theme only. Per-theme styles and Settings changes stay on top of them. A `candle.type` switches the chart type, as the top bar does. |
| `refreshTheme()` | Re-read the chrome's CSS variables into the canvas, for a host that changes them without `setTheme`. |
| `setLocale(locale)` / `getLocale()` | The chrome language. |
| `setTimezone(timezone)` / `getTimezone()` | An IANA time zone. |
| `setSymbol(symbol)` / `getSymbol()` | The `SymbolInfo` shown. A symbol equal in every field to the current one changes nothing. A change to `name`, `shortName`, `logo` or a precision updates the chrome without refetching; any other field (for example `priceCurrency` or `market`) refetches. |
| `setPeriod(period)` / `getPeriod()` | The `Period` shown. Also takes shorthand: `'1m'` (minute) and `'1M'` (month) differ; `'4h'`/`'4H'`, `'D'`, `'W'`, `'Y'`, or a TradingView resolution such as `'240'`. Shorthand selects the configured period with the same multiplier and timespan. Only a new multiplier or timespan refetches. |
| `reload()` | Fetch the current symbol and period again, for example after a failed load. |
| `getChart()` | The underlying klinecharts `Chart`, for indicators, overlays and pixel conversion. `null` before the chart mounts and after `dispose()`. Anything a host creates through it is left alone by the chart's own UI. |
| `setChartType(type)` / `getChartType()` | The chart type, one of `CHART_TYPES`. The top bar, Settings and `setStyles({ candle: { type } })` all go through this one owner, so they always agree. An unknown type is refused with a warning and returns `false`. Setting the current type applies it again. `getChart().setStyles({ candle: { type } })` is not supported: the chrome cannot see it. |
| `setParts(parts)` / `getParts()` | Show or remove single controls (merged over the current parts). |
| `setLayoutMode(mode)` / `getSizeClass()` | Force a size class or go back to `'auto'`; the size class the chrome is in now. |
| `setPeriods(periods)` / `getPeriods()` | The top bar's periods. The current period stays when the new list has it (same multiplier and timespan); otherwise the chart switches to the first period and loads it. An empty list is ignored. |
| `setDrawingBarVisible(visible)` / `isDrawingBarVisible()` | Show or hide the drawing rail; the canvas takes the width. |
| `setWatermark(watermark)` | Replace the watermark: text (never parsed as HTML), a `Node`, a function returning one, or `''` for none. |
| `enterFullscreen()` / `exitFullscreen()` / `isFullscreen()` | Full screen from the API. `enterFullscreen()` resolves with the mode it entered (`'native'`, `'pseudo'` or `null`) and never rejects. Browsers refuse their own full screen without a user gesture, so from the API or an agent `'auto'` maximises the chart inside the page. `exitFullscreen()` only ever leaves this chart's full screen, never the host's. |
| `dispose()` | Tears the chart down and empties the container. Idempotent. |
| `isDisposed()` | `true` after `dispose()`. |
| `execute({ id, args })` | Validates `args` against the command's schema and runs it. Never throws or rejects: `{ ok: true, result }` or `{ ok: false, error }`. |
| `getCommands()` | The command registry this instance supports. |
| `toToolDefinitions(options?)` | Neutral, MCP-shaped tool definitions with this instance's live enums resolved in. Destructive commands excluded by default. |
| `addDrawing(spec)` / `updateDrawing(id, changes)` | Create/patch a user drawing from JSON `{ time, price }` points — a future `time` is never clamped to the last bar. |
| `listDrawingTools()` | Every tool name `addDrawing`/the rail accept. |
| `setDrawingTool(tool \| null)` | Arms a tool like the rail; resolves with the new drawing's id, or `null` on cancel. |
| `drawingLevelsAt(id, timestamp)` / `onDrawingCross(cb, { ids }?)` | A user drawing's price level(s) at a time (geometric on a log axis); fires once per crossing of the latest close over a level. |
| `setAnnotations(layer, specs)` / `getAnnotations(layer?)` / `clearAnnotations(layer)` | A declarative, upsertable, non-user-drawing overlay layer, diffed by a stable key. |
| `getLayout()` / `applyLayout(layout, options?)` / `onLayoutChange(cb)` | Save/restore the engine-owned indicators + the current symbol's drawings + chart type/timezone. |

After `dispose()`, every other method throws `ChartDisposedError` (`code: 'DISPOSED'`). The `ChartPro` type is the
same API without `dispose`/`isDisposed`.

Also exported: `THEMES`, `CHART_TYPES`, `BUILTIN_LOCALES`, `CHART_PARTS`, `LAYOUT_MODES`, `isTheme()`, `isChartType()`,
`isLayoutMode()` (for callers that pass JSON),
`loadLocales()`, `chartStyles()`, `canvasTheme()`, `canvasFontStyles()`, `CANVAS_FONT`, `ICON_FONT_FAMILY`, the SuperScript and AI functions below, `DefaultDatafeed` (a Polygon.io example
feed), `COMMAND_DESCRIPTORS`/`getCommandDescriptors()`/`findCommandDescriptor()`/`validateAgainstSchema()` (also at `./commands`) and the types `Datafeed`, `DatafeedSubscribeCallback`, `SymbolInfo`, `Period`, `ChartProOptions`, `ChartPro`,
`SuperChartInstance`, `Theme`, `ChartType`, `Locale`, `IndicatorName`, `Timespan`, `WatermarkOption`, `DataStatesOption`,
`SetStylesOptions`, `ChartPart`, `ChartParts`, `LayoutMode`, `SizeClass`, `FullscreenOption`, `FullscreenMode`,
`FullscreenChange`, `AddDrawingSpec`, `UpdateDrawingChanges`, `DrawingLevel`, `DrawingCrossEvent`, `AnnotationSpec`,
`SetAnnotationsResult`, `ChartLayoutV1`, `ApplyLayoutOptions`, `ApplyLayoutResult`, `ExecuteRequest`, `ExecuteResult`,
`ToToolDefinitionsOptions`, `ToolDefinition`, `CommandDescriptor`.

## Sizing and layout

The chart fills its container: give the container a width and a height (for example `height: 480px`, or `flex: 1`
with `min-height: 0` in a column flex layout). The engine renders into its own root element,
`.klinecharts-pro-root`, the container's only child. The container keeps the `klinecharts-pro` class and `data-theme`,
which carry only the theme's CSS variables and the text colour and size, so your height, display and position
utilities (layered or not) apply to it, and variables you set on it keep working. A container that gives the chart no
height (none of its own, or only a `min-height`) gets a 480px chart and a console warning. The chart never takes its
size from its content, so it shrinks with a grid column, a flex item or a resizable pane, and nothing in it widens
the page. A container that sizes itself to its content (an `inline-block`, a flex or grid item with no width) has no
width: the chart is not visible and the console says so. The canvas follows its element's size, not only the window's.

The top bar fits any width. It is measured, not switched at fixed breakpoints, because what it needs depends on the
locale, the symbol and the number of periods. It steps down one size class at a time:

- **regular:** labelled tools;
- **compact:** icon-only tools, then the lowest-priority tools move into a More (…) menu: Screenshot, Timezone,
  Replay, Full screen, Settings;
- **narrow:** the periods collapse into one dropdown showing the current period, Indicators and Chart type may move
  into More too, and the drawing rail starts collapsed (the top bar's menu button opens it).

The class is on the root as `data-size`. Every tool keeps its name in `aria-label` and `title` when its label is
hidden. The `layout` option or `setLayoutMode()` forces a class; tools that still do not fit go into More, so every
tool stays reachable. A host stylesheet that wraps the bar instead never makes it overflow, and it then stays regular.

Keyboard: every control is a button. The periods are one tab stop: the arrow keys, Home and End move between them,
Enter or Space selects. The chart-type, period and More menus open with Enter, Space or the down arrow, and close
with Escape or Tab. Dialogs take focus when they open and give it back when they close; Tab stays inside them;
Escape, the close button or a press on the backdrop closes them. While a dialog is open the chart's shortcuts pause,
so Delete or Backspace on a control in it never deletes the selected drawing. One Escape does one thing: it closes the
topmost dialog or menu, else ends brush mode, else deselects the drawing, else leaves the in-page full screen.

Full screen inside the page (`'pseudo'`, and `'auto'` where the browser refuses) is a fixed layer over the page. Inside
an ancestor with a `transform`, `filter` or `contain`, or inside an iframe, it only covers that box.

## Datafeed

```ts
import type { Datafeed, DatafeedSubscribeCallback, Period, SymbolInfo } from "@zzyzxlabs/super-chart";
import type { KLineData } from "klinecharts";

export class MyDatafeed implements Datafeed {
  // Symbol search box: symbols matching the text.
  async searchSymbols (search?: string): Promise<SymbolInfo[]> { return []; }
  // Bars with from <= timestamp < to (ms), oldest first. Reject on a transport error.
  async getHistoryKLineData (symbol: SymbolInfo, period: Period, from: number, to: number): Promise<KLineData[]> { return []; }
  // Start realtime updates; call `callback` with the latest bar, or an array of bars.
  subscribe (symbol: SymbolInfo, period: Period, callback: DatafeedSubscribeCallback): void {}
  // Stop the updates started by the last subscribe().
  unsubscribe (symbol: SymbolInfo, period: Period): void {}
}
```

What the chart asks of a datafeed, and what it tolerates:

- **History.** The first request for a symbol and period has `to` = now and `from` about 500 bars earlier (calendar
  months and years in UTC). Scrolling back asks for bars before the chart's first bar: `to` is that bar's timestamp,
  exclusive. Return `[]` only when there is no (older) history: after `[]` the chart stops asking further back for that
  symbol and period.
- **Errors.** Reject (or throw) on a transport error. The chart then shows "Could not load data" with Retry (see
  `dataStates`), a failed scroll-back page is retried with a backoff (1 s, 2 s, 4 s … up to 30 s), and nothing is left
  spinning. A request still pending after 20 s shows the error state; a late answer is still drawn.
- **Tolerated.** Bars out of order, duplicates (the last one wins), overlap with bars already loaded, timestamps in
  seconds, and numeric strings (as exchange APIs return them) are fixed, with one console warning per kind. A bar with
  a missing or non-finite timestamp, open, high, low or close is dropped. `volume` and `turnover` are optional.
- **Live updates.** `subscribe` is called once per load, after the history, and `unsubscribe` exactly once for each
  `subscribe` (on the next symbol or period change, and on `dispose()`). Call the callback with bars, not trades: each
  bar replaces the bar with the same timestamp, and nothing is merged. Pass an array (oldest first) to deliver several
  bars at once, for example a closed bar's final values and the new bar. A bar older than the chart's newest bar is
  ignored. Updates are applied once per animation frame, and bars from a superseded subscription are dropped.
- **Gaps.** When a live bar arrives two or more periods after the newest bar (after sleep or a reconnect), the chart
  holds it, asks the history for the missing bars once (from the newest bar to now), and appends them in order. It
  does the same when a hidden page becomes visible after more than one period, and when the browser comes back online.
  At most one such request every 30 s. A request that has not settled after 10 s is given up, and the held bars are
  appended as they are. A request with `from` equal to the chart's newest bar is one of these catch-ups: answer it like
  any other (the latest bars are fine), but it is not a new load. When the history itself has such holes (a market
  that closes overnight or at weekends, a thin pair that skips empty bars), a live bar after a gap is appended without
  a request.
- **Replay.** While Replay runs, live bars and scroll-back pages are kept for the end of the replay, not drawn. A
  symbol or period change ends the replay.

`SymbolInfo` is `{ ticker, name?, shortName?, exchange?, market?, pricePrecision?, volumePrecision?, priceCurrency?,
type?, logo? }`. `Period` is `{ multiplier, timespan, text }`, for example `{ multiplier: 4, timespan: "hour", text: "4H" }`.

## Languages and themes

`loadLocales(key, strings)` adds or extends the chrome strings of a locale (keys as in `src/i18n/en-US.json`); a
partial dictionary falls back to the locale's current strings and then en-US. The canvas has its own strings:
register those with klinecharts' `registerLocale`.

The chrome is themed with CSS variables on `.klinecharts-pro` (`--klinecharts-pro-primary-color`,
`--klinecharts-pro-background-color`, `--klinecharts-pro-text-color`, …; dark values under
`.klinecharts-pro[data-theme="dark"]`). The canvas follows the ones you override: the primary colour becomes the
line/area series and the colour of every drawing tool (klinecharts' own and Super Chart's, whose fills and label boxes
take it at draw time, with white or dark label text, whichever reads better on it), text-second the axis and legend
text and icons, border the grid, and hover the legend icons' hover wash. It reads them when the chart mounts and on every `setTheme`; call
`refreshTheme()` after changing them any other way. Derived tokens follow the ones you set, so you rarely need them, but
they can be overridden too: `--klinecharts-pro-primary-text-color` (text on a selected item),
`-control-border-color`, `-active-background-color` (pressed), `-popover-border-color`, `-shadow-bar` / `-menu` /
`-dialog`, `-radius-sm` / `-lg`, the type scale `-font-size-xs` … `-xl` (11, 12, 13, 14, 16, 18px) and
`-font-weight-regular` / `-strong`, and the stacking order inside the chart, `-z-bar` … `-z-dropdown`. The chart
element is its own stacking context (`isolation: isolate`), so none of these compete with your page's z-indexes,
and it sets `color-scheme` from its theme. Chrome text uses your page's font; canvas text uses `canvasFont`. Anything more goes through `styles`, `themeStyles` or
`setStyles`, which survive theme switches. Styles set on the raw chart (`getChart().setStyles`) are not kept: a
theme switch applies the whole engine theme, which covers more than klinecharts' own light/dark table (candle bodies,
borders and wicks, the last-price line and tag, indicator bars, the grid's line style, legend icons and every drawing
default), so re-apply raw styles on those keys after `setTheme`, or pass them through `setStyles` / `themeStyles`.

`chartStyles(klinecharts, dark)` from `./lite` themes a `klinecharts` chart you drive yourself (monospace numerals, one text size, TradingView candle colours); unlike the engine theme it also sets behaviour (crosshair-following legends, hidden high/low marks).

The drawing tools `registerExtensionOverlays()` adds take their colour and font from the chart they draw on: the accent
is the chart's `overlay.line.color` (klinecharts' own default on a raw chart, unless you set it) and label text uses
`overlay.text.family`. Apply `chartStyles` or `canvasFontStyles()` to a raw chart, or those labels draw in
klinecharts' bare `'Helvetica Neue'`, which is a serif on Windows and Linux.

## Editing drawings

User-created drawings support hold-to-draw, editing, undo/redo and layout persistence.
See the [complete drawing interaction guide](https://github.com/Super-Solution/super-chart/blob/main/docs/DRAWING-INTERACTIONS.md) for gestures, keyboard behavior, protected overlays and compatibility limits.

### Earlier changes

The imported release history is preserved in [Legacy changelog](https://github.com/Super-Solution/super-chart/blob/main/docs/LEGACY-CHANGELOG.md).

## SuperScript → on the chart

Write an indicator in SuperScript, register it, and create it on the chart like any built-in:

```ts
import { registerScriptIndicator, type SuperChartInstance } from "@zzyzxlabs/super-chart";

declare const chart: SuperChartInstance; // the chart from the quick start

registerScriptIndicator({
  name: "SUPER_SMA_CROSS",
  source: `
    // @title SMA Cross
    // @overlay
    fast = sma(close, input(10, title="Fast"))
    slow = sma(close, input(30, title="Slow"))
    plot(fast, title="Fast", color="#2962ff")
    plot(slow, title="Slow", color="#ff6d00")
  `,
});

// getChart() is null until the chart has mounted.
chart.getChart()?.createIndicator("SUPER_SMA_CROSS", false, { id: "candle_pane" });
```

- `// @overlay` says the script plots on the price scale, so its legend uses the symbol's price precision. Other
  scripts show 2 decimals (the `series` option overrides both). Legends read `Fast: 64,431.31`. Give a small-valued
  script `precision: 6` (or what it needs): at 2 decimals a return of 0.0004 reads `0.00`. `precision` applies only
  to scripts off the price scale; price-scale scripts follow the chart's precision, also after `updateScriptIndicator`.
- A name that already exists and was not registered by `registerScriptIndicator` (klinecharts' `RSI`, the host's
  own) throws `ScriptIndicatorError` with `code: "NAME_TAKEN"`. Registering one of its own names again replaces it.
- `input()` values are the indicator's `calcParams`. `getScriptInputSchema(name)` lists them, and
  `setScriptIndicatorParams(chart, name, { in0: 20 })` sets them by id or position.
- `updateScriptIndicator(chart.getChart(), { name, source })` replaces the script of the indicators already on
  the chart, in place (same pane and height). Registering again only affects indicators created afterwards.
- `onError(error, diagnostics)` hears about a script that fails on the chart's data; the indicator then draws nothing.
- Histograms grow from `histbase` (0). On a log- or percentage-scaled price pane 0 is off the scale and the bars
  vanish, so give such a script `histbase=` a price.

A script that does not compile throws a `SuperScriptError` (check with `isSuperScriptError(e)`) that names the line
and column. `checkSuperScript(source)` lists every problem without throwing:

```ts
import { checkSuperScript, formatDiagnostics } from "@zzyzxlabs/super-chart/superscript";

const source = "x = close\nx := x * 2\nplot(x)";
const problems = checkSuperScript(source);
// [{ severity: "error", code: "REASSIGNMENT", line: 2, col: 3, endCol: 5, message: "':=' is not supported", hint: "…" }]
console.log(formatDiagnostics(problems, source));
```

You can also just compute results headlessly, in the browser or in Node:

```ts
import { runScript, SuperScriptLanguage, type Bar } from "@zzyzxlabs/super-chart/superscript";

declare const source: string;
declare const bars: Bar[]; // { timestamp, open, high, low, close, volume }[]

const { plots } = runScript(source, bars);

// Compile once, then run with other input values (by position or input id):
const compiled = SuperScriptLanguage.compile('len = input(14, title="Length")\nplot(rsi(close, len))');
const rsi21 = compiled.run(bars, { len: 21 }).plots[0].values;
```

Only SuperScript is registered. The JavaScript adapter runs its source with `new Function` in your page, so it is
opt-in: `registerLanguage(JavaScriptLanguage)`. Never register it where scripts come from a model, a user or a tool.

## AI

```ts
import {
  createHttpAIClient, nlToSuperScript, nlToSuperScriptChecked, buildChartContext, analyzeChart, registerScriptIndicator,
  type SuperChartInstance,
} from "@zzyzxlabs/super-chart";

declare const chart: SuperChartInstance;

// The host endpoint holds the model keys and returns { text } (or Anthropic's content blocks;
// `extract` reads any other shape). The client rejects on errors and empty replies.
const ai = createHttpAIClient({ endpoint: "/api/super-chart/ai", timeoutMs: 30_000 });

// 1) natural language → a SuperScript indicator → on the chart
//    (nlToSuperScript rejects a reply that is not a script that draws something)
const source = await nlToSuperScript(ai, "20/50 EMA cross, color the fast line blue");
registerScriptIndicator({ name: "AI_EMA_CROSS", source });
chart.getChart()?.createIndicator("AI_EMA_CROSS");

// …or let the model repair its script from the diagnostics (at most 2 more calls):
const checked = await nlToSuperScriptChecked(ai, "Bollinger %B, 20 bars", { maxRepairs: 2 });
if (checked.ok) registerScriptIndicator({ name: "AI_PCT_B", source: checked.source });

// 2) analyse what's on screen: the visible bars, rounded to the symbol's precision,
//    aggregated into at most 200 rows when zoomed out
const ac = new AbortController();
const note = await analyzeChart(ai, buildChartContext(chart), undefined, { signal: ac.signal });
```

## SuperScript reference

Generated from `superscriptReference()` (a unit test keeps this block equal to it):

<!-- superscript-reference:start -->
```text
Series: open, high, low, close, volume, hl2, hlc3, ohlc4, bar_index, time. History: close[1], close[len] (a constant whole number >= 0). na is the missing value; x/0, log(0) and other non-finite results are na.
Operators: + - * / %, comparison < <= > >= == !=, logic and/or/not (also && || !), ternary cond ? a : b.
Bind variables: name = expr, one statement per line (a line continues inside brackets or after an operator). Declare params: len = input(14, title="Length", minval=1, maxval=200, step=1); input(14, "Length") also works. Lengths and offsets must be constants: numbers, inputs, or arithmetic on them.
Moving averages: sma(src,len), ema(src,len), wma(src,len), rma(src,len), hma(src,len), vwma(src,len).
Oscillators: rsi(src,len), stoch(len) (%K over close/high/low), cci(len) (over hlc3), mfi(len) (over hlc3), roc(src,len), mom(src,len).
Volatility: stdev(src,len), dev(src,len), atr(len), tr(). Bollinger via basis=sma(close,len) and stdev(close,len).
Volume: vwma(src,len), mfi(len) (over hlc3), obv(), vwap() (cumulative from the first bar, no session reset).
Trend: sar(start=0.02,inc=0.02,max=0.2), linreg(src,len,offset=0), correlation(a,b,len).
Ranges/aggregates: highest(src,len), lowest(src,len), sum(src,len), cum(src), change(src,len=1).
Signals: crossover(a,b), crossunder(a,b), cross(a,b), barssince(cond), valuewhen(cond,src,occurrence=0).
Pivots: pivothigh(src,left,right), pivotlow(src,left,right).
Math: abs(x), sign(x), round(x), floor(x), ceil(x), sqrt(x), log(x), log10(x), exp(x), pow(a,b), max(a,b), min(a,b), nz(x,replacement), na(x).
Draw: plot(expr, title="...", color="#rrggbb", type="line"|"histogram"|"circle", lineWidth=1, histbase=0); histogram bars grow from histbase. hline(price, title="...", color="#rrggbb") draws a dashed level.
Start the script with // @title <name>. Add // @overlay when it plots on the price scale (drawn over the candles).
Not supported (an error names the line): := and += (bindings are single-assignment series; bind a new name), if/for/while (use cond ? a : b), function definitions, request.*, strings or colours as values. Ignored with a warning: var, strategy.*, plotshape, plotchar, bgcolor, fill, alertcondition.
Pine names are accepted where the arguments match: ta.sma … ta.pivotlow, math.abs … math.sum, input.int, input.float, color.red …, plot.style_*, indicator("Name", overlay=true). ta.cci and ta.mfi only over hlc3; ta.stoch only as ta.stoch(close, high, low, len); ta.vwap is session-anchored and has no equivalent.
```
<!-- superscript-reference:end -->

## Roadmap

- [ ] SuperScript: more built-ins (macd, bbands, …), conditionals, multi-output strategies, `strategy()` + backtest
- [ ] Indicator/strategy editor panel inside the chart, with SuperScript syntax highlighting
- [ ] AI side-panel UI (chat about the chart, one-click "explain this move", NL→indicator)
- [ ] Closer TradingView parity pass (hotkeys, more drawing tools, replay)
- [ ] Stay current with upstream KLineChart Pro

## Development

```bash
bun install --frozen-lockfile
bunx vitest run        # unit tests
bun run lint           # ESLint (warnings only for now)
bun run build          # tsc + vite + d.ts bundle, then scripts/check-package.mjs
bun run dev            # the demo (demo/main.ts) on a Vite dev server

# Browser tests over the built dist, in the installed Google Chrome,
# on klinecharts 9.7.2 and 9.8.12, plus the lifecycle spec on 9.1.1
# (never downloads a browser):
cd e2e && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 bun install --frozen-lockfile && bun run test:browser
```

See `MAINTAINING.md` for how a change reaches the wallet's committed tarball.

## License & attribution

Apache-2.0. SUPer-Chart is based on **KLineChart Pro** (github.com/klinecharts/pro) by **liihuu** and the
KLineChart authors, forked at commit `4234b79`. See [`NOTICE`](./NOTICE) for full attribution and
[`LICENSE`](./LICENSE) for the license text. Our additions (the SuperScript runtime, the AI layer, and the
rebranding) are likewise Apache-2.0.

See [Realtime series](docs/REALTIME-SERIES.md) for the opt-in Web/native batch sink and incremental MA20/EMA21.

See [Realtime viewport](docs/REALTIME-VIEW.md) for stable render subscriptions, viewport controls and incremental Heikin Ashi.

See [Realtime inspection](docs/REALTIME-INSPECTION.md) for visible geometry, cursor values and timestamp navigation.

Run the existing dev server and open [/demo/realtime.html](demo/realtime.html) for the offline shared-core demo ([usage](docs/REALTIME-DEMO.md)).
