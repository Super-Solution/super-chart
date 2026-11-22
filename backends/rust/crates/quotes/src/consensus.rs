// Copyright 2026 SUPER SOLUTION LABS INC
//! The consensus: one price from the weighted bars of several sources.
//!
//! The consensus itself. One pass over the union of the sources' bucket times, oldest first;
//! everything a bucket needs from the past (how many bars a source has had) is one counter per
//! source, so the cost is linear in the bars.
//!
//! A source's weight is judged on what it says *now* (how old its quote is, how far it is from
//! the others in this bucket) and never on a record of how it behaved before: a market that sits
//! apart is light while it does, and heavy again the moment it comes back. Its prices are never
//! changed.

use crate::aggregate::{
    AggBar, Aggregate, Aggregator, EmptyReason, FetchPlan, MemberReading, MemberState, Request,
    StrategyName,
};
use crate::bar::{Bar, Source};
use crate::params::{ParamError, Params};

/// Per-source memory carried from bucket to bucket: buckets in which the source had a bar of its
/// own (how long it has been speaking, for the entry ramp).
struct Memory {
    observations: u32,
}

/// What a source offers one bucket.
struct Offer {
    state: MemberState,
    age: u32,
    /// The bar it offers (its own, or its last close flat), `None` when stale or not yet listed.
    bar: Option<Bar>,
}

/// The consensus of `sources` at `bucket_ms` resolution.
///
/// `bucket_ms` is the width of the candles (a bar's `t` is floored to it, so sources that open a
/// bucket at slightly different times still meet). The result has one bar per bucket in which at
/// least one source has a bar of its own and at least `min_sources` are counted, oldest first.
pub fn consensus(
    sources: &[Source],
    bucket_ms: i64,
    params: &Params,
) -> Result<Vec<AggBar>, ParamError> {
    consensus_aligned(sources, bucket_ms, 0, params)
}

/// [`consensus`] for buckets that do not start at a multiple of their width from the Unix epoch:
/// a bucket opens at `origin_ms` plus a whole number of widths (weeks open on a Monday, the epoch
/// was a Thursday, so `origin_ms` is minus three days).
pub fn consensus_aligned(
    sources: &[Source],
    bucket_ms: i64,
    origin_ms: i64,
    params: &Params,
) -> Result<Vec<AggBar>, ParamError> {
    params.validate()?;
    if bucket_ms <= 0 {
        return Err(ParamError("bucket_ms must be positive".into()));
    }
    let series: Vec<Vec<Bar>> = sources
        .iter()
        .map(|s| normalise(&s.bars, bucket_ms, origin_ms))
        .collect();
    let mut times: Vec<i64> = series.iter().flatten().map(|b| b.t).collect();
    times.sort_unstable();
    times.dedup();

    let mut cursor = vec![0usize; sources.len()];
    let mut memory: Vec<Memory> = sources.iter().map(|_| Memory { observations: 0 }).collect();
    let mut out = Vec::with_capacity(times.len());

    for t in times {
        let offers: Vec<Offer> = series
            .iter()
            .enumerate()
            .map(|(i, bars)| {
                while cursor[i] < bars.len() && bars[cursor[i]].t <= t {
                    cursor[i] += 1;
                }
                offer(bars, cursor[i], t, bucket_ms, params)
            })
            .collect();
        let fresh: Vec<usize> = (0..offers.len())
            .filter(|&i| offers[i].age == 0 && offers[i].bar.is_some())
            .collect();
        if fresh.is_empty() {
            continue;
        }
        if let Some(bar) = bucket(sources, &offers, &memory, t, params) {
            out.push(bar);
        }

        // Only now does this bucket become history: a source's own bar counts towards its ramp
        // after it has been weighed, never before.
        for &i in &fresh {
            memory[i].observations = memory[i].observations.saturating_add(1);
        }
    }
    Ok(out)
}

/// Floor to the bucket, drop what cannot be a price, keep the last of two bars in one bucket.
pub(crate) fn normalise(bars: &[Bar], bucket_ms: i64, origin_ms: i64) -> Vec<Bar> {
    let mut v: Vec<Bar> = bars
        .iter()
        .filter(|b| b.usable())
        .map(|b| Bar {
            t: (b.t - origin_ms).div_euclid(bucket_ms) * bucket_ms + origin_ms,
            ..*b
        })
        .collect();
    v.sort_by_key(|b| b.t);
    let mut out: Vec<Bar> = Vec::with_capacity(v.len());
    for b in v {
        match out.last_mut() {
            Some(last) if last.t == b.t => *last = b,
            _ => out.push(b),
        }
    }
    out
}

/// What the source whose bars before `next` are in the past offers bucket `t`.
fn offer(bars: &[Bar], next: usize, t: i64, bucket_ms: i64, p: &Params) -> Offer {
    let Some(last) = next.checked_sub(1).map(|i| bars[i]) else {
        return Offer {
            state: MemberState::NotListed,
            age: 0,
            bar: None,
        };
    };
    let age = u32::try_from((t - last.t) / bucket_ms).unwrap_or(u32::MAX);
    if age == 0 {
        Offer {
            state: MemberState::Used,
            age,
            bar: Some(last),
        }
    } else if age <= p.stale_after_buckets {
        Offer {
            state: MemberState::Carried,
            age,
            bar: Some(Bar::flat(t, last.c)),
        }
    } else {
        Offer {
            state: MemberState::Stale,
            age,
            bar: None,
        }
    }
}

/// The weights and the consensus of one bucket, `None` when fewer than `min_sources` count.
fn bucket(
    sources: &[Source],
    offers: &[Offer],
    memory: &[Memory],
    t: i64,
    p: &Params,
) -> Option<AggBar> {
    struct Candidate {
        source: usize,
        /// o, h, l, c as the source quotes them.
        ohlc: [f64; 4],
        volume: f64,
        /// Everything in the weight that does not depend on the consensus.
        prior: f64,
    }

    let mut candidates: Vec<Candidate> = Vec::new();
    for (i, offer) in offers.iter().enumerate() {
        let Some(bar) = offer.bar else { continue };
        let base = sources[i].weight;
        if !base.is_finite() || base <= 0.0 {
            continue;
        }
        let observations = memory[i].observations + u32::from(offer.age == 0);
        let entry = (f64::from(observations) / f64::from(p.entry_ramp_buckets)).min(1.0);
        let recency = 0.5_f64.powf(f64::from(offer.age) / p.recency_half_life_buckets);
        candidates.push(Candidate {
            source: i,
            ohlc: [bar.o, bar.h, bar.l, bar.c],
            volume: if offer.age == 0 { bar.v } else { 0.0 },
            prior: base * recency * entry,
        });
    }
    if candidates.is_empty() {
        return None;
    }

    // The first estimate is the weighted median: it does not care how far a bad source is.
    let mut start: Vec<(f64, f64)> = candidates.iter().map(|c| (c.ohlc[3], c.prior)).collect();
    let mut estimate = weighted_median(&mut start)?;

    let weigh = |estimate: f64| -> Vec<(f64, bool)> {
        candidates
            .iter()
            .map(|c| {
                let d = c.ohlc[3] / estimate - 1.0;
                if d.abs() > p.outlier_limit {
                    (0.0, true)
                } else {
                    (c.prior / (1.0 + (d / p.deviation_scale).powi(2)), false)
                }
            })
            .collect()
    };
    for _ in 0..p.iterations {
        let w = weigh(estimate);
        let total: f64 = w.iter().map(|x| x.0).sum();
        if total <= 0.0 {
            break;
        }
        estimate = candidates
            .iter()
            .zip(&w)
            .map(|(c, x)| c.ohlc[3] * x.0)
            .sum::<f64>()
            / total;
    }
    let mut weights = weigh(estimate);
    if weights.iter().map(|x| x.0).sum::<f64>() <= 0.0 {
        // Every source is "too far" from the median (two markets a long way apart): no consensus
        // is possible, so the one with the strongest standing speaks alone rather than none.
        let (best, _) = candidates
            .iter()
            .enumerate()
            .max_by(|a, b| a.1.prior.total_cmp(&b.1.prior))?;
        for (k, w) in weights.iter_mut().enumerate() {
            *w = (if k == best { 1.0 } else { 0.0 }, k != best);
        }
    }
    let total: f64 = weights.iter().map(|x| x.0).sum();
    let used = weights.iter().filter(|x| x.0 > 0.0).count();
    if used < p.min_sources {
        return None;
    }
    let mix = |field: usize| -> f64 {
        candidates
            .iter()
            .zip(&weights)
            .map(|(c, w)| c.ohlc[field] * w.0)
            .sum::<f64>()
            / total
    };
    let (o, c) = (mix(0), mix(3));
    let h = mix(1).max(o).max(c);
    let l = mix(2).min(o).min(c);

    let mut readings: Vec<MemberReading> = offers
        .iter()
        .enumerate()
        .map(|(i, offer)| MemberReading {
            source: i,
            state: offer.state,
            price: offer.bar.map(|b| b.c),
            share: 0.0,
            deviation: None,
            age: offer.age,
        })
        .collect();
    let mut volume = 0.0;
    for (cand, (weight, outlier)) in candidates.iter().zip(&weights) {
        let r = &mut readings[cand.source];
        r.share = weight / total;
        r.deviation = Some(cand.ohlc[3] / c - 1.0);
        if *outlier {
            r.state = MemberState::Outlier;
        } else if *weight > 0.0 {
            volume += cand.volume;
        }
    }
    Some(AggBar {
        t,
        o,
        h,
        l,
        c,
        v: volume,
        members: readings,
    })
}

/// The value at which half the total weight lies on either side; the midpoint of the two middle
/// values when the halves are exactly equal. `None` for no weight.
fn weighted_median(items: &mut [(f64, f64)]) -> Option<f64> {
    items.sort_by(|a, b| a.0.total_cmp(&b.0));
    let total: f64 = items.iter().map(|x| x.1).sum();
    if total.is_nan() || total <= 0.0 {
        return None;
    }
    let half = total / 2.0;
    let eps = total * 1e-12;
    let mut cumulative = 0.0;
    for (k, (value, weight)) in items.iter().enumerate() {
        cumulative += weight;
        if (cumulative - half).abs() <= eps {
            return Some(
                items
                    .get(k + 1)
                    .map_or(*value, |next| (value + next.0) / 2.0),
            );
        }
        if cumulative > half {
            return Some(*value);
        }
    }
    items.last().map(|x| x.0)
}

/// The consensus as an [`Aggregator`]: every source is read, every source with a recent price has a say.
#[derive(Debug, Clone, Default)]
pub struct Consensus {
    pub params: Params,
}

impl Consensus {
    pub fn new(params: Params) -> Result<Self, ParamError> {
        params.validate()?;
        Ok(Self { params })
    }
}

impl Aggregator for Consensus {
    fn name(&self) -> StrategyName {
        StrategyName::Consensus
    }

    fn fetch_plan(&self) -> FetchPlan {
        FetchPlan::All
    }

    fn aggregate(&self, request: &Request<'_>) -> Result<Aggregate, ParamError> {
        let bars = consensus_aligned(
            request.sources,
            request.bucket_ms,
            request.origin_ms,
            &self.params,
        )?;
        let empty = bars.is_empty().then_some(EmptyReason::NoData);
        Ok(Aggregate {
            strategy: StrategyName::Consensus,
            bars,
            served_by: None,
            label: None,
            empty,
        })
    }
}
