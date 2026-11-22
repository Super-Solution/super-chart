# super-chart Rust libraries

Libraries for the services that integrate Super Chart, in Rust. Unlike the `go/` and `python/` backends they are not
technical-analysis kernels (those stay TypeScript, Go and Python for now); they are the server-side pieces a product needs
around a chart. All code here is GPL-3.0-or-later; a commercial licence is available from SUPER SOLUTION LABS INC
(contact@supersolution.io).

| Crate | What it is |
| --- | --- |
| [`super-chart-docs`](crates/docs) | Saves the drawings and workspaces a chart keeps for a person: the server side of the [sync protocol](../../docs/SYNC-PROTOCOL.md). An `axum` router you embed, a `DocStore` trait with in-memory and Postgres stores, bearer-token authentication (static and signed), per-owner rate limits. |
| [`super-chart-quotes`](crates/quotes) | One price from several markets: primary-with-fallbacks and a weighted consensus behind one `Aggregator` trait, with a source adapter trait and a single-flight cache. No network code. |

Both are built and tested, and neither is published to crates.io (`publish = false`); a release needs the owner's separate
authorization.

Requires Rust 1.88 or newer (edition 2024).

```bash
cd backends/rust
cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace
# the Postgres tests run when a database is given; they use owners of their own
CHART_DOCS_TEST_DATABASE_URL=postgres://user@127.0.0.1:5432/chart_docs_test cargo test -p super-chart-docs
```
