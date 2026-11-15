/** Host-owned persistence: writes are synchronous acknowledgements, not fire-and-forget. */
export interface WorkspaceDrawingStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}
export interface WorkspaceDrawingCacheOptions {
  /** Namespace is explicit; nothing is written to browser storage by default. */
  namespace: string
  storage: WorkspaceDrawingStorage
  maxSymbols?: number
  /** Approximate UTF-16 string bytes in the in-memory document cache. */
  maxBytes?: number
}

export class DrawingDocuments {
  private readonly entries = new Map<string, { json: string, saved: boolean }>()
  private readonly maxSymbols: number
  private readonly maxBytes: number

  constructor (private readonly options?: WorkspaceDrawingCacheOptions) {
    this.maxSymbols = options?.maxSymbols ?? 8
    this.maxBytes = options?.maxBytes ?? 2 * 1024 * 1024
    if (options !== undefined && (typeof options.namespace !== 'string' || options.namespace.trim() === '' || options.namespace.length > 256)) throw new RangeError('Drawing storage needs a bounded nonempty namespace')
    if (!Number.isSafeInteger(this.maxSymbols) || this.maxSymbols < 0 || !Number.isSafeInteger(this.maxBytes) || this.maxBytes < 0) throw new RangeError('Drawing cache limits must be nonnegative safe integers')
  }

  get (symbol: string): string | undefined {
    const cached = this.entries.get(symbol)
    if (cached !== undefined) { this.entries.delete(symbol); this.entries.set(symbol, cached); return cached.json }
    // The current DrawingStore owns the loaded document. Do not duplicate it here.
    return this.options?.storage.getItem(this.key(symbol)) ?? undefined
  }

  set (symbol: string, json: string): void {
    const previous = this.entries.get(symbol)
    if (previous?.json === json && previous.saved) return
    this.entries.delete(symbol)
    // Preserve the in-memory copy before calling storage: quota errors never evict it.
    const entry = { json, saved: false }
    this.entries.set(symbol, entry)
    if (this.options !== undefined) {
      const result: unknown = this.options.storage.setItem(this.key(symbol), json)
      if (result !== null && (typeof result === 'object' || typeof result === 'function') && typeof (result as { then?: unknown }).then === 'function') {
        // Do not acknowledge or evict while a mistaken async adapter is still pending.
        void Promise.resolve(result).catch(() => {})
        throw new TypeError('Drawing storage setItem must finish synchronously')
      }
      entry.saved = true
      this.trim()
    } else if (json === '{"version":1,"drawings":[]}') {
      this.entries.delete(symbol)
    }
  }

  getStats (): { symbols: number, bytes: number, unsaved: number } {
    let bytes = 0, unsaved = 0
    for (const [key, entry] of this.entries) { bytes += (key.length + entry.json.length) * 2; if (!entry.saved) unsaved++ }
    return { symbols: this.entries.size, bytes, unsaved }
  }

  clear (): void { this.entries.clear() }

  private key (symbol: string): string { return 'super-chart:drawings:' + JSON.stringify([this.options?.namespace, symbol]) }
  private trim (): void {
    let { bytes } = this.getStats()
    for (const [key, entry] of this.entries) {
      if (this.entries.size <= this.maxSymbols && bytes <= this.maxBytes) break
      if (!entry.saved) continue
      bytes -= (key.length + entry.json.length) * 2
      this.entries.delete(key)
    }
  }
}
