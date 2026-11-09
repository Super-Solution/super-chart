# Engineering improvement log

Each iteration records what was found, decided, changed and checked, and what is left. Newest first. The
repository's own rules apply (see [`../MAINTAINING.md`](../MAINTAINING.md) and `AGENTS.md`): no CI pipeline is
added and no test case, fixture or snapshot baseline is added without the owner's permission, so validation
below is the existing suites plus bounded manual observation.

## Directive rounds (2026-11-08, second series of 15)

Run under the owner's "library excellence" directive. Constraints held throughout: public API stays compatible,
no publish, no licence change, no history rewrite, no new runtime dependency, no CI. The directive's "add tests"
authorisation is what allows the tests below. Newest round first within this section.

### Round 6: `buildChartContext` takes the workspace the package actually ships

* Audited the AI helpers (`createHttpAIClient`, `nlToSuperScript[Checked]`, `buildChartContext`): timeouts, abort
  wiring, error bodies, repair loop bounds and the model-reply path all hold (a model reply is only ever compiled by
  the SuperScript compiler, never evaluated as JavaScript).
* Found: `buildChartContext` accepted `ChartProLike` (needs `getChart()` and `getTimezone()`), an interface the
  owned engine retired, so `analyzeChart` on a `ChartWorkspace` needed a hand-written adapter (the e2e case writes
  one). Added `ChartWorkspaceLike`; `buildChartContext(workspace)` now reads the viewport (fractional bar edges
  widened to whole bars) and the render time zone itself. `ChartProLike` and the parts form stay, so nothing
  breaks. A real `ChartWorkspace` type-checks against the new interface (checked with a scratch compile; the
  superscript package cannot import web, so the repo cannot hold that assertion).
* Tests: one case in `ai/ai.test.ts` (workspace input equals the equivalent parts input).

### Round 5: the indicator servers get a shared contract test

* Probe first: a randomised stress of the browser workspace (25 runs of 40 random operations: market changes
  racing history loads that fail 8% of the time, scroll-back, in-order, repeated and stale live ticks, replay start
  and exit, dispose) found nothing: bars always ordered, unique and finite, the shown market always the last one
  requested, every subscription released on dispose, no page errors. The loader's generation scheme holds up.
* Found: the two indicator servers (Go, Python) had a documented contract and no test of it in the repository (the
  log's earlier "remaining" item), and `go test ./...` reported "no test files" for the server. The only parity
  evidence was a manual run.
* Added: `conformance/indicators-server.v1.json`, 22 refusals with status and error code. Go
  (`server/server_test.go`) and Python (`tests/test_server_contract.py`, through the ASGI app) both replay all 341
  conformance cases through `POST /v1/indicators` and check the whole refusal table; Go also covers chaining
  (`m.hist`), columnar-versus-row equality, overflow-to-null and bearer authorisation. Mutating the Go catalog
  (sma wired to ema) fails the replay.
* No server code changed: both already satisfied the contract. Left open: the catalog is still written out by hand in
  Go and Python (and the private Rust backend); a shared catalog document would remove that.
* Validation: `go vet`, `go test ./...`, `ruff check`, `ruff format --check`, `mypy src` and `pytest` (32 tests + 341
  subtests) pass. `mypy tests` reports 8 pre-existing annotation errors in `test_conformance.py`, untouched.

### Round 4: a workspace chrome a host can restyle (and a light one)

* Found: every colour of the workspace chrome (toolbars, selects, search panel, notices) was a hard-coded hex in
  inline styles, so a host could not restyle it without forking, and the chat plugin's light cards sat on a dark
  toolbar (the README listed it as a known limit). `tokens.ts` was ~190 lines of retired klinecharts-pro tokens
  (`--klinecharts-pro-*`, `base.less`, tests that no longer exist); only four annotation tones were used.
* Changed: chrome colours read `--super-chart-{background,text,surface,border,divider,danger}` with the original
  dark values as the fallback (default look verified pixel-for-pixel by computed style). New `theme: 'dark' | 'light'`
  option and `setTheme()` apply a preset to the chrome and the canvas colours (`chart.render` still wins at
  construction); `WORKSPACE_THEMES` and `WORKSPACE_CHROME_VARS` are exported with their types. The chat plugin passes
  its card theme through. `tokens.ts` shrank to the annotation tones. Additive only: no existing option or default
  changed.
* Decision: presets are two (dark, light), not five. The directive's style templates (terminal, editorial,
  enterprise, ...) are only worth shipping once the chrome has a real component layer; custom properties already let
  a host build them.
* Checked in a real browser: default, `light`, host-set properties and `setTheme` computed colours; light screenshot.
* Tests: `e2e/tests/workspace-theme.spec.ts` (added to the config's match list). Also made the brush stroke in
  `drawing-input.spec.ts` start inside the plot at any harness height (it used y = 240 while the plot ends near 238
  here, so the stroke never started: a failure on an unchanged tree). All 71 browser cases pass locally with the
  installed Chromium.

### Round 3: chat plugin card registry and indicator tool

* The plugin (the only code an agent drives directly) had no tests at all. Audited `createChartChatPlugin`.
* Found: cards register under `spec.id` and `teardown()` deleted by id. Two cards with one id (an agent that reuses
  `id: "btc"` every turn, with the older message unmounted by a virtualised chat list afterwards) made the older
  card's unmount drop the newer card's registration, so every tool then answered "No chart is on screen" while the
  chart was visible. Fixed: only the entry a card still owns is released.
* Found: `chart_indicators` removed first, then added one by one, so a refused indicator (bad parameters) left the
  earlier ones of the same call behind and a retry stacked duplicates. Now adds run first and are rolled back on a
  failure; removals only touch indicators that existed before the call and happen after every add succeeded.
* Not changed (design, noted): a theme switch rebuilds a feed-backed card from its original spec, which discards a
  market the agent set through `chart_set_market`.
* Tests: `chat-plugin/src/index.test.ts` against a stand-in `ChartWorkspace` (no DOM): registry ownership, tool
  argument validation, all-or-nothing indicators. Two of four fail without the fixes.

### Round 2: non-finite viewport input, reproducible type-checking

* Found: `zoomViewport(v, n, factor, NaN)` and `clampViewport({i0: NaN, ...})` returned a `{NaN, NaN}` window
  (every `Math.min/max` propagates NaN). A gesture over a zero-width plot yields exactly that fraction.
  `RealtimeView` and the continuous variants already guard, so the chart itself was safe; the exported
  `/native` helpers were not.
* Found: with no lockfile, a fresh `npm install` resolves `@types/node` to a release whose `.d.ts` files TypeScript
  4.9 cannot parse, so `npm run typecheck` fails on a clean checkout (`skipLibCheck` is off). A direct
  devDependency `@types/node@^20.19.0` keeps it green (lint is back to its recorded 128 warnings too).
* Changed: `viewport.ts` (NaN anchor ignored, NaN edge falls back to the default window), root `package.json`.
* Tests: `core/src/viewport.test.ts` (fails without the fix).

### Round 1: hostile SuperScript structure

* Probe: 18 hostile scripts through `runScript`. Names such as `constructor`/`__proto__` are inert, absurd periods
  are bounded, 5,000 plots and 40,000 lines scale linearly. But 20,000 nested brackets, prefix operators, calls or
  ternaries, and a 100,000-term `a + a + ...` chain, escaped as a raw `RangeError: Maximum call stack size exceeded`
  from `compile()`/`run()` (and as an "internal error" string from `checkSuperScript`). Scripts come from models, so
  the AI repair loop, which reads `SuperScriptError.diagnostics`, got nothing to act on.
* Fix: the parser caps nesting at 200 levels with an `UNSUPPORTED` diagnostic that has a position and a hint; any
  remaining stack overflow (long operator chains build a deep left-leaning tree) is converted to a
  `SuperScriptError` in `compile`, `run` and `checkSuperScript`. No new diagnostic code, so exhaustive switches in
  consumers keep compiling. Real scripts nest in single digits.
* Tests: `superscript/src/runtime/limits.test.ts` (5 of 6 fail without the fix).

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
