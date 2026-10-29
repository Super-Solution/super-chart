# Shared data lifecycle, phase 2 (private candidate 0.0.42)

PR #1 was normally merged at df038c0e9a41c61aa3052ea915a9ab958285320e. Its merged tree equals the reviewed 1207810 candidate. This second phase remains limited to Super-Solution/super-chart. It does not update SupWallet/Broker dependencies, old monorepo source, native views/gestures, deployment, repository visibility or package publication.

## One loader state machine, platform-owned lifecycle

The existing loader implementation now lives in src/core/dataLoader.ts. It owns request generations, superseded/aborted requests, subscription pairing, initial/history/gap loading, retry/timeout policy, cache adoption and replay. The state transitions were moved rather than rewritten. The existing history cache, replay, symbol/period identity and request-range functions also live under core; src/data/* retains compatibility facades.

src/core/feed.ts is the shared market/feed contract. The Web types.ts surface keeps its existing export names. MarketBar's extension-field index preserves the original KLineData any contract for callers using custom fields; known timestamp/OHLCV fields remain explicitly numeric. Runtime normalization/refusal rules do not change. The first review caught an unintended any-to-unknown narrowing; that was corrected before delivery.

src/core/loaderEnvironment.ts provides timers/microtasks and optional injected visibility/connectivity event sources. It never reads document or window. Native/Node core consumers can create DataLoader without a browser. A host can inject animation-frame scheduling and foreground/reconnect sources.

src/platform/browser.ts owns the browser-specific document/window, animation-frame and visibility bindings. src/data/loader.ts is a thin Web subclass that maps the old env.document/env.window injection contract into core visibility/connectivity. Existing browser callers retain their import path and constructor defaults. No React Native AppState, NetInfo, renderer or gesture binding is installed by this phase: the host must bridge those native signals before enabling automatic resume/reconnect behavior. Timers-only construction is not device acceptance or proof of correct app-background integration.

core/native consumers need normal JavaScript timers, Promise and AbortController/AbortSignal support (or their host-provided equivalents). There is no Worker, WASM or new native runtime dependency. The standard browser-compatible event names visibilitychange and online describe the injected event-source contract, not a DOM dependency.

## Bounded cache optimization

mergeKind determines whether newly loaded normalized bars line up with cached bars. The old code performed an independent binary search for every overlapping bar. The new path checks the next adjacent cached timestamp first and falls back to the same binary lookup whenever it does not match. This does not skip timestamp validation or compare only endpoints. Gaps, sparse markets, re-anchored timestamps and replacement semantics remain unchanged.

Manual measurements: Bun 1.3.10, 100,000 cached bars, 5 warm-up pairs followed by 25 alternating before/after samples; values below are medians. Synthetic local computation, not device FPS or end-to-end load latency. The comparison result was observed equal in each measured workload.

| Fresh data | Before | After | Result |
| --- | ---: | ---: | --- |
| 50,000 contiguous overlapping bars | 3.6606 ms | 0.2572 ms | tail |
| Last 100 cached bars | 0.0041 ms | 0.0004 ms | tail |
| 10,001 sparse overlapping bars | 0.7519 ms | 0.7670 ms | tail |
| 50,000 timestamps shifted by 1 ms | 0.0002 ms | 0.0002 ms | replace |

The useful gain is the long contiguous case. Sparse lookup showed a small local slowdown, and tiny timings are near measurement limits. No claim of universal speedup is made. Cache snapshots, source data, retained bar values and normalization are unchanged.

## Validation and limits

- Existing data/state tests: 216 passed across 10 files, including all 84 loader cases, keys, ranges, cache, replay, normalization and load-state behavior.
- Final Web/core/native build, generated declarations and existing package/consumer check passed (exit 0). Existing browser loader/interaction/lifecycle specs: 26 passed on 9.8.12. Plain Node imported both core/native and constructed/disposed their shared DataLoader with no document/window.
- Independent AI review found the public extension-field type narrowing and confirmed its correction. Normalizing the moved loader class's type/environment names produces the same state-machine body as the baseline, including abort/subscription/generation/dispose behavior.
- Scoped existing ESLint: 0 errors, 71 warnings, primarily existing method-signature conventions carried with the extracted contracts and types. No warning-clean claim.
- No new or edited tests, assertions, fixtures, pipeline, status check or hosted job. No old-app adoption or Android/iOS/Metro/Hermes device validation.

Next: have each host explicitly wire a renderer port, datafeed and lifecycle signals to the shared loader, then profile actual devices. That integration remains separate from this repository-only change. Worker/WASM work still requires a demonstrated compute bottleneck; the previous Chrome pan/zoom profiling did not show a frame-rate improvement.
