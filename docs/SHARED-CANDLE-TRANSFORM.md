# Shared candle transform, phase 6 (private candidate 0.0.46)

PR #5 was normally merged at d65d7d667b49f97eac1d9d5e30ae9460cdc1f098. This phase moves the existing pure Heikin Ashi transform into src/core/heikinAshi.ts and makes it available through the core/native entries. The Web src/data/heikinAshi.ts import remains a compatibility facade, including its existing KLineData compatibility helper. No new copy of the calculation is introduced.

## Platform boundary and reduced allocation

The shared transform accepts the same generic OHLC bar structure and returns the same generic bar type. Valid bars preserve metadata through the existing object spread. Invalid OHLC bars pass through as the original object and reset the recurrence; the next valid bar restarts with its own first-bar formula. Timestamps, volume, turnover, output ordering, high/low bounds and the prior transformed open/close recurrence remain unchanged. A contradictory old comment about invalid bars seeding the next bar was corrected to describe the existing reset behavior.

The only calculation-path change replaces a four-element array plus every(Number.isFinite) with four short-circuit Number.isFinite calls. Both stop at the first non-finite value. This removes one temporary check array per processed bar without changing floating-point arithmetic or introducing a cross-update cache. The transformed output array and valid output bar objects are still allocated.

Web rendering continues to import the same compatibility path. Native hosts can import toHeikinAshi, isHeikinAshiUp and the OhlcBar type from the native/core entry without KLineChart, React, Solid or a DOM. They must transform the full loaded history from its first bar, then select a visible window: transforming just a viewport would seed a different recurrence. Renderers and gestures remain host-owned. This does not wire the old Mobile app to the new package or change its displayed chart type.

## Manual local measurements

Windows/Bun 1.3.10; eight warm-up pairs, then 41 alternating before/after samples per size. Medians for full-history transformation of finite OHLC bars; baseline is merged PR #5. Serialized output data was observed equal. The number of temporary check arrays removed is a source-level allocation count, not a measured heap/GC result.

| Bars | Before | After | Temporary four-element check arrays removed |
| --- | ---: | ---: | ---: |
| 2,000 | 0.3739 ms | 0.2167 ms | 2,000 |
| 20,000 | 0.7259 ms | 0.4650 ms | 20,000 |
| 100,000 | 3.7072 ms | 2.1798 ms | 100,000 |

These are engine/JIT-sensitive synthetic computation timings; they do not establish Web frame-rate, finger latency or actual phone performance. No incremental/viewport-only transform, Worker or WASM path is added.

## Validation

Existing Heikin Ashi and custom-series overlay tests: 18 passed across two files. They exercise recurrence, malformed-bar recovery, timestamp/volume preservation and the existing Web data-to-drawing path. No tests, assertions, cases, fixtures, snapshots, workflows or status checks were added or changed. Scoped lint passed with no errors or warnings. The existing Web/core/native build, declarations and package/consumer check passed: 309 files, 777,090 packed bytes under the unchanged 780,000-byte allowance. Plain Node imported the built core/native entries, observed the same transform function and produced a transformed bar with no document/window. Independent AI review found 0 confirmed findings.

This remains private and unpublished. No original-monorepo edits, native dependency, renderer/gesture change, deployment or host adoption. Android/iOS/Metro/Hermes device acceptance and application adoption remain outstanding.
