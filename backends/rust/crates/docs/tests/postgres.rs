// Copyright 2026 SUPER SOLUTION LABS INC
//! The Postgres store against a real database. Opt in with `CHART_DOCS_TEST_DATABASE_URL`, for example
//! `postgres://postgres@127.0.0.1:15499/chart_docs_test`; without it every test returns at once. Each test uses owners of
//! its own, so they can run in parallel and against a database that is already in use.

#![cfg(feature = "postgres")]
#![allow(clippy::expect_used)]

use std::time::{SystemTime, UNIX_EPOCH};

use super_chart_docs::pg::PgStore;
use super_chart_docs::store::{DocStore, Put, Record};

async fn store() -> Option<PgStore> {
    let url = std::env::var("CHART_DOCS_TEST_DATABASE_URL").ok()?;
    let store = PgStore::connect(&url, 8).await.expect("connect");
    store.migrate().await.expect("migrate");
    Some(store)
}

fn owner(name: &str) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    format!("test-{name}-{nanos}")
}

fn record(revision: i64, document: &str) -> Record {
    Record {
        revision,
        document: document.to_owned(),
    }
}

#[tokio::test]
async fn migrate_is_idempotent_and_ping_works() {
    let Some(store) = store().await else { return };
    store.migrate().await.expect("second migrate");
    store.ping().await.expect("ping");
}

#[tokio::test]
async fn create_replace_and_conflicts() {
    let Some(store) = store().await else { return };
    let o = owner("flow");
    assert_eq!(store.get(&o, "a").await.expect("get"), None);
    assert_eq!(
        store.put(&o, "a", "one", 0, 10).await.expect("put"),
        Put::Saved(1)
    );
    assert_eq!(
        store.get(&o, "a").await.expect("get"),
        Some(record(1, "one"))
    );
    assert_eq!(
        store.put(&o, "a", "two", 1, 10).await.expect("put"),
        Put::Saved(2)
    );
    // Stale base, and a second create.
    assert_eq!(
        store.put(&o, "a", "x", 1, 10).await.expect("put"),
        Put::Conflict(Some(record(2, "two")))
    );
    assert_eq!(
        store.put(&o, "a", "x", 0, 10).await.expect("put"),
        Put::Conflict(Some(record(2, "two")))
    );
    // Replacing what is not there.
    assert_eq!(
        store.put(&o, "nope", "x", 3, 10).await.expect("put"),
        Put::Conflict(None)
    );
    // Same text again is still a write: the revision goes up.
    assert_eq!(
        store.put(&o, "a", "two", 2, 10).await.expect("put"),
        Put::Saved(3)
    );
}

#[tokio::test]
async fn owners_and_ids_are_separate_keys() {
    let Some(store) = store().await else { return };
    let (a, b) = (owner("a"), owner("b"));
    store.put(&a, "x", "mine", 0, 10).await.expect("put");
    assert_eq!(store.get(&b, "x").await.expect("get"), None);
    assert_eq!(
        store.put(&b, "x", "yours", 0, 10).await.expect("put"),
        Put::Saved(1)
    );
    assert_eq!(
        store.get(&a, "x").await.expect("get"),
        Some(record(1, "mine"))
    );
    // Ids that differ only by case, whitespace, or a lookalike are different ids.
    for (i, id) in ["X", "x ", "x\u{200b}", "ｘ"].iter().enumerate() {
        assert_eq!(
            store.put(&a, id, "other", 0, 100).await.expect("put"),
            Put::Saved(1),
            "{i}"
        );
    }
}

#[tokio::test]
async fn text_comes_back_byte_for_byte() {
    let Some(store) = store().await else { return };
    let o = owner("bytes");
    for (i, text) in [
        "",
        " \n\t ",
        "a\u{0000}b",
        "日本 😀 e\u{0301}",
        "\u{feff}bom",
    ]
    .iter()
    .enumerate()
    {
        let id = format!("t{i}");
        assert_eq!(
            store.put(&o, &id, text, 0, 100).await.expect("put"),
            Put::Saved(1)
        );
        assert_eq!(
            store.get(&o, &id).await.expect("get"),
            Some(record(1, text)),
            "{text:?}"
        );
    }
}

#[tokio::test]
async fn the_document_cap_applies_to_creating_only() {
    let Some(store) = store().await else { return };
    let o = owner("cap");
    assert_eq!(
        store.put(&o, "a", "x", 0, 2).await.expect("put"),
        Put::Saved(1)
    );
    assert_eq!(
        store.put(&o, "b", "x", 0, 2).await.expect("put"),
        Put::Saved(1)
    );
    assert_eq!(
        store.put(&o, "c", "x", 0, 2).await.expect("put"),
        Put::TooMany
    );
    assert_eq!(
        store.put(&o, "a", "y", 1, 2).await.expect("put"),
        Put::Saved(2)
    );
    assert_eq!(
        store.put(&o, "a", "z", 0, 2).await.expect("put"),
        Put::Conflict(Some(record(2, "y"))),
        "a conflict, not a quota error"
    );
    assert_eq!(store.get(&o, "c").await.expect("get"), None);
}

#[tokio::test]
async fn racing_writers_have_one_winner_and_revisions_stay_gapless() {
    let Some(store) = store().await else { return };
    let store = std::sync::Arc::new(store);
    let o = owner("race");
    store.put(&o, "a", "base", 0, 10).await.expect("put");
    let mut tasks = Vec::new();
    for i in 0..32 {
        let (store, o) = (store.clone(), o.clone());
        tasks.push(tokio::spawn(async move {
            store
                .put(&o, "a", &format!("writer {i}"), 1, 10)
                .await
                .expect("put")
        }));
    }
    let mut saved = 0;
    for task in tasks {
        match task.await.expect("task") {
            Put::Saved(2) => saved += 1,
            Put::Conflict(Some(current)) => assert!(current.revision >= 2),
            other => panic!("unexpected {other:?}"),
        }
    }
    assert_eq!(saved, 1);
    // Racing creates too.
    let mut tasks = Vec::new();
    for i in 0..32 {
        let (store, o) = (store.clone(), o.clone());
        tasks.push(tokio::spawn(async move {
            store
                .put(&o, "fresh", &format!("w{i}"), 0, 100)
                .await
                .expect("put")
        }));
    }
    let mut created = 0;
    for task in tasks {
        if task.await.expect("task") == Put::Saved(1) {
            created += 1;
        }
    }
    assert_eq!(created, 1);
}

#[tokio::test]
async fn a_chain_of_writes_counts_up_by_one() {
    let Some(store) = store().await else { return };
    let o = owner("chain");
    let mut revision = 0;
    for i in 0..25 {
        let Put::Saved(next) = store
            .put(&o, "a", &format!("v{i}"), revision, 10)
            .await
            .expect("put")
        else {
            panic!("write {i}")
        };
        assert_eq!(next, revision + 1);
        revision = next;
    }
    assert_eq!(
        store.get(&o, "a").await.expect("get"),
        Some(record(25, "v24"))
    );
}
