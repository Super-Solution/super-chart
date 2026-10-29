# Latest-hit query, phase 5 (private candidate 0.0.45)

PR #4 was normally merged at 94ce13462460d37c644c7601a36406ad02773a33. This change remains in the private chart repository. It adds a small fast path to the shared TA valuewhen function, used by SuperScript and available through core/native. No renderer, gesture, feed, loader, old-app adoption or indicator formula changes.

## Remove unused hit history

valuewhen(cond, src, occurrence) returns the source value at an earlier condition hit. For the default occurrence=0 (latest hit), the previous code accumulated every hit index even though each output only read the last one. This path now keeps one optional scalar index. It still reads src at that index for each output and preserves the original condition/null behavior, including negative zero. Queries for any other occurrence use the unchanged existing history implementation.

This reduces auxiliary hit-history storage from O(number of hits) to O(1) for the latest-hit query. The output array is still O(number of bars); this is not constant total memory. Source/condition arrays are not mutated, and no state survives a call. EMA seeds, numerical formulas, prices and other TA functions remain unchanged.

## Manual local measurement

Windows/Bun 1.3.10, eight warm-up pairs followed by 41 alternating before/after samples; median milliseconds. Baseline is merged PR #4. Synthetic full-series calculations, not phone FPS or an end-to-end chart benchmark. Timing at this scale is sensitive to engine/JIT and GC effects.

| Bars / condition hits | Before | After | Before auxiliary hit indices | After auxiliary state |
| --- | ---: | ---: | ---: | --- |
| 20,000 / every bar | 0.1458 ms | 0.0787 ms | 20,000 | one scalar |
| 100,000 / every bar | 0.5116 ms | 0.2872 ms | 100,000 | one scalar |
| 100,000 / every 20th bar | 0.5852 ms | 0.3261 ms | 5,000 | one scalar |
| 100,000 / no hits | 0.6996 ms | 0.2056 ms | 0 | one undefined scalar |

Output data was observed equal in the measured workloads. The main structural benefit is removing the unused growing hit-index array. These sub-millisecond absolute savings do not establish an improvement in overall chart responsiveness or real-device memory usage.

## Validation and limits

Existing TA and SuperScript tests: 88 passed in two files (51 TA, 37 SuperScript), including the existing script-level latest-hit behavior. Scoped TA lint passed with no errors or warnings. Independent AI review found 0 confirmed findings, including negative-zero, null/non-finite conditions, short source arrays and unchanged nonzero occurrences. The existing Web/core/native build, generated declarations and package/consumer check passed: 309 files, 776,510 packed bytes, below the unchanged 780,000-byte allowance.

No tests, cases, assertions, fixtures, snapshots, workflows, status checks, runtime dependencies or storage permissions were added. No package publication or deployment. The old monorepo remains unchanged. Host adoption and actual Web/RN device profiling are still outstanding; speculative Worker/WASM or further algorithm changes require a demonstrated bottleneck.
