# Rendering and indicator follow-up, 2026-11-15

This implements audit items 21–29 in the owned engine. It does not add tests,
assertions, fixtures, snapshot baselines, dependencies or CI. Existing tests and
bounded, in-memory comparisons were used. Work is in the standalone chart repo;
no SupWallet consumer, npm release or production deployment is changed.

## Implemented runtime changes

| Item | Change | Correctness boundary |
| --- | --- | --- |
| 21: dense candles | Explicit `candleDensity: 'pixel-envelope'` aggregates the paint list by logical-pixel column. The bucket retains the first open, final close and every high/low. | Default is `raw`. Only candles/OHLC paint uses the envelope. Raw bars, model candles, indicators and inspection remain complete. This is an intentionally different dense visual representation, not lossless per-candle color preservation. |
| 22: line/area geometry | Frame-local close coordinates are projected once. Browser `Path2D` stroke/area geometry is reused for repaints of the same model; non-Path2D hosts keep the command fallback. | Null gaps and area closure remain separate runs. Weak model keys release old frames; changing viewport/data creates a new model. Borrowed owned-frame geometry must not be mutated by consumers. |
| 23: volume paint | Removed the copied OHLC object list and intensity array. A scalar maximum pass feeds the original per-bar alpha expression. | Exact alpha and draw order remain; differently transparent bars are not incorrectly combined into one opaque path. |
| 24: optional kernels | SC_SMA/SC_RSI/SC_MACD use their matching existing incremental kernels. Donchian and Ichimoku use finite dependency windows on tail changes. | Calculation identity opts in, not a name match. SC defaults/partial parameters and SMA's `sma` output key remain. Ichimoku rewrites affected lagging rows before the edited bar. History correction, prepend, reset and replay truncate rebuild. Huge lookbacks/displacements naturally fall back to a full input window. |
| 25: duplicate builtins | One computation per owned kernel/parameters/output-key in a compute call. Instances share borrowed rows and immutable checkpoints, with their own identity/figures/pane metadata. | Hidden/removal/parameter changes preserve correct surviving-instance state; custom formulas are never deduplicated by their name. |
| 26: shared input fields | Technical/classic calculations share lazily allocated OHLC arrays in a synchronous compute-local scope. | Raw/finite/nonnegative-volume policies have separate cache keys. Nested registry calls restore their caller; `finally` drops the scope. Nothing is reused across data edits. |
| 27: cursor lookup | `inspectBar` supplies the bar/time/mode without copying all indicator rows for every pane. Public `inspect` still supplies complete indicator values. | Generic manually supplied frames retain the old `inspect` fallback. Padded future space does not snap to the last candle. |
| 28: axis formatting | Bounded 512-entry caches reuse deterministic time labels/calendar parts across small pans and cursor moves. Calendar extraction avoids filter/map/Object.fromEntries intermediates. | Keys include timestamp, viewer timezone, timespan, symbol timezone, request type and format. Custom price formatters are still called, because hosts may supply stateful callbacks. |
| 29: drawing sampling | Quadratic/cubic Bezier segment counts follow projected curvature instead of fixed 64/96 segments. | The linear interpolation bound targets 0.35 logical pixels, capped at 1024 segments to bound work. Extremely large curves can reach that cap. Prices/anchors do not change; rays/channels are not culled by anchor visibility. Circular arcs were already screen-aware. |

Future-padding integration also projects a single real bar using the viewport
span and uses the true slot width for candle bodies. Empty future space returns
no inspection hit. With only one historical timestamp there is no observed time
interval from which to infer future drawing timestamps; no synthetic interval
or price is invented.

## Actual validation

- Existing TA (51), geometry (20), precision (12) and date-formatting (13): **96 passed**.
- Affected renderer/core TypeScript dependency graph: **50 source files, 0 diagnostics**.
  The full workspace still requires its pre-existing unpublished protocol/dependency setup;
  this is not a claim that the full package build passed.
- Pure numeric observation: 48 instances covering all technical/classic definitions
  and duplicate builtins. Initial load, append, last-bar correction, historical
  correction, prepend, truncate, post-truncate append, leader removal and parameter
  split: **1,443,468 field comparisons, 0 differences** against the existing full formulas.
- Added finite-window observation: default/empty/partial parameters and Ichimoku
  displacements 1, 4, 300 and 1,000,000, including batch append/no-op/history/truncate:
  **80 stages, 136,972 field comparisons, 0 differences**.
- With 50,000 real candles and a 1,000 × 600 logical-pixel frame, explicit envelope
  mode emitted **937 bodies/wicks instead of 50,000**. Global wick extrema remained
  exactly 50.20689655172407 and 527.7931034482759 pixels; both public bars and public
  model candles remained 50,000. These are command/geometry observations, not a
  claim of raster-equivalent candle colors.
- One real bar plus 12 future slots projected the bar at the plot's left edge (52px),
  inspected that bar as index 0, and returned null at the future right edge.
- Three optional kernels over 5,000 bars read high/low/close **5,000 times each**,
  rather than independently collecting those fields three times.
- Independent runtime review by the interaction and data agents: no confirmed
  material findings, including the finite-window and truncate invalidation paths.

## Bounded CPU measurements

Bun, same machine/data, in-memory modules from local HEAD before this follow-up
versus current runtime, five rounds with alternating order. Timings exclude module
build/import and registry setup/initialization for tail-update workloads. They are
microbenchmarks, not browser FPS or end-to-end input-latency measurements.

| Workload | Before median | After median |
| --- | ---: | ---: |
| 50,000 bars, SC_SMA/SC_RSI/SC_MACD, last-bar updates (12/round) | 22.5618 ms/update | 0.00625 ms/update |
| 20,000 bars, 24 identical MA instances, initial calculation | 17.7650 ms | 0.5633 ms |
| 50,000 bars, Ichimoku + Donchian, last-bar updates (12/round) | 23.6732 ms/update | 0.04195 ms/update |

Profiling the optional full formulas first identified Ichimoku as the highest
sampled full-calculation cost (7.57ms/50k bars in that isolated run), which justified
the extra bounded-window path. Other optional formulas continue to rebuild on data
changes when their recursive/session semantics have not been given a proven
incremental implementation. Their OHLC input collection is still shared. No
worker/WASM framework is introduced for these costs; scheduling/frame budget work
is handled separately in audit item 30.
