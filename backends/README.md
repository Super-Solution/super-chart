# Backends

One folder per language. Go and Python reimplement the Super Chart technical-analysis kernels and are tested against
the shared data in [`../conformance`](../conformance/README.md); `rust/` holds service libraries (see its README). All code here is GPL-3.0-or-later.

| Folder | Status |
| --- | --- |
| `go/` | 33 kernels (moving averages, oscillators, bands, signals, volume and SAR); benchmarks in `ta/bench_test.go`; HTTP indicators server in `server/` and `cmd/super-chart-server` |
| `rust/` | Not kernels: libraries for the services around a chart. `super-chart-docs` saves drawings and workspaces (the server of the sync protocol), `super-chart-quotes` aggregates quotes from several markets |
| `python/` | The same 33 kernels; src layout, typed (`py.typed`), ruff and strict mypy clean; HTTP indicators server in `super_chart.server` |

There is no TypeScript folder here: the TypeScript implementation is the library itself, in `packages/core`.
The ports cover the kernels listed in the conformance README. The other indicators (`linreg`, `correlation`,
`valuewhen`, pivots), the SuperScript runtime, data loading and drawings stay TypeScript-only for now.

Both public backends also serve the kernels over HTTP with one contract: see [`../docs/INDICATORS-SERVER.md`](../docs/INDICATORS-SERVER.md).
