# Indicators server

A small stateless HTTP service that runs the Super Chart technical-analysis kernels: send price bars, get
indicator series back. It is the same contract in Go and Python, so a deployment can pick either (or run both
behind one gateway). The kernels are the ones pinned by [`conformance/indicators.v1.json`](../conformance/README.md).

| Backend | Run | Mount |
| --- | --- | --- |
| Go | `cd backends/go && go run ./cmd/super-chart-server` | `server.New(server.Config{})` is an `http.Handler` |
| Python | `cd backends/python && PYTHONPATH=src python -m super_chart.server` (or `super-chart-server` once installed) | `super_chart.server.create_app()` is a plain ASGI app |

Python needs no dependencies; for production put the ASGI app under uvicorn or hypercorn.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `SUPERCHART_ADDR` | `:8787` | listen address |
| `SUPERCHART_API_KEY` | unset | when set, `/v1/indicators` needs `Authorization: Bearer <key>`; `/healthz` stays open. Unset means anyone who can reach the port can use it, so do not expose that |
| `SUPERCHART_MAX_BARS` | `100000` | longest series accepted (413 `too_many_bars`) |
| `SUPERCHART_MAX_INDICATORS` | `64` | indicators per request (413 `too_many_indicators`) |
| `SUPERCHART_MAX_BODY_BYTES` | `16777216` | request body size (413 `body_too_large`) |

The server stores nothing and calls nothing. It does not do TLS, rate limiting or CORS; put it behind a gateway.

## Routes

| Route | Purpose |
| --- | --- |
| `GET /healthz` | `{"status":"ok"}` |
| `GET /v1/indicators` | the catalog: for every `fn` its `inputs` (with default source), `params` (with default and whether it must be a whole number of bars) and `outputs`, plus the list of `sources` |
| `POST /v1/indicators` | compute |

## Request

```json
{
  "bars": {"open": [...], "high": [...], "low": [...], "close": [...], "volume": [...]},
  "indicators": [
    {"id": "rsi14", "fn": "rsi", "params": {"len": 14}},
    {"id": "m", "fn": "macd"},
    {"id": "sig", "fn": "ema", "inputs": {"src": "m.hist"}, "params": {"len": 5}}
  ]
}
```

* `bars` is either columnar (an object of equal-length arrays) or a list of bar objects with `open`, `high`,
  `low`, `close`, `volume`. Values are numbers or `null`; other members (`time`) are ignored. Send only the
  fields the indicators need.
* `id` is optional (default: the `fn`), 1-64 of `A-Za-z0-9_-`, unique, and not a bar field name.
* `inputs` maps an input name to a **source**. Defaults come from the catalog (`src` is `close`, `high` is
  `high`, ...); `crossover`, `crossunder`, `cross` (`a`, `b`) and `barssince` (`cond`) have no default.
  A source is a bar field (`open high low close volume`), a derived price (`hl2 hlc3 ohlc4 hlcc4`, null where
  any component is null), or the output of an **earlier** indicator in the same request: `id` for a
  single-output indicator, `id.output` for one with several (`macd` has `dif dea hist`; single outputs are also
  reachable as `id.value`).
* `params` overrides numeric parameters. `change`, `mom` and `roc` take a whole number `len` of 0 or more; any
  other `len` that is not a positive integer yields an all-null series, exactly like the kernels.
* Unknown members of the request, of an indicator, of `inputs` or of `params` are refused rather than ignored,
  so a typo does not silently run with defaults. Member names of the request, indicators and bars match
  case-insensitively in both backends.

## Response

```json
{
  "version": 1,
  "bars": 500,
  "results": [
    {"id": "rsi14", "fn": "rsi", "series": {"value": [null, ..., 54.2]}},
    {"id": "m", "fn": "macd", "series": {"dif": [...], "dea": [...], "hist": [...]}}
  ]
}
```

Every series has `bars` entries; `null` means no value (warm-up, a gap, or a result JSON cannot carry:
NaN and infinities become `null`). Results come back in request order.

## Errors

`{"error": {"code": "...", "message": "..."}}` with these codes (assert on the code; the message is for humans).

| Status | Codes |
| --- | --- |
| 400 | `invalid_request` (not JSON, wrong shape, unknown member, no indicators, no bars), `invalid_bars`, `bars_length_mismatch`, `missing_bars_field`, `unknown_indicator`, `invalid_id`, `duplicate_id`, `invalid_input`, `missing_input`, `unknown_source`, `ambiguous_source`, `invalid_param` |
| 401 | `unauthorized` |
| 404 / 405 | `not_found`, `method_not_allowed` |
| 411 | `length_required` (Python's built-in server only: send a `Content-Length`) |
| 413 | `body_too_large`, `too_many_bars`, `too_many_indicators` |

## Keeping the three in step

The catalog is written out three times: `backends/go/server/catalog.go`, `backends/python/src/super_chart/server.py`
and the private Rust backend. When a kernel is added or a default changes, change all of them, then compare the
two public servers: `GET /v1/indicators` must return the same document, and every case in
`conformance/indicators.v1.json` must give the same series through `POST /v1/indicators` (inputs mapped to
bar fields, params passed through).
