# super-chart Go backend

Package `ta` reproduces the technical-analysis kernels of `packages/core/src/ta.ts`. A `Series` is a slice of
`*float64` where `nil` is a missing bar. Every case in [`../../conformance`](../../conformance/README.md) must
pass; products are wrapped in explicit `float64()` conversions so no compiler fuses a multiply into an add.

```bash
go vet ./... && go test ./...
go test -run xxx -bench . ./ta     # 100k-bar benchmarks
```

## HTTP server

`server.New(server.Config{})` is an `http.Handler`; `go run ./cmd/super-chart-server` serves it (environment and
contract in [`../../docs/INDICATORS-SERVER.md`](../../docs/INDICATORS-SERVER.md)).

GPL-3.0-or-later; a commercial licence is available from SUPER SOLUTION LABS INC (contact@supersolution.io).
