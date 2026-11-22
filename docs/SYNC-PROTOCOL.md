# Sync protocol, version 1

How a Super Chart client keeps one saved document (the person's drawings, or a whole workspace) in step with a server
without losing an edit and without overwriting a newer one. The protocol knows nothing about charts: a document is an
opaque text. Any backend, in any language, can implement it; the client is `DocumentSync` in
`@supersolutions/super-chart-core/sync`, with `createHttpTransport` speaking the HTTP binding below.

The words MUST, SHOULD and MAY are used as in RFC 2119.

## Model

- A **document** has an **id** chosen by the app (`drawings/OKX:BTC-USDT`) and, once stored, a **revision** and a **text**.
- The id is 1 to 256 UTF-16 code units, with no control characters (U+0000 to U+001F, U+007F). The server MUST scope
  ids to the authenticated person: two people's `drawings/x` are two documents, and nothing a client sends in an id can
  name another person's.
- The text is a UTF-8 string the server stores verbatim and does not interpret. It MUST NOT be rewritten, re-encoded,
  normalized or reordered: the client compares texts byte for byte.
- The revision is a positive integer the **server** assigns. A document that does not exist has no revision (the client
  writes it as `0`). The first accepted write gives revision 1, and every accepted write after that gives the current
  revision plus exactly one.

## Operations

### Read

Returns the stored document, or "not found".

### Write (compare and set)

Takes the new text and a **base revision**: the revision the client edited from, or `0` for "only if nothing is stored".

1. If the stored revision equals the base revision, the server stores the text with revision base + 1 and answers
   **saved** with that revision.
2. Otherwise the server changes nothing and answers **conflict** with the document as it is now (revision and text), or
   with "nothing" if no document is stored under the id.

The comparison and the store MUST be one atomic step (a single `UPDATE ... WHERE revision = $base`, a transaction at
serializable isolation, or equivalent). Two writes with the same base MUST NOT both succeed.

A write that stores a text identical to the stored one is still a write: the revision goes up. (The client never sends one
on purpose; it can after a lost answer, below.)

### Deleting

There is no delete. A client that wants a document empty writes an empty document in whatever format its app uses.
A server MAY remove documents by its own policy; a client then sees "not found", or a conflict whose current document is
"nothing", and the person decides (the client does not recreate silently unless told to).

## What the client does with the answers

- **saved**: the client now agrees with the server at that revision. The revision MUST be greater than the base; a
  client treats anything else as a broken server and stops writing that document.
- **conflict**: someone else wrote since. The client keeps the person's unsaved text, and never overwrites. By default it
  asks the host app; the host may choose its side, the server's, or a merged text. The chosen text is written on top of the
  revision the conflict carried.
- **A lost answer.** If a write's answer never arrives, the client sends the same write again with the same base. If the
  first one had been stored, the server answers conflict, and the document it carries is the text the client was
  writing. The client compares the texts, sees they are equal, and counts the write as done. This is why the server
  MUST NOT normalize the text and why no idempotency key is needed.
- **Failures** other than conflict are retried with growing delays (1 s, doubling to 60 s by default) when they can
  succeed later (network, 408, 429, 5xx) and not otherwise (400, 401, 403, 413). An unsaved edit is kept in memory, and in
  the host's storage if it gave one, until the server has it.

## Limits

| What | Limit | Where it is checked |
| --- | --- | --- |
| Id length | 256 UTF-16 code units | client and server |
| Document text | 1 048 576 UTF-16 code units by default, set by the host | client; the server MUST enforce its own limit (it SHOULD be at least 1 MiB and MUST be stated to hosts) and answer 413 |
| Request body | text size plus at most 4 KiB; the JSON form of the text can be up to six times its length | server, before reading all of it |
| Response body | the client refuses more than six times the text limit plus 4 KiB | client |
| Rate | the server SHOULD limit writes per person; the client writes at most once a second per document in the quiet case (debounce) and backs off on failure | server |

A server SHOULD also cap the number of documents per person and answer 413 (or 507) when it is reached.

## HTTP binding

Base URL `https://host/<prefix>`; a document is `<base>/<id>` with the id percent-encoded as one path segment
(`/` becomes `%2F`). TLS is required except for loopback development. Every request carries whatever credentials the app
uses (`Authorization: Bearer ...`, or a cookie) and the server MUST authenticate it before anything else.

### `GET <base>/<id>`

| Status | Body | Meaning |
| --- | --- | --- |
| 200 | `{"revision": 3, "document": "<text>"}` plus `ETag: "3"` | the document |
| 404 | any | nothing stored |
| 401, 403 | any | not signed in, not allowed |
| 429, 5xx | any | try later |

### `PUT <base>/<id>`

Request: `Content-Type: application/json`, body `{"document": "<text>"}`, and one of

- `If-None-Match: *` when the base revision is 0;
- `If-Match: "<base revision>"` otherwise.

A request without exactly one of them is `428 Precondition Required`: an unconditional write could overwrite someone.

| Status | Body | Meaning |
| --- | --- | --- |
| 200 or 201 | `{"revision": 4}` plus `ETag: "4"` | saved (201 for the first revision) |
| 412 | `{"current": {"revision": 3, "document": "<text>"}}` or `{"current": null}` | conflict; `null` when nothing is stored |
| 400 | any | the id or the body is not valid |
| 401, 403 | any | not signed in, not allowed |
| 413 | any | the text (or the person's number of documents) is over the limit |
| 428 | any | no precondition header |
| 429, 5xx | any | try later |

The server MUST NOT follow or issue redirects for these routes (a client refuses them, so credentials never follow one),
MUST send `Cache-Control: no-store`, and MUST NOT put the text in logs. For browser clients it answers CORS for the
origins it allows by name, never `*` together with credentials, and allows the `If-Match`, `If-None-Match`,
`Content-Type` and `Authorization` request headers.

## Security notes for implementers

- **Authorization is the server's.** The id is a name, not a permission. Derive the owner from the credentials, store
  `(owner, id)` as the key, and never accept an owner from the request.
- **The text is untrusted.** Store it as text, bound its size before parsing, and do not execute or render it. A
  server that wants to validate (for Super Chart drawings: JSON with `version: 1` and at most 1000 drawings) MAY, and
  answers 400 for a text it refuses; the client also validates before it shows anything it pulled.
- **Compare and set under concurrency.** The most common mistake is read, compare, then write as three steps.
- **Do not leak existence.** A 404 for a document that belongs to someone else is a 404, not a 403.
- **Revisions are not secrets and not clocks.** Do not derive them from time; do not reuse a revision after a delete if
  the document is recreated (continue from the last revision, or from a per-owner counter) so that an old client's base
  cannot match a new, different document.

## A reference

`createMemoryTransport()` in `@supersolutions/super-chart-core/sync` is a complete in-memory implementation of the two
operations. Super Chart Cloud's Rust service (`chart-docs`) implements this protocol over Postgres.

## Versioning

This is version 1 (`SYNC_PROTOCOL_VERSION`). A change that an old client or server could misread gets a new version and a
new base path (`/v2/...`); additive fields in answers are ignored by clients.
