// Copyright 2026 SUPER SOLUTION LABS INC
//! What a service needs around the arithmetic: where bars come from, reading them the way a strategy wants them read,
//! and sharing one read between many askers. There is still no network code here: an app implements [`QuoteSource`]
//! for its venues and brings its own HTTP client.

use std::collections::HashMap;
use std::fmt;
use std::future::Future;
use std::hash::Hash;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::sync::OnceCell;
use tokio::task::JoinSet;
use tokio::time::Instant;

use crate::aggregate::{Aggregate, Aggregator, FetchPlan, Request};
use crate::bar::{Bar, Source};
use crate::failover::newest_age;
use crate::params::ParamError;

/// What to ask a source for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Query {
    /// The width of a candle in milliseconds.
    pub bucket_ms: i64,
    /// The newest this many candles, oldest first in the answer. A consensus needs
    /// [`crate::Params::warmup_buckets`] more than the caller wants back.
    pub limit: usize,
    /// Only candles that opened before this time; `None` for up to now.
    pub to_ms: Option<i64>,
}

/// A source could not answer. The message is for the operator's log; show a client a fixed sentence.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceError(pub String);

impl fmt::Display for SourceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for SourceError {}

/// A market that can give candles. Implemented by the app, once per venue or feed: the library never opens a socket.
pub trait QuoteSource: Send + Sync + 'static {
    /// A stable name, echoed in every reading.
    fn id(&self) -> &str;
    /// A fixed weight for a consensus. 1 unless the app has a reason.
    fn weight(&self) -> f64 {
        1.0
    }
    fn bars(&self, query: &Query) -> impl Future<Output = Result<Vec<Bar>, SourceError>> + Send;
}

type BoxFuture<T> = Pin<Box<dyn Future<Output = T> + Send>>;

/// [`QuoteSource`] with its future boxed, so sources of different types can stand in one list. Implemented for every
/// `QuoteSource`; use [`erase`].
pub trait DynSource: Send + Sync + 'static {
    fn id(&self) -> &str;
    fn weight(&self) -> f64;
    fn bars(&self, query: Query) -> BoxFuture<Result<Vec<Bar>, SourceError>>;
}

struct Erased<S>(Arc<S>);

impl<S: QuoteSource> DynSource for Erased<S> {
    fn id(&self) -> &str {
        self.0.id()
    }
    fn weight(&self) -> f64 {
        self.0.weight()
    }
    fn bars(&self, query: Query) -> BoxFuture<Result<Vec<Bar>, SourceError>> {
        let source = self.0.clone();
        Box::pin(async move { source.bars(&query).await })
    }
}

/// A source in the form an [`Instrument`] holds.
pub fn erase<S: QuoteSource>(source: S) -> Arc<dyn DynSource> {
    Arc::new(Erased(Arc::new(source)))
}

/// Why a source gave nothing. For the operator; the aggregate already says what the client may be told.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceFailure {
    pub source: String,
    pub kind: FailureKind,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FailureKind {
    Timeout,
    Error(String),
    /// The source's task panicked.
    Panicked,
}

/// The result of reading an instrument.
#[derive(Debug, Clone, PartialEq)]
pub struct Read {
    pub aggregate: Aggregate,
    /// Sources that were asked and did not answer. They count as having no data in this read.
    pub failures: Vec<SourceFailure>,
    /// How many sources were asked. A primary-with-fallbacks read of a healthy primary is 1.
    pub asked: usize,
}

/// One instrument: its sources in priority order, and how long to wait for each.
pub struct Instrument {
    pub id: String,
    sources: Vec<Arc<dyn DynSource>>,
    timeout: Duration,
}

impl Instrument {
    pub fn new(id: impl Into<String>, sources: Vec<Arc<dyn DynSource>>) -> Self {
        Self {
            id: id.into(),
            sources,
            timeout: Duration::from_secs(5),
        }
    }

    /// How long one source may take before it counts as having no data (default 5 s).
    #[must_use]
    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }

    pub fn source_ids(&self) -> Vec<&str> {
        self.sources.iter().map(|s| s.id()).collect()
    }

    /// Reads the sources the way `aggregator` wants them read and aggregates. `origin_ms` is where buckets open (see
    /// [`Request::origin_ms`]); `previous` the id of the source this instrument was last read from.
    pub async fn read(
        &self,
        aggregator: &dyn Aggregator,
        query: Query,
        now_ms: i64,
        origin_ms: i64,
        previous: Option<&str>,
    ) -> Result<Read, ParamError> {
        let mut failures = Vec::new();
        let mut sources: Vec<Source> = Vec::with_capacity(self.sources.len());
        let mut asked = 0;
        match aggregator.fetch_plan() {
            FetchPlan::All => {
                let mut set = JoinSet::new();
                for (i, source) in self.sources.iter().enumerate() {
                    let (source, timeout) = (source.clone(), self.timeout);
                    set.spawn(async move {
                        (i, tokio::time::timeout(timeout, source.bars(query)).await)
                    });
                }
                asked = self.sources.len();
                let mut answers: Vec<Option<Result<Vec<Bar>, FailureKind>>> =
                    (0..self.sources.len()).map(|_| None).collect();
                while let Some(joined) = set.join_next().await {
                    match joined {
                        Ok((i, Ok(Ok(bars)))) => answers[i] = Some(Ok(bars)),
                        Ok((i, Ok(Err(e)))) => answers[i] = Some(Err(FailureKind::Error(e.0))),
                        Ok((i, Err(_elapsed))) => answers[i] = Some(Err(FailureKind::Timeout)),
                        Err(_panicked) => {} // its slot stays `None`, below
                    }
                }
                for (source, answer) in self.sources.iter().zip(answers) {
                    let mut out = Source::new(source.id(), Vec::new());
                    out.weight = source.weight();
                    match answer {
                        Some(Ok(bars)) => out.bars = bars,
                        Some(Err(kind)) => failures.push(SourceFailure {
                            source: source.id().to_owned(),
                            kind,
                        }),
                        None => failures.push(SourceFailure {
                            source: source.id().to_owned(),
                            kind: FailureKind::Panicked,
                        }),
                    }
                    sources.push(out);
                }
            }
            FetchPlan::UntilCurrent { max_age_buckets } => {
                let mut current = false;
                for source in &self.sources {
                    if current {
                        sources.push(Source::unread(source.id()));
                        continue;
                    }
                    asked += 1;
                    let task = tokio::spawn({
                        let (source, timeout) = (source.clone(), self.timeout);
                        async move { tokio::time::timeout(timeout, source.bars(query)).await }
                    });
                    let mut out = Source::new(source.id(), Vec::new());
                    match task.await {
                        Ok(Ok(Ok(bars))) => out.bars = bars,
                        Ok(Ok(Err(e))) => failures.push(SourceFailure {
                            source: source.id().to_owned(),
                            kind: FailureKind::Error(e.0),
                        }),
                        Ok(Err(_elapsed)) => failures.push(SourceFailure {
                            source: source.id().to_owned(),
                            kind: FailureKind::Timeout,
                        }),
                        Err(_panicked) => failures.push(SourceFailure {
                            source: source.id().to_owned(),
                            kind: FailureKind::Panicked,
                        }),
                    }
                    current = newest_age(&out.bars, query.bucket_ms, origin_ms, now_ms)
                        .is_some_and(|age| age <= max_age_buckets);
                    sources.push(out);
                }
            }
        }
        let aggregate = aggregator.aggregate(&Request {
            sources: &sources,
            bucket_ms: query.bucket_ms,
            origin_ms,
            now_ms,
            previous,
        })?;
        Ok(Read {
            aggregate,
            failures,
            asked,
        })
    }
}

// ---------------------------------------------------------------------------------------------------------------

struct Entry<V, E> {
    cell: Arc<OnceCell<Result<V, E>>>,
    created: Instant,
    ttl: Duration,
}

/// Answers kept for a few seconds and computed once however many ask at the same time.
///
/// A key's first asker computes; everyone who asks while it runs, or before its time is up, gets the same answer. An
/// **error is not kept**: the next asker tries again. If the asker that was computing goes away, a waiting one takes
/// over. The map is bounded: when it is full, expired entries go first, then the oldest.
pub struct SingleFlight<K, V, E> {
    entries: Mutex<HashMap<K, Entry<V, E>>>,
    max_entries: usize,
}

impl<K: Hash + Eq + Clone, V: Clone, E: Clone> SingleFlight<K, V, E> {
    pub fn new(max_entries: usize) -> Self {
        Self {
            entries: Mutex::new(HashMap::new()),
            max_entries: max_entries.max(1),
        }
    }

    pub fn len(&self) -> usize {
        self.entries.lock().map_or(0, |e| e.len())
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub async fn get_or_compute<F, Fut>(&self, key: K, ttl: Duration, compute: F) -> Result<V, E>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<V, E>>,
    {
        let cell = self.cell_for(&key, ttl);
        let result = cell.get_or_init(compute).await.clone();
        if result.is_err()
            && let Ok(mut entries) = self.entries.lock()
            && entries
                .get(&key)
                .is_some_and(|e| Arc::ptr_eq(&e.cell, &cell))
        {
            entries.remove(&key);
        }
        result
    }

    fn cell_for(&self, key: &K, ttl: Duration) -> Arc<OnceCell<Result<V, E>>> {
        let fresh = || Arc::new(OnceCell::new());
        let Ok(mut entries) = self.entries.lock() else {
            return fresh();
        };
        let now = Instant::now();
        if let Some(entry) = entries.get(key)
            && now.duration_since(entry.created) < entry.ttl
        {
            return entry.cell.clone();
        }
        if entries.len() >= self.max_entries {
            entries.retain(|_, e| now.duration_since(e.created) < e.ttl);
            while entries.len() >= self.max_entries {
                let Some(oldest) = entries
                    .iter()
                    .min_by_key(|(_, e)| e.created)
                    .map(|(k, _)| k.clone())
                else {
                    break;
                };
                entries.remove(&oldest);
            }
        }
        let cell = fresh();
        entries.insert(
            key.clone(),
            Entry {
                cell: cell.clone(),
                created: now,
                ttl,
            },
        );
        cell
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;
    use crate::aggregate::{EmptyReason, MemberState};
    use crate::consensus::Consensus;
    use crate::failover::Failover;

    const MIN: i64 = 60_000;
    const T0: i64 = 1_767_225_600_000;

    enum Behaviour {
        Bars(std::ops::Range<i64>, f64),
        Fail,
        Hang,
        Panic,
    }

    struct Fake {
        id: &'static str,
        behaviour: Behaviour,
        calls: Arc<AtomicUsize>,
    }

    impl QuoteSource for Fake {
        fn id(&self) -> &str {
            self.id
        }
        async fn bars(&self, query: &Query) -> Result<Vec<Bar>, SourceError> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            match &self.behaviour {
                Behaviour::Bars(range, price) => {
                    let wanted = query.limit;
                    let mut bars: Vec<Bar> = range
                        .clone()
                        .map(|i| Bar {
                            t: T0 + i * MIN,
                            ..Bar::flat(0, *price)
                        })
                        .collect();
                    let skip = bars.len().saturating_sub(wanted);
                    bars.drain(..skip);
                    Ok(bars)
                }
                Behaviour::Fail => Err(SourceError("503 from venue".into())),
                Behaviour::Hang => {
                    tokio::time::sleep(Duration::from_secs(3600)).await;
                    Ok(vec![])
                }
                Behaviour::Panic => panic!("adapter bug"),
            }
        }
    }

    fn fake(id: &'static str, behaviour: Behaviour) -> (Arc<dyn DynSource>, Arc<AtomicUsize>) {
        let calls = Arc::new(AtomicUsize::new(0));
        (
            erase(Fake {
                id,
                behaviour,
                calls: calls.clone(),
            }),
            calls,
        )
    }

    fn query() -> Query {
        Query {
            bucket_ms: MIN,
            limit: 100,
            to_ms: None,
        }
    }
    const NOW: i64 = T0 + 59 * MIN + 10_000;

    #[tokio::test]
    async fn a_healthy_primary_is_the_only_one_asked() {
        let (a, ca) = fake("a", Behaviour::Bars(0..60, 100.0));
        let (b, cb) = fake("b", Behaviour::Bars(0..60, 100.2));
        let instrument = Instrument::new("X", vec![a, b]);
        let read = instrument
            .read(&Failover::default(), query(), NOW, 0, None)
            .await
            .expect("read");
        assert_eq!(
            (
                ca.load(Ordering::SeqCst),
                cb.load(Ordering::SeqCst),
                read.asked
            ),
            (1, 0, 1)
        );
        assert_eq!(read.aggregate.served_by, Some(0));
        assert_eq!(
            read.aggregate.bars[0].members[1].state,
            MemberState::Standby
        );
        assert!(read.failures.is_empty());
    }

    #[tokio::test]
    async fn a_fallback_is_asked_when_the_primary_fails_times_out_panics_or_is_old() {
        for primary in [
            Behaviour::Fail,
            Behaviour::Hang,
            Behaviour::Panic,
            Behaviour::Bars(0..10, 100.0),
        ] {
            let failing = !matches!(primary, Behaviour::Bars(..));
            let (a, _) = fake("a", primary);
            let (b, cb) = fake("b", Behaviour::Bars(0..60, 100.2));
            let (c, cc) = fake("c", Behaviour::Bars(0..60, 99.0));
            let instrument =
                Instrument::new("X", vec![a, b, c]).with_timeout(Duration::from_millis(50));
            let read = instrument
                .read(&Failover::default(), query(), NOW, 0, None)
                .await
                .expect("read");
            assert_eq!(read.aggregate.served_by, Some(1));
            assert_eq!(
                (
                    cb.load(Ordering::SeqCst),
                    cc.load(Ordering::SeqCst),
                    read.asked
                ),
                (1, 0, 2)
            );
            assert_eq!(read.failures.len(), usize::from(failing));
            assert_eq!(
                read.aggregate.bars[0].members[2].state,
                MemberState::Standby,
                "the third was never asked"
            );
        }
    }

    #[tokio::test]
    async fn failure_kinds_are_reported_for_the_operator() {
        let (a, _) = fake("a", Behaviour::Fail);
        let (b, _) = fake("b", Behaviour::Hang);
        let (c, _) = fake("c", Behaviour::Panic);
        let instrument =
            Instrument::new("X", vec![a, b, c]).with_timeout(Duration::from_millis(50));
        let read = instrument
            .read(&Failover::default(), query(), NOW, 0, Some("b"))
            .await
            .expect("read");
        assert_eq!(
            read.failures,
            vec![
                SourceFailure {
                    source: "a".into(),
                    kind: FailureKind::Error("503 from venue".into())
                },
                SourceFailure {
                    source: "b".into(),
                    kind: FailureKind::Timeout
                },
                SourceFailure {
                    source: "c".into(),
                    kind: FailureKind::Panicked
                },
            ]
        );
        assert!(read.aggregate.bars.is_empty());
        assert_eq!(
            read.aggregate.label,
            Some(1),
            "the source last read keeps the label"
        );
        assert_eq!(read.aggregate.empty, Some(EmptyReason::NoData));
    }

    #[tokio::test]
    async fn a_consensus_asks_every_source_at_once_and_a_failure_is_just_no_data() {
        let (a, ca) = fake("a", Behaviour::Bars(0..60, 100.0));
        let (b, cb) = fake("b", Behaviour::Bars(0..60, 100.1));
        let (c, _) = fake("c", Behaviour::Fail);
        let (d, _) = fake("d", Behaviour::Panic);
        let instrument = Instrument::new("X", vec![a, b, c, d]);
        let read = instrument
            .read(&Consensus::default(), query(), NOW, 0, None)
            .await
            .expect("read");
        assert_eq!(
            (
                ca.load(Ordering::SeqCst),
                cb.load(Ordering::SeqCst),
                read.asked
            ),
            (1, 1, 4)
        );
        assert_eq!(read.failures.len(), 2);
        let last = read.aggregate.latest().expect("a bar");
        assert_eq!(last.members[0].state, MemberState::Used);
        assert_eq!(last.members[2].state, MemberState::NotListed);
        assert!((last.members[0].share + last.members[1].share - 1.0).abs() < 1e-9);
    }

    #[tokio::test(start_paused = true)]
    async fn sources_are_asked_concurrently() {
        // Three sources that each take two seconds, with a ten second limit: one read takes two seconds, not six.
        struct Slow(&'static str);
        impl QuoteSource for Slow {
            fn id(&self) -> &str {
                self.0
            }
            async fn bars(&self, _: &Query) -> Result<Vec<Bar>, SourceError> {
                tokio::time::sleep(Duration::from_secs(2)).await;
                Ok(vec![Bar::flat(T0, 100.0)])
            }
        }
        let instrument = Instrument::new(
            "X",
            vec![erase(Slow("a")), erase(Slow("b")), erase(Slow("c"))],
        )
        .with_timeout(Duration::from_secs(10));
        let started = Instant::now();
        instrument
            .read(&Consensus::default(), query(), NOW, 0, None)
            .await
            .expect("read");
        assert_eq!(started.elapsed(), Duration::from_secs(2));
    }

    // ---- single flight ------------------------------------------------------------------------

    #[tokio::test(start_paused = true)]
    async fn many_askers_share_one_computation_until_it_expires() {
        let flight: Arc<SingleFlight<&'static str, u32, String>> = Arc::new(SingleFlight::new(10));
        let computed = Arc::new(AtomicUsize::new(0));
        let ask = |flight: Arc<SingleFlight<&'static str, u32, String>>,
                   computed: Arc<AtomicUsize>| async move {
            flight
                .get_or_compute("k", Duration::from_secs(5), || async move {
                    computed.fetch_add(1, Ordering::SeqCst);
                    tokio::time::sleep(Duration::from_millis(100)).await;
                    Ok(7)
                })
                .await
        };
        let tasks: Vec<_> = (0..50)
            .map(|_| tokio::spawn(ask(flight.clone(), computed.clone())))
            .collect();
        for t in tasks {
            assert_eq!(t.await.expect("task"), Ok(7));
        }
        assert_eq!(computed.load(Ordering::SeqCst), 1);
        assert_eq!(ask(flight.clone(), computed.clone()).await, Ok(7));
        assert_eq!(computed.load(Ordering::SeqCst), 1, "still fresh");
        tokio::time::advance(Duration::from_secs(6)).await;
        assert_eq!(ask(flight.clone(), computed.clone()).await, Ok(7));
        assert_eq!(
            computed.load(Ordering::SeqCst),
            2,
            "expired, computed again"
        );
    }

    #[tokio::test]
    async fn an_error_is_not_kept() {
        let flight: SingleFlight<u8, u32, String> = SingleFlight::new(10);
        let tries = AtomicUsize::new(0);
        let attempt = || async {
            flight
                .get_or_compute(1, Duration::from_secs(60), || async {
                    if tries.fetch_add(1, Ordering::SeqCst) == 0 {
                        Err("down".to_owned())
                    } else {
                        Ok(5)
                    }
                })
                .await
        };
        assert_eq!(attempt().await, Err("down".to_owned()));
        assert_eq!(attempt().await, Ok(5));
        assert_eq!(attempt().await, Ok(5));
        assert_eq!(tries.load(Ordering::SeqCst), 2);
    }

    #[tokio::test(start_paused = true)]
    async fn different_keys_are_different_computations_and_the_map_is_bounded() {
        let flight: SingleFlight<u32, u32, String> = SingleFlight::new(4);
        for k in 0..20 {
            assert_eq!(
                flight
                    .get_or_compute(k, Duration::from_secs(60), || async move { Ok(k * 2) })
                    .await,
                Ok(k * 2)
            );
            tokio::time::advance(Duration::from_millis(10)).await;
        }
        assert_eq!(flight.len(), 4);
        // The newest survive.
        let hit = AtomicUsize::new(0);
        flight
            .get_or_compute(19, Duration::from_secs(60), || async {
                hit.fetch_add(1, Ordering::SeqCst);
                Ok(0)
            })
            .await
            .expect("ok");
        assert_eq!(hit.load(Ordering::SeqCst), 0);
    }

    #[tokio::test(start_paused = true)]
    async fn when_the_computing_asker_goes_away_a_waiting_one_takes_over() {
        let flight: Arc<SingleFlight<u8, u32, String>> = Arc::new(SingleFlight::new(10));
        let first = {
            let flight = flight.clone();
            tokio::spawn(async move {
                flight
                    .get_or_compute(1, Duration::from_secs(60), || async {
                        std::future::pending::<Result<u32, String>>().await
                    })
                    .await
            })
        };
        tokio::task::yield_now().await;
        let second = {
            let flight = flight.clone();
            tokio::spawn(async move {
                flight
                    .get_or_compute(1, Duration::from_secs(60), || async { Ok(9) })
                    .await
            })
        };
        tokio::task::yield_now().await;
        first.abort();
        assert_eq!(second.await.expect("task"), Ok(9));
    }
}
