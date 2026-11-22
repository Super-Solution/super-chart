// Copyright 2026 SUPER SOLUTION LABS INC
//! The consensus's knobs. Every one is a plain number so it can be set from the environment, shown to an operator and
//! tuned against real data without touching the algorithm.

use std::fmt;

use serde::Serialize;

/// Tunable parameters of the consensus. [`Params::default`] is the first proposal, not a final answer:
/// `docs/CONSENSUS.md` says why each number is what it is and which of them are open questions.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Params {
    /// A source whose last bar is more than this many buckets old is *stale*: it no longer counts.
    /// Younger than that and older than the current bucket, its last close is carried forward.
    pub stale_after_buckets: u32,
    /// A carried source's recency weight halves every this many buckets.
    pub recency_half_life_buckets: f64,
    /// The relative deviation from the consensus at which a source's deviation weight is one half
    /// (`0.002` is 20 basis points). The weight is `1 / (1 + (d / scale)^2)`.
    pub deviation_scale: f64,
    /// Past this relative deviation from the consensus a source is an *outlier* and has no weight.
    pub outlier_limit: f64,
    /// A source reaches full weight after this many observations; before, its weight is the
    /// fraction `observations / entry_ramp_buckets`.
    pub entry_ramp_buckets: u32,
    /// How many times the consensus is recomputed with weights taken against the previous
    /// estimate. Three is enough for the weights to settle.
    pub iterations: u32,
    /// A bucket with fewer *used* sources than this has no consensus bar.
    pub min_sources: usize,
}

impl Default for Params {
    fn default() -> Self {
        Self {
            stale_after_buckets: 3,
            recency_half_life_buckets: 1.5,
            deviation_scale: 0.002,
            outlier_limit: 0.03,
            entry_ramp_buckets: 6,
            iterations: 3,
            min_sources: 1,
        }
    }
}

/// A parameter outside the range the algorithm is defined on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParamError(pub String);

impl fmt::Display for ParamError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for ParamError {}

impl Params {
    /// Reject what the arithmetic cannot take: a non-positive scale divides by zero, a negative
    /// window has no meaning, a limit below the scale would exclude a source before it is merely
    /// down-weighted.
    pub fn validate(&self) -> Result<(), ParamError> {
        let positive = |name: &str, v: f64| {
            if v.is_finite() && v > 0.0 {
                Ok(())
            } else {
                Err(ParamError(format!("{name} must be a positive number")))
            }
        };
        positive("recency_half_life_buckets", self.recency_half_life_buckets)?;
        positive("deviation_scale", self.deviation_scale)?;
        positive("outlier_limit", self.outlier_limit)?;
        if self.outlier_limit < self.deviation_scale {
            return Err(ParamError(
                "outlier_limit must be at least deviation_scale".into(),
            ));
        }
        if self.entry_ramp_buckets == 0 {
            return Err(ParamError("entry_ramp_buckets must be at least 1".into()));
        }
        if self.iterations == 0 || self.iterations > 20 {
            return Err(ParamError("iterations must be between 1 and 20".into()));
        }
        if self.min_sources == 0 {
            return Err(ParamError("min_sources must be at least 1".into()));
        }
        Ok(())
    }

    /// How many buckets of history a bucket's consensus depends on: what a caller asks each
    /// source for beyond the buckets it wants back (the entry ramp and the stale horizon), so a
    /// page of history equals the same buckets of a longer page.
    pub fn warmup_buckets(&self) -> usize {
        self.entry_ramp_buckets as usize + self.stale_after_buckets as usize
    }
}

impl Params {
    /// The defaults with whatever `CONSENSUS_*` variables `get` knows about laid over them
    /// (`CONSENSUS_DEVIATION_SCALE=0.003`, `CONSENSUS_OUTLIER_LIMIT=0.05`, ...: the field's
    /// name in capitals), validated. A variable that is set and cannot be read is an error, never
    /// silently the default: a typo in a tuning value must not look like a tuned service.
    pub fn from_lookup(get: impl Fn(&str) -> Option<String>) -> Result<Self, ParamError> {
        Self::from_lookup_prefixed("CONSENSUS_", get)
    }

    /// [`Params::from_lookup`] with another variable prefix, for a host that runs several aggregators.
    pub fn from_lookup_prefixed(
        prefix: &str,
        get: impl Fn(&str) -> Option<String>,
    ) -> Result<Self, ParamError> {
        fn read<T: std::str::FromStr>(
            get: &impl Fn(&str) -> Option<String>,
            prefix: &str,
            name: &str,
            into: &mut T,
        ) -> Result<(), ParamError> {
            let key = format!("{prefix}{name}");
            if let Some(raw) = get(&key)
                .map(|v| v.trim().to_owned())
                .filter(|v| !v.is_empty())
            {
                *into = raw
                    .parse()
                    .map_err(|_| ParamError(format!("{key} is not a valid value: {raw:?}")))?;
            }
            Ok(())
        }
        let mut p = Params::default();
        read(
            &get,
            prefix,
            "STALE_AFTER_BUCKETS",
            &mut p.stale_after_buckets,
        )?;
        read(
            &get,
            prefix,
            "RECENCY_HALF_LIFE_BUCKETS",
            &mut p.recency_half_life_buckets,
        )?;
        read(&get, prefix, "DEVIATION_SCALE", &mut p.deviation_scale)?;
        read(&get, prefix, "OUTLIER_LIMIT", &mut p.outlier_limit)?;
        read(
            &get,
            prefix,
            "ENTRY_RAMP_BUCKETS",
            &mut p.entry_ramp_buckets,
        )?;
        read(&get, prefix, "ITERATIONS", &mut p.iterations)?;
        read(&get, prefix, "MIN_SOURCES", &mut p.min_sources)?;
        p.validate()?;
        Ok(p)
    }
}
