// Copyright 2026 SUPER SOLUTION LABS INC
//! Who is asking, and whose documents they may touch.
//!
//! Every document belongs to one *owner*, and the owner always comes from the credentials, never from the request.
//! Two kinds of credential are built in, and an operator may use either or both:
//!
//! * **Static tokens**: a JSON file of `{id, sha256, rps, burst, expires}` entries (`id` is `[a-z0-9][a-z0-9_-]{0,63}`). Each token is its own owner, `static:<id>`. Only the SHA-256 of a secret is stored.
//! * **Signed tokens**: `scd1.<kid>.<owner>.<exp>.<mac>`. The app that knows the person mints one for them with a
//!   shared key (HMAC-SHA256), so the chart can talk to this service directly from the browser and the service needs
//!   no user database. `owner` is base64url, `exp` is a Unix time in seconds, and the lifetime is capped by the
//!   service, so a leaked token expires and a long-lived one is refused.
//!
//! Another [`Authenticator`] (single sign-on, say) can sit beside these in a [`Chain`].

use std::collections::{HashMap, HashSet};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use hmac::{Hmac, Mac};
use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::limits::valid_owner;

/// Longest credential accepted; anything longer is refused before it is looked at.
pub const MAX_CREDENTIAL_LEN: usize = 512;
/// Prefix of signed tokens (version 1).
pub const SIGNED_PREFIX: &str = "scd1";
/// Smallest signing secret, in bytes.
pub const MIN_SECRET_BYTES: usize = 32;
const OWNER_PREFIX_STATIC: &str = "static:";

/// The caller: who owns the documents, and how fast they may go.
#[derive(Clone, Debug, PartialEq)]
pub struct Principal {
    pub owner: String,
    pub rps: f64,
    pub burst: u32,
}

/// Why a request was not authenticated. The HTTP layer maps both to 401 and says no more than that.
#[derive(Debug, PartialEq, Eq)]
pub enum AuthError {
    /// No `Authorization` header, or not a bearer one.
    Missing,
    /// Unknown, expired, malformed or forged.
    Invalid,
}

pub trait Authenticator: Send + Sync + 'static {
    /// `header` is the raw `Authorization` value. `now` is passed in so expiry is testable.
    fn authenticate(&self, header: Option<&str>, now: SystemTime) -> Result<Principal, AuthError>;
}

/// The secret of an `Authorization: Bearer <secret>` header.
fn bearer(header: Option<&str>) -> Result<&str, AuthError> {
    let header = header
        .map(str::trim)
        .filter(|h| !h.is_empty())
        .ok_or(AuthError::Missing)?;
    let (scheme, secret) = header.split_once(' ').ok_or(AuthError::Missing)?;
    if !scheme.eq_ignore_ascii_case("bearer") {
        return Err(AuthError::Missing);
    }
    let secret = secret.trim();
    if secret.is_empty() || secret.len() > MAX_CREDENTIAL_LEN {
        return Err(AuthError::Invalid);
    }
    Ok(secret)
}

fn unix(now: SystemTime) -> u64 {
    now.duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

// ---------------------------------------------------------------------------------------------------------------
// Static tokens

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TokenFile {
    tokens: Vec<TokenEntry>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TokenEntry {
    id: String,
    sha256: String,
    #[serde(default)]
    rps: Option<f64>,
    #[serde(default)]
    burst: Option<u32>,
    #[serde(default)]
    expires: Option<String>,
}

struct StaticToken {
    principal: Principal,
    expires: Option<u64>,
}

/// Bearer tokens from a token file.
pub struct StaticTokens {
    by_hash: HashMap<String, StaticToken>,
}

impl StaticTokens {
    /// Parses the token file. Unknown fields, duplicates and malformed entries are errors, so a typo cannot silently
    /// widen or drop access.
    pub fn parse(raw: &str, default_rps: f64, default_burst: u32) -> Result<Self, String> {
        let file: TokenFile = serde_json::from_str(raw).map_err(|e| format!("token file: {e}"))?;
        if file.tokens.is_empty() {
            return Err("token file: no tokens".into());
        }
        let mut ids = HashSet::new();
        let mut by_hash = HashMap::new();
        for (i, entry) in file.tokens.into_iter().enumerate() {
            let id_ok = !entry.id.is_empty()
                && entry.id.len() <= 64
                && entry
                    .id
                    .starts_with(|c: char| c.is_ascii_lowercase() || c.is_ascii_digit())
                && entry
                    .id
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-');
            if !id_ok {
                return Err(format!(
                    "token file: entry {i}: id must match [a-z0-9][a-z0-9_-]{{0,63}}"
                ));
            }
            if !ids.insert(entry.id.clone()) {
                return Err(format!("token file: duplicate id {:?}", entry.id));
            }
            let hash = entry.sha256.to_ascii_lowercase();
            if hash.len() != 64
                || !hash
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            {
                return Err(format!(
                    "token file: {:?}: sha256 must be 64 hex characters",
                    entry.id
                ));
            }
            let rps = entry.rps.unwrap_or(default_rps);
            let burst = entry.burst.unwrap_or(default_burst);
            if !(rps > 0.0 && rps <= 1000.0) || burst == 0 || burst > 10_000 {
                return Err(format!(
                    "token file: {:?}: rps or burst out of range",
                    entry.id
                ));
            }
            let expires = match entry.expires.as_deref() {
                None | Some("") => None,
                Some(text) => Some(parse_rfc3339(text).ok_or_else(|| {
                    format!("token file: {:?}: expires must be RFC 3339 in UTC, like 2027-01-01T00:00:00Z", entry.id)
                })?),
            };
            let token = StaticToken {
                principal: Principal {
                    owner: format!("{OWNER_PREFIX_STATIC}{}", entry.id),
                    rps,
                    burst,
                },
                expires,
            };
            if by_hash.insert(hash, token).is_some() {
                return Err(format!("token file: {:?}: duplicate sha256", entry.id));
            }
        }
        Ok(Self { by_hash })
    }

    /// A new secret and the token-file entry that holds its hash. The secret is shown once and never stored.
    pub fn mint(id: &str, random: [u8; 32]) -> (String, String) {
        let secret = format!("scc_{}", B64.encode(random));
        let entry = format!(
            r#"{{ "id": "{id}", "sha256": "{}" }}"#,
            hex(&Sha256::digest(secret.as_bytes()))
        );
        (secret, entry)
    }
}

impl Authenticator for StaticTokens {
    fn authenticate(&self, header: Option<&str>, now: SystemTime) -> Result<Principal, AuthError> {
        let secret = bearer(header)?;
        let found = self
            .by_hash
            .get(&hex(&Sha256::digest(secret.as_bytes())))
            .ok_or(AuthError::Invalid)?;
        if found.expires.is_some_and(|at| unix(now) >= at) {
            return Err(AuthError::Invalid);
        }
        Ok(found.principal.clone())
    }
}

fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    bytes
        .iter()
        .fold(String::with_capacity(bytes.len() * 2), |mut s, b| {
            let _ = write!(s, "{b:02x}");
            s
        })
}

/// `YYYY-MM-DDTHH:MM:SSZ` to Unix seconds. Only UTC, so an operator cannot get an offset wrong.
fn parse_rfc3339(text: &str) -> Option<u64> {
    let b = text.as_bytes();
    if b.len() != 20
        || b[4] != b'-'
        || b[7] != b'-'
        || b[10] != b'T'
        || b[13] != b':'
        || b[16] != b':'
        || b[19] != b'Z'
    {
        return None;
    }
    let num = |from: usize, to: usize| -> Option<i64> {
        let part = text.get(from..to)?;
        if !part.bytes().all(|c| c.is_ascii_digit()) {
            return None;
        }
        part.parse().ok()
    };
    let (y, m, d, hh, mm, ss) = (
        num(0, 4)?,
        num(5, 7)?,
        num(8, 10)?,
        num(11, 13)?,
        num(14, 16)?,
        num(17, 19)?,
    );
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) || hh > 23 || mm > 59 || ss > 59 {
        return None;
    }
    // Days from the civil date (Howard Hinnant's algorithm).
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y.rem_euclid(400);
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    u64::try_from(days * 86_400 + hh * 3600 + mm * 60 + ss).ok()
}

// ---------------------------------------------------------------------------------------------------------------
// Signed tokens

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct KeyFile {
    keys: Vec<KeyEntry>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct KeyEntry {
    kid: String,
    /// base64url (no padding) of at least 32 random bytes.
    secret: String,
}

/// The shared keys that sign and verify tokens. Several may be loaded at once so a key can be rotated: mint with the
/// new one, keep the old one until its tokens have expired, then remove it.
pub struct SigningKeys {
    keys: HashMap<String, Vec<u8>>,
}

fn valid_kid(kid: &str) -> bool {
    !kid.is_empty()
        && kid.len() <= 32
        && kid
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-')
}

impl SigningKeys {
    pub fn parse(raw: &str) -> Result<Self, String> {
        let file: KeyFile =
            serde_json::from_str(raw).map_err(|e| format!("signing key file: {e}"))?;
        if file.keys.is_empty() {
            return Err("signing key file: no keys".into());
        }
        let mut keys = HashMap::new();
        for entry in file.keys {
            if !valid_kid(&entry.kid) {
                return Err(format!(
                    "signing key file: kid {:?} must match [a-z0-9_-]{{1,32}}",
                    entry.kid
                ));
            }
            let secret = B64.decode(entry.secret.trim()).map_err(|_| {
                format!(
                    "signing key file: {:?}: secret must be base64url without padding",
                    entry.kid
                )
            })?;
            if secret.len() < MIN_SECRET_BYTES {
                return Err(format!(
                    "signing key file: {:?}: secret must be at least {MIN_SECRET_BYTES} bytes",
                    entry.kid
                ));
            }
            if keys.insert(entry.kid.clone(), secret).is_some() {
                return Err(format!("signing key file: duplicate kid {:?}", entry.kid));
            }
        }
        Ok(Self { keys })
    }

    /// Makes a token for `owner` that stops working at `expires` (Unix seconds).
    pub fn mint(&self, kid: &str, owner: &str, expires: u64) -> Result<String, String> {
        let secret = self
            .keys
            .get(kid)
            .ok_or_else(|| format!("no key {kid:?}"))?;
        if !valid_owner(owner) || owner.starts_with(OWNER_PREFIX_STATIC) {
            return Err("owner must be 1 to 128 characters of A-Za-z0-9._:@- and not start with \"static:\"".into());
        }
        let head = format!("{SIGNED_PREFIX}.{kid}.{}.{expires}", B64.encode(owner));
        Ok(format!("{head}.{}", B64.encode(sign(secret, &head))))
    }
}

type HmacSha256 = Hmac<Sha256>;

#[allow(clippy::expect_used)] // HMAC accepts a key of any length, so this cannot fail.
fn mac_for(secret: &[u8], head: &str) -> HmacSha256 {
    let mut mac = HmacSha256::new_from_slice(secret).expect("HMAC accepts any key length");
    mac.update(head.as_bytes());
    mac
}

fn sign(secret: &[u8], head: &str) -> Vec<u8> {
    mac_for(secret, head).finalize().into_bytes().to_vec()
}

/// Tokens signed with a shared key.
pub struct SignedTokens {
    keys: SigningKeys,
    max_ttl: Duration,
    rps: f64,
    burst: u32,
}

impl SignedTokens {
    /// `max_ttl` is the longest remaining life a token may show: a token that expires later than `now + max_ttl` is
    /// refused, so a minting mistake cannot make a credential that lives for years.
    pub fn new(keys: SigningKeys, max_ttl: Duration, rps: f64, burst: u32) -> Self {
        Self {
            keys,
            max_ttl,
            rps,
            burst,
        }
    }
}

impl Authenticator for SignedTokens {
    fn authenticate(&self, header: Option<&str>, now: SystemTime) -> Result<Principal, AuthError> {
        let token = bearer(header)?;
        let mut parts = token.split('.');
        let (Some(prefix), Some(kid), Some(owner_b64), Some(exp), Some(mac_b64), None) = (
            parts.next(),
            parts.next(),
            parts.next(),
            parts.next(),
            parts.next(),
            parts.next(),
        ) else {
            return Err(AuthError::Invalid);
        };
        if prefix != SIGNED_PREFIX {
            return Err(AuthError::Invalid);
        }
        let secret = self.keys.keys.get(kid).ok_or(AuthError::Invalid)?;
        let given = B64.decode(mac_b64).map_err(|_| AuthError::Invalid)?;
        let head = &token[..token.len() - mac_b64.len() - 1];
        // Constant-time comparison of the MAC, before anything in the token is believed.
        mac_for(secret, head)
            .verify_slice(&given)
            .map_err(|_| AuthError::Invalid)?;
        let expires: u64 = exp.parse().map_err(|_| AuthError::Invalid)?;
        let now = unix(now);
        if now >= expires || expires - now > self.max_ttl.as_secs() {
            return Err(AuthError::Invalid);
        }
        let owner = String::from_utf8(B64.decode(owner_b64).map_err(|_| AuthError::Invalid)?)
            .map_err(|_| AuthError::Invalid)?;
        if !valid_owner(&owner) || owner.starts_with(OWNER_PREFIX_STATIC) {
            return Err(AuthError::Invalid);
        }
        Ok(Principal {
            owner,
            rps: self.rps,
            burst: self.burst,
        })
    }
}

// ---------------------------------------------------------------------------------------------------------------

/// Tries each authenticator in order and takes the first that accepts. `Missing` only when none saw a credential.
pub struct Chain(pub Vec<Box<dyn Authenticator>>);

impl Authenticator for Chain {
    fn authenticate(&self, header: Option<&str>, now: SystemTime) -> Result<Principal, AuthError> {
        let mut result = AuthError::Missing;
        for each in &self.0 {
            match each.authenticate(header, now) {
                Ok(principal) => return Ok(principal),
                Err(AuthError::Invalid) => result = AuthError::Invalid,
                Err(AuthError::Missing) => {}
            }
        }
        Err(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SECRET: &str = "scc_test-secret";
    fn at(secs: u64) -> SystemTime {
        UNIX_EPOCH + Duration::from_secs(secs)
    }
    fn statics(extra: &str) -> StaticTokens {
        let hash = hex(&Sha256::digest(SECRET.as_bytes()));
        let raw = format!(r#"{{"tokens":[{{"id":"web","sha256":"{hash}"{extra}}}]}}"#);
        StaticTokens::parse(&raw, 5.0, 20).expect("parses")
    }
    fn keys() -> SigningKeys {
        let a = B64.encode([7u8; 32]);
        let b = B64.encode([9u8; 40]);
        SigningKeys::parse(&format!(
            r#"{{"keys":[{{"kid":"k1","secret":"{a}"}},{{"kid":"k2","secret":"{b}"}}]}}"#
        ))
        .expect("keys")
    }
    fn signed() -> SignedTokens {
        SignedTokens::new(keys(), Duration::from_secs(3600), 5.0, 20)
    }
    fn header(token: &str) -> String {
        format!("Bearer {token}")
    }

    #[test]
    fn static_token_is_its_own_owner() {
        let p = statics("")
            .authenticate(Some(&header(SECRET)), at(0))
            .expect("accepted");
        assert_eq!(
            p,
            Principal {
                owner: "static:web".into(),
                rps: 5.0,
                burst: 20
            }
        );
    }

    #[test]
    fn static_token_rejections() {
        let auth = statics(r#","expires":"2027-01-01T00:00:00Z""#);
        assert_eq!(auth.authenticate(None, at(0)), Err(AuthError::Missing));
        assert_eq!(
            auth.authenticate(Some("Basic abc"), at(0)),
            Err(AuthError::Missing)
        );
        assert_eq!(
            auth.authenticate(Some("Bearer nope"), at(0)),
            Err(AuthError::Invalid)
        );
        assert_eq!(
            auth.authenticate(Some(&header(&"x".repeat(600))), at(0)),
            Err(AuthError::Invalid)
        );
        // 2027-01-01T00:00:00Z is 1798761600.
        assert!(
            auth.authenticate(Some(&header(SECRET)), at(1_798_761_599))
                .is_ok()
        );
        assert_eq!(
            auth.authenticate(Some(&header(SECRET)), at(1_798_761_600)),
            Err(AuthError::Invalid)
        );
        assert!(
            auth.authenticate(Some("bearer  scc_test-secret "), at(0))
                .is_ok()
        );
    }

    #[test]
    fn token_file_mistakes_are_errors() {
        let h = "a".repeat(64);
        for bad in [
            r#"{"tokens":[]}"#.to_string(),
            r#"{"tokens":[{"id":"Bad Id","sha256":"x"}]}"#.to_string(),
            format!(r#"{{"tokens":[{{"id":"a","sha256":"{h}","venues":["X"]}}]}}"#),
            format!(
                r#"{{"tokens":[{{"id":"a","sha256":"{h}"}},{{"id":"a","sha256":"{}"}}]}}"#,
                "b".repeat(64)
            ),
            format!(r#"{{"tokens":[{{"id":"a","sha256":"{h}"}},{{"id":"b","sha256":"{h}"}}]}}"#),
            format!(r#"{{"tokens":[{{"id":"a","sha256":"{h}","rps":0}}]}}"#),
            format!(r#"{{"tokens":[{{"id":"a","sha256":"{h}","expires":"2027-01-01"}}]}}"#),
            "not json".to_string(),
        ] {
            assert!(StaticTokens::parse(&bad, 5.0, 20).is_err(), "{bad}");
        }
    }

    #[test]
    fn rfc3339_known_dates() {
        assert_eq!(parse_rfc3339("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_rfc3339("2000-03-01T00:00:00Z"), Some(951_868_800));
        assert_eq!(parse_rfc3339("2026-11-22T12:34:56Z"), Some(1_795_350_896));
        assert_eq!(parse_rfc3339("2026-13-01T00:00:00Z"), None);
        assert_eq!(parse_rfc3339("2026-11-22 12:34:56Z"), None);
    }

    #[test]
    fn minted_static_entry_matches_its_secret() {
        let (secret, entry) = StaticTokens::mint("app", [3u8; 32]);
        let auth = StaticTokens::parse(&format!(r#"{{"tokens":[{entry}]}}"#), 5.0, 20)
            .expect("entry parses");
        assert_eq!(
            auth.authenticate(Some(&header(&secret)), at(0))
                .expect("ok")
                .owner,
            "static:app"
        );
    }

    #[test]
    fn signed_token_round_trip() {
        let token = keys().mint("k1", "user-42.a@b", 1000).expect("mint");
        let p = signed()
            .authenticate(Some(&header(&token)), at(500))
            .expect("accepted");
        assert_eq!(p.owner, "user-42.a@b");
        // The second key verifies too, so rotation works.
        let token2 = keys().mint("k2", "u", 1000).expect("mint");
        assert!(
            signed()
                .authenticate(Some(&header(&token2)), at(500))
                .is_ok()
        );
    }

    #[test]
    fn signed_token_rejections() {
        let auth = signed();
        let good = keys().mint("k1", "alice", 1000).expect("mint");
        // Expired, and not yet expired at the last second.
        assert!(auth.authenticate(Some(&header(&good)), at(999)).is_ok());
        assert_eq!(
            auth.authenticate(Some(&header(&good)), at(1000)),
            Err(AuthError::Invalid)
        );
        // Lives longer than the cap allows.
        let long = keys().mint("k1", "alice", 10_000).expect("mint");
        assert_eq!(
            auth.authenticate(Some(&header(&long)), at(0)),
            Err(AuthError::Invalid)
        );
        // Owner swapped for another, with the old MAC.
        let parts: Vec<&str> = good.split('.').collect();
        let forged = format!(
            "{}.{}.{}.{}.{}",
            parts[0],
            parts[1],
            B64.encode("bob"),
            parts[3],
            parts[4]
        );
        assert_eq!(
            auth.authenticate(Some(&header(&forged)), at(0)),
            Err(AuthError::Invalid)
        );
        // Expiry extended.
        let extended = format!(
            "{}.{}.{}.{}.{}",
            parts[0], parts[1], parts[2], 2000, parts[4]
        );
        assert_eq!(
            auth.authenticate(Some(&header(&extended)), at(0)),
            Err(AuthError::Invalid)
        );
        // Unknown key, wrong prefix, extra parts, garbage.
        assert_eq!(
            auth.authenticate(Some(&header(&good.replace(".k1.", ".k9."))), at(0)),
            Err(AuthError::Invalid)
        );
        assert_eq!(
            auth.authenticate(Some(&header(&good.replacen("scd1", "scd2", 1))), at(0)),
            Err(AuthError::Invalid)
        );
        assert_eq!(
            auth.authenticate(Some(&header(&format!("{good}.x"))), at(0)),
            Err(AuthError::Invalid)
        );
        assert_eq!(
            auth.authenticate(Some(&header("scd1")), at(0)),
            Err(AuthError::Invalid)
        );
    }

    #[test]
    fn minting_refuses_bad_owners_and_unknown_keys() {
        assert!(keys().mint("k1", "", 1).is_err());
        assert!(keys().mint("k1", "a b", 1).is_err());
        assert!(keys().mint("k1", "static:web", 1).is_err());
        assert!(keys().mint("nope", "a", 1).is_err());
    }

    #[test]
    fn short_or_duplicate_keys_are_errors() {
        let short = B64.encode([1u8; 16]);
        assert!(
            SigningKeys::parse(&format!(r#"{{"keys":[{{"kid":"a","secret":"{short}"}}]}}"#))
                .is_err()
        );
        let ok = B64.encode([1u8; 32]);
        assert!(
            SigningKeys::parse(&format!(
                r#"{{"keys":[{{"kid":"a","secret":"{ok}"}},{{"kid":"a","secret":"{ok}"}}]}}"#
            ))
            .is_err()
        );
        assert!(SigningKeys::parse(r#"{"keys":[]}"#).is_err());
    }

    #[test]
    fn chain_takes_the_first_that_accepts() {
        let chain = Chain(vec![Box::new(statics("")), Box::new(signed())]);
        let token = keys().mint("k1", "alice", 1000).expect("mint");
        assert_eq!(
            chain
                .authenticate(Some(&header(SECRET)), at(0))
                .expect("static")
                .owner,
            "static:web"
        );
        assert_eq!(
            chain
                .authenticate(Some(&header(&token)), at(0))
                .expect("signed")
                .owner,
            "alice"
        );
        assert_eq!(
            chain.authenticate(Some("Bearer zzz"), at(0)),
            Err(AuthError::Invalid)
        );
        assert_eq!(chain.authenticate(None, at(0)), Err(AuthError::Missing));
    }
}
