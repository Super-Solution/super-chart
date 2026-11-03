# Bounded auxiliary storage in the shared TA core (0.0.51)

The Web/SuperScript and native-exported pure TA functions keep their existing API
and numeric behavior. Highest/lowest now hold a circular monotonic deque with at
most `len` indices, rather than allocating an index buffer for the whole series.
Windows longer than the series return the same all-null warmup output immediately.
Valuewhen for positive occurrence keeps only the latest occurrence+1 hit indices,
growing lazily until full. Occurrence0 retains its earlier single-index fast path.
Invalid/unreachable occurrences keep their existing all-null result.

This reduces auxiliary working storage, not the required output arrays or input
history. For100,000 input values and window20, the typed index buffer is80bytes
instead of400,000bytes; window2000 uses8,000bytes. These are exact buffer payload
sizes, not a measured whole-process heap/RSS reduction. Valuewhen with33,334 hits
and occurrence1 retains2 indices instead of33,334 (occurrence10 retains11).

A bounded local Bun comparison alternated old/new calls for24 rounds, discarding
6 warmups and reporting the upper median of18 retained samples. Input was100,000 oscillating
finite values, with every third condition true. Final measured milliseconds:

| Function | Parameter | Before | After |
| --- | ---: | ---: | ---: |
| highest |20|0.599|0.674|
| lowest |2000|0.683|0.712|
| valuewhen |1|0.456|0.318|
| valuewhen |10|0.333|0.315|

Extremes trade a small processing-time increase for bounded auxiliary memory;
this is not an across-the-board speed improvement or a device FPS claim. A first
prototype using modulo for every deque position was slower; conditional wrap
reduced that overhead without changing calculations. Output observations matched
using Object.is, including separate null/NaN/infinity/tie/signed-zero and invalid
length/occurrence inputs. No persistent identity cache or input mutation is added.

The existing51 TA and37 SuperScript cases passed after the final change. Scoped lint and full build/package checks passed; the packed size is779,906bytes under the unchanged780,000byte limit. Independent
source review found no confirmed findings. No tests, fixtures, snapshots, pipeline,
dependency, production-renderer or original-monorepo changes were introduced.


