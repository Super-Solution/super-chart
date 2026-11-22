# quotes

One price from several markets. An asset trades on more than one venue, and a product that shows it must decide which
price. There are two honest answers, and this crate has both behind one trait so a product can pick, and change its mind,
by changing one value.

| Strategy | Reads | The price is | Use it when |
| --- | --- | --- | --- |
| `Failover` (primary with fallbacks) | one source at a time, a fallback only when it has to | the serving source's own candles, **whole**; never joined from two sources | the source is part of the claim ("OKX's perpetual"), or sources are not interchangeable (an index contract on one venue, another's as a stand-in) |
| `Consensus` (weighted) | every source | a weighted mix: recent quotes count more, new listings fade in, a source far from the others counts less or is set aside; **no source's price is ever changed** | many venues quote the same thing and no one of them should set the line (a token on four exchanges) |

Both take the same `Request` and give the same `Aggregate`. A bar of an aggregate says what each source was in it (`used`,
`carried`, `outlier`, `stale`, `notListed`, `standby`), the share it carried and its deviation, so a card can say "Bitget:
3 bp above, 12 % of the price" or "OKX has no current quote; this is Bitget" without recomputing anything.

```rust
use super_chart_quotes::{Aggregator, Consensus, Failover, Request, Source};

let request = Request { sources: &sources, bucket_ms: 60_000, origin_ms: 0, now_ms, previous: None };
let by_primary = Failover::default().aggregate(&request)?;   // candles of the first current source
let by_everyone = Consensus::default().aggregate(&request)?; // one weighted line
```

## Composing

Strategies stack. `Aggregate::into_source(id)` turns an aggregate back into a source:

```rust
// A consensus of each venue group, then a failover across the groups.
let eu = Consensus::default().aggregate(&request_for(&eu_venues))?.into_source("eu");
let us = Consensus::default().aggregate(&request_for(&us_venues))?.into_source("us");
let served = Failover::default().aggregate(&request_for(&[eu, us]))?;
```

A price with no candles (a midpoint, a ticker) is a source too: `Source::quote(id, price, at_ms, bucket_ms, origin_ms,
Params::default().warmup_buckets())` makes the flat bars that carry it through the same rules, so it enters like a new
listing and fades when it is old.

## What `Failover` promises

- The first source in priority order that has a **current quote** serves. Current means its newest usable bar is at most
  `max_age_buckets` old (3 by default).
- The choice is a function of what each source has *now*. The instrument goes back to the primary the moment it is current
  again.
- Price, candles and label are the serving source's. When nobody is current there are no bars, the label is the source last
  read (`previous`) or else the primary, and `empty` says `noCurrentQuote` or `noData`: the instrument is never hidden and
  never shown under another source's name.
- `fetch_plan()` is `UntilCurrent`: a host reads the fallbacks only when it needs them. A healthy primary costs one read.

## Around the arithmetic (feature `runtime`, on by default)

There is no network code in this crate. An app implements `QuoteSource` for each venue (candles in, `SourceError` out),
puts them in an `Instrument` in priority order, and calls `instrument.read(&strategy, query, now_ms, origin_ms,
previous)`. The read follows the strategy's `fetch_plan()`: all sources at once with a timeout each for a consensus; one
at a time until one is current for a failover. A source that fails, times out or panics is *no data* in that read and is
listed in `Read::failures` for the operator; it never fails the read.

`SingleFlight` shares answers: the first asker of a key computes, everyone asking while it runs or before its time is up
gets the same answer, an **error is not kept**, a waiting asker takes over if the computing one goes away, and the map is
bounded. Use it around `instrument.read`, with a few seconds for a live quote and longer for finished history. Turn the
feature off (`default-features = false`) for the arithmetic alone, with no async runtime.

## Performance

`cargo run --release -p super-chart-quotes --example bench` (one run on a 2026 cloud VM, a pessimistic measure: every bar carries one
reading per source, allocated):

| | per aggregated bar |
| --- | --- |
| consensus, 1 source | 0.26 µs |
| consensus, 4 sources | 0.6 µs |
| consensus, 12 sources | 1.6 to 2.2 µs |
| failover, 12 sources | 0.5 to 1 µs |

Cost is linear in sources × bars: a 1 000-bar chart over 12 venues is about 1.5 ms. The weights of a bucket need only a
counter per source from the buckets before it, so there is no quadratic step and no history is kept between calls.

## Documents

- [docs/CONSENSUS.md](docs/CONSENSUS.md): the algorithm, every parameter, the edge cases and the test that pins each.
- The primary-with-fallbacks rule is in the module documentation of `src/failover.rs`.

Tests: `cargo test -p super-chart-quotes` (50 unit tests and a doc-test), `cargo test -p super-chart-quotes
--no-default-features` for the arithmetic alone.
