# Owned chart engine rewrite

Local 0.1 candidate on `codex/chart-engine-rewrite-20261107`, based on `ff0420a`.
The package entries replace both the inherited Pro shell and the underlying
KLineChart engine. The owner chose a breaking owned API with a migration guide,
not an emulation of upstream internals. Runtime and peer dependencies on
KLineCharts and Solid have been removed from the manifest and lockfile.
This is not a published release or a deployed consumer cutover. Legacy source
cleanup is tracked separately from the new package's import graph.

## Module boundaries

- `core/` owns normalized bars, feed loading, replay, rolling calculations and
  view snapshots. Existing native consumers remain on the same shared core.
- `engine/model.ts` exposes the owned, renderer-free model, indicators, reversible
  scales and retained drawings. Native hosts can use these values and primitives
  with their own renderer and gestures. This surface does not import the DOM,
  Solid or KLineChart.
- `engine/chart.ts` owns the Web lifetime, three Canvas 2D layers and a single
  frame scheduler. Pending gesture changes commit before rendering. Cursor and
  drawing previews do not force the price layer to repaint.
- `engine/canvasRenderer.ts` and `seriesRenderer.ts` paint existing geometry.
  They do not fetch prices or recalculate indicators.
- `engine/gestures.ts` owns Web pointer capture, wheel/pinch/pan, keyboard and
  optional inertia. Reduced motion disables inertia. Fractional viewport bounds
  preserve subpixel motion; visible sampling includes the partial edge candles.
- `engine/drawings.ts` owns immutable timestamp/price anchors and bounded undo
  history. Web input and Canvas painting live in separate modules. Feed updates
  do not create undo entries. Edits commit once on pointer release.
- `engine/indicatorPack.ts` is optional. The workbench imports it on demand.
- `engine/classicIndicators.ts` adds an optional classic catalog. The base engine
  does not load either catalog. `marketOverlays.ts` projects raw-data volume
  profiles and zones; its separate Canvas layer also loads only on demand.
- `engine/workspace.ts` supplies the owned DOM shell: market search, interval
  selection, chart/scale/indicator/drawing controls, replay, history paging,
  PNG download, fullscreen, and loading/error/retry state. It uses the existing
  portable `DataLoader`; no UI framework or upstream chart engine is involved.

All eight public package entries use owned modules with no external runtime
imports. No files or consumers in the original monorepo were changed.

## Implemented

Fourteen series renderings: candles, three hollow/outline variants, OHLC,
volume-weighted OHLC, columns, high-low, line, line-markers, step-line, area,
HLC-area and baseline. Heikin Ashi remains a separate synthetic display mode;
indicators use raw prices. Renko, line break, range bars, Kagi and point and figure are price-driven
styles that replace the series with derived marks (see WORKSPACE-UI.md). Columns retain the preceding display-mode close even
when that candle is offscreen. HLC cursor values follow the plotted typical price.

Linear, logarithmic, percentage and reversed price axes share reversible
projection with drawing tools. Log prices must be positive; percentage reference
must be nonzero. Timestamp ranges, OHLC bounds and timezones are checked before
ingestion/options take effect. All engine data writes use the same validated
port. Explicit history reads return copies; feed tail reads use an O(1) accessor.

MA, EMA, BOLL, VOL, MACD, RSI and KDJ are configurable registry entries. All seven
support tail updates without scanning the entire history. MA/BOLL preserve the
core's periodic reseed; MACD uses three recursive checkpoints; KDJ reads its
lookback window and preceding K/D. The renderer disables redundant native
reference MA/EMA calculation; existing native callers retain it by default.
Optional SC_ATR, SC_ATR_BANDS, SC_KELTNER, SC_DONCHIAN, SC_VWAP, SC_STOCH,
SC_STOCHRSI, SC_MFI, SC_BBP, SC_SUPERTREND, SC_ICHIMOKU, SC_RSI, SC_MACD,
SC_SMA and SC_PDHL reuse the existing
owned TA formulas. SC_WMA, SC_HMA, SC_DEMA, SC_TEMA, SC_VWMA and SC_KAMA (price pane, full recompute)
follow TA-Lib's seeding: DEMA/TEMA start at index `2*(len-1)` / `3*(len-1)`, KAMA at `len` from the
price at `len - 1`; they match TA-Lib 0.8.3 to about 1e-13 on 500 synthetic bars. They exist in the
TypeScript core only, not in the Go/Python/Rust indicator servers. SC_CVD (separate pane) adds up buy minus sell volume
from the `buyVolume` field a feed reports on each bar and leaves a bar without it as a gap; SC_CVD_EST estimates the
split from where the close sits in the bar's range and is named as an estimate. Parameter 1 restarts the total at each
UTC midnight. Also TypeScript core only. Inspection returns the actual registry rows used for plotting,
not the differently seeded native reference EMA. Separate instances have distinct
pane scales by default; an explicit shared `paneId` groups lower indicators.
Visibility and parameter changes update the owned registry. Custom callbacks are conservatively invalidated by offscreen changes
because a custom formula may depend on later bars.

The optional classic pack has nineteen names: CCI, DMI, CR, PSY, DMA, TRIX, OBV,
VR, WR, MTM, EMV, ROC, PVT, AO, SAR, BIAS, BRAR, SMA and BBI. These use documented
owned conventions, not a claim of bit-identical legacy-engine behavior. DMI/TRIX
seeding, negative single-line WR, unshifted CR averages and unscaled EMV are
explicit in the module. Owned SAR includes Wilder's prior-two-extrema clamp;
the older shared-core SAR is unchanged. The catalogs provide 47 names in total.
SC_PDHL is a latest-period UTC reference, not a historical backtesting series.

Ten more optional names arrived in 0.13, each an owned kernel in `packages/core/src/ta.ts` with a SuperScript builtin
and, except Pivot Points, an entry in both indicator servers (see [INDICATORS-SERVER.md](INDICATORS-SERVER.md)):

| Name | Pane | Formula and conventions |
| --- | --- | --- |
| SC_AROON (14) | separate | Up/Down = `100 * (len - bars since the high/low) / len` over the last `len + 1` bars, as TradingView; the newest bar wins a tie |
| SC_CMF (20) | separate | money flow volume over volume, summed over the window; money flow multiplier is `((C - L) - (H - C)) / (H - L)`, 0 on a bar with no range; null where the window has no volume |
| SC_ADL | separate | running total of money flow volume; a bar missing a price adds nothing |
| SC_FORCE (13) | separate | EMA of `(close - previous close) * volume`, SMA-seeded like every EMA here |
| SC_VORTEX (14) | separate | VI+ and VI-: summed `|H - previous L|` and `|L - previous H|` over summed true range |
| SC_TSI (25, 13, 13) | separate | `100 * EMA(EMA(change, long), short) / EMA(EMA(|change|, long), short)` and an EMA signal; null on a flat stretch |
| SC_ULTIMATE (7, 14, 28) | separate | buying pressure over true range for three windows, weighted 4:2:1, scaled 0..100; the first bar is null |
| SC_ZIGZAG (5) | price | percentage reversal on highs and lows; straight legs between pivots, the last leg ending at the latest extreme |
| SC_PIVOTS (anchor 0, offset 0, kind 0) | price | classic (`kind` 0) or Fibonacci (`kind` 1) levels PP, R1-R3, S1-S3 from the previous completed period; `anchor` 0 day, 1 week (Sunday to Saturday, UTC), 2 month, 3 quarter, 4 year; `offset` shifts the edges by fixed minutes |
| SC_CHANDELIER (22, 3) | price | highest high minus `mult` ATR (long exit) and lowest low plus `mult` ATR (short exit); plain levels, no ratchet |

Limits stated plainly. SC_ZIGZAG **repaints**: a pivot is only known after price reverses, so earlier legs move as bars
arrive and the line is not a historical signal; it is a drawing aid and must not be backtested. SC_PIVOTS buckets by fixed
UTC offset like SC_VWAP, with no exchange sessions or daylight-saving rules, so an equity's "day" is the UTC day unless
`offset` says otherwise; its first period has no levels, and the line renderer joins one period's level to the next with a
slanted segment at each boundary. Aroon, vortex, TSI and the ultimate oscillator are conventions, not claims of
bit-identity with any one vendor; the conformance file pins ours. All ten recompute the whole series on a tail edit.

All 65 former drawing tools are retained through owned models and geometry:
lines/channels/pitchforks, geometric shapes, Fibonacci/Gann/waves, price/time
measurements, text, positions, anchored VWAP/profiles, local images and freehand
support selection, handles, body drag, lock/hide, removal, undo/redo and strict
atomic JSON import/export. Locked drawings remain selectable and allow pan/pinch
through. Body dragging preserves pointerdown pixel offsets through live rescaling.
Drawing projections extrapolate timestamps outside the loaded range using edge
intervals; this is not a market-session calendar.
Circles are screen-circular; time ranges use elapsed wall-clock duration.
See [the full mapping and interaction semantics](OWNED-DRAWING-CATALOG.md).
Data-derived drawings receive only revealed raw bars, with a raw-series revision
for caching. Missing volume/history and invalid position sides are explicit
statuses. Images accept bounded local PNG/JPEG/WebP bytes; no remote URL or SVG
is decoded. Bitmap leases protect asynchronous import, and removed resources are
released without deleting retained drawing history.

VRVP, FVG and order-block overlays reuse the existing owned detection helpers. The volume profile has three modes:
`visible` (one profile of the bars in view), `session` (one per calendar day in a chosen IANA time zone, each using all of
its bars even when part of the day is off screen, at most 60 days at once) and `range` (the bars between two
timestamps, at most 50,000). The order-book heatmap (`createDepthHeatmapLayer`) and liquidation map
(`createLiquidationMapLayer`) take ascending depth snapshots and liquidation levels from the host; nothing is fetched or
invented, malformed input is reported as `invalid-data` and not drawn, and layers paint above the candles so both are
translucent. Call `chart.requestPaint()` after `setSnapshots` or `setLevels`.
Volume is distributed across candle price ranges, not derived from trade prints.
FVG and OB retain their documented window, confirmation and fill/mitigation
semantics. Zone scans wider than 5,000 bars report `too-wide` and the Web layer
asks the user to zoom in; no silently truncated result is presented. Replay
passes revealed raw bars only. The detectors' broad-window cost remains material.

Workspace market identities use all data-identifying fields from `marketKeys`,
including currency and instrument type. Drawing documents are retained per
market in memory and restored only after that market's data is accepted. Search
is debounced, abortable and generation-bound. Paging has one owner through both
in-flight requests and retry backoff; loader cancellation explicitly releases it.
A cache-backed request that times out now restores the full late answer rather
than merging its tail into an empty chart. This also fixes the shared loader.
Search supports keyboard navigation and IME-safe selection, with optional
host-namespaced recents. Timed replay pauses in hidden documents and on market
changes. Countdown is a period-boundary estimate unless the symbol has a `session`
(then it ends at the real close); hosts may also supply actual session closes. Workspace JSON validates indicators, image data and schema before loading
the matching market. Superseded restoration never applies saved state to another
market. Executable plugins and credentials are not serialized.

Awaitable load outcomes and typed events distinguish requested markets, applied
data, cancellation, supersession and failure. Daily and larger period labels use
the market's session timezone; intraday labels use the viewer's timezone. Pane
separators resize adjacent panes, and price-axis dragging adjusts an explicit
range. A market change clears that range while retaining the scale mode.

The optional `/scripts` bridge checks and bounds SuperScript before evaluating
revealed raw data. It preserves line, histogram, circle and horizontal-line
plots and rejects unsupported syntax. These synchronous resource ceilings are
not an interruptible sandbox. The optional `/annotations` layer scopes host
levels, zones, markers and text independently of editable user drawings.

Run the existing `bun run dev` and open `/demo/workspace.html` for the integrated
synthetic-feed shell or `/demo/engine.html` for the 100,000-bar workbench. These
are source demos, not new npm entry points or a deployed application.

## Measurements and validation

The current owned package has passed strict TypeScript, eight generated
declaration entries, and the packed Node ESM/CJS/Node10 consumer checks. Its
eight entry exports and declarations agree and have no external runtime imports.
With all three migration/catalog documents included, the expanded candidate
tarball measured 360,845 bytes (87 files), within the unchanged
780,000-byte budget. Small documentation edits can change that byte count.
This smaller package also has a different API/feature scope; the size difference
is not a feature-equivalent performance comparison.

Across the existing targeted runs, 581 retained/adapted unit cases passed. The former
19-case upstream script-wrapper suite was adapted to 10 owned numerical,
ownership and security cases; its retired registry/style contracts are excluded
from that count. The browser suite has 70 adapted existing cases in 13 files;
the earlier 67 and the restored search/replay/countdown cases passed in targeted
batches. Its previous 175 unique contracts are
accounted for in `e2e/MIGRATION.md`, including 105 retired contracts that are not
reported as passing. No new test cases, assertions, fixtures, snapshots or
pipeline were added. Temporary diagnostic observations are separate evidence.

Lint covers the complete public runtime import graph: 78 source files, zero
errors and 120 existing-rule warnings, within the unchanged warning budget.
Independent reviews covered data/viewport semantics, input lifetime, indicators,
scripts, dates, public declarations and browser-case migration. No confirmed
findings remain in those reviewed changes. This is not a claim of full old-Pro
feature equivalence or production-device validation.

The earlier observations below retain their original workload and snapshot
scope; timings are not interchangeable across the successive feature additions.

The full-catalog tranche exercised all 65 tools through real Chrome pointer,
text, file-picker and freehand input, with strict JSON roundtrip and PNG output.
Long/short placements returned R/R 2 for valid 100/120/90 and 100/80/110 inputs.
Targeted existing unit validation passed 104 cases in 9 affected files. An actual
workspace observation covered restoring a linear negative-price market from a
logarithmic chart, matching restored controls, timed replay, no-request rejection
of invalid indicator periods, superseded restoration and keyboard market search;
no page errors occurred. Review found and fixed resource collection, asynchronous
image/export races and restored-control synchronization.

At 100,000 raw bars, data-drawing calculation/projection measured about 11.4ms
cold for anchored VWAP and 60–71ms cold for volume profiles. Same-revision cached
projection was about 0.03ms and 0.01ms respectively. These are bounded numeric
observations, not browser frame or production FPS results. A 6.24MB workspace
document with 143,360 stroke anchors and 12 images roundtripped in 433.5ms;
document import is a bounded explicit operation, not work performed every frame.
The latest full-catalog source with 100,000 bars and all seven base indicators
measured 11.8ms ingestion and 103.8ms first-frame work. Across 100 warmed live
frames, p50 was 1.7ms, p95 2.2ms and max 2.7ms. Initial work still exceeds a frame
budget; these timings are workload-specific, not a claimed speedup over old Pro.

Measurements below are local development observations in Chrome with synthetic
data. They are not production latency or a full feature-equivalent comparison
against the old Pro application.

- Existing normalization, loader, replay, Heikin Ashi and TA tests: 166 passed.
- Existing chart-type geometry tests: 20 passed.
- After adding optional tail reads to the shared loader, its 84 existing cases
  were rerun and passed. No new tests, assertions, snapshots or CI workflows were
  added to the repository test suites.
- Strict TypeScript checks passed for the source. The optional technical pack
  also compiles with ES2022 alone, without DOM libraries.
- Existing package build, generated declarations, package self-check and existing
  consumer compatibility checks passed after shared-core changes (779,033-byte
  tarball). This validates the existing exports; it does not claim the owned
  engine is already the package's production entry.
- Manual browser observations exercised all fourteen series types, the eleven
  optional indicators, six drawing types, lock, undo/redo, rejected import,
  price scales, PNG output, actual touch pinch, reduced motion and disposal.
  Pinch changed the visible range from 160 to 87 candles. Disposal removed all
  owned canvases. No browser page errors occurred in those observations.
- Later browser observations exercised all thirteen drawing tools, search,
  interval and currency changes, stale responses, replay, empty/error/retry,
  restored per-market drawings, and secondary-pane cursor values. A cached
  timeout recovered all 32 bars; 100 repeated paging requests created one fetch,
  retry backoff was respected, and gap resync released paging for the next page.
- MACD: three parameter sets, 900,576 final values and replacement/reset/prepend
  observations matched the existing core exactly. One 100,000-bar sample with
  three MACD instances took 19.55ms initially and 7.71ms for 1,000 tail changes.
- Integrated BOLL/KDJ: 10,784,640 fields across 64 configurations and 1,152
  snapshots matched existing full calculations exactly, including reseed
  boundaries, replacements/appends and history corrections.
- Default RealtimeSeries raw/reference/HA values and events matched the previous
  implementation. Disabling reference indicators kept raw/HA values and events,
  with empty reference arrays. One 100,000-bar initialization measured 7.73ms
  enabled and 3.10ms disabled; this is only the series stage.
- One 100,000-bar, five-indicator first-frame computation/paint measured 40.1ms.
  This excludes module loading and ingestion. Optional indicator first calculations
  measured roughly 17–60ms each. These long calculations still require work;
  merely choosing Canvas does not remove them.
- A later actual Canvas observation with 100,000 bars and all seven built-ins
  measured 11.2ms ingestion and 81.4ms first-frame computation/paint. For 100
  warmed-up live frames, p50 was 1.7ms, p95 2.7ms and max 4.9ms. First-load work
  still exceeds a frame budget; this is not a production FPS or overall-load
  speedup claim. Earlier five-indicator timings are not a comparable baseline.
- 120 wheel events delivered in one task caused one viewport build/paint through
  the unified scheduler. Pointer movement did not rebuild price geometry.
- MA periods 1/20/999: 500 tail replacements took about 1.33ms total in one
  bounded calculation. After replacement and 64 appends, results had zero exact
  numerical differences from existing full `sma` output.
- The optional pack was compared to existing SC calculations over 26 parameter
  cases and 31,680 values; no numerical differences were found.
- Actual `DataLoader` with 100,000 bars and 100 separately flushed ticks:
  new port performed 100 tail reads and zero full-history reads; the compatible
  fallback performed 100 full-history reads. Synchronous routing measured 1.4ms
  versus 178.1ms in that sample. Both retained the same last bar and notification
  count. A same-frame burst produced one batch/notification.
- Isolated minified ES bundles measured: chart 75.8KB / 25.4KB gzip; complete
  owned entry including workspace 114.3KB / 36.4KB gzip; renderer-free model
  39.0KB / 13.7KB gzip. Optional technical/classic/market-overlay entries were
  4.45/3.31/3.37KB gzip when bundled separately. Do not add these figures as if
  shared modules were duplicated in a consumer bundle. No external imports or
  `node_modules` inputs occurred in these measured runtime graphs.
  These sizes are not a full-Pro bundle comparison and change as migration grows.

Independent review identified and corrected gesture coordinate mismatch, a
one-frame input delay, invalid-date rendering errors, zero-reference percentages,
inspection seed mismatch, offscreen invalidation, callback reentrancy/disposal,
live drawing drag offsets and full-history copies in the live feed path.

## Technology choices

Canvas 2D, Pointer Events and `requestAnimationFrame` currently cover the measured
interaction needs with a small dependency-free rendering graph. Data and drawing
models remain portable to React Native. The browser renderer does not become a
native renderer by virtue of sharing its model.

Worker/OffscreenCanvas remains an option for the measured long indicator/render
tasks, but moving work requires a versioned protocol and efficient data transfer.
It has not been implemented or benchmarked here. WASM and WebGPU have not been
introduced; no speed claim is made for either. See the platform references for
[OffscreenCanvas](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas)
and [WebGPU availability](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API).

## Intentional scope and remaining limitations

The new API removes `getChart()`, upstream stores and arbitrary upstream plugin
interfaces. `docs/OWNED-API-MIGRATION.md` maps supported replacements and lists
retired command/chrome/localization contracts. All 65 drawing tool capabilities
now have owned implementations; legacy private object identity and plugin hooks
are deliberately not restored. The new workspace document is not the old schema.
Classic indicator conventions are documented rather than presented as identical
to every upstream formula. AVP has no agreed turnover/volume contract and is not
advertised. Hosts must migrate explicitly before upgrading.

The shell has basic labeled controls and chart keyboard navigation, but full
localization and keyboard pane/axis editing remain future work. Drawings outside
loaded data use edge intervals, not a session calendar. Percentage scaling uses
the first loaded raw close as its reference.

Custom formulas and optional catalog definitions still fully recalculate on
   changed data; their SC aliases do not yet reuse the default incremental
   kernels. First-load allocation, expensive custom combinations and wide zone
   scans need further work. Ichimoku future projection and cloud fill
   are not implemented; the previous SC implementation also omitted those paths.

Legacy source cleanup must preserve portable financial helpers and their relevant
validation. Its removal plan is independently reviewed; excluding an obsolete
module from the runtime build does not prove that every historical behavior is
unimportant. Applicable license notices remain included.

No push, merge, npm publication, or deployed consumer switch has occurred for this
rewrite. Local diagnostic files prefixed `.task-` are evidence, not package inputs
or new persistent tests.
