// Copyright 2026 SUPER SOLUTION LABS INC
//! Document storage for Super Chart's sync protocol (`docs/SYNC-PROTOCOL.md` in the `super-chart` repository).
//!
//! A *document* is an opaque text under an id the app chooses, owned by one person. The server assigns a revision that
//! goes up by one on every accepted write; a write names the revision it was made from and is refused, with the current
//! document, when someone wrote since. The server never interprets the text.
//!
//! * [`store`]: the [`store::DocStore`] trait, an in-memory store (development, tests) and, with the `postgres`
//!   feature, [`pg::PgStore`].
//! * [`auth`]: who is asking and who owns what: [`auth::Authenticator`], static tokens from a file and signed
//!   tokens an app mints for each person.
//! * [`http`]: the HTTP binding of the protocol as an `axum` router.
//! * [`limits`] and [`ratelimit`]: the bounds on ids, documents and request rate.
//!
//! The crate is a library: it opens no socket and reads no environment. A service builds an [`http::AppState`] (a store,
//! an authenticator, a rate limiter and [`http::Settings`]), calls [`http::router`] and serves or nests the result in its
//! own `axum` application. `examples/embed.rs` is a complete small server.

#![cfg_attr(test, allow(clippy::expect_used))]

pub mod auth;
pub mod http;
pub mod limits;
#[cfg(feature = "postgres")]
pub mod pg;
pub mod ratelimit;
pub mod store;
