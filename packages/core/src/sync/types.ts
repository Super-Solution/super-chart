/**
 * Document sync, protocol version 1 (docs/SYNC-PROTOCOL.md).
 *
 * One *document* is an opaque string (for the chart: a drawings or workspace JSON) stored under an id the host chooses.
 * The server owns a revision number that goes up by one on every accepted write; a write names the revision it was made
 * from, and is refused, with the current document, when someone wrote since. Nothing here knows what a document means.
 */
export const SYNC_PROTOCOL_VERSION = 1

export const SYNC_LIMITS = Object.freeze({
  /** Longest document id, in UTF-16 code units. */
  maxIdLength: 256,
  /** Longest document, in UTF-16 code units, unless the host sets another. A server enforces its own limit in bytes. */
  maxDocumentChars: 1_048_576
})

/** A stored document and the revision it has. Revisions start at 1. */
export interface RemoteRecord {
  readonly revision: number
  readonly document: string
}

export type PutResult =
  | { readonly status: 'saved', readonly revision: number }
  /** `current` is what the server holds now, or `null` when it holds nothing under the id (it was deleted). */
  | { readonly status: 'conflict', readonly current: RemoteRecord | null }

/**
 * What a backend must offer. Failures that are not a conflict reject with a `SyncTransportError`; any other rejection is
 * treated as a retryable network failure.
 */
export interface SyncTransport {
  get: (id: string, signal: AbortSignal) => Promise<RemoteRecord | null>
  /** `baseRevision` is the revision the document was edited from; `0` means "only if nothing is stored". */
  put: (id: string, document: string, baseRevision: number, signal: AbortSignal) => Promise<PutResult>
}

export type SyncErrorKind = 'network' | 'unauthorized' | 'too-large' | 'rejected' | 'server' | 'invalid-response'

export class SyncTransportError extends Error {
  readonly kind: SyncErrorKind
  readonly status: number | null
  /** Whether trying again later can help. Network failures, 408, 429 and 5xx can; 400, 401, 403 and 413 cannot. */
  readonly retryable: boolean
  constructor (kind: SyncErrorKind, message: string, options: { status?: number | null, retryable?: boolean } = {}) {
    super(message)
    this.name = 'SyncTransportError'
    this.kind = kind
    this.status = options.status ?? null
    this.retryable = options.retryable ?? (kind === 'network' || kind === 'server')
  }
}

export function validateSyncId (id: unknown): asserts id is string {
  if (typeof id !== 'string' || id.length === 0 || id.length > SYNC_LIMITS.maxIdLength) throw new RangeError(`A sync id is 1 to ${SYNC_LIMITS.maxIdLength} characters`)
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(id)) throw new RangeError('A sync id has no control characters')
}
