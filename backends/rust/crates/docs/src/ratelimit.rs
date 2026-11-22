// Copyright 2026 SUPER SOLUTION LABS INC
//! A token bucket per owner, in memory. Bounded: it forgets the quietest owners when it grows.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

const MAX_OWNERS: usize = 10_000;

struct Bucket {
    tokens: f64,
    last: Instant,
}

pub struct RateLimiter {
    buckets: Mutex<HashMap<String, Bucket>>,
}

impl Default for RateLimiter {
    fn default() -> Self {
        Self::new()
    }
}

impl RateLimiter {
    pub fn new() -> Self {
        Self {
            buckets: Mutex::new(HashMap::new()),
        }
    }

    /// Takes one token for `owner`, filling at `rps` per second up to `burst`. `Err` carries how long until one is
    /// available.
    pub fn take(&self, owner: &str, rps: f64, burst: u32, now: Instant) -> Result<(), Duration> {
        let burst = f64::from(burst.max(1));
        let rps = if rps.is_finite() && rps > 0.0 {
            rps
        } else {
            0.001
        };
        let Ok(mut buckets) = self.buckets.lock() else {
            // A poisoned lock must not take the service down; refuse rather than allow unbounded work.
            return Err(Duration::from_secs(1));
        };
        if buckets.len() >= MAX_OWNERS && !buckets.contains_key(owner) {
            // Drop the buckets that have been full the longest: they are the owners that have been quiet.
            let mut by_age: Vec<(String, Instant)> =
                buckets.iter().map(|(k, b)| (k.clone(), b.last)).collect();
            by_age.sort_by_key(|(_, last)| *last);
            for (key, _) in by_age.into_iter().take(MAX_OWNERS / 10) {
                buckets.remove(&key);
            }
        }
        let bucket = buckets.entry(owner.to_owned()).or_insert(Bucket {
            tokens: burst,
            last: now,
        });
        let elapsed = now.saturating_duration_since(bucket.last).as_secs_f64();
        bucket.tokens = (bucket.tokens + elapsed * rps).min(burst);
        bucket.last = now;
        if bucket.tokens >= 1.0 {
            bucket.tokens -= 1.0;
            Ok(())
        } else {
            Err(Duration::from_secs_f64((1.0 - bucket.tokens) / rps))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn burst_then_refill() {
        let limiter = RateLimiter::new();
        let t0 = Instant::now();
        assert!(limiter.take("a", 1.0, 2, t0).is_ok());
        assert!(limiter.take("a", 1.0, 2, t0).is_ok());
        let wait = limiter.take("a", 1.0, 2, t0).expect_err("empty");
        assert!(
            wait > Duration::from_millis(900) && wait <= Duration::from_secs(1),
            "{wait:?}"
        );
        assert!(
            limiter
                .take("a", 1.0, 2, t0 + Duration::from_millis(1100))
                .is_ok()
        );
        // The bucket never holds more than the burst, however long the owner was quiet.
        let later = t0 + Duration::from_secs(3600);
        assert!(limiter.take("a", 1.0, 2, later).is_ok());
        assert!(limiter.take("a", 1.0, 2, later).is_ok());
        assert!(limiter.take("a", 1.0, 2, later).is_err());
    }

    #[test]
    fn owners_do_not_share() {
        let limiter = RateLimiter::new();
        let t0 = Instant::now();
        assert!(limiter.take("a", 0.1, 1, t0).is_ok());
        assert!(limiter.take("a", 0.1, 1, t0).is_err());
        assert!(limiter.take("b", 0.1, 1, t0).is_ok());
    }

    #[test]
    fn memory_stays_bounded() {
        let limiter = RateLimiter::new();
        let t0 = Instant::now();
        for i in 0..(MAX_OWNERS + 5_000) {
            let _ = limiter.take(
                &format!("owner-{i}"),
                1.0,
                1,
                t0 + Duration::from_millis(i as u64),
            );
        }
        let len = limiter
            .buckets
            .lock()
            .map(|b| b.len())
            .unwrap_or(usize::MAX);
        assert!(len <= MAX_OWNERS, "{len}");
    }

    #[test]
    fn bad_rates_do_not_panic_or_open_the_gate() {
        let limiter = RateLimiter::new();
        let t0 = Instant::now();
        assert!(limiter.take("a", f64::NAN, 0, t0).is_ok());
        assert!(limiter.take("a", f64::NAN, 0, t0).is_err());
    }
}
