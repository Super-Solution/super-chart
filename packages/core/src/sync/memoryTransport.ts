import { SYNC_LIMITS, SyncTransportError, validateSyncId, type PutResult, type RemoteRecord, type SyncTransport } from './types'

/**
 * A `SyncTransport` that keeps documents in memory with the protocol's real compare-and-set rule. For development, demos
 * and tests; it is also the reference for what a backend must decide.
 */
export function createMemoryTransport (options: { maxDocumentChars?: number } = {}): SyncTransport & { readonly size: number } {
  const limit = options.maxDocumentChars ?? SYNC_LIMITS.maxDocumentChars
  const rows = new Map<string, RemoteRecord>()
  return {
    get size () { return rows.size },
    get: async id => { validateSyncId(id); return rows.get(id) ?? null },
    put: async (id, document, baseRevision): Promise<PutResult> => {
      validateSyncId(id)
      if (document.length > limit) throw new SyncTransportError('too-large', `A document is at most ${limit} characters`, { status: 413, retryable: false })
      if (!Number.isSafeInteger(baseRevision) || baseRevision < 0) throw new SyncTransportError('rejected', 'The base revision is a non-negative integer', { status: 400, retryable: false })
      const current = rows.get(id) ?? null
      if ((current?.revision ?? 0) !== baseRevision) return { status: 'conflict', current }
      const revision = baseRevision + 1
      rows.set(id, { revision, document })
      return { status: 'saved', revision }
    }
  }
}
