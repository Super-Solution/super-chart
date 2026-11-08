# Datafeed over HTTP

Super Chart reads market data through the `Datafeed` interface (`searchSymbols`, `getHistoryKLineData`,
`subscribe`, `unsubscribe`). This page is the small HTTP contract a server can implement so that one adapter
serves any data source: your own database, a CSV or JSON file, or a hosted relay. It is a contract and an
example, not a product: the chart does not depend on it, and a datafeed written directly against the interface is
equally valid.

Runnable pieces are in [`examples/datafeed-http`](../examples/datafeed-http/README.md): a `Datafeed` that speaks
this contract (`httpDatafeed.ts`), a zero-dependency server that serves CSV files through it (`serve.mjs`) and
sample data.

## Where it sits

```
chart (browser)  ->  your server or the Super Solution relay  ->  data source
                     this contract                              any (files, database, Aggre)
```

* The chart only ever talks to a server that implements this contract. The data source behind it is that
  server's business.
* **Aggre endpoints are never exposed to the chart.** The hosted version, "Super Chart on Aggre quotes", runs
  through a Super Solution relay: the relay holds the Aggre credentials, authenticates the chart user, maps the
  request to its own upstream calls and returns only the shapes below. No Aggre URL, key, header or error text
  reaches the browser or the chart bundle.
* Quote backends do not have to be open source. Only the chart library, the indicator core and this interface are.

## Conventions

| Topic | Rule |
| --- | --- |
| Transport | HTTPS, `GET`, JSON (`application/json; charset=utf-8`), gzip welcome |
| Version | the path starts with `/v1`; a breaking change is `/v2`, additions to `/v1` are always optional |
| Time | epoch **milliseconds**, UTC. A bar's `timestamp` is its **open** time |
| Ranges | `from` inclusive, `to` exclusive (`from <= timestamp < to`), as in `getHistoryKLineData` |
| Order | bars are sorted oldest first, with no duplicates |
| Numbers | JSON numbers, finite, never strings or `null`. `volume` and `turnover` are optional |
| Period | `<n><unit>` with unit `s` `m` `h` `d` `w` `M` (month) `y`: `1m`, `15m`, `4h`, `1d`, `1w`, `1M` |
| Symbol | `ticker`, plus `market` and `exchange` when a ticker alone is ambiguous. Compare them exactly |
| Unknown members | a client ignores response members it does not know; a server refuses unknown query parameters with 400 |

## Routes

### `GET /v1/symbols?search=&limit=`

Maps to `searchSymbols`. `search` is matched against ticker and name (case-insensitive, empty means a default
list); `limit` defaults to 50, at most 200.

```json
{ "symbols": [ { "ticker": "SAMPLE-USD", "name": "Sample asset (fictional data)", "exchange": "EXAMPLE",
  "market": "spot", "type": "crypto", "priceCurrency": "USD", "pricePrecision": 2, "volumePrecision": 1, "timezone": "UTC" } ] }
```

Members are those of `SymbolInfo`; only `ticker` is required. `timezone` matters for daily bars: say which IANA
zone a day opens in when it is not UTC. Omit `pricePrecision` (or send `"auto"`) to let the chart derive it.

### `GET /v1/bars?ticker=&period=&from=&to=&limit=[&market=&exchange=]`

Maps to `getHistoryKLineData`. `ticker` and `period` are required.

* `from` (default: the beginning) and `to` (default: after the newest bar, so the forming bar is included) are
  epoch milliseconds.
* `limit` is the most bars to return, default 500, at most 5000. When more bars match, the **newest** `limit`
  are returned (still oldest first). That is what the chart wants: the first page ends at now, and scroll-back
  asks again with `to` set to its oldest bar's `timestamp`. The client sends `countBack` as `limit`.
* The answer:

```json
{ "ticker": "SAMPLE-USD", "period": "1h",
  "bars": [ { "timestamp": 1792454400000, "open": 100.0, "high": 100.37, "low": 99.5, "close": 99.74, "volume": 1912.4 } ],
  "noData": true }
```

`noData: true` means "there is nothing older than the first bar returned" (or the answer is empty because
nothing exists before `to`). The chart then stops asking further back; saying it saves one empty request per
series. Leave it `false` when unsure.

An empty `bars` array for a known series is a normal answer, not an error.

### Live bar

The chart calls `subscribe` once after the history. The baseline needs no new route: poll

```
GET /v1/bars?ticker=SAMPLE-USD&period=1h&from=<timestamp of the newest bar you have>&limit=50
```

every few seconds. The answer starts with the newest bar again (its values may have changed; a bar is a snapshot
that replaces the one with the same timestamp) followed by any newer bars. This works through every proxy and
cache and needs no connection state on the server.

A server may additionally offer `GET /v1/stream?ticker=&period=` as Server-Sent Events: each `event: bar` carries
the same JSON as a `bars` member (one bar object or an array, oldest first), and the server sends a comment line
(`: keep-alive`) every 15 s. A client that finds the route missing or failing falls back to polling.

### `GET /healthz`

`{"status":"ok"}` without authentication, for load balancers.

## Errors

Every failure is `{"error": {"code": "...", "message": "..."}}` with the right status. Assert on `code`; the
message is for people, and must not name the data source behind a relay.

| Status | `code` | When |
| --- | --- | --- |
| 400 | `bad_request` | a missing or malformed parameter, an unknown parameter, a `limit` out of range |
| 400 | `invalid_period` | the period is malformed, or not offered for this symbol |
| 401 | `unauthorized` | no or expired credentials |
| 403 | `forbidden` | the user may not read this symbol or range |
| 404 | `unknown_symbol` | no such ticker (or `not_found` for an unknown route) |
| 429 | `rate_limited` | too many requests; send `Retry-After` in seconds |
| 502, 503 | `upstream_unavailable` | the source behind the server failed; the chart will retry |

The adapter turns any non-2xx answer into a rejected promise. The chart shows its error state with Retry for the
first load, and retries scroll-back with a backoff.

## Caching

A response that ends before the newest bar is immutable for practical purposes: send
`Cache-Control: public, max-age=3600`. Anything that includes the forming bar is `no-store`. `ETag` or
`Last-Modified` are welcome on the large history pages. Do not put credentials in the URL; they would end up in
caches and logs.

## Authentication and limits

The contract does not define a login. A hosted server takes `Authorization: Bearer <token>`; the adapter calls
`token()` for every request, so a short-lived token can be refreshed. A server that is only reachable on a private
network may skip it. Whatever you run:

* **Authorize per symbol**, not per route: a valid token is not permission for every ticker.
* **Cap the work.** Enforce `limit` (5000), reject ranges larger than you intend to serve, and rate-limit per
  token, not per IP. A browser can call this in a loop.
* **CORS.** Allow the exact origins of your chart hosts, `GET`, and the `authorization` header. Never `*` together
  with credentials.
* **Do not echo the source.** A relay answers with the contract's fields only: no upstream URLs, request ids,
  provider names or raw error bodies.
* **Log without secrets.** Keep tokens out of access logs.

## Files as a data source

For a CSV or JSON file the server is a few dozen lines (`serve.mjs`). The CSV it reads:

```csv
timestamp,open,high,low,close,volume
2026-10-20T00:00:00Z,100.00,100.37,99.50,99.74,1912.4
```

* One file per series, named `<TICKER>.<period>.csv`; the header names the columns, `volume` is optional.
* `timestamp` is epoch milliseconds or ISO-8601 with a `Z`; the server converts it. Files do not have to be
  sorted; the server sorts them.
* A JSON source is the same rows as `{"bars": [...]}` with numeric `timestamp` in milliseconds.

Everything else (a database, a cache in front of a quote vendor, the hosted relay) implements the same three
routes and returns the same shapes.

## What the chart tolerates

You can send slightly messy data and the chart's normalization copes (duplicates, overlap, unsorted bars, seconds
instead of milliseconds, numeric strings), but a server should not rely on it: it costs a pass over every page and
hides bugs. Send clean bars.
