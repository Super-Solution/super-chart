// Copyright 2026 SUPER SOLUTION LABS INC
#![cfg_attr(test, allow(clippy::expect_used, clippy::unwrap_used))]
//! One price from several markets.
//!
//! An asset trades on more than one market. A product that shows it has to decide *which price*, and there are two
//! honest answers, so this crate has both behind one trait, [`Aggregator`]:
//!
//! * [`Failover`], primary with fallbacks: the instrument is read from one source at a time, the first in priority
//!   order that has a current quote. Its candles, price and label are that source's, whole.
//! * [`Consensus`], a weighted consensus: every source with a recent price has a say, weighted by how recent its quote
//!   is, how long it has been listed and how far it is from the others. A source's own prices are never changed, only
//!   its weight.
//!
//! Both take the same [`Request`] (sources as candles, in priority order) and give the same [`Aggregate`], so a host
//! switches strategy by changing one value, and one aggregate can be a [`Source`] of another
//! ([`Aggregate::into_source`]): a consensus of each venue group, then a failover across groups, or the reverse. A live
//! quote is a candle too ([`Source::quote`]), so a midpoint with no history goes through the same rules as a market
//! with candles.
//!
//! The arithmetic is pure: no network, no clock (the request carries `now_ms`), no randomness, so every edge case is a
//! unit test. With the default `runtime` feature the crate also has what a service needs around it: the
//! [`runtime::QuoteSource`] adapter trait an app implements for its venues, [`runtime::Instrument`] to read the sources
//! the way the strategy wants them read, and a single-flight cache so many viewers cost one read.

//! ```
//! use super_chart_quotes::{Aggregator, Bar, Consensus, Failover, Request, Source};
//!
//! let minute = 60_000;
//! let bars = |price: f64, n: i64| (0..n).map(|i| Bar { t: i * minute, ..Bar::flat(0, price) }).collect();
//! let sources = [Source::new("okx", bars(100.0, 30)), Source::new("bitget", bars(100.1, 30))];
//! let request = Request { sources: &sources, bucket_ms: minute, origin_ms: 0, now_ms: 29 * minute, previous: None };
//!
//! // Primary with fallbacks: OKX's candles, whole, while OKX has a current quote.
//! let served = Failover::default().aggregate(&request)?;
//! assert_eq!((served.served_by, served.latest().map(|b| b.c)), (Some(0), Some(100.0)));
//!
//! // Consensus: both have a say, weighted by how close they are to each other.
//! let blended = Consensus::default().aggregate(&request)?;
//! let price = blended.latest().map_or(0.0, |b| b.c);
//! assert!(price > 100.0 && price < 100.1);
//! # Ok::<(), super_chart_quotes::ParamError>(())
//! ```

pub mod aggregate;
pub mod bar;
pub mod consensus;
pub mod failover;
pub mod params;
#[cfg(feature = "runtime")]
pub mod runtime;

#[cfg(test)]
mod tests;

pub use aggregate::{
    AggBar, Aggregate, Aggregator, EmptyReason, FetchPlan, MemberReading, MemberState, Request,
    StrategyName,
};
pub use bar::{Bar, Source};
pub use consensus::{Consensus, consensus, consensus_aligned};
pub use failover::Failover;
pub use params::{ParamError, Params};
