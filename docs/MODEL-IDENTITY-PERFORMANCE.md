# Model identity reuse (0.0.53)

Financial model construction repeatedly normalized identical ISO time strings while
filtering each source, creating visible indices, accumulating stacks and plotting.
It now reuses string-key identities within one build. Numeric keys and category
labels retain their cheap original conversion. The temporary map is explicitly
cleared before returning; x/y callbacks retain their original conversion behavior.
No caller-array identity cache or state survives into the next build, so callers
can edit data and rebuild normally. Sorting, aliases, stacking and axis arithmetic
are unchanged. Valid-candle checks also avoid a temporary four-element array.

Local Bun1.3.10 measurement reused the earlier model benchmark:4 series of10,000
points,160 visible at390x300,5 warmups and21 alternating samples, median milliseconds:

| Input | Before | After |
| --- | ---: | ---: |
| Sorted ISO dates |23.724|16.209|
| Shuffled ISO dates |60.230|47.126|
| Numeric timestamps |16.685|16.269|
| Category labels |4.002|4.252|

ISO Date.parse calls per model fell from51,920 to20,960. Model values/geometry matched
in all four observations. Numeric/category measurements are included for context,
not claimed as improvements; category was slightly slower in this run. This is
model CPU work, not production/native FPS. Temporary identity storage scales with
unique string keys during a build and is then cleared; this is not a claim of
lower peak memory or heap profiling.

The7 existing native financial-model cases passed through the existing resolver
against this repo's core;3 unrelated UI cases were filtered, no snapshots. Original
monorepo source was read-only. Bounded observations of mixed ISO/numeric aliases,
invalid inputs, stacked dual axes, category order, returned x callbacks and edits
between builds also matched. Independent source review found0 confirmed findings.
Full build/type declarations and package consumer checks validate the final source.
No tests, fixtures, pipeline, dependency, renderer/gesture or production integration
changes were introduced. Version0.0.53 is not published.

Final full build/declarations and package checks passed:312files,778,549bytes packed, below the unchanged780,000byte limit.
