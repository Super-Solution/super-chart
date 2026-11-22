// Copyright 2026 SUPER SOLUTION LABS INC
//! The consensus's arithmetic, and the strategies together.

use crate::*;

const MIN: i64 = 60_000;
const T0: i64 = 1_767_225_600_000; // 2026-01-01 00:00 UTC, a minute boundary

/// A bar whose four prices and volume are given; `i` is the bucket index.
fn bar(i: i64, o: f64, h: f64, l: f64, c: f64, v: f64) -> Bar {
    Bar {
        t: T0 + i * MIN,
        o,
        h,
        l,
        c,
        v,
    }
}

/// A bar that is a price with a little range around it, 10 units of volume.
fn px(i: i64, price: f64) -> Bar {
    bar(i, price, price * 1.0005, price * 0.9995, price, 10.0)
}

/// A reproducible wobble in [-1, 1]: the same on every run, different per (seed, i).
fn noise(seed: u64, i: i64) -> f64 {
    let mut x =
        (seed.wrapping_mul(0x9E37_79B9_7F4A_7C15)) ^ (i as u64).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    x ^= x >> 31;
    x = x.wrapping_mul(0x94D0_49BB_1331_11EB);
    x ^= x >> 29;
    (x % 20_001) as f64 / 10_000.0 - 1.0
}

/// The "true" price all the markets follow: a slow wave around 100.
fn truth(i: i64) -> f64 {
    100.0 * (1.0 + 0.004 * (i as f64 / 9.0).sin())
}

/// A market's series over `range`: the truth times `offset`, plus a few basis points of its own noise.
fn series(
    id: &str,
    seed: u64,
    range: std::ops::Range<i64>,
    offset: f64,
    f: impl Fn(i64, f64) -> f64,
) -> Source {
    Source {
        id: id.into(),
        weight: 1.0,
        read: true,
        bars: range
            .map(|i| px(i, f(i, truth(i) * offset * (1.0 + 0.0003 * noise(seed, i)))))
            .collect(),
    }
}

fn plain(id: &str, seed: u64, range: std::ops::Range<i64>, offset: f64) -> Source {
    series(id, seed, range, offset, |_, p| p)
}

fn run(sources: &[Source]) -> Vec<AggBar> {
    consensus(sources, MIN, &Params::default()).expect("valid params")
}

fn at(bars: &[AggBar], i: i64) -> &AggBar {
    bars.iter()
        .find(|b| b.t == T0 + i * MIN)
        .unwrap_or_else(|| panic!("no consensus bar at bucket {i}"))
}

fn rel(a: f64, b: f64) -> f64 {
    (a / b - 1.0).abs()
}

#[test]
fn one_source_is_its_own_consensus() {
    let a = plain("a", 1, 0..30, 1.0);
    let got = run(std::slice::from_ref(&a));
    assert_eq!(got.len(), 30);
    for (bar, own) in got.iter().zip(&a.bars) {
        assert_eq!(bar.t, own.t);
        for (got, want) in [
            (bar.o, own.o),
            (bar.h, own.h),
            (bar.l, own.l),
            (bar.c, own.c),
            (bar.v, own.v),
        ] {
            assert!(
                rel(got.max(1e-12), want.max(1e-12)) < 1e-12,
                "{got} vs {want}"
            );
        }
        assert_eq!(bar.members[0].state, MemberState::Used);
        assert_eq!(bar.members[0].share, 1.0);
    }
}

#[test]
fn sources_that_agree_give_that_price() {
    let sources = [
        plain("a", 1, 0..40, 1.0),
        plain("b", 2, 0..40, 1.0),
        plain("c", 3, 0..40, 1.0),
    ];
    for bar in run(&sources) {
        let truth = truth((bar.t - T0) / MIN);
        assert!(
            rel(bar.c, truth) < 0.0006,
            "consensus {} vs {}",
            bar.c,
            truth
        );
        assert!(bar.h >= bar.o.max(bar.c) && bar.l <= bar.o.min(bar.c));
        assert!((bar.members.iter().map(|m| m.share).sum::<f64>() - 1.0).abs() < 1e-9);
    }
}

#[test]
fn a_new_listing_does_not_move_the_line_and_is_not_invented_before_it_exists() {
    // Three markets for 100 buckets; a fourth lists at bucket 60, half a percent above the rest.
    let sources = [
        plain("a", 1, 0..100, 1.0),
        plain("b", 2, 0..100, 1.001),
        plain("c", 3, 0..100, 0.999),
        plain("new", 4, 60..100, 1.005),
    ];
    let with = run(&sources);
    let without = run(&sources[..3]);

    // Before the listing the newcomer is NotListed and the consensus is the three alone.
    for i in 0..60 {
        assert_eq!(at(&with, i).members[3].state, MemberState::NotListed);
        assert_eq!(at(&with, i).c, at(&without, i).c);
    }
    // At the listing it is there, and the line does not jump: it moves by less than a
    // tenth of the premium it came with, and the newcomer carries a small share.
    let first = at(&with, 60);
    assert_eq!(first.members[3].state, MemberState::Used);
    assert!(
        rel(first.c, at(&without, 60).c) < 0.0005,
        "jumped {}",
        rel(first.c, at(&without, 60).c)
    );
    assert!(
        first.members[3].share < 0.05,
        "share {}",
        first.members[3].share
    );
    // Over the next buckets it is at full strength in age, but half a percent apart is far in
    // deviation: it keeps a small share and does not lift the line.
    let later = at(&with, 99);
    assert!(
        later.members[3].share > 0.0 && later.members[3].share < 0.1,
        "share {}",
        later.members[3].share
    );
    assert!(rel(later.c, at(&without, 99).c) < 0.0015);
}

#[test]
fn a_source_that_drifts_away_does_not_drag_the_line() {
    // `a` slides 0.05% further from the others every bucket, for 120 buckets (6% in all).
    let sources = [
        series("a", 1, 0..120, 1.0, |i, p| p * (1.0 + 0.0005 * i as f64)),
        plain("b", 2, 0..120, 1.0),
        plain("c", 3, 0..120, 1.0),
    ];
    let got = run(&sources);
    let worst = got
        .iter()
        .map(|b| rel(b.c, truth((b.t - T0) / MIN)))
        .fold(0.0, f64::max);
    assert!(worst < 0.002, "the line followed the drift by {worst}");
    // Beyond the outlier limit it is not counted at all.
    assert_eq!(at(&got, 119).members[0].state, MemberState::Outlier);
    assert_eq!(at(&got, 119).members[0].share, 0.0);
}

#[test]
fn a_single_bar_spike_is_seen_and_not_followed() {
    let mut a = plain("a", 1, 0..60, 1.0);
    a.bars[40] = px(40, truth(40) * 1.10);
    let sources = [a, plain("b", 2, 0..60, 1.0), plain("c", 3, 0..60, 1.0)];
    let got = run(&sources);
    let spike = at(&got, 40);
    assert_eq!(spike.members[0].state, MemberState::Outlier);
    assert!(
        rel(spike.c, truth(40)) < 0.0006,
        "followed the spike: {}",
        spike.c
    );
    // The next bucket it is back in, with the share it had.
    let after = at(&got, 41);
    assert_eq!(after.members[0].state, MemberState::Used);
    assert!(after.members[0].share > 0.2);
}

#[test]
fn a_spike_smaller_than_the_outlier_limit_is_only_down_weighted() {
    let mut a = plain("a", 1, 0..60, 1.0);
    a.bars[40] = px(40, truth(40) * 1.01);
    let sources = [a, plain("b", 2, 0..60, 1.0), plain("c", 3, 0..60, 1.0)];
    let got = run(&sources);
    let bar = at(&got, 40);
    assert_eq!(bar.members[0].state, MemberState::Used);
    assert!(bar.members[0].share < 0.1, "share {}", bar.members[0].share);
    // A plain mean would move 0.33%; the weighted one moves a fraction of that.
    assert!(
        rel(bar.c, truth(40)) < 0.0012,
        "moved {}",
        rel(bar.c, truth(40))
    );
}

#[test]
fn a_source_that_goes_quiet_is_carried_for_a_while_then_dropped() {
    let sources = [
        plain("a", 1, 0..50, 1.0),
        plain("b", 2, 0..100, 1.0),
        plain("c", 3, 0..100, 1.0),
    ];
    let got = run(&sources);
    // Its last bar is 49. Buckets 50..=52 are one to three buckets old: carried.
    let shares: Vec<f64> = (50..=52).map(|i| at(&got, i).members[0].share).collect();
    for i in 50..=52 {
        assert_eq!(at(&got, i).members[0].state, MemberState::Carried);
        assert_eq!(at(&got, i).members[0].age as i64, i - 49);
    }
    assert!(shares[0] > shares[1] && shares[1] > shares[2], "{shares:?}");
    assert!(
        shares[0] < at(&got, 49).members[0].share,
        "the carried share must be below its live share"
    );
    // The fourth bucket without a bar is past the horizon.
    assert_eq!(at(&got, 53).members[0].state, MemberState::Stale);
    assert_eq!(at(&got, 53).members[0].share, 0.0);
    // A carried source adds no volume.
    assert_eq!(at(&got, 51).v, 20.0);
}

#[test]
fn a_market_that_always_sits_apart_weighs_little_and_its_prices_are_not_changed() {
    // A flat price, and three markets that sit 0.5% above, level with and 0.5% below it, for good.
    let flat = |id: &str, seed: u64, offset: f64| Source {
        id: id.into(),
        weight: 1.0,
        read: true,
        bars: (0..120)
            .map(|i| px(i, 100.0 * offset * (1.0 + 0.0001 * noise(seed, i))))
            .collect(),
    };
    let sources = [
        flat("high", 1, 1.005),
        flat("mid", 2, 1.0),
        flat("low", 3, 0.995),
    ];
    let got = run(&sources);
    let last = got.last().unwrap();
    let share = |k: usize| last.members[k].share;
    // The one in the middle carries most of it; the two that sit apart carry little each.
    assert!(share(1) > 0.6, "{} {} {}", share(0), share(1), share(2));
    assert!(share(0) < 0.2 && share(2) < 0.2);
    assert!(rel(last.c, 100.0) < 0.0015, "the line is at {}", last.c);
    // Their prices are what they quoted: nothing is "corrected" to make them agree.
    for (m, own) in last.members.iter().zip(&sources) {
        assert_eq!(m.price, Some(own.bars.last().unwrap().c));
    }
}

#[test]
fn a_market_that_comes_back_to_the_others_is_heard_at_once() {
    // `a` sits 1% off for 60 buckets, then quotes what the others do. It keeps no record of
    // having been away: its weight is what its price says now.
    let sources = [
        series(
            "a",
            1,
            0..120,
            1.0,
            |i, p| if i < 60 { p * 1.01 } else { p },
        ),
        plain("b", 2, 0..120, 1.0),
        plain("c", 3, 0..120, 1.0),
    ];
    let got = run(&sources);
    let away = at(&got, 59).members[0].share;
    let back = at(&got, 61).members[0].share;
    assert!(away < 0.05, "while away it carries {away}");
    assert!(back > 0.25, "one bucket after it is back it carries {back}");
}

#[test]
fn no_bar_when_no_source_has_one() {
    let sources = [
        Source {
            id: "a".into(),
            weight: 1.0,
            read: true,
            bars: vec![px(0, 100.0), px(1, 100.0), px(10, 100.0)],
        },
        Source {
            id: "b".into(),
            weight: 1.0,
            read: true,
            bars: vec![px(0, 100.0), px(1, 100.0), px(10, 100.0)],
        },
    ];
    let got = run(&sources);
    assert_eq!(
        got.iter().map(|b| (b.t - T0) / MIN).collect::<Vec<_>>(),
        [0, 1, 10]
    );
    // Bucket 10: both are fresh again, even though both were stale in between.
    assert!(got[2].members.iter().all(|m| m.state == MemberState::Used));
}

#[test]
fn two_markets_far_apart_leave_the_stronger_one_speaking() {
    let a = Source {
        id: "a".into(),
        weight: 2.0,
        read: true,
        bars: (0..30).map(|i| px(i, 100.0)).collect(),
    };
    let b = Source {
        id: "b".into(),
        weight: 1.0,
        read: true,
        bars: (0..30).map(|i| px(i, 108.0)).collect(),
    };
    let got = run(&[a, b]);
    let last = got.last().unwrap();
    assert!(rel(last.c, 100.0) < 1e-9, "{}", last.c);
    assert_eq!(last.members[0].state, MemberState::Used);
    assert_eq!(last.members[1].state, MemberState::Outlier);
}

#[test]
fn min_sources_withholds_a_bar_that_one_market_alone_would_make() {
    let sources = [plain("a", 1, 0..20, 1.0), plain("b", 2, 10..20, 1.0)];
    let strict = Params {
        min_sources: 2,
        ..Params::default()
    };
    let got = consensus(&sources, MIN, &strict).unwrap();
    assert_eq!(got.first().map(|b| (b.t - T0) / MIN), Some(10));
}

#[test]
fn a_new_source_fades_in_over_the_ramp() {
    let sources = [plain("a", 1, 0..40, 1.0), plain("b", 2, 20..40, 1.0)];
    let got = run(&sources);
    let shares: Vec<f64> = (20..26).map(|i| at(&got, i).members[1].share).collect();
    assert!(shares.windows(2).all(|w| w[0] < w[1]), "{shares:?}");
    assert!(shares[0] < 0.2 && shares[5] > 0.35, "{shares:?}");
}

#[test]
fn bars_that_open_a_few_seconds_apart_meet_in_one_bucket() {
    let mut b = plain("b", 2, 0..10, 1.0);
    for x in &mut b.bars {
        x.t += 7_000;
    }
    let got = run(&[plain("a", 1, 0..10, 1.0), b]);
    assert_eq!(got.len(), 10);
    assert!(
        got.iter()
            .all(|x| x.members.iter().all(|m| m.state == MemberState::Used))
    );
}

#[test]
fn unusable_bars_are_ignored_not_averaged() {
    let mut a = plain("a", 1, 0..10, 1.0);
    a.bars[5].c = f64::NAN;
    a.bars[6].o = -3.0;
    let got = run(&[a, plain("b", 2, 0..10, 1.0)]);
    assert_eq!(at(&got, 5).members[0].state, MemberState::Carried);
    assert!(got.iter().all(|b| b.c.is_finite() && b.c > 0.0));
}

#[test]
fn a_page_of_history_equals_the_same_buckets_of_a_longer_one() {
    let params = Params::default();
    let full = [
        plain("a", 1, 0..400, 1.002),
        plain("b", 2, 0..400, 1.0),
        series("c", 3, 100..400, 0.996, |_, p| p),
    ];
    let whole = consensus(&full, MIN, &params).unwrap();
    // A caller that wants buckets 300..400 asks each source for `warmup_buckets` more.
    let from = 300 - params.warmup_buckets() as i64;
    let page: Vec<Source> = full
        .iter()
        .map(|s| Source {
            bars: s
                .bars
                .iter()
                .copied()
                .filter(|b| b.t >= T0 + from * MIN)
                .collect(),
            ..s.clone()
        })
        .collect();
    let paged = consensus(&page, MIN, &params).unwrap();
    for i in 300..400 {
        let (x, y) = (at(&whole, i), at(&paged, i));
        assert!(
            (x.c - y.c).abs() < 1e-9 && (x.h - y.h).abs() < 1e-9,
            "bucket {i}: {} vs {}",
            x.c,
            y.c
        );
    }
}

#[test]
fn parameters_the_arithmetic_cannot_take_are_refused() {
    let bad = [
        Params {
            deviation_scale: 0.0,
            ..Params::default()
        },
        Params {
            recency_half_life_buckets: f64::NAN,
            ..Params::default()
        },
        Params {
            outlier_limit: 0.0001,
            ..Params::default()
        },
        Params {
            entry_ramp_buckets: 0,
            ..Params::default()
        },
        Params {
            iterations: 0,
            ..Params::default()
        },
        Params {
            min_sources: 0,
            ..Params::default()
        },
    ];
    for p in &bad {
        assert!(p.validate().is_err(), "{p:?}");
        assert!(consensus(&[], MIN, p).is_err());
    }
    assert!(Params::default().validate().is_ok());
    assert!(consensus(&[], 0, &Params::default()).is_err());
    assert!(consensus(&[], MIN, &Params::default()).unwrap().is_empty());
}

// ---- reading the parameters from the environment ----------------------------------------------

fn env(pairs: &'static [(&'static str, &'static str)]) -> impl Fn(&str) -> Option<String> {
    move |k| {
        pairs
            .iter()
            .find(|(n, _)| *n == k)
            .map(|(_, v)| (*v).to_owned())
    }
}

#[test]
fn the_environment_overrides_the_defaults_and_nothing_else() {
    assert_eq!(Params::from_lookup(|_| None).unwrap(), Params::default());
    let p = Params::from_lookup(env(&[
        ("CONSENSUS_DEVIATION_SCALE", "0.004"),
        ("CONSENSUS_OUTLIER_LIMIT", "0.05"),
        ("CONSENSUS_MIN_SOURCES", " 2 "),
        ("CONSENSUS_ITERATIONS", ""),
    ]))
    .unwrap();
    assert_eq!(p.deviation_scale, 0.004);
    assert_eq!(p.outlier_limit, 0.05);
    assert_eq!(p.min_sources, 2);
    assert_eq!(p.iterations, Params::default().iterations);
}

#[test]
fn a_tuning_value_that_cannot_be_read_or_is_out_of_range_is_an_error() {
    for pairs in [
        &[("CONSENSUS_DEVIATION_SCALE", "wide")][..],
        &[("CONSENSUS_STALE_AFTER_BUCKETS", "soon")][..],
        &[("CONSENSUS_ENTRY_RAMP_BUCKETS", "-3")][..],
        &[("CONSENSUS_OUTLIER_LIMIT", "0.0001")][..],
    ] {
        let pairs: &'static [(&str, &str)] = Box::leak(pairs.to_vec().into_boxed_slice());
        let err = Params::from_lookup(env(pairs)).unwrap_err();
        assert!(!err.0.is_empty());
    }
}

#[test]
fn buckets_open_where_the_caller_says_not_at_a_multiple_of_the_epoch() {
    // Weeks open on a Monday and the epoch was a Thursday: a Monday 2026-11-16 00:00 UTC bar must
    // stay on its Monday, not move back four days to the epoch's own week boundary.
    const DAY: i64 = 24 * 60 * MIN;
    const WEEK: i64 = 7 * DAY;
    const MONDAY: i64 = 1_794_787_200_000; // 2026-11-16 00:00 UTC
    let week = |id: &str, price: f64| Source {
        id: id.into(),
        weight: 1.0,
        read: true,
        bars: (0..3)
            .map(|i| Bar {
                t: MONDAY + i * WEEK,
                ..px(0, price)
            })
            .collect(),
    };
    let sources = [week("a", 100.0), week("b", 100.1)];
    let aligned = consensus_aligned(&sources, WEEK, -3 * DAY, &Params::default()).unwrap();
    let times: Vec<i64> = aligned.iter().map(|b| b.t).collect();
    assert_eq!(times, vec![MONDAY, MONDAY + WEEK, MONDAY + 2 * WEEK]);
    // Without the origin the same bars land on Thursdays: that is what the origin is for.
    let epoch = consensus(&sources, WEEK, &Params::default()).unwrap();
    assert_eq!(epoch[0].t, MONDAY - 4 * DAY);
}

// ---- the two strategies behind one trait ------------------------------------------------------

mod strategies {
    use super::*;

    fn request(sources: &[Source], now_bucket: i64) -> Request<'_> {
        Request {
            sources,
            bucket_ms: MIN,
            origin_ms: 0,
            now_ms: T0 + now_bucket * MIN,
            previous: None,
        }
    }

    #[test]
    fn one_request_serves_either_strategy() {
        let sources = [
            plain("okx", 1, 0..60, 1.0),
            plain("bitget", 2, 0..60, 1.001),
            plain("hl", 3, 0..60, 0.999),
        ];
        let strategies: [&dyn Aggregator; 2] = [&Failover::default(), &Consensus::default()];
        let [failover, consensus] =
            strategies.map(|s| s.aggregate(&request(&sources, 59)).expect("valid"));
        assert_eq!(failover.strategy, StrategyName::Failover);
        assert_eq!(consensus.strategy, StrategyName::Consensus);
        assert_eq!(failover.bars.len(), 60);
        assert_eq!(consensus.bars.len(), 60);
        // The failover is the primary's candles, untouched; the consensus is the weighted mix of all three.
        assert_eq!(failover.bars[30].c, sources[0].bars[30].c);
        assert_ne!(consensus.bars[30].c, sources[0].bars[30].c);
        assert!(
            consensus.bars[30]
                .members
                .iter()
                .all(|m| m.state == MemberState::Used)
        );
        assert_eq!((consensus.served_by, consensus.label), (None, None));
        assert_eq!((failover.served_by, failover.label), (Some(0), Some(0)));
    }

    #[test]
    fn they_agree_on_what_a_source_with_nothing_is() {
        let sources = [Source::new("a", vec![]), Source::new("b", vec![])];
        for s in [
            &Failover::default() as &dyn Aggregator,
            &Consensus::default(),
        ] {
            let got = s.aggregate(&request(&sources, 5)).expect("valid");
            assert!(got.bars.is_empty());
            assert_eq!(got.empty, Some(EmptyReason::NoData), "{:?}", s.name());
        }
    }

    #[test]
    fn a_bad_request_is_refused_by_both() {
        let bad = Request {
            sources: &[],
            bucket_ms: -1,
            origin_ms: 0,
            now_ms: 0,
            previous: None,
        };
        assert!(Failover::default().aggregate(&bad).is_err());
        assert!(Consensus::default().aggregate(&bad).is_err());
        assert!(
            Consensus::new(Params {
                iterations: 0,
                ..Params::default()
            })
            .is_err()
        );
    }

    #[test]
    fn an_aggregate_is_a_source_for_the_next_strategy() {
        // Two venue groups, each a consensus; then a failover across the groups.
        let eu = [plain("eu1", 1, 0..60, 1.0), plain("eu2", 2, 0..60, 1.001)];
        let us = [plain("us1", 3, 0..60, 1.002), plain("us2", 4, 0..60, 1.003)];
        let group = |sources: &[Source], id: &str| {
            Consensus::default()
                .aggregate(&request(sources, 59))
                .expect("valid")
                .into_source(id)
        };
        let (eu_group, us_group) = (group(&eu, "eu"), group(&us, "us"));
        assert_eq!(eu_group.bars.len(), 60);
        assert!(eu_group.read && eu_group.weight == 1.0);
        let up = [eu_group.clone(), us_group.clone()];
        let got = Failover::default()
            .aggregate(&request(&up, 59))
            .expect("valid");
        assert_eq!(got.served_by, Some(0));
        assert_eq!(got.bars[10].c, eu_group.bars[10].c);
        // The first group goes quiet: the second serves.
        let quiet = [Source::new("eu", eu_group.bars[..20].to_vec()), us_group];
        assert_eq!(
            Failover::default()
                .aggregate(&request(&quiet, 59))
                .expect("valid")
                .served_by,
            Some(1)
        );
    }

    #[test]
    fn a_quote_goes_through_the_same_rules_as_candles() {
        // A midpoint with no history: `buckets` flat bars ending in the bucket of the quote.
        let mid = Source::quote("rh", 100.0, T0 + 59 * MIN + 31_000, MIN, 0, 9);
        assert_eq!(mid.bars.len(), 9);
        assert_eq!(mid.bars.last().map(|b| b.t), Some(T0 + 59 * MIN));
        assert_eq!(mid.bars.first().map(|b| b.t), Some(T0 + 51 * MIN));
        assert!(mid.bars.iter().all(|b| b.c == 100.0 && b.v == 0.0));
        let sources = [plain("a", 1, 0..60, 1.0), plain("b", 2, 0..60, 1.0), mid];
        let got = Consensus::default()
            .aggregate(&request(&sources, 59))
            .expect("valid");
        let last = got.latest().expect("a bar");
        assert_eq!(last.members[2].state, MemberState::Used);
        assert!(
            last.members[2].share > 0.2,
            "fully in after the ramp: {}",
            last.members[2].share
        );
        // An old quote fades and is dropped, like a market that went quiet.
        let old = Source::quote("rh", 100.0, T0 + 50 * MIN, MIN, 0, 9);
        let sources = [plain("a", 1, 0..60, 1.0), old];
        let got = Consensus::default()
            .aggregate(&request(&sources, 59))
            .expect("valid");
        assert_eq!(
            got.latest().expect("a bar").members[1].state,
            MemberState::Stale
        );
    }

    #[test]
    fn the_age_of_the_newest_bar_is_reported() {
        let sources = [plain("a", 1, 0..60, 1.0)];
        let got = Consensus::default()
            .aggregate(&request(&sources, 59))
            .expect("valid");
        assert_eq!(got.age_buckets(T0 + 59 * MIN + 59_000, MIN, 0), Some(0));
        assert_eq!(got.age_buckets(T0 + 64 * MIN, MIN, 0), Some(5));
        assert_eq!(
            got.age_buckets(T0, MIN, 0),
            Some(0),
            "a clock behind the data is not negative"
        );
        assert_eq!(
            Aggregate {
                bars: vec![],
                ..got
            }
            .age_buckets(0, MIN, 0),
            None
        );
    }

    #[test]
    fn the_same_sources_in_any_order_give_the_same_consensus() {
        let a = [
            plain("a", 1, 0..80, 1.002),
            plain("b", 2, 0..80, 1.0),
            plain("c", 3, 10..80, 0.997),
        ];
        let b = [a[2].clone(), a[0].clone(), a[1].clone()];
        let x = Consensus::default()
            .aggregate(&request(&a, 79))
            .expect("valid");
        let y = Consensus::default()
            .aggregate(&request(&b, 79))
            .expect("valid");
        for (p, q) in x.bars.iter().zip(&y.bars) {
            assert!((p.c - q.c).abs() < 1e-9 && (p.v - q.v).abs() < 1e-9);
        }
    }
}
