// Copyright 2026 SUPER SOLUTION LABS INC
//! What a source gives: candles. A live quote is a candle too, so one set of rules serves both.

use serde::Serialize;

/// One candle. `t` is the bucket's open time in milliseconds since the Unix epoch (UTC).
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Bar {
    pub t: i64,
    pub o: f64,
    pub h: f64,
    pub l: f64,
    pub c: f64,
    pub v: f64,
}

impl Bar {
    /// A bar that is only a price: what a quote, or a source carried forward, contributes.
    pub fn flat(t: i64, price: f64) -> Self {
        Self {
            t,
            o: price,
            h: price,
            l: price,
            c: price,
            v: 0.0,
        }
    }

    /// Whether the bar can be a price at all: finite, positive prices, non-negative volume.
    pub fn usable(&self) -> bool {
        [self.o, self.h, self.l, self.c, self.v]
            .iter()
            .all(|x| x.is_finite())
            && self.o > 0.0
            && self.h > 0.0
            && self.l > 0.0
            && self.c > 0.0
            && self.v >= 0.0
    }
}

/// One source: a market's candles, oldest first.
///
/// The order of a slice of sources is meaningful to a primary-with-fallbacks strategy (first is the primary) and
/// irrelevant to a consensus.
#[derive(Debug, Clone)]
pub struct Source {
    /// What the caller calls it (a venue and a symbol, say); echoed back, never interpreted.
    pub id: String,
    /// A fixed weight on top of everything the consensus computes (`1.0` for all of them is the usual; a liquidity
    /// weight would go here). Ignored by a primary-with-fallbacks strategy.
    pub weight: f64,
    /// `false` when the source was deliberately not asked (a fallback is not read while its primary is current). It
    /// is then reported as standing by, not as having no data.
    pub read: bool,
    pub bars: Vec<Bar>,
}

impl Source {
    pub fn new(id: impl Into<String>, bars: Vec<Bar>) -> Self {
        Self {
            id: id.into(),
            weight: 1.0,
            read: true,
            bars,
        }
    }

    /// A source that was not asked.
    pub fn unread(id: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            weight: 1.0,
            read: false,
            bars: Vec::new(),
        }
    }

    /// A source that only has a price now (a midpoint, a ticker): `buckets` flat bars ending in the bucket of `at_ms`,
    /// so it goes through the same rules as a source with candles: it counts for what its age says and fades in like
    /// any other. `buckets` is usually [`crate::Params::warmup_buckets`], so a quote is fully in by its first bar.
    pub fn quote(
        id: impl Into<String>,
        price: f64,
        at_ms: i64,
        bucket_ms: i64,
        origin_ms: i64,
        buckets: u32,
    ) -> Self {
        let bucket_ms = bucket_ms.max(1);
        let newest = (at_ms - origin_ms).div_euclid(bucket_ms) * bucket_ms + origin_ms;
        let bars = (0..i64::from(buckets.max(1)))
            .rev()
            .map(|back| Bar::flat(newest - back * bucket_ms, price))
            .collect();
        Self::new(id, bars)
    }
}
