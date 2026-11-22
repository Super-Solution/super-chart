// Copyright 2026 SUPER SOLUTION LABS INC
//! What every strategy takes and gives, so a caller can swap one for another, or feed one's answer to the next.

use serde::Serialize;

use crate::bar::Source;
use crate::params::ParamError;

/// What a source was in one bucket.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MemberState {
    /// A bar in this very bucket, counted.
    Used,
    /// No bar in this bucket; its last close, carried forward, counted.
    Carried,
    /// Too far from the consensus: seen, not counted.
    Outlier,
    /// Its last bar is older than the strategy allows: not counted.
    Stale,
    /// It has no bar yet: the market had not listed (or the page starts before it).
    NotListed,
    /// Not serving: an earlier source in the priority order is current, so this one was not used (and, where the host
    /// fetches lazily, not even asked). Only a primary-with-fallbacks strategy says this.
    Standby,
}

/// One source's part in one bucket.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberReading {
    /// Index into the `sources` slice the aggregate was computed from.
    pub source: usize,
    pub state: MemberState,
    /// The source's own close (carried forward if it had no bar), `None` if it has none or is on standby.
    pub price: Option<f64>,
    /// The share of the price this source carries, 0 to 1; the shares of a bucket sum to 1.
    pub share: f64,
    /// `price / aggregate - 1`, `None` without a price.
    pub deviation: Option<f64>,
    /// Buckets since the source's last bar (0 for a bar in this bucket).
    pub age: u32,
}

/// One bucket of an aggregate.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct AggBar {
    pub t: i64,
    pub o: f64,
    pub h: f64,
    pub l: f64,
    pub c: f64,
    /// The volume of the sources that had a bar in this bucket and counted; a carried source adds none.
    pub v: f64,
    /// One reading per source, in the order of the `sources` slice.
    pub members: Vec<MemberReading>,
}

impl AggBar {
    /// This bar as a plain candle, for a consumer that does not care where it came from.
    pub fn bar(&self) -> crate::bar::Bar {
        crate::bar::Bar {
            t: self.t,
            o: self.o,
            h: self.h,
            l: self.l,
            c: self.c,
            v: self.v,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StrategyName {
    Consensus,
    Failover,
}

/// Why an aggregate has no bars. Never "hidden": a host shows this beside the label.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum EmptyReason {
    /// No source gave a usable bar.
    NoData,
    /// Some source has bars but none is recent enough: a primary-with-fallbacks strategy has nobody to serve.
    NoCurrentQuote,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Aggregate {
    pub strategy: StrategyName,
    /// Oldest first.
    pub bars: Vec<AggBar>,
    /// Failover: the source whose candles these are, in full. A chart is never joined from two sources. `None` for a
    /// consensus, which has no single server, and when no source is current.
    pub served_by: Option<usize>,
    /// Failover: the source to name beside the price. `served_by`; when nobody is current, the source last read (else
    /// the primary), so the price is never shown under another name. `None` for a consensus.
    pub label: Option<usize>,
    /// Set when `bars` is empty.
    pub empty: Option<EmptyReason>,
}

impl Aggregate {
    pub fn latest(&self) -> Option<&AggBar> {
        self.bars.last()
    }

    /// How many buckets before `now_ms` the newest bar opened, `None` without a bar. A host that wants "no price" when
    /// even a consensus has gone quiet checks this (a consensus is computed from the bars it was given and has no
    /// clock; the failover strategy applies its own limit itself).
    pub fn age_buckets(&self, now_ms: i64, bucket_ms: i64, origin_ms: i64) -> Option<u32> {
        let bucket_ms = bucket_ms.max(1);
        let now = (now_ms - origin_ms).div_euclid(bucket_ms) * bucket_ms + origin_ms;
        self.latest()
            .map(|b| u32::try_from(((now - b.t) / bucket_ms).max(0)).unwrap_or(u32::MAX))
    }

    /// The aggregate as a source for another strategy: this is how strategies compose (a consensus per venue group,
    /// then a failover across groups, or the other way round). Its bars are the aggregate's bars.
    pub fn into_source(self, id: impl Into<String>) -> Source {
        Source::new(id, self.bars.iter().map(AggBar::bar).collect())
    }
}

/// What a strategy needs to know besides the sources.
#[derive(Debug, Clone, Copy)]
pub struct Request<'a> {
    /// In priority order: the first is the primary.
    pub sources: &'a [Source],
    /// The width of a candle in milliseconds.
    pub bucket_ms: i64,
    /// Where buckets open: a bucket starts at `origin_ms` plus a whole number of widths (weeks open on a Monday, the
    /// epoch was a Thursday, so a weekly caller passes minus three days). 0 for the rest.
    pub origin_ms: i64,
    /// The time of the request, for the strategies that judge a source by how recent its newest bar is.
    pub now_ms: i64,
    /// The id of the source this instrument was last read from, for the label when nobody is current.
    pub previous: Option<&'a str>,
}

/// How a host should read the sources for a strategy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FetchPlan {
    /// Every source, at once: the strategy uses them all.
    All,
    /// In priority order, each only when every one before it has no current quote. A healthy primary costs one read.
    UntilCurrent { max_age_buckets: u32 },
}

pub trait Aggregator: Send + Sync {
    fn name(&self) -> StrategyName;
    fn fetch_plan(&self) -> FetchPlan;
    fn aggregate(&self, request: &Request<'_>) -> Result<Aggregate, ParamError>;
}
