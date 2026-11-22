// Copyright 2026 SUPER SOLUTION LABS INC
//! Primary with fallbacks: an instrument is read from **one source at a time**.
//!
//! The rule, stated for any sources:
//!
//! - The sources are in priority order; the first is the primary.
//! - The instrument moves to the next source only when the one before it has **no current quote**: it gave nothing,
//!   or its newest bar is older than `max_age_buckets`.
//! - It goes back to the primary the moment the primary has a current quote again. There is no memory in the choice:
//!   it is a function of what each source has now.
//! - Its price, its candles and its label all come from the serving source. A chart is **never joined** from two
//!   sources' candles, and a price is never shown under another source's name.
//! - When nobody is current the instrument is not hidden and is given no number. It keeps the label of the source it
//!   was last read from (else the primary), and says why it has no price.
//! - A fallback is read only when it has to be ([`FetchPlan::UntilCurrent`]).

use crate::aggregate::{
    AggBar, Aggregate, Aggregator, EmptyReason, FetchPlan, MemberReading, MemberState, Request,
    StrategyName,
};
use crate::bar::Bar;
use crate::consensus::normalise;
use crate::params::ParamError;

/// How many buckets before `now_ms` the newest usable bar of `bars` opened (0 for one at or after it), `None` without a
/// usable bar. This is what "current quote" means, and the runtime asks it too, to know whether to read the next source.
pub(crate) fn newest_age(bars: &[Bar], bucket_ms: i64, origin_ms: i64, now_ms: i64) -> Option<u32> {
    let bucket = bucket_ms.max(1);
    let now = (now_ms - origin_ms).div_euclid(bucket) * bucket + origin_ms;
    bars.iter()
        .filter(|b| b.usable())
        .map(|b| (b.t - origin_ms).div_euclid(bucket) * bucket + origin_ms)
        .max()
        .map(|t| u32::try_from(((now - t) / bucket).max(0)).unwrap_or(u32::MAX))
}

/// Primary with fallbacks.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Failover {
    /// A source whose newest bar is more than this many buckets old has no current quote. 3 is what the consensus
    /// uses for the same purpose (`Params::stale_after_buckets`).
    pub max_age_buckets: u32,
}

impl Default for Failover {
    fn default() -> Self {
        Self { max_age_buckets: 3 }
    }
}

impl Failover {
    pub fn new(max_age_buckets: u32) -> Self {
        Self { max_age_buckets }
    }
}

impl Aggregator for Failover {
    fn name(&self) -> StrategyName {
        StrategyName::Failover
    }

    fn fetch_plan(&self) -> FetchPlan {
        FetchPlan::UntilCurrent {
            max_age_buckets: self.max_age_buckets,
        }
    }

    fn aggregate(&self, request: &Request<'_>) -> Result<Aggregate, ParamError> {
        if request.bucket_ms <= 0 {
            return Err(ParamError("bucket_ms must be positive".into()));
        }
        let bucket = request.bucket_ms;
        let series: Vec<Vec<Bar>> = request
            .sources
            .iter()
            .map(|s| normalise(&s.bars, bucket, request.origin_ms))
            .collect();
        // Once per source: the age of its newest bar is what "current" means. A bar that opens after `now` (a clock a
        // little behind the source's) is as current as it can be.
        let ages: Vec<Option<u32>> = series
            .iter()
            .map(|bars| newest_age(bars, bucket, request.origin_ms, request.now_ms))
            .collect();
        let age = |i: usize| ages[i];
        let current =
            |i: usize| request.sources[i].read && age(i).is_some_and(|a| a <= self.max_age_buckets);
        let served = (0..series.len()).find(|&i| current(i));

        let Some(serving) = served else {
            let label = request
                .previous
                .and_then(|id| request.sources.iter().position(|s| s.id == id))
                .or_else(|| (!request.sources.is_empty()).then_some(0));
            let any_bars = series.iter().any(|s| !s.is_empty());
            return Ok(Aggregate {
                strategy: StrategyName::Failover,
                bars: Vec::new(),
                served_by: None,
                label,
                empty: Some(if any_bars {
                    EmptyReason::NoCurrentQuote
                } else {
                    EmptyReason::NoData
                }),
            });
        };

        let state_of = |k: usize, bar: Option<&Bar>| -> MemberReading {
            if k == serving {
                let price = bar.map(|b| b.c);
                return MemberReading {
                    source: k,
                    state: MemberState::Used,
                    price,
                    share: 1.0,
                    deviation: price.map(|_| 0.0),
                    age: 0,
                };
            }
            let state = if k > serving || !request.sources[k].read {
                MemberState::Standby
            } else if series[k].is_empty() {
                MemberState::NotListed
            } else {
                MemberState::Stale
            };
            MemberReading {
                source: k,
                state,
                price: None,
                share: 0.0,
                deviation: None,
                age: age(k).unwrap_or(0),
            }
        };
        let bars = series[serving]
            .iter()
            .map(|b| AggBar {
                t: b.t,
                o: b.o,
                h: b.h,
                l: b.l,
                c: b.c,
                v: b.v,
                members: (0..series.len())
                    .map(|k| state_of(k, (k == serving).then_some(b)))
                    .collect(),
            })
            .collect();
        Ok(Aggregate {
            strategy: StrategyName::Failover,
            bars,
            served_by: Some(serving),
            label: Some(serving),
            empty: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bar::Source;

    const MIN: i64 = 60_000;
    const T0: i64 = 1_767_225_600_000; // 2026-01-01 00:00 UTC

    fn bars(range: std::ops::Range<i64>, price: f64) -> Vec<Bar> {
        range
            .map(|i| Bar {
                t: T0 + i * MIN,
                o: price,
                h: price * 1.001,
                l: price * 0.999,
                c: price,
                v: 5.0,
            })
            .collect()
    }
    fn run(sources: &[Source], now_bucket: i64, previous: Option<&str>) -> Aggregate {
        Failover::default()
            .aggregate(&Request {
                sources,
                bucket_ms: MIN,
                origin_ms: 0,
                now_ms: T0 + now_bucket * MIN + 17_000,
                previous,
            })
            .expect("valid")
    }
    fn three(primary: std::ops::Range<i64>, second: std::ops::Range<i64>) -> [Source; 3] {
        [
            Source::new("okx", bars(primary, 100.0)),
            Source::new("bitget", bars(second, 100.2)),
            Source::new("hl", bars(0..50, 99.9)),
        ]
    }

    #[test]
    fn a_current_primary_serves_everything() {
        let got = run(&three(0..50, 0..50), 49, None);
        assert_eq!(got.served_by, Some(0));
        assert_eq!(got.label, Some(0));
        assert_eq!(got.bars.len(), 50);
        assert_eq!(got.bars[10].c, 100.0);
        assert_eq!(got.bars[10].members[0].state, MemberState::Used);
        assert_eq!(got.bars[10].members[0].share, 1.0);
        assert_eq!(got.bars[10].members[1].state, MemberState::Standby);
        assert_eq!(got.bars[10].members[2].state, MemberState::Standby);
        assert!(got.empty.is_none());
    }

    #[test]
    fn it_moves_on_only_when_the_primary_has_no_current_quote() {
        // The primary's newest bar is bucket 40; at bucket 43 it is 3 old (current), at 44 it is 4 old (not).
        let sources = three(0..41, 0..50);
        assert_eq!(run(&sources, 43, None).served_by, Some(0));
        let moved = run(&sources, 44, None);
        assert_eq!(moved.served_by, Some(1));
        assert_eq!(moved.label, Some(1));
        assert_eq!(moved.bars.len(), 50, "the fallback's own candles, whole");
        assert_eq!(moved.bars[0].c, 100.2);
        assert_eq!(moved.bars[0].members[0].state, MemberState::Stale);
        assert_eq!(moved.bars[0].members[2].state, MemberState::Standby);
    }

    #[test]
    fn it_goes_back_to_the_primary_the_moment_it_is_current_again() {
        let down = three(0..30, 0..50);
        assert_eq!(run(&down, 49, None).served_by, Some(1));
        let back = three(0..50, 0..50);
        assert_eq!(
            run(&back, 49, Some("bitget")).served_by,
            Some(0),
            "the previous source does not keep the instrument"
        );
    }

    #[test]
    fn a_chart_is_never_joined_from_two_sources() {
        // The primary has candles for the early history only; the fallback has the recent ones. The answer is one
        // source's candles, not the primary's past stitched to the fallback's present.
        let got = run(&three(0..10, 5..50), 49, None);
        assert_eq!(got.served_by, Some(1));
        assert_eq!(got.bars.len(), 45);
        assert!(got.bars.iter().all(|b| b.c == 100.2));
    }

    #[test]
    fn nobody_current_gives_no_price_and_the_label_of_the_last_source_read() {
        let sources = [
            Source::new("okx", bars(0..10, 100.0)),
            Source::new("bitget", bars(0..10, 100.2)),
            Source::new("hl", bars(0..10, 99.9)),
        ];
        let got = run(&sources, 49, Some("bitget"));
        assert!(got.bars.is_empty());
        assert_eq!(got.served_by, None);
        assert_eq!(got.label, Some(1));
        assert_eq!(got.empty, Some(EmptyReason::NoCurrentQuote));
        // Never read, or a previous that is not a source: the primary.
        assert_eq!(run(&sources, 49, None).label, Some(0));
        assert_eq!(run(&sources, 49, Some("gone")).label, Some(0));
    }

    #[test]
    fn nothing_at_all_is_no_data() {
        let empty = [Source::new("a", vec![]), Source::new("b", vec![])];
        let got = run(&empty, 5, None);
        assert_eq!(got.empty, Some(EmptyReason::NoData));
        assert_eq!(got.label, Some(0));
        let none = run(&[], 5, None);
        assert_eq!((none.label, none.empty), (None, Some(EmptyReason::NoData)));
    }

    #[test]
    fn a_source_that_was_not_asked_is_standing_by_and_cannot_serve() {
        let sources = [
            Source::new("okx", bars(0..50, 100.0)),
            Source::unread("bitget"),
        ];
        let got = run(&sources, 49, None);
        assert_eq!(got.bars[0].members[1].state, MemberState::Standby);
        let down = [
            Source::new("okx", bars(0..10, 100.0)),
            Source::unread("bitget"),
        ];
        let none = run(&down, 49, None);
        assert_eq!(
            none.served_by, None,
            "an unread source has no quote to serve"
        );
    }

    #[test]
    fn an_earlier_source_that_was_not_asked_stands_by_it_is_not_stale() {
        let sources = [
            Source::unread("okx"),
            Source::new("bitget", bars(0..50, 100.2)),
        ];
        let got = run(&sources, 49, None);
        assert_eq!(got.served_by, Some(1));
        assert_eq!(got.bars[0].members[0].state, MemberState::Standby);
    }

    #[test]
    fn a_bar_a_little_ahead_of_the_clock_is_current() {
        let sources = [Source::new("a", bars(0..50, 100.0))];
        let got = Failover::default()
            .aggregate(&Request {
                sources: &sources,
                bucket_ms: MIN,
                origin_ms: 0,
                now_ms: T0 + 20 * MIN,
                previous: None,
            })
            .expect("valid");
        assert_eq!(got.served_by, Some(0));
    }

    #[test]
    fn unusable_bars_are_not_a_quote() {
        let mut a = bars(0..50, 100.0);
        for b in &mut a[40..] {
            b.c = f64::NAN;
        }
        let sources = [Source::new("a", a), Source::new("b", bars(0..50, 100.2))];
        let got = run(&sources, 49, None);
        assert_eq!(
            got.served_by,
            Some(1),
            "the primary's newest usable bar is 9 buckets old"
        );
    }

    #[test]
    fn weights_do_not_matter_here_only_the_order() {
        let mut a = Source::new("a", bars(0..50, 100.0));
        a.weight = 0.0;
        let got = run(&[a, Source::new("b", bars(0..50, 100.2))], 49, None);
        assert_eq!(got.served_by, Some(0));
    }

    #[test]
    fn the_plan_reads_fallbacks_only_when_needed() {
        assert_eq!(
            Failover::new(5).fetch_plan(),
            FetchPlan::UntilCurrent { max_age_buckets: 5 }
        );
    }

    #[test]
    fn weekly_buckets_use_their_origin() {
        const DAY: i64 = 24 * 60 * MIN;
        const WEEK: i64 = 7 * DAY;
        const MONDAY: i64 = 1_794_787_200_000; // 2026-11-16 00:00 UTC
        let weekly = |t: i64| Bar {
            t,
            ..Bar::flat(0, 100.0)
        };
        let sources = [Source::new(
            "a",
            vec![weekly(MONDAY), weekly(MONDAY + WEEK)],
        )];
        let got = Failover::default()
            .aggregate(&Request {
                sources: &sources,
                bucket_ms: WEEK,
                origin_ms: -3 * DAY,
                now_ms: MONDAY + WEEK + 2 * DAY,
                previous: None,
            })
            .expect("valid");
        assert_eq!(
            got.bars.iter().map(|b| b.t).collect::<Vec<_>>(),
            vec![MONDAY, MONDAY + WEEK]
        );
        assert_eq!(
            got.age_buckets(MONDAY + WEEK + 2 * DAY, WEEK, -3 * DAY),
            Some(0)
        );
    }

    #[test]
    fn a_bad_bucket_is_an_error() {
        let r = Request {
            sources: &[],
            bucket_ms: 0,
            origin_ms: 0,
            now_ms: 0,
            previous: None,
        };
        assert!(Failover::default().aggregate(&r).is_err());
    }
}
