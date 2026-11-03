# Linear large-window pivots (0.0.52)

The shared TA pivot high/low function previously rescanned the complete left/right
window for every candidate. For nonnegative safe-integer bounds, a total window
of at least64 that fits the series, and finite-or-null input, it now uses a circular
monotonic deque. Each index enters/leaves at most once: O(n) time and O(window)
auxiliary index storage. A preliminary finite-value scan also takes O(n).

Strict comparisons retain the earliest equal extreme, and output is still placed
right bars after the candidate. A null restarts the complete-window requirement.
NaN/infinity, unconventional bounds and small windows use the unchanged original
private scan. Inputs are not mutated; no persistent cache is introduced. The64-bar
cutoff is a conservative dispatch heuristic for avoiding small-window queue overhead,
not a guarantee that every data shape becomes faster.

Local Bun observations on100,000 values, alternating12 before/after rounds,
discarding3 warmups, median of9 retained samples (milliseconds):

| High-pivot input | Left/right | Before | After |
| --- | --- | ---: | ---: |
| Ascending |500/500|47.262|0.474|
| Oscillating |100/100|6.194|1.230|
| Small oscillating window |2/2|0.532|0.458|
| Descending |500/500|0.294|0.711|

Descending candidates are rejected almost immediately by the original scan;
the queue and preliminary scan cost more there. This change bounds expensive
large-window behavior, not universal latency or device FPS. Timing varies by
runtime. Final old/new output observations matched;810 bounded combinations also
showed no differences across high/low, wraparound, ties, nulls, signed zero,
non-finite inputs and unconventional bounds. These were local diagnostic probes,
not committed tests or fixtures.

The existing51 TA and37 SuperScript cases passed, as did scoped lint. Independent
source review found no confirmed issues. Full build, declarations and existing
package consumer checks are run for the final source. No new tests, pipelines,
dependencies, original-monorepo changes or production integration were added.

The first build exceeded the unchanged780,000-byte package limit. The full README
hold-drawing/editing guide was moved intact to DRAWING-INTERACTIONS.md and linked
from the retained Editing drawings section; no interaction/API documentation was
removed and no size guard was relaxed. Version0.0.52 remains unpublished.

Final build/declarations and package checks passed:312files,778,494bytes packed, below the unchanged780,000-byte limit.
