# Changelog

Releases of the five `@supersolutions/super-chart-*` packages, which share one version. Older releases are in the git
history (`git log --oneline`, one commit per release). Nothing here is published by this repository's commits.

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
