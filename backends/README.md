# Backends

One folder per language. Each reimplements the Super Chart technical-analysis kernels and is tested against
the shared data in [`../conformance`](../conformance/README.md). All code here is GPL-3.0-or-later.

| Folder | Status |
| --- | --- |
| `go/` | 33 kernels (moving averages, oscillators, bands, signals, volume and SAR); benchmarks in `ta/bench_test.go`; HTTP indicators server in `server/` and `cmd/super-chart-server` |
| `python/` | The same 33 kernels; src layout, typed (`py.typed`), ruff and strict mypy clean; HTTP indicators server in `super_chart.server` |

There is no TypeScript folder here: the TypeScript implementation is the library itself, in `packages/core`.
The ports cover the kernels listed in the conformance README. The other indicators (`linreg`, `correlation`,
`valuewhen`, pivots), the SuperScript runtime, data loading and drawings stay TypeScript-only for now.

Both public backends also serve the kernels over HTTP with one contract: see [`../docs/INDICATORS-SERVER.md`](../docs/INDICATORS-SERVER.md).
