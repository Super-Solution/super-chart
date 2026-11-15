/**
 * Saving, upgrading, invalidating and syncing a Super Chart workspace.
 *
 * `workspace.exportDocument()` returns one strictly validated JSON string (schema version 1: market, candle mode, render
 * options, layout, indicators, drawings). It never contains code, layers, feed subscriptions or annotations: those are
 * the host's. This file is the host's side of saving it, in four steps that every product needs:
 *
 *   1. save      wrap the document in an envelope that records who saved it, when, and which revision;
 *   2. upgrade   read envelopes written by older versions of *this app* (the chart's own document has its own version);
 *   3. invalidate restore what still makes sense when the world has changed (an indicator was removed, a market delisted);
 *   4. sync      push and pull envelopes between devices, and report a conflict instead of guessing.
 *
 * Everything here is plain TypeScript over the public API, so it is a starting point to copy, not a package.
 */
import type { ChartWorkspace, SymbolInfo, Period } from '@supersolutions/super-chart-web'

/** The app's own envelope version. The chart document inside has its own (`version: 1`) and is checked by the chart. */
export const ENVELOPE_SCHEMA = 2

export interface Envelope {
  readonly schema: typeof ENVELOPE_SCHEMA
  /** The result of `workspace.exportDocument()`, kept as an opaque string so it round-trips byte for byte. */
  readonly document: string
  /** Milliseconds since the epoch on the saving device. Informational: ordering uses `revision`. */
  readonly savedAt: number
  /** Increases by one on every save of the same workspace, on whichever device saves it. */
  readonly revision: number
  readonly deviceId: string
}

/** Envelope schema 1 (an older version of this app): no revision, no device. */
interface EnvelopeV1 { readonly schema: 1, readonly document: string, readonly savedAt: number }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Reads stored text. Returns the current envelope, upgrading schema 1 on the way, or:
 *   `null`            nothing stored, or the text is not a recognizable envelope (corrupt, hand-edited);
 *   `'newer-than-app'` written by a newer version of this app: do not read it, and do not overwrite it blindly.
 */
export function readEnvelope (text: string | null): Envelope | null | 'newer-than-app' {
  if (text === null) return null
  let value: unknown
  try { value = JSON.parse(text) } catch { return null }
  if (!isRecord(value) || typeof value.document !== 'string' || typeof value.savedAt !== 'number') return null
  if (typeof value.schema === 'number' && value.schema > ENVELOPE_SCHEMA) return 'newer-than-app'
  if (value.schema === 1) return upgradeV1(value as unknown as EnvelopeV1)
  if (value.schema === ENVELOPE_SCHEMA && Number.isSafeInteger(value.revision) && typeof value.deviceId === 'string') return value as unknown as Envelope
  return null
}
function upgradeV1 (old: EnvelopeV1): Envelope {
  // A schema 1 save has no revision: treat it as revision 0 from an unknown device, older than any save that follows.
  return { schema: ENVELOPE_SCHEMA, document: old.document, savedAt: old.savedAt, revision: 0, deviceId: 'unknown' }
}

/** Saves the current workspace. `previous` is the envelope being replaced, if any, so revisions only ever go up. */
export function saveEnvelope (workspace: ChartWorkspace, deviceId: string, previous: Envelope | null, now = Date.now()): Envelope {
  // Throws until a market has loaded: there is nothing meaningful to save before that.
  const document = workspace.exportDocument()
  return { schema: ENVELOPE_SCHEMA, document, savedAt: now, revision: (previous?.revision ?? 0) + 1, deviceId }
}

export type RestoreOutcome =
  | { readonly status: 'restored', readonly droppedIndicators: readonly string[] }
  /** The saved market is gone (delisted, no longer entitled): nothing was applied. */
  | { readonly status: 'invalidated', readonly reason: 'market-unavailable' | 'unreadable' }
  /** The feed failed or the person changed market while it loaded. The chart shows what the feed produced. */
  | { readonly status: 'not-applied', readonly result: string }

export interface RestorePolicy {
  /** Return false when the saved market can no longer be shown. Default: every market is available. */
  readonly isMarketAvailable?: (symbol: SymbolInfo, period: Period) => boolean
}

/**
 * Restores an envelope into a live workspace, repairing what changed since it was saved.
 * The chart validates the whole document before touching anything, so a failure leaves the current chart as it was.
 */
export async function restoreEnvelope (workspace: ChartWorkspace, envelope: Envelope, policy: RestorePolicy = {}): Promise<RestoreOutcome> {
  let document: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(envelope.document)
    if (!isRecord(parsed)) return { status: 'invalidated', reason: 'unreadable' }
    document = parsed
  } catch { return { status: 'invalidated', reason: 'unreadable' } }
  const symbol = document.symbol as SymbolInfo, period = document.period as Period
  if (policy.isMarketAvailable !== undefined && !policy.isMarketAvailable(symbol, period)) return { status: 'invalidated', reason: 'market-unavailable' }
  // An indicator the app no longer registers would make the chart refuse the whole document. Drop it and say so.
  const registered = new Set(workspace.chart.getRegisteredIndicatorNames())
  const indicators = Array.isArray(document.indicators) ? document.indicators as Array<{ name?: unknown }> : []
  const kept = indicators.filter(item => typeof item.name === 'string' && registered.has(item.name))
  const droppedIndicators = indicators.filter(item => !kept.includes(item)).map(item => String(item.name))
  const repaired = droppedIndicators.length === 0 ? envelope.document : JSON.stringify({ ...document, indicators: kept })
  try {
    const result = await workspace.restoreDocument(repaired)
    return result.status === 'loaded' || result.status === 'unchanged' ? { status: 'restored', droppedIndicators } : { status: 'not-applied', result: result.status }
  } catch { return { status: 'invalidated', reason: 'unreadable' } }
}

// ---- cross-device sync ------------------------------------------------------------------------------------------------

/** What a server must offer: read the stored envelope with its version tag, and write only if the tag still matches. */
export interface RemoteStore {
  get: (id: string) => Promise<{ readonly etag: string, readonly envelope: Envelope } | null>
  /** `ifMatch` is the etag you read (null = "only if nothing is stored"). Resolves `'conflict'` when someone wrote since. */
  put: (id: string, envelope: Envelope, ifMatch: string | null) => Promise<{ readonly etag: string } | 'conflict'>
}
export type SyncOutcome =
  | { readonly status: 'same' }
  | { readonly status: 'pushed', readonly envelope: Envelope }
  | { readonly status: 'pulled', readonly envelope: Envelope }
  /** Both sides changed since they last agreed. Nothing was overwritten: show both and let the person choose. */
  | { readonly status: 'conflict', readonly local: Envelope, readonly remote: Envelope }

/**
 * One sync round for workspace `id`. `local` is this device's newest envelope; `base` is the revision both sides last
 * agreed on (store it after every successful sync). Revisions decide direction: only-local-changed pushes,
 * only-remote-changed pulls, both changed is a conflict.
 */
export async function syncEnvelope (remote: RemoteStore, id: string, local: Envelope | null, base: number): Promise<SyncOutcome> {
  const stored = await remote.get(id)
  if (stored === null) {
    if (local === null) return { status: 'same' }
    const put = await remote.put(id, local, null)
    return put === 'conflict' ? syncEnvelope(remote, id, local, base) : { status: 'pushed', envelope: local }
  }
  // The very envelope the server holds (same revision, same device): already in sync, whatever `base` says.
  if (local !== null && local.revision === stored.envelope.revision && local.deviceId === stored.envelope.deviceId) return { status: 'same' }
  const remoteChanged = stored.envelope.revision > base, localChanged = local !== null && local.revision > base
  if (!remoteChanged && !localChanged) return { status: 'same' }
  if (remoteChanged && !localChanged) return { status: 'pulled', envelope: stored.envelope }
  if (!remoteChanged && local !== null) {
    const put = await remote.put(id, local, stored.etag)
    // Someone wrote between our read and our write: start over, now seeing their revision.
    return put === 'conflict' ? syncEnvelope(remote, id, local, base) : { status: 'pushed', envelope: local }
  }
  return { status: 'conflict', local: local as Envelope, remote: stored.envelope }
}

/** An in-memory `RemoteStore` with real compare-and-set semantics, for tests and local development. */
export function createMemoryRemote (): RemoteStore & { readonly size: number } {
  const rows = new Map<string, { etag: number, envelope: Envelope }>()
  return {
    get size () { return rows.size },
    get: async id => { const row = rows.get(id); return row === undefined ? null : { etag: String(row.etag), envelope: row.envelope } },
    put: async (id, envelope, ifMatch) => {
      const row = rows.get(id)
      if ((row === undefined ? null : String(row.etag)) !== ifMatch) return 'conflict'
      const etag = (row?.etag ?? 0) + 1
      rows.set(id, { etag, envelope }); return { etag: String(etag) }
    }
  }
}
