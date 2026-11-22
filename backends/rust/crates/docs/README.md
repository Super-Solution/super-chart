# super-chart-docs

The server side of [Super Chart's sync protocol](../../../../docs/SYNC-PROTOCOL.md): it stores the documents a chart
saves for a person (their drawings, or a whole workspace). A *library*: you put its router into your own service, with your own
store, authentication and limits. One person, one document id, one revision. The server never reads the text; it only decides, atomically, whether a
write was made from the revision that is stored.

```
GET /v1/docs/{id}   200 {"revision":3,"document":"…"} + ETag "3"  |  404
PUT /v1/docs/{id}   If-None-Match: *  or  If-Match: "3",  body {"document":"…"}
                    201/200 {"revision":4}  |  412 {"current":{…}|null}  |  428 no precondition  |  413  |  400
GET /healthz        liveness (no credentials)
GET /readyz         the database answers and the table exists (no credentials)
```

The ids are percent-encoded as one path segment (`drawings%2FOKX%3ABTC-USDT`). Every other status, header and rule is the
protocol's; this service adds only the limits below.

### Who owns what

The owner always comes from the credential and never from the request, and a document is stored under
`(owner, id)`, so two people's `drawings/x` are two documents and no id can name someone else's. A document that belongs
to another owner is a plain 404.

Two credentials are built in; use either or both (`StaticTokens`, `SignedTokens`):

* **Static tokens**, for a server or a service account. The token file is
  `{"tokens":[{"id":"svc","sha256":"<hex>","rps":5,"burst":20,"expires":"2027-01-01T00:00:00Z"}]}` (`rps`, `burst` and
  `expires` optional; an unknown field, a duplicate or a typo is an error at start-up, so access is never widened by
  accident). The owner is `static:<id>`. `StaticTokens::mint(id, random_bytes)` makes a secret and the entry that holds its hash.
* **Signed tokens**, for a browser. Your own backend knows who the person is. It mints `scd1.<kid>.<owner>.<exp>.<mac>`
  (HMAC-SHA256 over the first four parts with a shared key, `owner` in base64url, `exp` in Unix seconds) and the chart
  sends it as the bearer token straight to this service, so the service keeps no user database and does not need to
  call your backend. The service refuses a token that has expired, that expires later than
  the `max_ttl` given to `SignedTokens::new` from now (24 hours is a good default), that names an unknown key, or whose MAC is wrong
  (compared in constant time). The key file is `{"keys":[{"kid":"k1","secret":"<base64url of ≥32 random bytes>"}]}`;
  to rotate, add a second key, mint with it, and remove the old one once its tokens have expired.
  An app mints in its own language by following the format above; the Rust function is `SigningKeys::mint`, with tests that
  pin the format.

Another way to authenticate (single sign-on, say) is one more implementation of `auth::Authenticator`, placed in a
`Chain` with the others.

### Putting it in your service

```rust
let state = Arc::new(AppState {
    store: PgStore::connect(&database_url, 10).await?,   // or MemoryStore, or your own DocStore
    auth: Box::new(Chain(vec![Box::new(static_tokens), Box::new(signed_tokens)])),
    limiter: RateLimiter::new(),
    settings: Settings { max_document_bytes: 3 * 1024 * 1024, max_docs_per_owner: 2000,
        allowed_origins: vec!["https://app.example.com".into()], concurrency: 256,
        request_timeout: Duration::from_secs(15) },
});
let app = router(state);          // an axum::Router: serve it, or `.nest("/sync", app)` into yours
```

`examples/embed.rs` is a complete small server. The crate reads no environment and opens no socket; reading
configuration, choosing the database and running `PgStore::migrate` are the service's job.

| Setting | Meaning |
| --- | --- |
| `max_document_bytes` | largest document in UTF-8 bytes. 3 MiB (`limits::DEFAULT_MAX_DOCUMENT_BYTES`) is the most a client's default limit of 1 048 576 UTF-16 units can need; at most 16 MiB (`limits::HARD_MAX_DOCUMENT_BYTES`) |
| `max_docs_per_owner` | 2000 by default; reaching it answers 413 `too_many_documents` for a new document only |
| `allowed_origins` | exact browser origins for CORS (`https://app.example.com`). Empty means no CORS headers. Never `*`; credentials are never allowed (the bearer token is a header, not a cookie) |
| per-owner `rps`, `burst` | from the token (static entry or the authenticator's defaults) |
| `concurrency`, `request_timeout` | requests handled at once, per-request timeout |

### Database

```rust
store.migrate().await?;   // creates chart_docs; idempotent; safe to run from several hosts at once
```

The router never migrates on its own; `/readyz` stays 503 until the table exists. One table, `chart_docs(owner, id,
revision, body bytea, updated_at)`, primary key `(owner, id)`. The text is `bytea` so it comes back byte for byte
(Postgres `text` cannot store U+0000, which JSON can). The compare-and-set is one statement (`UPDATE … WHERE revision =
$base`, or `INSERT … ON CONFLICT DO NOTHING`), so it is atomic without a lock and two writes with the same base never
both succeed. There is no delete and no code path that lowers or reuses a revision.

### What it does not do, on purpose

* It does not look inside the text. A host that wants only valid drawing documents validates in its own proxy; the
  client validates what it pulls before showing it.
* A text that is not valid Unicode (a lone surrogate, which JSON can carry as `\ud800`) is refused with 400, because it
  cannot be stored as UTF-8 and returned unchanged.
* It has no delete, no listing and no history. A listing would be a new protocol route, not a quiet addition.
* It does not terminate TLS. Run it behind the host's HTTPS front end; the TS client refuses plain `http` except for
  loopback.

### Security notes

* Order of every request: credentials, then the owner's rate limit, then the id, the preconditions and the body. A
  request without credentials learns nothing, not even whether an id is valid.
* Bodies are bounded before they are read (`6 × max document + 4 KiB`), and `Content-Length` is checked first.
* Responses carry `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`; there are no redirects.
* Logs hold the method, status and time of a request, and a store failure's message. Never a path (an id can name a
  person), a header, a token or a text. A store failure reaches the client only as `503 unavailable`.
* `unsafe` is forbidden in the workspace and `unwrap` is denied by lint.
