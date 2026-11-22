// Copyright 2026 SUPER SOLUTION LABS INC
//! The HTTP binding of the sync protocol (`docs/SYNC-PROTOCOL.md`): `GET` and `PUT` on `/v1/docs/{id}`.
//!
//! Order of every request: authenticate, rate-limit the owner, then look at the id, the preconditions and the body. The
//! owner is only ever the one the credentials name. Document text never reaches a log.

// The `Err` of the helpers below is the response to send, returned at once; boxing it would only add noise.
#![allow(clippy::result_large_err)]

use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};

use axum::Router;
use axum::body::Body;
use axum::extract::rejection::PathRejection;
use axum::extract::{Path, Request, State};
use axum::http::header::{
    AUTHORIZATION, CACHE_CONTROL, CONTENT_LENGTH, CONTENT_TYPE, ETAG, HeaderMap, HeaderName,
    HeaderValue, IF_MATCH, IF_NONE_MATCH, RETRY_AFTER, WWW_AUTHENTICATE,
};
use axum::http::{Method, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tower::limit::ConcurrencyLimitLayer;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::set_header::SetResponseHeaderLayer;
use tower_http::timeout::TimeoutLayer;

use crate::auth::{AuthError, Authenticator, Principal};
use crate::limits::{max_body_bytes, valid_id};
use crate::ratelimit::RateLimiter;
use crate::store::{DocStore, Put, Record};

/// What the handlers need besides the store.
pub struct Settings {
    pub max_document_bytes: usize,
    pub max_docs_per_owner: usize,
    /// Exact origins browsers may call from. Empty: no CORS headers are sent.
    pub allowed_origins: Vec<String>,
    pub concurrency: usize,
    pub request_timeout: Duration,
}

pub struct AppState<S: DocStore> {
    pub store: S,
    pub auth: Box<dyn Authenticator>,
    pub limiter: RateLimiter,
    pub settings: Settings,
}

fn error(status: StatusCode, code: &str, message: &str) -> Response {
    (
        status,
        axum::Json(json!({ "error": code, "message": message })),
    )
        .into_response()
}

fn with_etag(mut response: Response, revision: i64) -> Response {
    if let Ok(value) = HeaderValue::from_str(&format!("\"{revision}\"")) {
        response.headers_mut().insert(ETAG, value);
    }
    response
}

fn unauthorized(why: &AuthError) -> Response {
    let message = match why {
        AuthError::Missing => "send Authorization: Bearer <token>",
        AuthError::Invalid => "the token is not valid",
    };
    let mut response = error(StatusCode::UNAUTHORIZED, "unauthorized", message);
    response
        .headers_mut()
        .insert(WWW_AUTHENTICATE, HeaderValue::from_static("Bearer"));
    response
}

/// Authenticates and rate-limits. `Err` is the response to send.
fn admit<S: DocStore>(state: &AppState<S>, headers: &HeaderMap) -> Result<Principal, Response> {
    let header = headers.get(AUTHORIZATION).and_then(|v| v.to_str().ok());
    let principal = state
        .auth
        .authenticate(header, SystemTime::now())
        .map_err(|e| unauthorized(&e))?;
    if let Err(wait) = state.limiter.take(
        &principal.owner,
        principal.rps,
        principal.burst,
        Instant::now(),
    ) {
        let mut response = error(
            StatusCode::TOO_MANY_REQUESTS,
            "rate_limited",
            "too many requests, retry shortly",
        );
        let secs = wait.as_secs_f64().ceil().max(1.0);
        if let Ok(value) = HeaderValue::from_str(&format!("{secs:.0}")) {
            response.headers_mut().insert(RETRY_AFTER, value);
        }
        return Err(response);
    }
    Ok(principal)
}

fn id_of(path: Result<Path<String>, PathRejection>) -> Result<String, Response> {
    let Ok(Path(id)) = path else {
        return Err(error(
            StatusCode::BAD_REQUEST,
            "bad_id",
            "the document id is not valid",
        ));
    };
    if valid_id(&id) {
        Ok(id)
    } else {
        Err(error(
            StatusCode::BAD_REQUEST,
            "bad_id",
            "the document id must be 1 to 256 characters without control characters",
        ))
    }
}

#[derive(Serialize)]
struct Current<'a> {
    revision: i64,
    document: &'a str,
}

async fn get_doc<S: DocStore>(
    State(state): State<Arc<AppState<S>>>,
    headers: HeaderMap,
    path: Result<Path<String>, PathRejection>,
) -> Response {
    let principal = match admit(&state, &headers) {
        Ok(p) => p,
        Err(r) => return r,
    };
    let id = match id_of(path) {
        Ok(id) => id,
        Err(r) => return r,
    };
    match state.store.get(&principal.owner, &id).await {
        Ok(Some(Record { revision, document })) => with_etag(
            axum::Json(Current {
                revision,
                document: &document,
            })
            .into_response(),
            revision,
        ),
        Ok(None) => error(
            StatusCode::NOT_FOUND,
            "not_found",
            "nothing is stored under this id",
        ),
        Err(e) => store_failed(&e),
    }
}

fn store_failed(e: &crate::store::StoreError) -> Response {
    // The message may name a table or a host; it goes to the operator's log and not to the client.
    tracing::error!(error = %e, "store failed");
    error(
        StatusCode::SERVICE_UNAVAILABLE,
        "unavailable",
        "the store is not available, retry later",
    )
}

/// The base revision a request names: `If-None-Match: *` is 0, `If-Match: "n"` is n. Exactly one of them.
fn base_revision(headers: &HeaderMap) -> Result<i64, Response> {
    let none_match = headers.get_all(IF_NONE_MATCH).iter().count();
    let match_ = headers.get_all(IF_MATCH).iter().count();
    if none_match + match_ != 1 {
        return Err(error(
            StatusCode::PRECONDITION_REQUIRED,
            "precondition_required",
            "send exactly one of If-None-Match: * (create) or If-Match: \"<revision>\" (replace)",
        ));
    }
    let bad = || {
        error(
            StatusCode::BAD_REQUEST,
            "bad_precondition",
            "If-None-Match must be * and If-Match a quoted revision such as \"3\"",
        )
    };
    if none_match == 1 {
        let value = headers
            .get(IF_NONE_MATCH)
            .and_then(|v| v.to_str().ok())
            .map(str::trim);
        return if value == Some("*") {
            Ok(0)
        } else {
            Err(bad())
        };
    }
    let value = headers
        .get(IF_MATCH)
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .ok_or_else(bad)?;
    let digits = value
        .strip_prefix('"')
        .and_then(|v| v.strip_suffix('"'))
        .ok_or_else(bad)?;
    match digits.parse::<i64>() {
        Ok(n) if n >= 1 && digits.bytes().all(|b| b.is_ascii_digit()) => Ok(n),
        _ => Err(bad()),
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PutBody {
    document: String,
}

fn is_json(headers: &HeaderMap) -> bool {
    headers
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(';').next())
        .is_some_and(|mime| mime.trim().eq_ignore_ascii_case("application/json"))
}

async fn put_doc<S: DocStore>(
    State(state): State<Arc<AppState<S>>>,
    headers: HeaderMap,
    path: Result<Path<String>, PathRejection>,
    body: Body,
) -> Response {
    let principal = match admit(&state, &headers) {
        Ok(p) => p,
        Err(r) => return r,
    };
    let id = match id_of(path) {
        Ok(id) => id,
        Err(r) => return r,
    };
    let base = match base_revision(&headers) {
        Ok(b) => b,
        Err(r) => return r,
    };
    if !is_json(&headers) {
        return error(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "unsupported_media_type",
            "send Content-Type: application/json",
        );
    }
    let limit = max_body_bytes(state.settings.max_document_bytes);
    let declared = headers
        .get(CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<usize>().ok());
    if declared.is_some_and(|n| n > limit) {
        return too_large();
    }
    let Ok(bytes) = axum::body::to_bytes(body, limit).await else {
        // Either the body ran past the limit, or the connection broke while it was read.
        return too_large();
    };
    // A struct would also accept the array form `["text"]`; the protocol's body is an object.
    let is_object = bytes.iter().find(|b| !b.is_ascii_whitespace()) == Some(&b'{');
    let Some(PutBody { document }) = is_object
        .then(|| serde_json::from_slice::<PutBody>(&bytes).ok())
        .flatten()
    else {
        return error(
            StatusCode::BAD_REQUEST,
            "bad_body",
            "the body must be {\"document\": \"<text>\"}",
        );
    };
    if document.len() > state.settings.max_document_bytes {
        return too_large();
    }
    match state
        .store
        .put(
            &principal.owner,
            &id,
            &document,
            base,
            state.settings.max_docs_per_owner,
        )
        .await
    {
        Ok(Put::Saved(revision)) => {
            let status = if revision == 1 {
                StatusCode::CREATED
            } else {
                StatusCode::OK
            };
            with_etag(
                (status, axum::Json(json!({ "revision": revision }))).into_response(),
                revision,
            )
        }
        Ok(Put::Conflict(current)) => {
            let current = current.as_ref().map(|r| Current {
                revision: r.revision,
                document: &r.document,
            });
            (
                StatusCode::PRECONDITION_FAILED,
                axum::Json(json!({ "current": current })),
            )
                .into_response()
        }
        Ok(Put::TooMany) => error(
            StatusCode::PAYLOAD_TOO_LARGE,
            "too_many_documents",
            "this account holds the most documents it may",
        ),
        Err(e) => store_failed(&e),
    }
}

fn too_large() -> Response {
    error(
        StatusCode::PAYLOAD_TOO_LARGE,
        "too_large",
        "the document is over the size limit",
    )
}

async fn healthz() -> &'static str {
    "ok"
}

async fn readyz<S: DocStore>(State(state): State<Arc<AppState<S>>>) -> Response {
    match state.store.ping().await {
        Ok(()) => "ok".into_response(),
        Err(e) => store_failed(&e),
    }
}

/// One line per request: method, status and time. Never the path (an id is the app's, and may name a person), never a
/// header, never a body.
async fn access_log(request: Request, next: Next) -> Response {
    let method = request.method().clone();
    let started = Instant::now();
    let response = next.run(request).await;
    tracing::info!(method = %method, status = response.status().as_u16(), ms = started.elapsed().as_millis() as u64, "request");
    response
}

/// The service as a router. Layers, outermost first: response headers, CORS, access log, timeout, concurrency limit.
pub fn router<S: DocStore>(state: Arc<AppState<S>>) -> Router {
    let settings = &state.settings;
    let origins: Vec<HeaderValue> = settings
        .allowed_origins
        .iter()
        .filter_map(|o| HeaderValue::from_str(o).ok())
        .collect();
    let timeout = settings.request_timeout;
    let concurrency = settings.concurrency;
    let mut app = Router::new()
        .route("/v1/docs/{id}", get(get_doc::<S>).put(put_doc::<S>))
        .route("/healthz", get(healthz))
        .route("/readyz", get(readyz::<S>))
        .with_state(state)
        .layer(ConcurrencyLimitLayer::new(concurrency))
        .layer(TimeoutLayer::with_status_code(
            StatusCode::REQUEST_TIMEOUT,
            timeout,
        ))
        .layer(middleware::from_fn(access_log));
    if !origins.is_empty() {
        app = app.layer(
            CorsLayer::new()
                .allow_origin(AllowOrigin::list(origins))
                .allow_methods([Method::GET, Method::PUT])
                .allow_headers([AUTHORIZATION, CONTENT_TYPE, IF_MATCH, IF_NONE_MATCH])
                .expose_headers([ETAG, RETRY_AFTER])
                .max_age(Duration::from_secs(600)),
        );
    }
    app.layer(SetResponseHeaderLayer::overriding(
        CACHE_CONTROL,
        HeaderValue::from_static("no-store"),
    ))
    .layer(SetResponseHeaderLayer::overriding(
        HeaderName::from_static("x-content-type-options"),
        HeaderValue::from_static("nosniff"),
    ))
}
