// Copyright 2026 SUPER SOLUTION LABS INC
//! A complete small server: the sync protocol over an in-memory store with one static token.
//!
//! ```text
//! SYNC_TOKEN=any-long-random-secret cargo run -p super-chart-docs --example embed
//! curl -i -X PUT localhost:8088/v1/docs/drawings%2FBTC -H "authorization: Bearer $SYNC_TOKEN" \
//!   -H 'content-type: application/json' -H 'if-none-match: *' -d '{"document":"hello"}'
//! ```
//!
//! The documents are lost when it stops. A real service uses `PgStore` (or its own `DocStore`) and mints
//! per-person tokens; see the crate README.
#![allow(clippy::expect_used)]

use std::sync::Arc;
use std::time::Duration;

use sha2::{Digest, Sha256};
use super_chart_docs::auth::StaticTokens;
use super_chart_docs::http::{AppState, Settings, router};
use super_chart_docs::ratelimit::RateLimiter;
use super_chart_docs::store::MemoryStore;

#[tokio::main]
async fn main() {
    let secret = std::env::var("SYNC_TOKEN").expect("set SYNC_TOKEN to a long random secret");
    let hash: String = Sha256::digest(secret.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    let tokens = StaticTokens::parse(
        &format!(r#"{{"tokens":[{{"id":"example","sha256":"{hash}"}}]}}"#),
        5.0,
        20,
    )
    .expect("token file");
    let state = Arc::new(AppState {
        store: MemoryStore::new(),
        auth: Box::new(tokens),
        limiter: RateLimiter::new(),
        settings: Settings {
            max_document_bytes: 3 * 1024 * 1024,
            max_docs_per_owner: 2000,
            allowed_origins: vec![],
            concurrency: 256,
            request_timeout: Duration::from_secs(15),
        },
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:8088")
        .await
        .expect("bind");
    axum::serve(listener, router(state)).await.expect("serve");
}
