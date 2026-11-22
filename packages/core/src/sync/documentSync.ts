import { SYNC_LIMITS, SyncTransportError, validateSyncId, type RemoteRecord, type SyncTransport } from './types'

/** Where a document stands. `offline` and `error` keep the edit; `conflict` keeps both sides and waits for a decision. */
export type DocumentSyncState = 'idle' | 'pending' | 'saving' | 'offline' | 'conflict' | 'error'

/** Synchronous key-value storage for edits not yet saved (`localStorage` fits). Optional: without it a reload loses them. */
export interface SyncJournal {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

export interface SyncConflict {
  readonly id: string
  /** This device's unsaved document. */
  readonly local: string
  /** The server's document, or `null` when the server holds none. */
  readonly remote: string | null
  readonly remoteRevision: number
}

/** What to do when both sides changed. A document string is a merge result: it is saved and shown. */
export type ConflictDecision = 'local' | 'remote' | string
export type ConflictPolicy = 'ask' | 'local' | 'remote' | ((conflict: SyncConflict) => ConflictDecision | null | Promise<ConflictDecision | null>)

export interface DocumentSyncOptions {
  transport: SyncTransport
  /** Quiet time after the last change before it is written. Default 1000 ms. */
  debounceMs?: number
  /** A change is written at the latest this long after the first unsaved one, however busy the edits. Default 10 000 ms. */
  maxWaitMs?: number
  /** Delay before the first retry after a failure; it doubles up to `retryMaxMs`. Defaults 1000 and 60 000 ms. */
  retryBaseMs?: number
  retryMaxMs?: number
  /** Longest document accepted, in UTF-16 code units. Default `SYNC_LIMITS.maxDocumentChars`. */
  maxDocumentChars?: number
  journal?: SyncJournal
  /** Keeps two apps' journals apart in one storage. Default `default`. */
  namespace?: string
  /** Default `'ask'`: emit `conflict` and change nothing until `resolve()`. */
  conflict?: ConflictPolicy
  /** For tests and hosts without global timers. */
  timers?: { setTimeout: (callback: () => void, ms: number) => unknown, clearTimeout: (handle: unknown) => void, now: () => number }
}

export interface DocumentSyncEvents {
  /** A document's state changed. `pending` says whether an unsaved edit is held. */
  state: { id: string, state: DocumentSyncState, pending: boolean, error: SyncTransportError | null }
  /** The server's document is to be shown: pulled, taken in a conflict, or merged. The host applies it. */
  document: { id: string, document: string, revision: number, reason: 'pull' | 'conflict-remote' | 'merged' }
  conflict: SyncConflict
}

export type PullResult =
  | { status: 'empty' }
  | { status: 'remote', document: string, revision: number }
  /** The server's document is the one this device already agreed on (or the unsaved edit equals it). `document` is that text. */
  | { status: 'unchanged', revision: number, document: string }
  | { status: 'pending' }
  | { status: 'conflict' }
  | { status: 'failed', error: SyncTransportError }

export type FlushResult = { status: 'saved', revision: number } | { status: 'idle' } | { status: 'conflict' } | { status: 'failed', error: SyncTransportError }

interface Entry {
  id: string
  /** The revision both sides last agreed on; 0 when the server held nothing. */
  base: number
  /** The document at `base` as this device last saw it (equal to the server's at that revision), or `null`. */
  synced: string | null
  /** The unsaved edit, or `null`. */
  local: string | null
  state: DocumentSyncState
  error: SyncTransportError | null
  firstEditAt: number
  timer: unknown
  retries: number
  /** The write or read now running; one at a time per id. */
  running: Promise<unknown> | null
  abort: AbortController | null
  conflict: SyncConflict | null
  /** Conflicts settled by the policy since the last save or decision. */
  automatic: number
}

type Listener<K extends keyof DocumentSyncEvents> = (event: DocumentSyncEvents[K]) => void

const JOURNAL_VERSION = 1
const MAX_AUTOMATIC_RESOLUTIONS = 3

/**
 * Keeps documents in step with a server, one id at a time, without losing an edit and without overwriting a newer one.
 *
 * - `set(id, document)` records an edit; it is written after a quiet moment, and again after any failure, with growing
 *   delays, for as long as the instance lives. With a `journal` the edit also survives a reload.
 * - `pull(id)` brings this device up to date: the server's document comes back through the `document` event, unless there
 *   is an unsaved edit, in which case the two are compared by revision and a conflict is raised if both changed.
 * - A conflict is never resolved silently: the default policy waits for `resolve()`.
 *
 * Plain TypeScript with no DOM; timers can be replaced.
 */
export class DocumentSync {
  private readonly entries = new Map<string, Entry>()
  private readonly listeners = new Map<keyof DocumentSyncEvents, Set<Listener<never>>>()
  private readonly transport: SyncTransport
  private readonly debounceMs: number
  private readonly maxWaitMs: number
  private readonly retryBaseMs: number
  private readonly retryMaxMs: number
  private readonly maxChars: number
  private readonly journal: SyncJournal | undefined
  private readonly namespace: string
  private readonly policy: ConflictPolicy
  private readonly timers: NonNullable<DocumentSyncOptions['timers']>
  private disposed = false

  constructor (options: DocumentSyncOptions) {
    if (typeof options.transport?.get !== 'function' || typeof options.transport.put !== 'function') throw new TypeError('A sync transport needs get and put')
    this.transport = options.transport
    this.debounceMs = bounded(options.debounceMs, 1000, 0, 60_000, 'debounceMs')
    this.maxWaitMs = bounded(options.maxWaitMs, 10_000, 0, 600_000, 'maxWaitMs')
    this.retryBaseMs = bounded(options.retryBaseMs, 1000, 1, 600_000, 'retryBaseMs')
    this.retryMaxMs = bounded(options.retryMaxMs, 60_000, this.retryBaseMs, 3_600_000, 'retryMaxMs')
    this.maxChars = bounded(options.maxDocumentChars, SYNC_LIMITS.maxDocumentChars, 1, 64 * 1024 * 1024, 'maxDocumentChars')
    this.journal = options.journal
    this.namespace = options.namespace ?? 'default'
    if (typeof this.namespace !== 'string' || this.namespace.length === 0 || this.namespace.length > 256) throw new RangeError('The sync namespace is 1 to 256 characters')
    this.policy = options.conflict ?? 'ask'
    this.timers = options.timers ?? { setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms), clearTimeout: handle => { globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>) }, now: () => Date.now() }
  }

  on<K extends keyof DocumentSyncEvents> (type: K, listener: Listener<K>): () => void {
    const set = this.listeners.get(type) ?? new Set<Listener<never>>()
    this.listeners.set(type, set)
    set.add(listener as Listener<never>)
    return () => { set.delete(listener as Listener<never>) }
  }

  getState (id: string): { state: DocumentSyncState, pending: boolean, revision: number, error: SyncTransportError | null } {
    const entry = this.entries.get(id)
    return entry === undefined ? { state: 'idle', pending: false, revision: 0, error: null } : { state: entry.state, pending: entry.local !== null, revision: entry.base, error: entry.error }
  }

  /** Records an edit. Throws a RangeError when the document is too long; the previous edit stays. */
  set (id: string, document: string): void {
    this.assertLive()
    validateSyncId(id)
    if (typeof document !== 'string') throw new TypeError('A sync document is a string')
    if (document.length > this.maxChars) throw new RangeError(`A sync document is at most ${this.maxChars} characters`)
    const entry = this.entry(id)
    if (entry.conflict !== null) { entry.local = document; this.remember(entry); entry.conflict = { ...entry.conflict, local: document }; return }
    if (entry.local === null && document === entry.synced) return
    if (entry.local === null) entry.firstEditAt = this.timers.now()
    entry.local = document
    // An edit that puts the document back as the server has it needs no write.
    if (document === entry.synced) { entry.local = null; this.forget(entry); this.cancelTimer(entry); this.setState(entry, 'idle'); return }
    this.remember(entry)
    this.setState(entry, entry.state === 'offline' || entry.state === 'error' ? entry.state : 'pending')
    if (entry.state === 'pending') this.schedule(entry, this.debounceMs)
  }

  /** Brings this device up to date with the server. See `PullResult`. */
  async pull (id: string): Promise<PullResult> {
    this.assertLive()
    validateSyncId(id)
    const entry = this.entry(id)
    return await this.serial(entry, async () => await this.pullNow(entry)) as PullResult
  }

  /** Writes any unsaved edit now. Resolves when it is saved, or says why not. */
  async flush (id: string): Promise<FlushResult> {
    this.assertLive()
    validateSyncId(id)
    const entry = this.entry(id)
    this.cancelTimer(entry)
    return await this.serial(entry, async () => await this.pushNow(entry)) as FlushResult
  }

  async flushAll (): Promise<void> {
    await Promise.all([...this.entries.keys()].map(async id => await this.flush(id)))
  }

  /** Call when the network is back (`online` event): retries every failed document without waiting out its delay. */
  retryNow (): void {
    if (this.disposed) return
    for (const entry of this.entries.values()) {
      if (entry.local !== null && (entry.state === 'offline' || entry.state === 'error') && entry.conflict === null) { entry.retries = 0; this.cancelTimer(entry); void this.flush(entry.id) }
    }
  }

  /** Settles a conflict: `'local'` writes this device's document over the server's, `'remote'` drops it, a string is a merge. */
  async resolve (id: string, decision: ConflictDecision): Promise<FlushResult> {
    this.assertLive()
    const entry = this.entries.get(id)
    if (entry?.conflict === undefined || entry.conflict === null) return { status: 'idle' }
    entry.automatic = 0
    return await this.serial(entry, async () => await this.applyDecision(entry, decision)) as FlushResult
  }

  /** Stops timers and requests. Unsaved edits stay in the journal, if there is one. */
  dispose (): void {
    this.disposed = true
    for (const entry of this.entries.values()) { this.cancelTimer(entry); entry.abort?.abort() }
    this.listeners.clear()
  }

  // ---- internals -------------------------------------------------------------------------------------------------------

  private async pullNow (entry: Entry): Promise<PullResult> {
    let remote: RemoteRecord | null
    try { remote = await this.get(entry) } catch (error) { return { status: 'failed', error: this.failure(entry, error, false) } }
    if (this.disposed) return { status: 'failed', error: new SyncTransportError('network', 'disposed', { retryable: false }) }
    if (entry.conflict !== null) return { status: 'conflict' }
    if (entry.local === null) {
      if (remote === null) { entry.base = 0; entry.synced = null; return { status: 'empty' } }
      if (remote.revision === entry.base && remote.document === entry.synced) return { status: 'unchanged', revision: remote.revision, document: remote.document }
      entry.base = remote.revision; entry.synced = remote.document
      this.emit('document', { id: entry.id, document: remote.document, revision: remote.revision, reason: 'pull' })
      return { status: 'remote', document: remote.document, revision: remote.revision }
    }
    // An unsaved edit: the server's side only matters if it moved on from the revision the edit was made from.
    if ((remote?.revision ?? 0) === entry.base) { this.schedule(entry, 0); return { status: 'pending' } }
    if (remote !== null && remote.document === entry.local) { this.markSaved(entry, remote.revision, entry.local); return { status: 'unchanged', revision: remote.revision, document: remote.document } }
    const settled = await this.conflict(entry, remote)
    return { status: settled.status === 'conflict' ? 'conflict' : 'pending' }
  }

  private async pushNow (entry: Entry): Promise<FlushResult> {
    if (entry.conflict !== null) return { status: 'conflict' }
    const document = entry.local
    if (document === null) return { status: 'idle' }
    this.setState(entry, 'saving')
    let result
    try { result = await this.put(entry, document, entry.base) } catch (error) { return { status: 'failed', error: this.failure(entry, error, true) } }
    if (this.disposed) return { status: 'failed', error: new SyncTransportError('network', 'disposed', { retryable: false }) }
    if (result.status === 'saved') return this.saved(entry, result.revision, document)
    // Refused: someone wrote since. If they wrote what we hold (a retry whose answer was lost), the write already happened.
    if (result.current !== null && result.current.document === document) return this.saved(entry, result.current.revision, document)
    return await this.conflict(entry, result.current)
  }

  private saved (entry: Entry, revision: number, document: string): FlushResult {
    this.markSaved(entry, revision, document)
    return { status: 'saved', revision }
  }

  /** The server holds `document` at `revision`. An edit made while the write was running stays pending. */
  private markSaved (entry: Entry, revision: number, document: string): void {
    entry.base = revision; entry.synced = document; entry.retries = 0; entry.error = null; entry.automatic = 0
    if (entry.local === document || entry.local === null) { entry.local = null; this.forget(entry); this.cancelTimer(entry); this.setState(entry, 'idle') } else {
      this.remember(entry); this.setState(entry, 'pending'); this.schedule(entry, this.debounceMs)
    }
  }

  private async conflict (entry: Entry, remote: RemoteRecord | null): Promise<FlushResult> {
    const conflict: SyncConflict = { id: entry.id, local: entry.local ?? '', remote: remote?.document ?? null, remoteRevision: remote?.revision ?? 0 }
    let decision: ConflictDecision | null
    try {
      decision = this.policy === 'ask' ? null : typeof this.policy === 'function' ? await this.policy(conflict) : this.policy
    } catch { decision = null }
    // A policy that keeps losing the race (a busy writer, a server that always refuses) stops after a few tries and asks.
    entry.automatic += 1
    if (decision === null || entry.automatic > MAX_AUTOMATIC_RESOLUTIONS || (typeof decision === 'string' && decision.length > this.maxChars)) {
      entry.conflict = conflict
      this.cancelTimer(entry)
      this.setState(entry, 'conflict')
      this.emit('conflict', conflict)
      return { status: 'conflict' }
    }
    entry.conflict = conflict
    return await this.applyDecision(entry, decision)
  }

  private async applyDecision (entry: Entry, decision: ConflictDecision): Promise<FlushResult> {
    const conflict = entry.conflict
    if (conflict === null) return { status: 'idle' }
    // A decision is made against the server's revision as seen now; a write that loses again is a new conflict.
    entry.conflict = null
    if (decision === 'remote') {
      entry.base = conflict.remoteRevision; entry.synced = conflict.remote; entry.local = null; entry.retries = 0; entry.error = null
      this.forget(entry); this.cancelTimer(entry); this.setState(entry, 'idle')
      if (conflict.remote !== null) this.emit('document', { id: entry.id, document: conflict.remote, revision: conflict.remoteRevision, reason: 'conflict-remote' })
      return { status: 'idle' }
    }
    const document = decision === 'local' ? entry.local ?? conflict.local : decision
    if (document.length > this.maxChars) { entry.conflict = conflict; this.setState(entry, 'conflict'); return { status: 'conflict' } }
    entry.base = conflict.remoteRevision
    entry.synced = conflict.remote
    entry.local = document
    this.remember(entry)
    if (decision !== 'local') this.emit('document', { id: entry.id, document, revision: conflict.remoteRevision, reason: 'merged' })
    return await this.pushNow(entry)
  }

  private async get (entry: Entry): Promise<RemoteRecord | null> {
    const abort = new AbortController()
    entry.abort = abort
    try {
      const record = await this.transport.get(entry.id, abort.signal)
      if (record !== null) checkRecord(record, this.maxChars)
      return record
    } finally { if (entry.abort === abort) entry.abort = null }
  }

  private async put (entry: Entry, document: string, base: number): ReturnType<SyncTransport['put']> {
    const abort = new AbortController()
    entry.abort = abort
    try {
      const result = await this.transport.put(entry.id, document, base, abort.signal)
      if (result.status === 'saved') { if (!Number.isSafeInteger(result.revision) || result.revision <= base) throw new SyncTransportError('invalid-response', 'The server gave a revision that does not follow the one it was written on top of', { retryable: false }) } else if (result.current !== null) checkRecord(result.current, this.maxChars)
      return result
    } finally { if (entry.abort === abort) entry.abort = null }
  }

  /** Records a failed request: retry later when it can help, otherwise stop and say so. */
  private failure (entry: Entry, error: unknown, writing: boolean): SyncTransportError {
    const failure = error instanceof SyncTransportError ? error : new SyncTransportError('network', error instanceof Error ? error.message : 'The request failed')
    entry.error = failure
    if (writing || entry.local !== null) {
      this.setState(entry, failure.retryable ? 'offline' : 'error')
      if (failure.retryable && entry.local !== null && !this.disposed) {
        const delay = Math.min(this.retryMaxMs, this.retryBaseMs * 2 ** Math.min(entry.retries, 20))
        entry.retries += 1
        this.schedule(entry, delay)
      }
    } else this.emit('state', { id: entry.id, state: entry.state, pending: false, error: failure })
    return failure
  }

  private schedule (entry: Entry, delay: number): void {
    if (this.disposed || entry.conflict !== null) return
    this.cancelTimer(entry)
    const waited = this.timers.now() - entry.firstEditAt
    const wait = Math.max(0, Math.min(delay, entry.state === 'pending' ? this.maxWaitMs - waited : delay))
    entry.timer = this.timers.setTimeout(() => { entry.timer = null; void this.flush(entry.id).catch(() => {}) }, wait)
  }

  private cancelTimer (entry: Entry): void {
    if (entry.timer !== null) { this.timers.clearTimeout(entry.timer); entry.timer = null }
  }

  private async serial (entry: Entry, run: () => Promise<unknown>): Promise<unknown> {
    while (entry.running !== null) await entry.running.catch(() => {})
    const running = run()
    entry.running = running
    try { return await running } finally { if (entry.running === running) entry.running = null }
  }

  private entry (id: string): Entry {
    let entry = this.entries.get(id)
    if (entry === undefined) {
      entry = { id, base: 0, synced: null, local: null, state: 'idle', error: null, firstEditAt: 0, timer: null, retries: 0, running: null, abort: null, conflict: null, automatic: 0 }
      this.entries.set(id, entry)
      this.restore(entry)
    }
    return entry
  }

  private setState (entry: Entry, state: DocumentSyncState): void {
    const changed = entry.state !== state
    entry.state = state
    if (changed || state === 'offline' || state === 'error') this.emit('state', { id: entry.id, state, pending: entry.local !== null, error: entry.error })
  }

  private emit<K extends keyof DocumentSyncEvents> (type: K, event: DocumentSyncEvents[K]): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      // A listener that throws must not stop the others or the sync.
      try { (listener as Listener<K>)(event) } catch { /* ignored */ }
    }
  }

  private assertLive (): void { if (this.disposed) throw new Error('This DocumentSync was disposed') }

  // ---- journal ---------------------------------------------------------------------------------------------------------

  private key (id: string): string { return 'super-chart:sync:' + JSON.stringify([this.namespace, id]) }

  private remember (entry: Entry): void {
    if (this.journal === undefined || entry.local === null) return
    // A full or blocked storage must not lose the edit in memory: it stays pending and the failure is reported once.
    try { this.journal.setItem(this.key(entry.id), JSON.stringify({ v: JOURNAL_VERSION, base: entry.base, local: entry.local })) } catch (error) {
      entry.error = new SyncTransportError('rejected', error instanceof Error ? `The journal could not be written: ${error.message}` : 'The journal could not be written', { retryable: false })
      this.emit('state', { id: entry.id, state: entry.state, pending: true, error: entry.error })
    }
  }

  private forget (entry: Entry): void {
    if (this.journal === undefined) return
    try { this.journal.removeItem(this.key(entry.id)) } catch { /* nothing more to do */ }
  }

  private restore (entry: Entry): void {
    if (this.journal === undefined) return
    let text: string | null
    try { text = this.journal.getItem(this.key(entry.id)) } catch { return }
    if (text === null) return
    try {
      const value: unknown = JSON.parse(text)
      if (typeof value === 'object' && value !== null && (value as { v?: unknown }).v === JOURNAL_VERSION) {
        const { base, local } = value as { base?: unknown, local?: unknown }
        if (Number.isSafeInteger(base) && (base as number) >= 0 && typeof local === 'string' && local.length <= this.maxChars) {
          entry.base = base as number; entry.local = local; entry.state = 'pending'; entry.firstEditAt = this.timers.now()
          this.schedule(entry, this.debounceMs)
          return
        }
      }
    } catch { /* fall through */ }
    this.forget(entry) // Unreadable: drop it rather than fail on it at every start.
  }
}

function bounded (value: number | undefined, fallback: number, min: number, max: number, name: string): number {
  const result = value ?? fallback
  if (!Number.isFinite(result) || result < min || result > max) throw new RangeError(`${name} must be between ${min} and ${max}`)
  return result
}

function checkRecord (record: RemoteRecord, maxChars: number): void {
  if (typeof record !== 'object' || !Number.isSafeInteger(record.revision) || record.revision < 1 || typeof record.document !== 'string') throw new SyncTransportError('invalid-response', 'The server gave a document that is not a revision and a string', { retryable: false })
  if (record.document.length > maxChars) throw new SyncTransportError('too-large', `The server's document is longer than ${maxChars} characters`, { retryable: false })
}
