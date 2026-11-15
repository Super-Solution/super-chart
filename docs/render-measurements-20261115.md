# Render measurements — 2026-11-15

Local one-time observations for the change described in [the rendering audit](render-audit-20261115.md). These are not newly installed regression tests or benchmark pipelines.

## Pure geometry construction

Baseline: `HEAD` version of `packages/core/src/model/frame.ts` at `5b9b7d0b329cd0853735f2eaeb75c70e31baf7f9`. Candidate: current owned aligned-frame path. Both were bundled in memory with Bun 1.3.10 and called in the same process, without writing fixture or benchmark files.

Workload: 5,000 deterministic OHLCV source bars; 1,000 × 600 logical-pixel chart; 3 panes and 6 series, including null gaps and a histogram. Fractional viewport. Fifty warmup calls per implementation, then five rounds with implementation order alternating. Each round contained 1,500 frame builds for 160 visible bars, or 300 builds for 1,600 visible bars. Table entries are median milliseconds per build, not browser frame times.

| Visible bars | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| 160 | 1.386513 ms | 0.126097 ms | 90.9% |
| 1,600 | 14.467457 ms | 1.414490 ms | 90.2% |

Five before samples at 160 bars: 0.764852, 1.192301, 1.386513, 1.390336, 1.438831 ms. After: 0.069356, 0.104160, 0.126097, 0.129300, 0.145005 ms.

Five before samples at 1,600 bars: 14.324041, 14.450610, 14.467457, 14.579900, 15.383953 ms. After: 1.323377, 1.411131, 1.414490, 1.491426, 1.716363 ms.

Variation and machine/JIT effects are visible. This measures the old generic-model work eliminated during geometry construction, including lower panes. It does not establish an equivalent overall FPS, startup, network, GPU or interaction-latency improvement.

## Numerical and rendering observations

A one-time comparison covered 36 combinations: 0, 1, 2, 6, 160 and 1,600 bars; linear/log/percentage price scales; normal/reversed orientation. Six indicator series included null gaps and separate panes. All compared model geometry, scale bounds/ticks, pane metadata and three cursor inspections matched the baseline. The intentionally new derived-precision field was excluded from the structural comparison.

A separate one-time Canvas-command trace compared ten extended price types across three scales and both orientations: 60 comparisons, no differing commands at 160 bars. This covered hollow/outline/hollow-down candles, columns, high-low, volume-bars, step-line, HLC area, line-markers and baseline. The trace did not rasterize pixels and is not a screenshot baseline.

At 1,000px chart width (936px plot), the deliberate candle-width correction gives:

| Visible bars | Slot width | Before body | After body |
| --- | ---: | ---: | ---: |
| 6 | 187.2px | 12px | 127.296px |
| 12 | 85.0909px | 12px | 57.8618px |
| 40 | 24px | 12px | 16.32px |
| 160 | 5.8868px | 4.0030px | 4.0030px |

## Existing validation actually executed

- Cached TypeScript 4.9.5 ran the existing tsconfig with the unavailable chat integration excluded: 76 core/web/SuperScript source files, zero diagnostics. This is an affected-package check, not a successful full workspace typecheck.
- The ordinary `npm run typecheck` could not locate local `tsc` because this checkout has no node_modules. Running cached TypeScript against the full workspace identified the missing `@supersolutions/super-protocol` package and resulting integration type errors; no dependency was installed to hide the limitation.
- Existing Vitest 0.28.5 ran TA (51), geometry (20) and precision (12): 83 current-source cases passed. The filter also matched the comparison demo's unchanged baseline copies, so the runner reported 166 passed across six files (83 current + 83 baseline). No assertion, fixture or test file was added and no rerun was performed just to change that count.
- Vitest used the already existing runner/dependencies through its programmatic interface with cache disabled. No new pipeline or package publication was triggered.
- Independent source review found no confirmed material finding in the ordered-snapshot fast path; malformed snapshots keep the generic fallback. Browser comparisons and gestures remain separate observations.

Remaining limits: no native-device performance claim; no pixel-equality guarantee across browsers/DPRs; no arbitrary invalid-snapshot compatibility claim; no assertion that every optional indicator is incremental. See the audit's pending areas.
