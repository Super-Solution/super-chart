> **Historical page.** Written for phase 1 of the shared core, before the owned engine and the package split. Paths such as `src/core/…` are the old single-package layout; the current layout is in [PACKAGES.md](PACKAGES.md).

# Shared core, phase 1 (private, 0.0.41)

## Scope and current integration

This branch is developed only in Super-Solution/super-chart. It does not modify, deploy or switch dependencies in ZzyzxLabs/zzyzx-full-repo. Web still renders with the existing KLineChart/Solid adapter. SupWallet Mobile still renders with its existing React Native SVG components and uses its existing native gestures. The new native entry exports computation, not a React component or renderer; adoption by Mobile is a later explicit integration change.

The original Mobile mathematical model, viewport transitions and MA20/EMA21 calculations were extracted read-only from frontend/sup-wallet/apps/mobile at de693554a087299df77fbd65be8e1f1f445f9fee. No React Native UI, theme, gesture binding or application data is copied here. LICENSE and NOTICE apply as described in the repository.

## Boundaries

- src/core/chartPort.ts: a small generic renderer data-sink contract; the Web loader keeps its old LoaderChart name as a type alias. Native hosts can retain compact candle data without inheriting the browser engine.
- src/core/types.ts: structural OHLCV MarketBar type, no upstream engine types.
- src/core/ta.ts: existing pure TA math, shared by SuperScript and Web indicators.
- src/core/normalizeBars.ts and precision.ts: bar normalization and price precision; existing semantics retained.
- src/core/coalesce.ts: frame-bounded tick batching with an injected scheduler. Hosts own foreground/background signals and timers. Never discard a closed bar simply to reduce draw calls.
- src/core/financialModel.ts: platform-neutral financial-card model, domains, coordinates and nearest-point lookup.
- src/core/viewport.ts: pure viewport state transitions extracted from native; hosts keep their own gesture handlers.
- src/core/nativeIndicators.ts: existing native MA20/EMA21 compatibility. Native EMA starts at the first close, while the standard Web TA EMA uses an SMA seed. This difference remains explicit rather than silently changing historical results.
- src/data/* and src/ta/index.ts retain compatibility facades for existing Web imports. src/indicators/* remain the thin KLineChart template adapters. Phase 1 retained the existing Web load protocol/engine bridge. Phase 2 moves the same state machine into core and leaves a thin browser adapter; see SHARED-LOADER.md.

Import the renderer-free API from `@supersolutions/super-chart-core` or `@supersolutions/super-chart-core/native`. Both entries use plain JavaScript/TypeScript, with no DOM, React, Solid or browser Worker import. (This page records phase 1; the KLineChart peer it mentions was removed with the owned engine, see [OWNED-API-MIGRATION.md](OWNED-API-MIGRATION.md).)

The native entry is ESM and has a react-native export condition. It is not a claim of validation on every Metro/Hermes/iOS/Android combination. No WASM, new native dependency or native build is introduced.

## Changes with a measured benefit

1. Four close-only Web indicator adapters read one series instead of allocating four unused-or-used OHLCV arrays. Each full close extraction allocates n slots instead of 4n. No cross-indicator mutable-array cache is introduced, so in-place ticks and history corrections cannot reuse stale columns.
2. Financial category keys are collected without concatenated filter/map/flatMap intermediate arrays, preserving candles-first, longest-series-next ordering.
3. Stacked-bar totals are accumulated once per visible point, rather than rescanning every series for every x key. Positive/negative totals, duplicate points and independent axes preserve the old accumulation order.
4. Domain bounds no longer spread an unbounded array into Math.min/Math.max. No price or indicator value is rounded or converted to Float32.
5. Nearest-point lookup uses binary search on the model's ordered positions, preserving first-match ties, non-finite input behavior and the degenerate-coordinate fallback.

These changes do not install a hidden identity-only cache. Callers can mutate data or correct history; model construction still observes the current supplied data.

## Manual measurements

Windows, Bun 1.3.10; warmed alternating before/after samples. Medians, synthetic data, no CI benchmark job and no committed benchmark fixtures or new assertions. Baseline is the imported model/algorithms before this branch. This is a bounded local observation, not a phone or production benchmark.

| Workload | Before | After | Samples |
| --- | ---: | ---: | ---: |
| Full stacked model: 8 series x 1,600 points | 74.512 ms | 2.588 ms | 9 |
| Pan model: 30 windows, 160 visible keys | 45.351 ms | 12.792 ms | 15 |
| Zoom model: 25 changing windows | 40.716 ms | 11.193 ms | 15 |
| Nearest-point scrub: 10,000 lookups | 20.223 ms | 0.988 ms | 15 |
| MACD + BBP + StochRSI: 20,000 bars, full computation | 3.796 ms | 3.552 ms | 15 |
| MACD: 10 full recomputations on 20,000 bars | 13.367 ms | 12.771 ms | 15 |

The full stacked-model improvement is specific to removing the quadratic accumulation. It is not a promise that every chart improves by that factor. Indicator improvements are modest and within a range that needs real-device confirmation; the reliable allocation reduction is limited to close extraction.

Manual Chrome 156.0.8078.48 profiling used 20,000 bars, SMA/MACD/StochRSI, 3 alternating rounds of 30 frame-scheduled pan/zoom/live operations. Median frame intervals remained about 8.3-8.4 ms before and after, with overlapping live-update p95 intervals up to about 16.7 ms. No page errors were observed. There is no demonstrated browser-frame-rate gain. API-driven pan/zoom is not a substitute for finger-to-screen latency or mobile device profiling.

## Existing validation only

- 11 affected Web unit files: 241 passed, including TA, indicator calculations, normalization, precision and loader behavior.
- Original Mobile tests were read and executed without editing that repository, using temporary module resolution to the extracted financialModel/viewport. The first filtered run passed 21 tests; a follow-up ran both full geometry and gesture files, 35 passed (counts overlap). Renderers/gestures remained the original implementations. This is local Jest compatibility, not an Android/iOS device acceptance.
- Web build, all generated declarations and existing package/consumer check pass. The first declaration build failed on a renamed type alias; using the platform-neutral type directly fixed the declarations.
- Affected browser behavior specs and isolated core/native import checks are recorded in the PR evidence after execution.
- No new tests, snapshots, fixtures, pipeline, required status checks or hosted jobs were added.

## Next stages

Adopt the core explicitly in each host, then profile representative phones and WebViews. Only move proven expensive computation to a Worker when host scheduling/cancellation semantics are established. Consider WASM only for a measured compute bottleneck. Keep renderer and input adapters separate; do not replace KLineChart or native SVG rendering as part of this phase.
