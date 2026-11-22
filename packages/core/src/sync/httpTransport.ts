import { SYNC_LIMITS, SyncTransportError, validateSyncId, type PutResult, type RemoteRecord, type SyncTransport } from './types'

export interface HttpTransportOptions {
  /** `https://host/prefix`; documents live at `<baseUrl>/<id>`. Plain `http` is accepted only for loopback. */
  baseUrl: string
  fetch?: typeof fetch
  /** Called for every request: the place for `Authorization`. Never logged or stored here. */
  headers?: () => Record<string, string> | Promise<Record<string, string>>
  /** Request options such as `credentials: 'include'`. Method, body, headers, signal and redirect cannot be set. */
  init?: Omit<RequestInit, 'method' | 'body' | 'headers' | 'signal' | 'redirect'>
  /** Per request. Default 15 000 ms. */
  timeoutMs?: number
  maxDocumentChars?: number
}

/**
 * The HTTP binding of the sync protocol (docs/SYNC-PROTOCOL.md): `GET` and `PUT` on `<baseUrl>/<id>`, `If-Match` /
 * `If-None-Match` for the base revision, `412` for a conflict. Redirects are refused so credentials never follow one.
 */
export function createHttpTransport (options: HttpTransportOptions): SyncTransport {
  const base = parseBase(options.baseUrl)
  const doFetch = options.fetch ?? globalThis.fetch?.bind(globalThis)
  if (typeof doFetch !== 'function') throw new TypeError('No fetch available: pass options.fetch')
  const timeoutMs = options.timeoutMs ?? 15_000
  const maxChars = options.maxDocumentChars ?? SYNC_LIMITS.maxDocumentChars
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000) throw new RangeError('timeoutMs must be between 1 and 600000')
  const maxBody = maxChars * 6 + 4096 // JSON escaping can turn one character into six

  async function call (id: string, method: 'GET' | 'PUT', outer: AbortSignal, headers: Record<string, string>, body?: string): Promise<{ status: number, text: string }> {
    validateSyncId(id)
    // The caller's signal and a timeout, whichever comes first.
    const control = new AbortController()
    const stop = (): void => { control.abort() }
    if (outer.aborted) stop(); else outer.addEventListener('abort', stop, { once: true })
    const timer = setTimeout(stop, timeoutMs)
    const signal = control.signal
    let response: Response
    try {
      const extra = options.headers === undefined ? {} : await options.headers()
      response = await doFetch(`${base}/${encodeURIComponent(id)}`, { ...options.init, method, body, headers: { accept: 'application/json', ...extra, ...headers }, signal, redirect: 'error' })
    } catch (error) {
      clearTimeout(timer); outer.removeEventListener('abort', stop)
      throw new SyncTransportError('network', error instanceof Error ? error.message : 'The request failed')
    }
    let text: string
    try {
      const length = Number(response.headers.get('content-length'))
      if (Number.isFinite(length) && length > maxBody) { void response.body?.cancel().catch(() => {}); throw new SyncTransportError('too-large', 'The response is larger than allowed', { status: response.status, retryable: false }) }
      text = await response.text()
    } catch (error) {
      throw error instanceof SyncTransportError ? error : new SyncTransportError('network', error instanceof Error ? error.message : 'The response could not be read')
    } finally { clearTimeout(timer); outer.removeEventListener('abort', stop) }
    if (text.length > maxBody) throw new SyncTransportError('too-large', 'The response is larger than allowed', { status: response.status, retryable: false })
    return { status: response.status, text }
  }

  return {
    async get (id, signal) {
      const { status, text } = await call(id, 'GET', signal, {})
      if (status === 404) return null
      if (status === 200) return record(parse(text, status), status, maxChars)
      throw failure(status)
    },
    async put (id, document, baseRevision, signal): Promise<PutResult> {
      if (!Number.isSafeInteger(baseRevision) || baseRevision < 0) throw new RangeError('The base revision is a non-negative integer')
      const headers: Record<string, string> = { 'content-type': 'application/json', ...(baseRevision === 0 ? { 'if-none-match': '*' } : { 'if-match': `"${baseRevision}"` }) }
      const { status, text } = await call(id, 'PUT', signal, headers, JSON.stringify({ document }))
      if (status === 200 || status === 201) {
        const value = parse(text, status)
        if (!Number.isSafeInteger(value.revision)) throw new SyncTransportError('invalid-response', 'The server gave no revision', { status, retryable: false })
        return { status: 'saved', revision: value.revision as number }
      }
      if (status === 412) {
        const value = parse(text, status)
        if (value.current === null) return { status: 'conflict', current: null }
        return { status: 'conflict', current: record(value.current, status, maxChars) }
      }
      throw failure(status)
    }
  }
}

function parseBase (value: string): string {
  let url: URL
  try { url = new URL(value) } catch { throw new RangeError('baseUrl is not a URL') }
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new RangeError('baseUrl must be https (http only for localhost)')
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') throw new RangeError('baseUrl has no credentials, query or fragment')
  return url.origin + url.pathname.replace(/\/+$/, '')
}

function parse (text: string, status: number): Record<string, unknown> {
  let value: unknown
  try { value = JSON.parse(text) } catch { throw new SyncTransportError('invalid-response', 'The server did not answer with JSON', { status, retryable: false }) }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new SyncTransportError('invalid-response', 'The server did not answer with a JSON object', { status, retryable: false })
  return value as Record<string, unknown>
}

function record (value: unknown, status: number, maxChars: number): RemoteRecord {
  const v = value as { revision?: unknown, document?: unknown } | null
  if (typeof v !== 'object' || v === null || !Number.isSafeInteger(v.revision) || (v.revision as number) < 1 || typeof v.document !== 'string') throw new SyncTransportError('invalid-response', 'The server gave a document that is not a revision and a string', { status, retryable: false })
  if (v.document.length > maxChars) throw new SyncTransportError('too-large', `The server's document is longer than ${maxChars} characters`, { status, retryable: false })
  return { revision: v.revision as number, document: v.document }
}

function failure (status: number): SyncTransportError {
  if (status === 401 || status === 403) return new SyncTransportError('unauthorized', `Not allowed (${status})`, { status, retryable: false })
  if (status === 413) return new SyncTransportError('too-large', 'The server refused the document as too large', { status, retryable: false })
  if (status === 408 || status === 429 || status >= 500) return new SyncTransportError('server', `The server could not take the request now (${status})`, { status, retryable: true })
  return new SyncTransportError('rejected', `The server refused the request (${status})`, { status, retryable: false })
}
