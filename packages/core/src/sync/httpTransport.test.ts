import { describe, expect, it } from 'vitest'
import { createHttpTransport } from './httpTransport'
import { SyncTransportError } from './types'

interface Call { url: string, method: string, headers: Record<string, string>, body: string | undefined, redirect: string | undefined }
function fakeFetch (responses: Array<{ status: number, body?: unknown, text?: string, headers?: Record<string, string> } | Error>) {
  const calls: Call[] = []
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, method: init.method ?? 'GET', headers: init.headers as Record<string, string>, body: init.body as string | undefined, redirect: init.redirect })
    const next = responses.shift()
    if (next === undefined) throw new Error('unexpected request')
    if (next instanceof Error) throw next
    return new Response(next.text ?? (next.body === undefined ? '' : JSON.stringify(next.body)), { status: next.status, headers: next.headers })
  }) as unknown as typeof fetch
  return { calls, fetchImpl }
}
const signal = (): AbortSignal => new AbortController().signal
const make = (responses: Parameters<typeof fakeFetch>[0], extra: Partial<Parameters<typeof createHttpTransport>[0]> = {}) => {
  const f = fakeFetch(responses)
  return { ...f, transport: createHttpTransport({ baseUrl: 'https://sync.example.com/v1/docs/', fetch: f.fetchImpl, ...extra }) }
}
async function failure (promise: Promise<unknown>): Promise<SyncTransportError> {
  try { await promise } catch (error) { return error as SyncTransportError }
  throw new Error('did not fail')
}

describe('http transport', () => {
  it('reads a document, with the id encoded and no redirect followed', async () => {
    const { transport, calls } = make([{ status: 200, body: { revision: 3, document: 'text' } }])
    expect(await transport.get('drawings/BTC USDT', signal())).toEqual({ revision: 3, document: 'text' })
    expect(calls[0]).toMatchObject({ url: 'https://sync.example.com/v1/docs/drawings%2FBTC%20USDT', method: 'GET', redirect: 'error' })
  })

  it('reads 404 as no document', async () => {
    expect(await make([{ status: 404 }]).transport.get('d', signal())).toBeNull()
  })

  it('creates with If-None-Match and updates with If-Match', async () => {
    const { transport, calls } = make([{ status: 201, body: { revision: 1 } }, { status: 200, body: { revision: 2 } }])
    expect(await transport.put('d', 'a', 0, signal())).toEqual({ status: 'saved', revision: 1 })
    expect(await transport.put('d', 'b', 1, signal())).toEqual({ status: 'saved', revision: 2 })
    expect(calls[0]?.headers).toMatchObject({ 'if-none-match': '*', 'content-type': 'application/json' })
    expect(calls[0]?.headers['if-match']).toBeUndefined()
    expect(calls[1]?.headers).toMatchObject({ 'if-match': '"1"' })
    expect(JSON.parse(calls[1]?.body ?? '')).toEqual({ document: 'b' })
  })

  it('reads 412 as a conflict carrying the current document, or none', async () => {
    const { transport } = make([{ status: 412, body: { current: { revision: 5, document: 'theirs' } } }, { status: 412, body: { current: null } }])
    expect(await transport.put('d', 'a', 4, signal())).toEqual({ status: 'conflict', current: { revision: 5, document: 'theirs' } })
    expect(await transport.put('d', 'a', 4, signal())).toEqual({ status: 'conflict', current: null })
  })

  it('sends the host headers on every request and they win over nothing it must keep', async () => {
    const { transport, calls } = make([{ status: 404 }], { headers: async () => ({ authorization: 'Bearer t' }) })
    await transport.get('d', signal())
    expect(calls[0]?.headers).toMatchObject({ authorization: 'Bearer t', accept: 'application/json' })
  })

  it.each([
    [401, 'unauthorized', false], [403, 'unauthorized', false], [413, 'too-large', false], [400, 'rejected', false], [404, null, null],
    [408, 'server', true], [429, 'server', true], [500, 'server', true], [503, 'server', true]
  ])('status %i on a write', async (status, kind, retryable) => {
    if (kind === null) return
    const error = await failure(make([{ status: status as number }]).transport.put('d', 'a', 0, signal()))
    expect(error).toBeInstanceOf(SyncTransportError)
    expect({ kind: error.kind, retryable: error.retryable, status: error.status }).toEqual({ kind, retryable, status })
  })

  it('a network failure is retryable', async () => {
    const error = await failure(make([new TypeError('fetch failed')]).transport.get('d', signal()))
    expect(error).toMatchObject({ kind: 'network', retryable: true })
  })

  it('refuses answers that are not what the protocol says', async () => {
    for (const body of [{ revision: 0, document: 'x' }, { revision: 1.5, document: 'x' }, { revision: 1, document: 5 }, [], { document: 'x' }]) {
      expect(await failure(make([{ status: 200, body }]).transport.get('d', signal()))).toMatchObject({ kind: 'invalid-response', retryable: false })
    }
    expect(await failure(make([{ status: 200, text: 'not json' }]).transport.get('d', signal()))).toMatchObject({ kind: 'invalid-response' })
    expect(await failure(make([{ status: 200, body: { revision: 'x' } }]).transport.put('d', 'a', 0, signal()))).toMatchObject({ kind: 'invalid-response' })
  })

  it('refuses a document or a body that is too long', async () => {
    const long = make([{ status: 200, body: { revision: 1, document: 'x'.repeat(20) } }], { maxDocumentChars: 10 })
    expect(await failure(long.transport.get('d', signal()))).toMatchObject({ kind: 'too-large' })
    const declared = make([{ status: 200, text: '{}', headers: { 'content-length': '999999999' } }], { maxDocumentChars: 10 })
    expect(await failure(declared.transport.get('d', signal()))).toMatchObject({ kind: 'too-large' })
  })

  it('refuses bad ids and bad base revisions before any request', async () => {
    const { transport, calls } = make([])
    await expect(transport.get('', signal())).rejects.toThrow(RangeError)
    await expect(transport.put('d', 'a', -1, signal())).rejects.toThrow(RangeError)
    expect(calls).toHaveLength(0)
  })

  it('accepts only https, or http on loopback, with no credentials or query', () => {
    const fetchImpl = fakeFetch([]).fetchImpl
    for (const baseUrl of ['http://sync.example.com', 'ftp://x', 'not a url', 'https://u:p@x.com', 'https://x.com/?a=1', 'https://x.com/#f']) {
      expect(() => createHttpTransport({ baseUrl, fetch: fetchImpl })).toThrow(RangeError)
    }
    expect(() => createHttpTransport({ baseUrl: 'http://localhost:8080/v1', fetch: fetchImpl })).not.toThrow()
    expect(() => createHttpTransport({ baseUrl: 'https://x.com', fetch: fetchImpl, timeoutMs: 0 })).toThrow(RangeError)
  })

  it('gives up on a request that takes longer than the timeout', async () => {
    const hanging = ((_url: string, init: RequestInit) => new Promise((_resolve, reject) => { init.signal?.addEventListener('abort', () => { reject(new Error('aborted')) }) })) as unknown as typeof fetch
    const transport = createHttpTransport({ baseUrl: 'https://x.com', fetch: hanging, timeoutMs: 20 })
    expect(await failure(transport.get('d', signal()))).toMatchObject({ kind: 'network', retryable: true })
  })

  it('stops when the caller aborts', async () => {
    const hanging = ((_url: string, init: RequestInit) => new Promise((_resolve, reject) => { init.signal?.addEventListener('abort', () => { reject(new Error('aborted')) }) })) as unknown as typeof fetch
    const transport = createHttpTransport({ baseUrl: 'https://x.com', fetch: hanging, timeoutMs: 60_000 })
    const controller = new AbortController()
    const promise = failure(transport.get('d', controller.signal))
    controller.abort()
    expect(await promise).toMatchObject({ kind: 'network' })
  })
})
