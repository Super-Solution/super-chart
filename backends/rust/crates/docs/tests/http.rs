// Copyright 2026 SUPER SOLUTION LABS INC
//! The protocol end to end through the router, against the in-memory store.

#![allow(clippy::expect_used)]

use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use http_body_util::BodyExt as _;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use super_chart_docs::auth::{Chain, SignedTokens, SigningKeys, StaticTokens};
use super_chart_docs::http::{AppState, Settings, router};
use super_chart_docs::ratelimit::RateLimiter;
use super_chart_docs::store::MemoryStore;
use tower::ServiceExt as _;

const STATIC_SECRET: &str = "scc_static-secret";

struct Options {
    max_document_bytes: usize,
    max_docs: usize,
    rps: f64,
    burst: u32,
    origins: Vec<String>,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            max_document_bytes: 1024,
            max_docs: 100,
            rps: 1000.0,
            burst: 1000,
            origins: vec![],
        }
    }
}

fn keys() -> SigningKeys {
    let secret = B64.encode([5u8; 32]);
    SigningKeys::parse(&format!(
        r#"{{"keys":[{{"kid":"k1","secret":"{secret}"}}]}}"#
    ))
    .expect("keys")
}

fn token_for(owner: &str) -> String {
    let exp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_secs()
        + 600;
    keys().mint("k1", owner, exp).expect("mint")
}

fn build(o: Options) -> Router {
    let hash: String = Sha256::digest(STATIC_SECRET.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    let statics = StaticTokens::parse(
        &format!(r#"{{"tokens":[{{"id":"svc","sha256":"{hash}"}}]}}"#),
        o.rps,
        o.burst,
    )
    .expect("tokens");
    let signed = SignedTokens::new(keys(), Duration::from_secs(3600), o.rps, o.burst);
    router(Arc::new(AppState {
        store: MemoryStore::new(),
        auth: Box::new(Chain(vec![Box::new(statics), Box::new(signed)])),
        limiter: RateLimiter::new(),
        settings: Settings {
            max_document_bytes: o.max_document_bytes,
            max_docs_per_owner: o.max_docs,
            allowed_origins: o.origins,
            concurrency: 16,
            request_timeout: Duration::from_secs(5),
        },
    }))
}

struct Reply {
    status: StatusCode,
    headers: axum::http::HeaderMap,
    body: Value,
}

async fn send(app: &Router, request: Request<Body>) -> Reply {
    let response = app.clone().oneshot(request).await.expect("response");
    let (parts, body) = response.into_parts();
    let bytes = body.collect().await.expect("body").to_bytes();
    let body = serde_json::from_slice(&bytes)
        .unwrap_or_else(|_| Value::String(String::from_utf8_lossy(&bytes).into_owned()));
    Reply {
        status: parts.status,
        headers: parts.headers,
        body,
    }
}

fn get(id: &str, token: &str) -> Request<Body> {
    Request::get(format!("/v1/docs/{id}"))
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .expect("request")
}

/// `precondition` is `("if-none-match", "*")` or `("if-match", "\"3\"")`.
fn put(id: &str, token: &str, precondition: Option<(&str, &str)>, text: &str) -> Request<Body> {
    put_raw(
        id,
        token,
        precondition,
        &json!({ "document": text }).to_string(),
    )
}

fn put_raw(id: &str, token: &str, precondition: Option<(&str, &str)>, body: &str) -> Request<Body> {
    let mut builder = Request::put(format!("/v1/docs/{id}"))
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json");
    if let Some((name, value)) = precondition {
        builder = builder.header(name, value);
    }
    builder.body(Body::from(body.to_owned())).expect("request")
}

const CREATE: Option<(&str, &str)> = Some(("if-none-match", "*"));
fn replace(rev: i64) -> String {
    format!("\"{rev}\"")
}

#[tokio::test]
async fn create_read_and_replace() {
    let app = build(Options::default());
    let t = token_for("alice");
    assert_eq!(
        send(&app, get("drawings%2FBTC", &t)).await.status,
        StatusCode::NOT_FOUND
    );

    let created = send(&app, put("drawings%2FBTC", &t, CREATE, "v1")).await;
    assert_eq!(created.status, StatusCode::CREATED);
    assert_eq!(created.body, json!({ "revision": 1 }));
    assert_eq!(created.headers[header::ETAG], "\"1\"");

    let read = send(&app, get("drawings%2FBTC", &t)).await;
    assert_eq!(read.status, StatusCode::OK);
    assert_eq!(read.body, json!({ "revision": 1, "document": "v1" }));
    assert_eq!(read.headers[header::ETAG], "\"1\"");
    assert_eq!(read.headers[header::CACHE_CONTROL], "no-store");

    let saved = send(
        &app,
        put("drawings%2FBTC", &t, Some(("if-match", &replace(1))), "v2"),
    )
    .await;
    assert_eq!(saved.status, StatusCode::OK);
    assert_eq!(saved.body, json!({ "revision": 2 }));
    assert_eq!(
        send(&app, get("drawings%2FBTC", &t)).await.body,
        json!({ "revision": 2, "document": "v2" })
    );
}

#[tokio::test]
async fn conflicts_carry_the_current_document() {
    let app = build(Options::default());
    let t = token_for("alice");
    send(&app, put("a", &t, CREATE, "one")).await;
    // Create again: conflict with what is stored.
    let again = send(&app, put("a", &t, CREATE, "other")).await;
    assert_eq!(again.status, StatusCode::PRECONDITION_FAILED);
    assert_eq!(
        again.body,
        json!({ "current": { "revision": 1, "document": "one" } })
    );
    // Stale base.
    send(&app, put("a", &t, Some(("if-match", &replace(1))), "two")).await;
    let stale = send(&app, put("a", &t, Some(("if-match", &replace(1))), "three")).await;
    assert_eq!(stale.status, StatusCode::PRECONDITION_FAILED);
    assert_eq!(
        stale.body,
        json!({ "current": { "revision": 2, "document": "two" } })
    );
    // Replace something that does not exist: current is null.
    let missing = send(
        &app,
        put("nothing", &t, Some(("if-match", &replace(4))), "x"),
    )
    .await;
    assert_eq!(missing.status, StatusCode::PRECONDITION_FAILED);
    assert_eq!(missing.body, json!({ "current": null }));
}

#[tokio::test]
async fn a_lost_answer_can_be_told_by_comparing_texts() {
    let app = build(Options::default());
    let t = token_for("alice");
    send(&app, put("a", &t, CREATE, "same text")).await;
    // The client never saw the answer and sends the same write again.
    let retry = send(&app, put("a", &t, CREATE, "same text")).await;
    assert_eq!(retry.status, StatusCode::PRECONDITION_FAILED);
    assert_eq!(retry.body["current"]["document"], "same text");
}

#[tokio::test]
async fn text_is_stored_byte_for_byte() {
    let app = build(Options::default());
    let t = token_for("alice");
    for (i, text) in [
        "",
        "  spaces \n\t",
        "é \u{0000} 日本 😀 \u{2028}",
        "{\"a\":1,\"a\":2}",
        "e\u{0301}",
    ]
    .iter()
    .enumerate()
    {
        let id = format!("t{i}");
        let written = send(&app, put(&id, &t, CREATE, text)).await;
        assert_eq!(
            written.status,
            StatusCode::CREATED,
            "{text:?}: {}",
            written.body
        );
        assert_eq!(
            send(&app, get(&id, &t)).await.body["document"],
            *text,
            "{text:?}"
        );
    }
}

#[tokio::test]
async fn documents_belong_to_their_owner() {
    let app = build(Options::default());
    let (alice, bob) = (token_for("alice"), token_for("bob"));
    send(&app, put("drawings", &alice, CREATE, "alice's")).await;
    assert_eq!(
        send(&app, get("drawings", &bob)).await.status,
        StatusCode::NOT_FOUND
    );
    // Bob writing the same id makes his own document; Alice's is untouched.
    assert_eq!(
        send(&app, put("drawings", &bob, CREATE, "bob's"))
            .await
            .status,
        StatusCode::CREATED
    );
    assert_eq!(
        send(&app, get("drawings", &alice)).await.body["document"],
        "alice's"
    );
    // The static token is a third owner.
    assert_eq!(
        send(&app, get("drawings", STATIC_SECRET)).await.status,
        StatusCode::NOT_FOUND
    );
    // Nothing in the request can name another owner.
    let sneaky = Request::get("/v1/docs/drawings?owner=alice")
        .header(header::AUTHORIZATION, format!("Bearer {bob}"))
        .header("x-owner", "alice")
        .body(Body::empty())
        .expect("request");
    assert_eq!(send(&app, sneaky).await.body["document"], "bob's");
}

#[tokio::test]
async fn authentication_comes_first() {
    let app = build(Options::default());
    let no_header = send(
        &app,
        Request::get("/v1/docs/a")
            .body(Body::empty())
            .expect("request"),
    )
    .await;
    assert_eq!(no_header.status, StatusCode::UNAUTHORIZED);
    assert_eq!(no_header.headers[header::WWW_AUTHENTICATE], "Bearer");
    assert_eq!(
        send(&app, get("a", "scd1.k1.YWxpY2U.9999999999.AAAA"))
            .await
            .status,
        StatusCode::UNAUTHORIZED
    );
    // Even a malformed write is 401 before it is anything else.
    let bad = Request::put("/v1/docs/a")
        .body(Body::from("not json"))
        .expect("request");
    assert_eq!(send(&app, bad).await.status, StatusCode::UNAUTHORIZED);
    // The static token works too.
    assert_eq!(
        send(&app, put("a", STATIC_SECRET, CREATE, "x"))
            .await
            .status,
        StatusCode::CREATED
    );
}

#[tokio::test]
async fn writes_need_exactly_one_precondition() {
    let app = build(Options::default());
    let t = token_for("alice");
    let none = send(&app, put("a", &t, None, "x")).await;
    assert_eq!(none.status, StatusCode::PRECONDITION_REQUIRED);
    let both = Request::put("/v1/docs/a")
        .header(header::AUTHORIZATION, format!("Bearer {t}"))
        .header(header::CONTENT_TYPE, "application/json")
        .header("if-none-match", "*")
        .header("if-match", "\"1\"")
        .body(Body::from(r#"{"document":"x"}"#))
        .expect("request");
    assert_eq!(
        send(&app, both).await.status,
        StatusCode::PRECONDITION_REQUIRED
    );
    for (name, value) in [
        ("if-match", "*"),
        ("if-match", "1"),
        ("if-match", "\"0\""),
        ("if-match", "\"-1\""),
        ("if-match", "W/\"1\""),
        ("if-match", "\"1\", \"2\""),
        ("if-none-match", "\"1\""),
    ] {
        assert_eq!(
            send(&app, put("a", &t, Some((name, value)), "x"))
                .await
                .status,
            StatusCode::BAD_REQUEST,
            "{name}: {value}"
        );
    }
    assert_eq!(
        send(&app, get("a", &t)).await.status,
        StatusCode::NOT_FOUND,
        "nothing was written"
    );
}

#[tokio::test]
async fn ids_are_validated() {
    let app = build(Options::default());
    let t = token_for("alice");
    for id in ["%00", "a%0Ab", "%7F", "%FF%FE", &"x".repeat(257)] {
        assert_eq!(
            send(&app, get(id, &t)).await.status,
            StatusCode::BAD_REQUEST,
            "{id}"
        );
    }
    // 256 UTF-16 units is the limit: 128 astral characters are 256, 129 are 258.
    let ok = "%F0%9F%98%80".repeat(128);
    let too_long = "%F0%9F%98%80".repeat(129);
    assert_eq!(
        send(&app, put(&ok, &t, CREATE, "x")).await.status,
        StatusCode::CREATED
    );
    assert_eq!(
        send(&app, put(&too_long, &t, CREATE, "x")).await.status,
        StatusCode::BAD_REQUEST
    );
    // Slashes arrive as one segment.
    assert_eq!(
        send(&app, put("a%2Fb%2Fc", &t, CREATE, "x")).await.status,
        StatusCode::CREATED
    );
}

#[tokio::test]
async fn bodies_are_checked() {
    let app = build(Options::default());
    let t = token_for("alice");
    let wrong_type = Request::put("/v1/docs/a")
        .header(header::AUTHORIZATION, format!("Bearer {t}"))
        .header(header::CONTENT_TYPE, "text/plain")
        .header("if-none-match", "*")
        .body(Body::from(r#"{"document":"x"}"#))
        .expect("request");
    assert_eq!(
        send(&app, wrong_type).await.status,
        StatusCode::UNSUPPORTED_MEDIA_TYPE
    );
    for body in [
        "not json",
        "{}",
        r#"{"document":1}"#,
        r#"{"document":"x","extra":true}"#,
        r#"["x"]"#,
        "",
    ] {
        assert_eq!(
            send(&app, put_raw("a", &t, CREATE, body)).await.status,
            StatusCode::BAD_REQUEST,
            "{body}"
        );
    }
    // With a charset parameter, still JSON.
    let charset = Request::put("/v1/docs/a")
        .header(header::AUTHORIZATION, format!("Bearer {t}"))
        .header(header::CONTENT_TYPE, "application/json; charset=utf-8")
        .header("if-none-match", "*")
        .body(Body::from(r#"{"document":"x"}"#))
        .expect("request");
    assert_eq!(send(&app, charset).await.status, StatusCode::CREATED);
}

#[tokio::test]
async fn size_limits_answer_413() {
    let app = build(Options {
        max_document_bytes: 100,
        ..Options::default()
    });
    let t = token_for("alice");
    assert_eq!(
        send(&app, put("a", &t, CREATE, &"x".repeat(100)))
            .await
            .status,
        StatusCode::CREATED
    );
    let over = send(&app, put("b", &t, CREATE, &"x".repeat(101))).await;
    assert_eq!(over.status, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(over.body["error"], "too_large");
    // Counted in UTF-8 bytes: 34 characters of 3 bytes are 102.
    assert_eq!(
        send(&app, put("c", &t, CREATE, &"日".repeat(34)))
            .await
            .status,
        StatusCode::PAYLOAD_TOO_LARGE
    );
    // A body far past the envelope is refused without being parsed.
    let huge = "x".repeat(100 * 6 + 4096 + 10);
    assert_eq!(
        send(&app, put_raw("d", &t, CREATE, &huge)).await.status,
        StatusCode::PAYLOAD_TOO_LARGE
    );
    assert_eq!(
        send(&app, get("b", &t)).await.status,
        StatusCode::NOT_FOUND,
        "a refused write stores nothing"
    );
}

#[tokio::test]
async fn the_number_of_documents_is_capped_per_owner() {
    let app = build(Options {
        max_docs: 2,
        ..Options::default()
    });
    let t = token_for("alice");
    assert_eq!(
        send(&app, put("a", &t, CREATE, "x")).await.status,
        StatusCode::CREATED
    );
    assert_eq!(
        send(&app, put("b", &t, CREATE, "x")).await.status,
        StatusCode::CREATED
    );
    let third = send(&app, put("c", &t, CREATE, "x")).await;
    assert_eq!(third.status, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(third.body["error"], "too_many_documents");
    // Replacing an existing one, and another owner's first, are still fine; so is a conflict at the cap.
    assert_eq!(
        send(&app, put("a", &t, Some(("if-match", &replace(1))), "y"))
            .await
            .status,
        StatusCode::OK
    );
    assert_eq!(
        send(&app, put("a", &t, CREATE, "z")).await.status,
        StatusCode::PRECONDITION_FAILED
    );
    assert_eq!(
        send(&app, put("c", &token_for("bob"), CREATE, "x"))
            .await
            .status,
        StatusCode::CREATED
    );
}

#[tokio::test]
async fn the_rate_limit_is_per_owner() {
    let app = build(Options {
        rps: 0.1,
        burst: 2,
        ..Options::default()
    });
    let alice = token_for("alice");
    assert_eq!(
        send(&app, get("a", &alice)).await.status,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        send(&app, get("a", &alice)).await.status,
        StatusCode::NOT_FOUND
    );
    let limited = send(&app, get("a", &alice)).await;
    assert_eq!(limited.status, StatusCode::TOO_MANY_REQUESTS);
    let retry: u64 = limited.headers[header::RETRY_AFTER]
        .to_str()
        .expect("ascii")
        .parse()
        .expect("seconds");
    assert!((1..=10).contains(&retry), "{retry}");
    assert_eq!(
        send(&app, get("a", &token_for("bob"))).await.status,
        StatusCode::NOT_FOUND,
        "bob has his own bucket"
    );
}

#[tokio::test]
async fn health_endpoints() {
    let app = build(Options::default());
    let health = send(
        &app,
        Request::get("/healthz")
            .body(Body::empty())
            .expect("request"),
    )
    .await;
    assert_eq!(health.status, StatusCode::OK);
    let ready = send(
        &app,
        Request::get("/readyz")
            .body(Body::empty())
            .expect("request"),
    )
    .await;
    assert_eq!(ready.status, StatusCode::OK);
    assert_eq!(
        send(
            &app,
            Request::get("/nope").body(Body::empty()).expect("request")
        )
        .await
        .status,
        StatusCode::NOT_FOUND
    );
    let delete = Request::delete("/v1/docs/a")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_for("a")))
        .body(Body::empty())
        .expect("request");
    assert_eq!(
        send(&app, delete).await.status,
        StatusCode::METHOD_NOT_ALLOWED,
        "there is no delete"
    );
}

#[tokio::test]
async fn cors_answers_only_listed_origins() {
    let app = build(Options {
        origins: vec!["https://app.example.com".into()],
        ..Options::default()
    });
    let preflight = |origin: &str| {
        Request::builder()
            .method("OPTIONS")
            .uri("/v1/docs/a")
            .header(header::ORIGIN, origin)
            .header(header::ACCESS_CONTROL_REQUEST_METHOD, "PUT")
            .header(
                header::ACCESS_CONTROL_REQUEST_HEADERS,
                "authorization,content-type,if-match,if-none-match",
            )
            .body(Body::empty())
            .expect("request")
    };
    let allowed = send(&app, preflight("https://app.example.com")).await;
    assert_eq!(
        allowed.headers[header::ACCESS_CONTROL_ALLOW_ORIGIN],
        "https://app.example.com"
    );
    let methods = allowed.headers[header::ACCESS_CONTROL_ALLOW_METHODS]
        .to_str()
        .expect("ascii")
        .to_owned();
    assert!(
        methods.contains("PUT") && methods.contains("GET") && !methods.contains("DELETE"),
        "{methods}"
    );
    assert!(
        allowed
            .headers
            .get(header::ACCESS_CONTROL_ALLOW_CREDENTIALS)
            .is_none()
    );
    let denied = send(&app, preflight("https://evil.example.com")).await;
    assert!(
        denied
            .headers
            .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
            .is_none()
    );
    // The real answer carries the origin and exposes ETag.
    let mut request = get("a", &token_for("alice"));
    request.headers_mut().insert(
        header::ORIGIN,
        "https://app.example.com".parse().expect("header"),
    );
    let real = send(&app, request).await;
    assert_eq!(
        real.headers[header::ACCESS_CONTROL_ALLOW_ORIGIN],
        "https://app.example.com"
    );
    // With no origins configured there are no CORS headers at all.
    let closed = build(Options::default());
    let none = send(&closed, preflight("https://app.example.com")).await;
    assert!(
        none.headers
            .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
            .is_none()
    );
}

#[tokio::test]
async fn concurrent_writes_with_one_base_have_one_winner() {
    let app = build(Options::default());
    let t = token_for("alice");
    send(&app, put("a", &t, CREATE, "base")).await;
    let mut tasks = Vec::new();
    for i in 0..32 {
        let (app, t) = (app.clone(), t.clone());
        tasks.push(tokio::spawn(async move {
            send(
                &app,
                put("a", &t, Some(("if-match", "\"1\"")), &format!("writer {i}")),
            )
            .await
            .status
        }));
    }
    let mut saved = 0;
    for task in tasks {
        match task.await.expect("task") {
            StatusCode::OK => saved += 1,
            StatusCode::PRECONDITION_FAILED => {}
            other => panic!("unexpected {other}"),
        }
    }
    assert_eq!(saved, 1);
    assert_eq!(send(&app, get("a", &t)).await.body["revision"], 2);
}
