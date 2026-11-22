/** Document sync for chart state (drawings, workspaces): protocol types, the client, transports. No DOM. */
export { SYNC_PROTOCOL_VERSION, SYNC_LIMITS, SyncTransportError, validateSyncId } from './sync/types'
export type { RemoteRecord, PutResult, SyncTransport, SyncErrorKind } from './sync/types'
export { DocumentSync } from './sync/documentSync'
export type { DocumentSyncOptions, DocumentSyncEvents, DocumentSyncState, SyncJournal, SyncConflict, ConflictDecision, ConflictPolicy, PullResult, FlushResult } from './sync/documentSync'
export { createHttpTransport } from './sync/httpTransport'
export type { HttpTransportOptions } from './sync/httpTransport'
export { createMemoryTransport } from './sync/memoryTransport'
export { mergeDrawingDocuments } from './model/drawings'
