# Engineering improvement log

Each iteration records what was found, decided, changed and checked, and what is left. Newest first. The
repository's own rules apply (see [`../MAINTAINING.md`](../MAINTAINING.md) and `AGENTS.md`): no CI pipeline is
added and no test case, fixture or snapshot baseline is added without the owner's permission, so validation
below is the existing suites plus bounded manual observation.

## PR #22 integration (2026-11-15)

Integrated the older branch with main after PR #23, retaining its runtime fixes
without introducing tests, fixtures, pipelines, dependencies or extra build gates.

- Retained SuperScript nesting diagnostics, loader request/timer bounds, finite
  viewport fallback, volume-profile invalid-bar handling, HTTP polling cleanup,
  chat-card ownership and indicator rollback, and workspace support in the AI helper.
- Integrated light/dark presets through the existing `--sc-*` variables. Kept
  PR #23's lazy controls, render/input optimizations, viewport limits and data paths.
- Removed PR #22's added unit/browser/backend cases and fixture, four additional
  TypeScript consumer/example build passes, obsolete Node-types workaround, and
  cosmetic colour/unknown-option checks. Existing main validation is unchanged.
- Independent review found a nonfinite bar-count recursion in viewport fallback;
  fixed it before merging. Tick throttling uses the same timer limit as other delays.

Validation on the integrated source: 188 existing cases across six affected suites
passed; full typecheck and all four ESM/DTS package builds with existing package
checks passed; lint passed with 0 errors and the existing 146 warnings; diff check
passed. The final viewport change was reviewed separately after the suite run.
No new cases or assertions were written. Browser cases were not rerun this round.

The prior branch's validation used a protocol stub and is not release evidence.
This integration uses the real locally built `@supersolutions/super-protocol`
source described in LOCAL-DEVELOPMENT.md. Registry-only installation still needs
that package published. No npm publication or workflow was triggered here.

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

## Rounds of 15 (audit, fix, local gate, push)

### Round 4 (2026-11-08) — a throwing chart no longer escapes the history load

* Audit: `normalizeBars`, `historyCache` and the initial-load path of `dataLoader`. Normalisation and
  the cache hold up (input is never mutated, clean input is returned as is, hostile keys are copied
  as data). One gap in `_start`: the `.then(onFulfilled, onRejected)` pair did not cover a throw from
  `_show` (klinecharts refusing the bars). That was an unhandled rejection, no live subscription and
  no `error` event for the host.
* Fix: `_show` is wrapped; a throw is warned and reported through `_failInitial` like any other failed
  initial load (the status goes to `error`, the host's error listener fires). A second throw while
  reporting is warned, never rethrown.
* Test added after the owner approved it: `dataLoader.test.ts`, "a chart that throws while drawing the history is reported as one initial error" (fails without the fix, with an unhandled rejection).
* Gate: `npm run typecheck && npm run lint && npm test && npm run build` pass (467 tests).

### Round 11 (2026-11-08) — Python indicators server parity with Go

* Audit: a differential run of the Go and Python indicator servers over 40 edge requests (case-insensitive
  keys, duplicate keys, nulls, string numbers, unknown fields, deep nesting, overflowing numbers, BOM). Error
  codes and results agree except for four bodies the Python server mishandled:
  `1e400` parsed to infinity and was computed on; a whole number of 400 digits raised `OverflowError`; JSON
  nested 50,000 deep raised `RecursionError` out of `handle_compute`; and a UTF-8 BOM or a UTF-16 body was
  accepted because `json.loads(bytes)` sniffs the encoding. Go answers 400 to all four.
* Fix: the body is decoded as strict UTF-8 before parsing, non-finite floats and integers beyond a double
  are rejected, and `RecursionError` becomes a 400.
* Tests: `backends/python/tests/test_server_requests.py` (five hostile bodies plus a good request), added
  with the owner's permission. Left alone: `fn` given as a non-string answers `unknown_indicator` in Python
  and `invalid_request` in Go (both 400).
* Gate: `ruff check`, `ruff format --check`, strict `mypy` and `pytest` (9 tests) pass; Go untouched.

### Round 15 (2026-11-08) — the datafeed example server survives a malformed request target

* Audit: the CSV datafeed example added earlier this session (`examples/datafeed-http/serve.mjs`). Nothing in a
  request reaches the filesystem (series are loaded at start-up), limits are range-checked and unknown routes
  are 404. One crash: `new URL(req.url, base)` throws on a request target such as `//[`, and the exception
  was not caught, so a single request stopped the process (checked: the old server was down afterwards).
* Fix: a malformed target answers 400.
* No test: the example is outside the test suites by design; verified by hand against the old and new file.
* Gate: `npm run typecheck && npm run lint && npm test && npm run build` pass (467 tests).
* Rounds 1 to 15 are complete across the four repositories; see each repository's log for its entries.
