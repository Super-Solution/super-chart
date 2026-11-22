# The consensus

One price from several markets, for an asset that trades on more than one. This is the algorithm of
`super_chart_quotes::Consensus`. It sits behind the same [`Aggregator`](../src/aggregate.rs) trait as
primary-with-fallbacks, so a product can switch between the two by changing one value.

The parameters below are a **first proposal**. The numbers (20 basis points for half weight, 3 % to be set aside, a quote
that loses half its weight every 1.5 buckets) have been checked against sample data only, not against live venues. Tune
them from real data before relying on them.

The one rule underneath: **a source's price is never changed.** A source that disagrees only has a lower weight, and its
weight is what it says *now*: low while it sits apart and high again the moment it comes back.

## What it does, per bucket

For each source, in the bucket (the candle width the caller chose):

1. **Offer.** A bar in this bucket is *used*. No bar, but a last close at most `stale_after_buckets` old, is *carried*,
   flat at that close. Older is *stale* and not counted. No bar yet is *not listed*.
2. **Prior weight** = `source.weight × recency × entry`.
   - recency `0.5^(age / recency_half_life_buckets)`: a carried source fades;
   - entry `min(1, observations / entry_ramp_buckets)`: a newly listed source fades in over its first buckets, so a new
     listing never makes the line jump. `observations` is the number of buckets in which the source had a bar of its own,
     the only memory the algorithm keeps.
3. **Deviation.** Start at the prior-weighted median (it does not care how far a bad source is). Then `iterations` times
   (three is enough for the weights to settle): each source's weight is `prior / (1 + (d / deviation_scale)²)` with
   `d = price / estimate − 1`, and **0 past `outlier_limit`** (an *outlier*: seen, not counted); the estimate becomes the
   weighted mean. The shares of a bucket sum to 1.
4. **The bar.** Open, high, low and close are the weighted means of the sources' own bars (high and low widened to hold
   the open and the close). Volume is the volume of the sources that had a bar in this bucket and counted; a carried source
   adds none.
5. **Nothing is invented.** A bucket in which no source has a bar of its own has no consensus bar, and the consensus starts
   at the first bar of the first source. `min_sources` (default 1) withholds a bar that fewer sources than that counted in.

If every source is "too far" from the median (two markets a long way apart), no consensus is possible, so the one with the
strongest standing speaks alone rather than a midpoint nobody quoted.

**No correction, no memory.** A source's price is never divided, shifted or "corrected" to look like the others. A source
that always sits above or below the others has a small deviation weight in every bucket, so it is light for as long as it
sits apart; the day it comes close it is heard at once. Weight is set by distance and by the age of the quote, not by
reputation.

## Parameters

| Field | Variable (`Params::from_lookup`) | Default | Meaning |
| --- | --- | --- | --- |
| `stale_after_buckets` | `CONSENSUS_STALE_AFTER_BUCKETS` | 3 | buckets after which a quiet source is dropped |
| `recency_half_life_buckets` | `CONSENSUS_RECENCY_HALF_LIFE_BUCKETS` | 1.5 | a carried source's weight halves this often |
| `deviation_scale` | `CONSENSUS_DEVIATION_SCALE` | 0.002 | deviation (20 bp) at which a source's weight is a half |
| `outlier_limit` | `CONSENSUS_OUTLIER_LIMIT` | 0.03 | deviation (3 %) past which a source is set aside |
| `entry_ramp_buckets` | `CONSENSUS_ENTRY_RAMP_BUCKETS` | 6 | observations to reach full weight |
| `iterations` | `CONSENSUS_ITERATIONS` | 3 | re-weighting passes |
| `min_sources` | `CONSENSUS_MIN_SOURCES` | 1 | counted sources a bucket needs to have a bar |

A value that is set and cannot be read, or is out of range, is an **error**, never silently the default: a typo in a tuning
value must not look like a tuned service. `Params::from_lookup_prefixed` reads another prefix, for a host that runs
several consensuses.

Buckets are counted in the caller's candles, so a one-minute consensus goes stale after three minutes and a daily one after
three days. One parameter set serves every period and asset class until real data asks for a split.

**Warm-up.** A bucket's weights depend on the buckets before it (the entry ramp, the stale horizon). A caller who wants
the newest *N* buckets therefore asks each source for `N + Params::warmup_buckets()` (9 by default); then a page of
history equals the same buckets of a longer one (`a_page_of_history_equals_the_same_buckets_of_a_longer_one`).

## Edge cases

| Case | What the consensus does | Test |
| --- | --- | --- |
| One source only | Its prices, exactly | `one_source_is_its_own_consensus` |
| Sources agree | The mean, no jitter | `sources_that_agree_give_that_price` |
| A new listing | The newcomer fades in over `entry_ramp_buckets`; the line does not jump | `a_new_listing_does_not_move_the_line_…`, `a_new_source_fades_in_over_the_ramp` |
| One source drifts away | Its weight falls with the deviation; past `outlier_limit` it is set aside, and returns when it returns | `a_source_that_drifts_away_does_not_drag_the_line` |
| A single-bar spike | Set aside (outlier) or, below the limit, weighted down; the next bucket is clean | `a_single_bar_spike_is_seen_and_not_followed`, `a_spike_smaller_than_the_outlier_limit_is_only_down_weighted` |
| A source that always sits apart | Light for as long as it does; its prices are not changed | `a_market_that_always_sits_apart_weighs_little_…` |
| That source comes back to the others | Heard at once | `a_market_that_comes_back_to_the_others_is_heard_at_once` |
| Two sources 8 % apart for good | Both are "too far"; the one with the stronger standing speaks alone | `two_markets_far_apart_leave_the_stronger_one_speaking` |
| A source goes quiet | Carried at its last close, fading, then stale and dropped | `a_source_that_goes_quiet_is_carried_for_a_while_then_dropped` |
| A gap in every source | No bar for that bucket | `no_bar_when_no_source_has_one` |
| A page of history | Equals the same buckets of a longer one | `a_page_of_history_equals_the_same_buckets_of_a_longer_one` |
| Weekly candles | Buckets open where the caller says (a Monday is `origin_ms = −3 days`) | `buckets_open_where_the_caller_says_…` |
| Bad numbers (NaN, zero, negative) | The bar is ignored, not averaged | `unusable_bars_are_ignored_not_averaged` |
| Sources in another order | The same consensus | `the_same_sources_in_any_order_give_the_same_consensus` |
| A price with no candles (a midpoint) | `Source::quote` makes flat bars over the ramp, so it enters and fades like any source | `a_quote_goes_through_the_same_rules_as_candles` |

## Decisions that shaped it

1. A source that sits off for good is not corrected; only its weight is low, and it is high at once if it comes close.
2. A source a host chooses to *hide* still counts. Hiding is presentation, not an input. (In this library that is simply
   the host not showing a row: every `Source` passed in counts.)
3. One parameter set for every period and asset class for now.
4. A midpoint-only source counts in the live quote (`Source::quote`).
5. Answers are cached for a few seconds and computed once for all askers (`runtime::SingleFlight`).

A common alternative, a Gaussian weight scaled by the spread over the age of the quote, was
considered and not used here: the heavy tail of the Cauchy-shaped weight lets a moderately off source keep a small voice and
recover, the hard `outlier_limit` covers what a Gaussian does by its tail, and the same weights serve a candle and a quote
(a bar has no spread to scale by).

## What it does not do

It stores nothing: every answer is computed from the sources it is given. It is not a trade price and makes no claim to be
one. It has no clock: whether an *aggregate* is too old to show is the host's call (`Aggregate::age_buckets`).
