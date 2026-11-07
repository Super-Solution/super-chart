# Normalization working buffer

The shared Web/native normalizeBars implementation now deduplicates in its newly
allocated normalization buffer instead of allocating and growing a second array.
The clean-input fast path is unchanged and still returns the caller array.
For repaired input, stable sorting, last duplicate wins, issue counters, optional
fields and timestamp conversion retain their behavior. Caller input is not mutated.

The write cursor never exceeds the current read position, and truncation happens
only after traversal. This is not a retained cache or a renderer change.

Manual Bun 1.3.10 Windows measurements used seconds timestamps with adjacent duplicate
pairs, eight warmup pairs and 41 alternating samples per implementation. Median full
normalization was 1.0314 -> 1.0025 ms for 20,000 bars and 5.4133 -> 5.2513 ms for
100,000 bars. Serialized results matched in these measured workloads. Timing changes
are small; the primary benefit is avoiding the second array and its reference writes.
No heap/GC, browser FPS or device improvement was measured. Valid bars still require
normalization objects; this change does not remove those allocations.

Validation uses existing normalization and loader tests, scoped lint and the existing
package build/consumer check. No test cases or pipeline were added. Original monorepo
and Mobile application adoption remain outside this change.
