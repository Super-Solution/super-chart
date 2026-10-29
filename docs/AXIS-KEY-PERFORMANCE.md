# Axis-key computation, phase 4 (private candidate 0.0.44)

PR #3 was normally merged at ec64a6a75fe72813780f4806bc32e089ae25095b. This phase remains in the private chart repository and changes only shared financial-model computation plus candidate metadata/documentation. There is no adoption in the old monorepo and no renderer, gesture, datafeed or loader change.

## Remove repeated work

chartKeys previously repeated Number/Date.parse conversions during validation, identity deduplication and sorting, often parsing the same date string many times. It now memoizes only date-string conversions inside one chartKeys call. Numbers and finite numeric strings retain the direct numeric path. Invalid dates remain non-finite and excluded. Category ordering, mixed date/numeric deduplication and the first original key for an epoch remain unchanged.

This temporary Map grows with distinct date strings encountered in the call. It is released when chartKeys returns, is not captured by the returned model, and is rebuilt after any input mutation. This trades temporary memory for fewer date parses; it is not an identity-only or persistent history cache. Financial values, scale rules, indicator results and timestamps are not rounded or changed.

Category models no longer allocate and numerically parse an unused visible-key array. Crosshair value lookup converts the requested key once, retaining the first matching source point and existing null/value behavior.

## Manual local measurements

Windows/Bun 1.3.10, 4 line series of 10,000 points each, 160 visible keys at indices 5000-5160. Five warm-up pairs, then 21 alternating before/after samples; table reports median milliseconds. Baseline is merged PR #3. Shuffled input uses the same keys in a deterministic permuted order. These are synthetic model calculations, not renderer or phone FPS measurements.

| Input | Key collection before / after | Complete window model before / after | Date.parse calls per model before / after |
| --- | ---: | ---: | ---: |
| Sorted ISO timestamps | 22.353 / 11.278 ms | 34.063 / 23.495 ms | 161,918 / 51,920 |
| Shuffled ISO timestamps | 140.729 / 42.037 ms | 162.430 / 68.118 ms | 382,746 / 51,920 |
| Numeric timestamps | 12.467 / 10.596 ms | 19.782 / 18.570 ms | 0 / 0 |
| Category labels | 3.328 / 2.152 ms | 4.545 / 3.294 ms | 160 / 0 |

Serialized model data was observed equal before/after in all four measured workloads. Timing improvement varies with key format, ordering and input size; the strongest predictable benefit is reduced date parsing. No claim of universal speedup or actual device responsiveness is made.

## Validation

The 7 existing native financial-chart model cases passed, using a temporary resolver to exercise this shared core without editing the old repository. The 3 UI cases in that file were filtered out because they do not validate this change. TypeScript, Web/core/native compilation, generated declarations and the existing package/consumer check passed (309 files, 776,301 packed bytes, below the unchanged 780,000-byte allowance). Scoped existing lint passed with 0 errors and 7 inherited warnings. Independent AI source review found 0 confirmed findings. No tests, test cases, fixtures, assertions, snapshots, pipeline or status checks were added. The temporary measurement/resolution scripts are not committed or packaged. Package visibility/publication and existing size allowance remain unchanged. Actual Web/RN host adoption and device profiling are still outstanding and remain outside the old-monorepo freeze for this task.
