# Engineering improvement log

Each iteration records what was found, decided, changed and checked, and what is left. Newest first. The
repository's own rules apply (see [`../MAINTAINING.md`](../MAINTAINING.md) and `AGENTS.md`): no CI pipeline is
added and no test case, fixture or snapshot baseline is added without the owner's permission, so validation
below is the existing suites plus bounded manual observation.

## Iteration 1 (2026-11-08)

### Discovered

* **No HTTP surface for the kernels.** The Go and Python ports existed only as libraries, so a service that
  wanted indicators without Node had to write its own server and its own input mapping.
* **Stale documentation about scope.** The Go and Python package comments still said they held ten kernels
  (`sum` .. `atr`); both hold the 33 pinned by the conformance data. `backends/` READMEs did not say how to run
  anything beyond the tests.
* **Stale package name in a user-facing error.** `runScript()` in `@supersolutions/super-chart-superscript`
  told users a language "is not enabled on @super-solution/super-chart/superscript", an entry that no longer
  exists after the split.
* The lint run reports 128 style warnings and no errors (mostly `no-confusing-void-expression` and
  `no-non-null-assertion`); none is a defect, so they were left alone rather than churned.

### Decisions

* **One contract, two implementations.** The server is `docs/INDICATORS-SERVER.md`: columnar or row bars in,
  named series out, with a catalog endpoint so a client discovers functions, defaults and outputs instead of
  hard-coding them. Go (`backends/go/server`, `cmd/super-chart-server`) and Python (`super_chart.server`) answer
  identically; the Rust backend can implement the same document.
* **Stateless, no authentication framework.** An optional bearer key and hard limits (bars, indicators, body
  size) are enough; TLS, rate limiting and CORS belong to the gateway in front.
* **Composable but bounded.** An input may name an earlier indicator in the same request (`macd.hist`), which
  covers the common "indicator of an indicator" case without a script language. SuperScript stays the answer
  for anything more.
* **Refuse, don't guess.** Unknown members, unknown params and fractional bar counts are 400s with stable
  error codes instead of silently using defaults. Non-finite results become `null`, because JSON cannot carry
  them and `null` already means "no value" in every kernel.
* **No new dependencies.** The Python server is standard library only (a threaded `http.server` runner plus a
  plain ASGI app); the Go server is `net/http`.

### Changed

* `backends/go/server`, `backends/go/cmd/super-chart-server`: the Go server.
* `backends/python/src/super_chart/server.py` and a `super-chart-server` console script.
* `docs/INDICATORS-SERVER.md`, backends READMEs, corrected package comments.
* `@supersolutions/super-chart-superscript`: the error message and entry comment name the real package.

### Validated

* Existing suites, unchanged: `npm run typecheck`, `npm run lint` (0 errors), `npm test` (466 tests),
  `npm run build` with the package check, `go vet` and `go test`, `ruff`, strict `mypy` and the Python
  conformance test; `node scripts/export-conformance.mjs --check` still matches the TypeScript reference.
* Manual, bounded (nothing was added to the repository): all 341 conformance cases were replayed through
  `POST /v1/indicators` on both servers (bars mapped from the case arrays, params passed through) and every
  series matched within the case tolerance. Over 40 further requests, including every kernel at once in both bar
  formats, chained indicators, malformed JSON, wrong types, duplicate ids, unknown members, case-insensitive
  member names, `NaN` literals, overflowing values and routing errors, gave the same status and error code
  on both servers and numerically equal results. The authorization check, the body limit, `SIGTERM` handling
  (exit 0) and the ASGI app (chunked body, oversized body) were exercised directly.
* Measured: a 100,000-bar request running 12 indicators (a 8.3 MB body, 35 MB response) took about 0.9 s on Go
  and 1.7 s on Python, mostly JSON encoding.

### Remaining

* Server tests. The conformance replay above is the right regression test (it needs no new data), but adding it
  to the repository needs the owner's permission under `AGENTS.md`.
* The catalog is written out in Go and Python by hand. If a third public implementation appears, generate it
  from one JSON file instead.
* Python's standard-library runner is for development and small deployments; production should run
  `create_app()` under an ASGI server. The kernels run on the event loop, so a very large request blocks it
  for its duration; the bar limit bounds that.
* `linreg`, `correlation`, `valuewhen` and the pivot indicators are TypeScript-only, and so are the SuperScript
  runtime and the drawings.
* 128 lint style warnings in the TypeScript packages.
