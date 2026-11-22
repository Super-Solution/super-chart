// Copyright 2026 SUPER SOLUTION LABS INC
//! Bounds shared by the store and the HTTP layer.

/// Longest document id, in UTF-16 code units, as the protocol counts it.
pub const MAX_ID_UTF16: usize = 256;
/// Longest owner name accepted from an authenticator.
pub const MAX_OWNER_CHARS: usize = 128;
/// The document size the server accepts unless configured (UTF-8 bytes). The client's default limit is 1 048 576
/// UTF-16 code units, which is at most three UTF-8 bytes each, so nothing a default client sends is refused.
pub const DEFAULT_MAX_DOCUMENT_BYTES: usize = 3 * 1024 * 1024;
/// The largest size an operator may configure (UTF-8 bytes).
pub const HARD_MAX_DOCUMENT_BYTES: usize = 16 * 1024 * 1024;
/// Documents a person may hold unless configured.
pub const DEFAULT_MAX_DOCS_PER_OWNER: usize = 2000;
/// The JSON form of a text can be up to six times its length (`\u0001`), plus the envelope.
pub const fn max_body_bytes(max_document_bytes: usize) -> usize {
    max_document_bytes * 6 + 4096
}

/// Whether `id` is a valid document id: 1 to 256 UTF-16 code units, no control characters.
pub fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.encode_utf16().count() <= MAX_ID_UTF16
        && !id.chars().any(|c| c.is_control())
}

/// Whether `owner` is a valid owner name: 1 to 128 characters of `A-Za-z0-9._:@-`.
pub fn valid_owner(owner: &str) -> bool {
    !owner.is_empty()
        && owner.chars().count() <= MAX_OWNER_CHARS
        && owner
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | ':' | '@' | '-'))
}
