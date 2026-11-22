// Copyright 2026 SUPER SOLUTION LABS INC
//! Where documents live. A store does the one thing the protocol needs to be atomic: compare the base revision and
//! write, as a single step.

use std::collections::HashMap;
use std::future::Future;
use std::sync::Mutex;

/// A stored document and its revision (1 or more).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Record {
    pub revision: i64,
    pub document: String,
}

/// The result of a write.
#[derive(Debug, PartialEq, Eq)]
pub enum Put {
    /// Stored; this is the new revision (the base plus one).
    Saved(i64),
    /// The base revision is not the stored one. Carries the stored record, or `None` when nothing is stored.
    Conflict(Option<Record>),
    /// A new document would exceed the owner's document limit.
    TooMany,
}

/// A store failure. The message is for the operator's log and never sent to a client.
#[derive(Debug)]
pub struct StoreError(pub String);

impl std::fmt::Display for StoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for StoreError {}

/// Storage for documents keyed by `(owner, id)`.
///
/// `put` MUST be atomic: two writes with the same base never both succeed, and the revision it stores is exactly
/// `base + 1`. There is no delete: a revision number is never reused for a different document.
pub trait DocStore: Send + Sync + 'static {
    fn get(
        &self,
        owner: &str,
        id: &str,
    ) -> impl Future<Output = Result<Option<Record>, StoreError>> + Send;

    /// `base` is 0 to create (only if nothing is stored) or the revision being replaced. `max_docs` limits how many
    /// documents the owner may hold; it is checked when creating.
    fn put(
        &self,
        owner: &str,
        id: &str,
        document: &str,
        base: i64,
        max_docs: usize,
    ) -> impl Future<Output = Result<Put, StoreError>> + Send;

    /// Whether the store can answer now (for `/readyz`).
    fn ping(&self) -> impl Future<Output = Result<(), StoreError>> + Send;
}

type Rows = HashMap<(String, String), Record>;

/// Documents in memory: for development and tests. Nothing survives a restart.
#[derive(Default)]
pub struct MemoryStore {
    rows: Mutex<Rows>,
}

impl MemoryStore {
    pub fn new() -> Self {
        Self::default()
    }

    fn rows(&self) -> Result<std::sync::MutexGuard<'_, Rows>, StoreError> {
        self.rows
            .lock()
            .map_err(|_| StoreError("memory store lock poisoned".into()))
    }
}

impl DocStore for MemoryStore {
    async fn get(&self, owner: &str, id: &str) -> Result<Option<Record>, StoreError> {
        Ok(self
            .rows()?
            .get(&(owner.to_owned(), id.to_owned()))
            .cloned())
    }

    async fn put(
        &self,
        owner: &str,
        id: &str,
        document: &str,
        base: i64,
        max_docs: usize,
    ) -> Result<Put, StoreError> {
        let mut rows = self.rows()?;
        let key = (owner.to_owned(), id.to_owned());
        let current = rows.get(&key).cloned();
        if current.as_ref().map_or(0, |r| r.revision) != base {
            return Ok(Put::Conflict(current));
        }
        if current.is_none() && rows.keys().filter(|(o, _)| o == owner).count() >= max_docs {
            return Ok(Put::TooMany);
        }
        let revision = base + 1;
        rows.insert(
            key,
            Record {
                revision,
                document: document.to_owned(),
            },
        );
        Ok(Put::Saved(revision))
    }

    async fn ping(&self) -> Result<(), StoreError> {
        self.rows().map(|_| ())
    }
}
