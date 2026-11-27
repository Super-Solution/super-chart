# Changelog

Releases of the five `@supersolutions/super-chart-*` packages, which share one version. Older releases are in the git
history (`git log --oneline`, one commit per release). Nothing here is published by this repository's commits.

## Unreleased

- A `plan` whose entry and target share one time now says so ("entry and target need different times") instead of blaming the stop; the chat plugin warns `plan_no_width` and the tool description says the plan spans from the entry time to the target time.

- Agent marks read cleaner: the labels of fibonacci levels and other template marks stay clear of the legend and of each other (moved sideways, level with their price), and two marks at one price share one axis tag instead of a stack of identical ones.

- Chat plugin: new `draft` tool `chart_compare` (`add`, `remove`, `list`) overlays another market on a chart that has a feed.

- **Copy chart image** (right-click menu and palette): the same picture as the camera button, put on the clipboard as a PNG. A browser without image clipboard access says so.

- **Compare with another symbol**: `workspace.addCompare(symbol)`, `removeCompare(id)`, `listCompares()` and a palette command lay another market over the chart, rebased to start at the chart's price (relative performance on one scale). It is a line indicator, so it can be hidden or removed like one. Fetched from the datafeed for the loaded range; refreshed on market change, on older bars and every 30 seconds (not streamed). Core: `rebaseCompare`.

- Chat plugin: new read tool `chart_swings` returns the latest swing highs and lows (time and price of real bars, alternating) and the last leg, so trend lines, fibonacci retracements and plans are anchored on real turning points. Core: `swingPivots(bars, { strength, lookback })`, exported next to `supportResistance`.

- Chat plugin: `chart_annotate` warns `near_duplicate` when two `level` marks of one call sit within 0.1% of each other.

- Right-clicking the time axis opens a time menu (go to date, reset, latest) instead of the price commands. The palette lists **Hide drawings**.

- **Go to date** (`Alt+G`, or the palette command): opens the palette on the latest bar's date, selected; type `2026-03-01` or `2026-03-01 14:30` (axis time zone) and Enter to move the view to the nearest loaded bar. A date outside the loaded bars says so. Running any palette command now returns focus to the chart first, so shortcuts keep working afterwards.

- The command palette leads with a **Recent** group (the last five commands run) when the query is empty. The demo workspace takes `?locale=zh-TW`.

- **Hide drawings** (eye button in the rail, and a palette command): hides every drawing at once without changing the document, undo history or export. Arming a drawing tool shows them again. Core: `DrawingStore.setViewHidden()` and `viewHidden` on the snapshot. On windows shorter than 860 px the rail's buttons shrink (34 px, then 30 px) so every tool stays in reach.

- Six more indicators in the technical pack: `SC_PPO`, `SC_CHAIKIN_OSC`, `SC_DPO`, `SC_LINREG` (regression channel), `SC_FISHER`, `SC_STDEV`; kernels in `taExtra.ts`, built on `ta.ts`. The catalogue is now 66 names. They exist in the TypeScript engine only (the Go and Python servers keep their 33 kernels).

- Hovering an indicator's row in the legend shows **settings** (opens the Indicators menu) and **remove** beside it. Core: price-pane legend entries now carry the indicator `id`. The replay bar uses icon buttons (previous, next, play or pause) and a clearer Exit.

- Quick measure: hold **Shift** and drag on the plot to measure between two bars: price change, percentage, bars and time, in a tinted box with a label. It stays (glued to its bars when the view moves) until the next ordinary press or Escape. Nothing is drawn into the document.

- Chat plugin: `chart_annotate` warns (`invalid_plan`, `flat_range`) about marks that draw as a note or with no height. A level chip that would sit under the legend moves to the right end of its line.

- New colour token `drawing` (TradingView-style blue, `#2962ff` on light and `#4d86ff` on dark; the colour-blind themes keep ink, since blue is their up colour). A drawing with no colour of its own takes it, replacing the ink colour used before. A drawing's own style, the chart's `color` option and a registered theme's token still win. Held at 3:1 on the surface by a test.

- The first tool of the Lines group, and `Alt+T`, now draw a **trend line** (a segment between two points), as in other charting tools. The line that runs on past both points is labelled **Extended line**; both still exist and keep their types (`segment`, `trend-line`).
- `?` opens the command palette, which lists every command with its shortcut.

- `supportResistance(bars, options)` (core): swing pivots clustered into support and resistance levels, ranked by distance from the last close. Pure, OHLC only. It backs the new `SC_SR` indicator (three lines each side, family "levels") and the chat plugin's `chart_levels` read tool, so an agent draws at prices where price turned.
- Indicator rows in the workspace read `Moving Average (20)` rather than `Moving Average 20`.

- `render.watermark` (`{ title, subtitle? }` or `null`): a faint background ticker like TradingView's. The workspace sets it to the symbol and "name, interval" by default; pass `render: { watermark: null }` to switch it off. Indicator panes do not paint it.

Changed (default behaviour; every item has a setting to get the old look back)

* **The price axis is on the right** (`layout.axisSide`, `'left'` restores it) and the time axis keeps its row.
* **Volume is a bottom band of the price pane** (indicator pane `'overlay'`, `layout.overlayRatio` 0.05–0.5, default
  0.2) with its own scale, not a separate pane. `{ pane: 'separate' }` on the VOL indicator restores the pane.
* **A legend sits over the plot at all times**: symbol and interval, open, high, low, close and the change for the latest
  bar (or the bar under the pointer), then one row per price-pane indicator in the colour of its line. It reads real
  prices in log and percentage scales. `render.legend: false` removes it; `render.legendTitle` names the chart.
* **Candles are solid** (hollow styles stay available as chart types).
* **Replay moved to the market bar**; the footer holds the quick ranges, a live clock, the time-zone menu and the
  `%` / `log` / `auto` scale switches.
* The bar-close countdown is a second tag under the last-price tag (`chart.setLastPriceCaption(text)`).

Added

* **Quick ranges** (1D, 5D, 1M, 3M, 6M, YTD, 1Y, 5Y, All): `workspace.showRange(range)`, `WORKSPACE_RANGES`,
  `isWorkspaceRange`, palette commands `view.range.*`. Month and year ranges are calendar ranges; older pages are
  requested until the range is covered.
* **Chart-type menu** with a picture of each type, **searchable indicator list**, `Copy price` and `Draw a horizontal line
  at <price>` in the plot's context menu, a context menu for the price axis (automatic range, scale mode, invert).
* **Dragging the plot up or down moves the price range** (the range turns manual; the Auto switch or a double click on the
  axis brings it back).
* **The workspace registers the indicator packs by default** (about 50 indicators; `indicators: { catalog: false }` for the
  built-ins only), grouped by family and searchable by name, long name, keyword or Chinese name. Core exports
  `INDICATOR_INFO`, `indicatorInfo`, `indicatorLabel`, `indicatorShortName`, `searchIndicators`. The chat plugin no longer
  registers the packs itself, and legend rows and pane titles use the short name (`ATR 14`, not `SC_ATR`).
* **Alt hotkeys** like other charting tools: Alt+T trend line, Alt+H horizontal line, Alt+J horizontal ray, Alt+V vertical
  line, Alt+F Fibonacci, Alt+I pitchfork, Alt+Shift+R rectangle, Alt+R reset the view, Alt+S save a PNG (by physical key, shown
  in the palette).
* **Each indicator pane has a legend** with its short title and the value of every line at the latest bar or under the pointer.
* **Agent marks**: times written as Unix seconds are corrected to milliseconds (and the agent is told), `chart_annotate`
  returns `notShown` with a reason for any mark outside the view, `chart_state` returns the reach of the data (`data`: first and
  last bar, recent price range, last close), and labels that would overlap move sideways so each stays level with its price.
* `chart.zoneAt(clientX, clientY)` names the part of the chart under a point (`plot`, `price-axis`, `time-axis`).

## 0.13.1

Changed

* **`@supersolutions/super-chart-chat-plugin` depends on `@supersolutions/super-protocol` 0.4.1** (it was 0.3.0), the version Super Chat 0.5.0 uses. A project with the chat plugin and Super Chat no longer installs two copies of the protocol. No chart behaviour changes; the five packages move to 0.13.1 together.

## 0.13.0

Added

* **Round-time time axis.** Ticks fall on round times (years, months, days, 12h down to 1s) chosen for the width, in the
  viewer's zone (intraday) or the symbol's zone (day and longer), with month and day names in the chart's locale.
  `timeAxisTicks` is exported from core and runs without a DOM. The axis labels you see will differ from 0.12.
* **`theme: 'auto'`** follows `prefers-color-scheme` live and removes its listener on dispose.
* **Time-zone menu** in the scale bar (common zones, every IANA zone the runtime knows, this device), replacing the
  Auto/UTC toggle. `checkTimeZone`, `timeZoneChoices`, `localTimeZone` and `COMMON_TIME_ZONES` are exported from core.
* **Narrow chrome.** A one-row market bar with icon menus at phone widths, a slimmer footer, and an interval bar that
  falls back to the dropdown when it would clip.
* **Ten indicators** with SuperScript builtins, Go and Python ports and regenerated conformance cases (443): Aroon,
  Chaikin Money Flow, Accumulation/Distribution, Force Index, Vortex, True Strength Index, Ultimate Oscillator, ZigZag
  (repaints, and says so), Pivot Points (classic and Fibonacci, by day, week, month, quarter or year) and Chandelier Exit.
* **`Datafeed.getMarks` (optional).** Earnings, dividends, splits and headlines drawn as one marker per bar through the
  annotation layer, with a tooltip, an Objects list, a viewer switch, stable rejection codes (`validateMarks`,
  `placeMarks`, `marksWindow`, `getMarksState()`), a `/v1/marks` route in `docs/DATAFEED-HTTP.md` and the reference server.
* **`SymbolInfo.session` (optional).** A weekly schedule in an IANA zone with holidays and per-date exceptions:
  pre-market and after-hours shading, a line at each new local date, a countdown that ends at the real session close,
  and "pre-market" / "after hours" in the keyboard readout. `compileSession`, `sessionKindAt`, `sessionChangeAfter`,
  `sessionBarClose` and `sessionLayout` are exported from core; faults come back with stable codes
  (`getSessionState()`).

Changed

* `BarReadoutText` gains `session` (`'pre' | 'post' | ''`), and the `a11y.bar` locale string ends with `{session}`. A host
  that replaced `descriptions.bar` receives the extra field and may ignore it.
* The shared example feed gains a `SESSION` market and `getMarks`.

Known limits are stated on the page of each feature: `docs/WORKSPACE-UI.md` (event marks, trading sessions, time axis,
time zones), `docs/DATAFEED-HTTP.md` and `docs/INDICATORS-SERVER.md`.
