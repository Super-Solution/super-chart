// Copyright 2026 SUPER SOLUTION LABS INC
//! A rough cost of the two strategies: `cargo run --release -p super-chart-quotes --example bench`.
#![allow(clippy::expect_used)]

use std::time::Instant;

use super_chart_quotes::{Aggregator, Bar, Consensus, Failover, Request, Source};

const MIN: i64 = 60_000;
const T0: i64 = 1_767_225_600_000;

fn source(id: &str, seed: u64, bars: i64) -> Source {
    let mut x = seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1;
    Source::new(
        id,
        (0..bars)
            .map(|i| {
                x ^= x << 13;
                x ^= x >> 7;
                x ^= x << 17;
                let wobble = (x % 2001) as f64 / 1_000_000.0;
                let price = 100.0 * (1.0 + 0.004 * (i as f64 / 9.0).sin()) * (1.0 + wobble);
                Bar {
                    t: T0 + i * MIN,
                    o: price,
                    h: price * 1.0005,
                    l: price * 0.9995,
                    c: price,
                    v: 10.0,
                }
            })
            .collect(),
    )
}

fn time(name: &str, bars: i64, sources: usize, strategy: &dyn Aggregator) {
    let data: Vec<Source> = (0..sources)
        .map(|k| source(&format!("m{k}"), k as u64 + 1, bars))
        .collect();
    let request = Request {
        sources: &data,
        bucket_ms: MIN,
        origin_ms: 0,
        now_ms: T0 + bars * MIN,
        previous: None,
    };
    strategy.aggregate(&request).expect("valid"); // warm up
    let runs = 20;
    let started = Instant::now();
    for _ in 0..runs {
        std::hint::black_box(strategy.aggregate(&request).expect("valid"));
    }
    let per_run = started.elapsed() / runs;
    let per_bar = per_run.as_nanos() as f64 / bars as f64;
    println!(
        "{name:<10} {sources:>2} sources x {bars:>6} bars: {per_run:>10.2?} per call, {per_bar:>8.0} ns per aggregated bar"
    );
}

fn main() {
    for &(sources, bars) in &[
        (1, 1_000),
        (4, 1_000),
        (12, 1_000),
        (4, 10_000),
        (12, 10_000),
        (12, 100_000),
    ] {
        time("consensus", bars, sources, &Consensus::default());
    }
    for &(sources, bars) in &[(4, 1_000), (12, 10_000), (12, 100_000)] {
        time("failover", bars, sources, &Failover::default());
    }
}
