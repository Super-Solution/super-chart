// Copyright 2026 SUPER SOLUTION LABS INC
//! Postgres storage. The write is one statement, so the protocol's compare-and-set is atomic in the database and no
//! application lock is needed:
//!
//! * replace: `UPDATE ... SET revision = revision + 1 WHERE owner = $1 AND id = $2 AND revision = $base`
//! * create: `INSERT ... ON CONFLICT DO NOTHING`
//!
//! The text is stored as `bytea` so it comes back byte for byte (Postgres `text` cannot hold U+0000, which JSON can).

use sqlx::Row as _;
use sqlx::postgres::{PgPool, PgPoolOptions};
use std::time::Duration;

use crate::store::{DocStore, Put, Record, StoreError};

/// Creates the table. Idempotent. Run by [`PgStore::migrate`], never by the router on its own.
pub const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS chart_docs (
    owner      text        NOT NULL,
    id         text        NOT NULL,
    revision   bigint      NOT NULL CHECK (revision >= 1),
    body       bytea       NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner, id)
)";

pub struct PgStore {
    pool: PgPool,
}

fn fail(e: sqlx::Error) -> StoreError {
    StoreError(e.to_string())
}

impl PgStore {
    pub async fn connect(url: &str, max_connections: u32) -> Result<Self, StoreError> {
        let pool = PgPoolOptions::new()
            .max_connections(max_connections)
            .acquire_timeout(Duration::from_secs(5))
            .connect(url)
            .await
            .map_err(fail)?;
        Ok(Self { pool })
    }

    pub fn from_pool(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Creates the table. Safe to run from several processes at once: `CREATE TABLE IF NOT EXISTS` alone can fail when
    /// two sessions race, so the statement runs under an advisory lock held for the transaction.
    pub async fn migrate(&self) -> Result<(), StoreError> {
        let mut tx = self.pool.begin().await.map_err(fail)?;
        sqlx::query("SELECT pg_advisory_xact_lock($1)")
            .bind(MIGRATE_LOCK)
            .execute(&mut *tx)
            .await
            .map_err(fail)?;
        sqlx::query(SCHEMA).execute(&mut *tx).await.map_err(fail)?;
        tx.commit().await.map_err(fail)
    }
}

/// The advisory lock key of `migrate` (the bytes of "chrtdocs").
const MIGRATE_LOCK: i64 = 0x6368_7274_646f_6373;

fn record(row: &sqlx::postgres::PgRow) -> Result<Record, StoreError> {
    let revision: i64 = row.try_get("revision").map_err(fail)?;
    let body: Vec<u8> = row.try_get("body").map_err(fail)?;
    let document = String::from_utf8(body)
        .map_err(|e| StoreError(format!("stored document is not UTF-8: {e}")))?;
    Ok(Record { revision, document })
}

impl DocStore for PgStore {
    async fn get(&self, owner: &str, id: &str) -> Result<Option<Record>, StoreError> {
        let row = sqlx::query("SELECT revision, body FROM chart_docs WHERE owner = $1 AND id = $2")
            .bind(owner)
            .bind(id)
            .fetch_optional(&self.pool)
            .await
            .map_err(fail)?;
        row.as_ref().map(record).transpose()
    }

    async fn put(
        &self,
        owner: &str,
        id: &str,
        document: &str,
        base: i64,
        max_docs: usize,
    ) -> Result<Put, StoreError> {
        if base == 0 {
            // The cap is checked in the same statement as the insert; a race can let a few documents past it, which is
            // fine for a quota and keeps the common path to one round trip.
            let cap = i64::try_from(max_docs).unwrap_or(i64::MAX);
            let inserted = sqlx::query(
                "INSERT INTO chart_docs (owner, id, revision, body)
                 SELECT $1, $2, 1, $3 WHERE (SELECT count(*) FROM chart_docs WHERE owner = $1) < $4
                 ON CONFLICT (owner, id) DO NOTHING",
            )
            .bind(owner)
            .bind(id)
            .bind(document.as_bytes())
            .bind(cap)
            .execute(&self.pool)
            .await
            .map_err(fail)?
            .rows_affected();
            if inserted == 1 {
                return Ok(Put::Saved(1));
            }
            // Nothing inserted: it already exists (a conflict), or the owner is at the cap.
            return Ok(match self.get(owner, id).await? {
                Some(current) => Put::Conflict(Some(current)),
                None => Put::TooMany,
            });
        }
        let updated = sqlx::query(
            "UPDATE chart_docs SET revision = revision + 1, body = $3, updated_at = now()
             WHERE owner = $1 AND id = $2 AND revision = $4 RETURNING revision",
        )
        .bind(owner)
        .bind(id)
        .bind(document.as_bytes())
        .bind(base)
        .fetch_optional(&self.pool)
        .await
        .map_err(fail)?;
        match updated {
            Some(row) => Ok(Put::Saved(row.try_get("revision").map_err(fail)?)),
            None => Ok(Put::Conflict(self.get(owner, id).await?)),
        }
    }

    async fn ping(&self) -> Result<(), StoreError> {
        // Also proves the table exists, so a deploy that skipped `migrate` is not ready.
        sqlx::query("SELECT 1 FROM chart_docs LIMIT 1")
            .execute(&self.pool)
            .await
            .map(|_| ())
            .map_err(fail)
    }
}
