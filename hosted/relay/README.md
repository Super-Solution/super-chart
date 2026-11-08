# Super Chart hosted relay

The hosted version of Super Chart is "the chart on Aggre market data". This service is the layer in between:
it speaks the open datafeed contract ([docs/DATAFEED-HTTP.md](../../docs/DATAFEED-HTTP.md)) to chart users and
reads stored candles from Aggre with **its own** Aggre API key. Aggre is never exposed to the chart or the
browser.

> **Status: built and tested locally, not deployed.** No hosting target, domain, Aggre key or client token
> exists yet, and no venue is cleared to be shown to outside users (see "Terms" below). The repository's
> licence and the "ask before adding tests" rule in `AGENTS.md` were written for the open chart packages; this
> directory is a separate, hosted component and should move to a private repository (see the PR description).

## What it does

| Contract route | Behaviour |
| --- | --- |
| `GET /v1/symbols` | Aggre's enabled instruments, narrowed to the operator's allowed venues/products and the token's scope. `ticker` is the venue's native symbol, `exchange` the venue, `market` the product (`spot`, `perp`, `futures`). |
| `GET /v1/bars` | Newest `limit` bars of a range, oldest first, `from` inclusive, `to` exclusive, as the contract says. Pages through Aggre's 1000-row limit. |
| `GET /healthz`, `GET /readyz` | Liveness; readiness (the instrument list has loaded). No credentials. |

* **Periods:** `1m 3m 5m 15m 30m 1h 2h 4h 6h 12h 1d 1w`. `1m`, `1h`, `1d` are stored; the others are folded
  from the stored candles (UTC-aligned, weeks open Monday 00:00 UTC). Folded requests read at most
  `RELAY_MAX_CANDLES` stored candles, so a very long folded history can return fewer than `limit` bars (and
  then never claims `noData`). A first bar that would be partial is left out, never sent wrong.
* **Live bar:** Aggre stores only confirmed candles, so the forming `1m` bar appears when its minute closes
  (folded and larger periods show a forming bar made of the confirmed minutes). There is no tick-level live
  bar yet.
* **Not offered:** `/v1/stream` (the chart falls back to polling), month/year periods, equities, anything
  that is not an Aggre `finance.market` candle.

## Security model

* **Auth:** `Authorization: Bearer <token>`. Tokens are issued with `chart-relay mint-token <id>`; the token
  file stores only the SHA-256. A token can be scoped to venues and products, can expire, and has its own
  rate limit (`rps`, `burst`). A token in the URL is never read.
* **No source leakage:** responses are built from the contract's own fields. Upstream errors become
  `503 upstream_unavailable` with a fixed message; the detail goes to the operator log only. The Aggre URL,
  key, instrument ids, `meta`, `version` and error bodies never reach a client. A redirect from the source is
  not followed (the key is sent to the configured host only). The key can come from a file
  (`RELAY_AGGRE_API_KEY_FILE`).
* **Fail closed:** with `RELAY_ALLOWED_VENUES` empty nothing is served.
* **Work is capped:** `limit` ≤ 5000, per-token token bucket, a global budget and concurrency limit towards
  Aggre, identical concurrent requests share one read, and a size-bounded response cache.
* **Caching:** history that ends before the previous closed bar is `Cache-Control: private, max-age=3600`
  (not `public`, as the open example sends: this data is entitled, so a shared cache must not serve it to
  someone else). Anything with the forming bar is `no-store`; the relay keeps it in memory for 2–30 s.
* **CORS:** exact origins only (`RELAY_ALLOWED_ORIGINS`), never `*`, never credentials.
* Logs contain a request id, the token **id**, path, status and duration. No secrets, no query strings.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `RELAY_AGGRE_BASE_URL` | required | e.g. `https://api.aggre.org` (plain `http` only for loopback) |
| `RELAY_AGGRE_API_KEY` or `_FILE` | required | the relay's own Aggre key |
| `RELAY_TOKENS_FILE` | required | JSON, see below |
| `RELAY_ALLOWED_VENUES` | none | comma list, e.g. `OKX,HYPERLIQUID`; empty serves nothing |
| `RELAY_ALLOWED_PRODUCTS` | `SPOT,PERP,FUTURES` | |
| `RELAY_ALLOWED_ORIGINS` | none | exact origins for browser clients |
| `RELAY_ADDR` | `:8080` | |
| `RELAY_UPSTREAM_TIMEOUT` / `_CONCURRENCY` / `_RPS` | `10s` / `8` / `20` | towards Aggre |
| `RELAY_CATALOG_REFRESH` | `10m` | instrument list refresh (retries sooner after a failure) |
| `RELAY_CACHE_BYTES` | 64 MiB | |
| `RELAY_MAX_CANDLES` | 20000 | stored candles read per folded request |

```json
{ "tokens": [ { "id": "acme-prod", "sha256": "<hex>", "rps": 5, "burst": 20, "venues": ["OKX"], "expires": "2027-01-01T00:00:00Z" } ] }
```

Tokens are read at start; changing the file needs a restart.

## Run and test

```sh
go test -race ./...                       # unit + end-to-end tests against a fake Aggre
go run ./cmd/chart-relay mint-token acme  # prints the secret once and the token-file entry
RELAY_AGGRE_BASE_URL=... RELAY_AGGRE_API_KEY=... RELAY_TOKENS_FILE=tokens.json RELAY_ALLOWED_VENUES=OKX go run ./cmd/chart-relay
```

The tests use a fake Aggre; the real Aggre API has **not** been called. The chart's own `httpDatafeed.ts`
adapter was run against the relay (symbols, history, scroll-back, live polling, bad token) during development.

## Terms

Aggre is not licensed for resale or redistribution, and exchange data (OKX, Hyperliquid, Bitget, …) has its
own terms. Showing it to users outside Labs is redistribution. The relay therefore serves only the venues the
operator names explicitly; deciding which venues may be shown, with what attribution, is the owner's call.
