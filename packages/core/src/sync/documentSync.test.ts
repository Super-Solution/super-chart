import { describe, expect, it } from 'vitest'
import { DocumentSync, type DocumentSyncOptions, type SyncJournal } from './documentSync'
import { createMemoryTransport } from './memoryTransport'
import { SyncTransportError, type PutResult, type SyncTransport } from './types'

/** A clock the test moves by hand, with the timers `DocumentSync` accepts. */
function clock () {
  let now = 0
  const pending = new Map<number, { at: number, run: () => void }>()
  let next = 1
  return {
    timers: {
      now: () => now,
      setTimeout: (run: () => void, ms: number) => { const id = next++; pending.set(id, { at: now + ms, run }); return id },
      clearTimeout: (handle: unknown) => { pending.delete(handle as number) }
    },
    get waiting () { return pending.size },
    /** The shortest delay among the timers set, or null. */
    get nextIn () { return pending.size === 0 ? null : Math.min(...[...pending.values()].map(t => t.at - now)) },
    /** Moves time forward, running every timer that falls due, in order, and lets the work they start finish. */
    async advance (ms: number) {
      const end = now + ms
      for (;;) {
        const due = [...pending.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
        if (due === undefined) break
        pending.delete(due[0]); now = Math.max(now, due[1].at); due[1].run()
        await settle()
      }
      now = end
    }
  }
}
const settle = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve() }

function make (transport: SyncTransport, extra: Partial<DocumentSyncOptions> = {}) {
  const time = clock()
  const sync = new DocumentSync({ transport, timers: time.timers, ...extra })
  return { sync, time }
}
function journal (): SyncJournal & { rows: Map<string, string> } {
  const rows = new Map<string, string>()
  return { rows, getItem: key => rows.get(key) ?? null, setItem: (key, value) => { rows.set(key, value) }, removeItem: key => { rows.delete(key) } }
}
/** Wraps a transport so a test can make requests fail or hold them back. */
function flaky (inner: SyncTransport) {
  const control = { failGet: null as Error | null, failPut: null as Error | null, loseAnswer: false, puts: 0, gets: 0, hold: null as Promise<void> | null }
  const transport: SyncTransport = {
    get: async (id, signal) => { control.gets++; if (control.failGet !== null) throw control.failGet; return await inner.get(id, signal) },
    put: async (id, document, base, signal): Promise<PutResult> => {
      control.puts++
      if (control.hold !== null) await control.hold
      if (control.failPut !== null) throw control.failPut
      const result = await inner.put(id, document, base, signal)
      if (control.loseAnswer) { control.loseAnswer = false; throw new SyncTransportError('network', 'connection reset') }
      return result
    }
  }
  return { control, transport }
}

describe('DocumentSync writes', () => {
  it('writes one revision for a burst of edits, after the quiet time', async () => {
    const remote = createMemoryTransport()
    const { sync, time } = make(remote)
    sync.set('d', 'one'); sync.set('d', 'two'); sync.set('d', 'three')
    expect(await remote.get('d', new AbortController().signal)).toBeNull()
    await time.advance(999)
    expect(await remote.get('d', new AbortController().signal)).toBeNull()
    await time.advance(1)
    expect(await remote.get('d', new AbortController().signal)).toEqual({ revision: 1, document: 'three' })
    expect(sync.getState('d')).toMatchObject({ state: 'idle', pending: false, revision: 1 })
  })

  it('writes at the latest after maxWaitMs however busy the edits are', async () => {
    const remote = createMemoryTransport()
    const { sync, time } = make(remote, { debounceMs: 1000, maxWaitMs: 3000 })
    for (let i = 0; i < 10; i++) { sync.set('d', `v${i}`); await time.advance(500) }
    expect((await remote.get('d', new AbortController().signal))?.revision).toBeGreaterThanOrEqual(1)
  })

  it('bases each write on the revision the server gave for the last one', async () => {
    const remote = createMemoryTransport()
    const { sync, time } = make(remote)
    sync.set('d', 'a'); await time.advance(1000)
    sync.set('d', 'b'); await time.advance(1000)
    expect(await remote.get('d', new AbortController().signal)).toEqual({ revision: 2, document: 'b' })
  })

  it('drops an edit that puts the document back as the server has it', async () => {
    const remote = createMemoryTransport()
    const { sync, time } = make(remote)
    sync.set('d', 'a'); await time.advance(1000)
    sync.set('d', 'b'); sync.set('d', 'a')
    expect(sync.getState('d').pending).toBe(false)
    expect(time.waiting).toBe(0)
  })

  it('keeps an edit made while a write is running and writes it next', async () => {
    const { control, transport } = flaky(createMemoryTransport())
    const { sync, time } = make(transport)
    let release!: () => void
    control.hold = new Promise<void>(resolve => { release = resolve })
    sync.set('d', 'first'); await time.advance(1000)
    sync.set('d', 'second')
    release(); control.hold = null; await settle(); await time.advance(1000)
    expect(await transport.get('d', new AbortController().signal)).toEqual({ revision: 2, document: 'second' })
  })

  it('refuses a document over the limit and keeps the previous edit', () => {
    const { sync } = make(createMemoryTransport(), { maxDocumentChars: 10 })
    sync.set('d', 'short')
    expect(() => { sync.set('d', 'x'.repeat(11)) }).toThrow(RangeError)
    expect(sync.getState('d').pending).toBe(true)
  })

  it('refuses a bad id', () => {
    const { sync } = make(createMemoryTransport())
    expect(() => { sync.set('', 'x') }).toThrow(RangeError)
    expect(() => { sync.set('a'.repeat(257), 'x') }).toThrow(RangeError)
    expect(() => { sync.set('bad\nid', 'x') }).toThrow(RangeError)
  })
})

describe('DocumentSync failures', () => {
  it('keeps the edit and retries with growing delays while the network is down', async () => {
    const { control, transport } = flaky(createMemoryTransport())
    const { sync, time } = make(transport, { retryBaseMs: 1000, retryMaxMs: 4000 })
    control.failPut = new SyncTransportError('network', 'offline')
    sync.set('d', 'a'); await time.advance(1000)
    expect(sync.getState('d')).toMatchObject({ state: 'offline', pending: true })
    expect(time.nextIn).toBe(1000)
    await time.advance(1000)
    expect(time.nextIn).toBe(2000)
    await time.advance(2000)
    expect(time.nextIn).toBe(4000)
    await time.advance(4000)
    expect(time.nextIn).toBe(4000) // capped
    control.failPut = null
    await time.advance(4000)
    expect(sync.getState('d')).toMatchObject({ state: 'idle', pending: false, revision: 1 })
    expect(await transport.get('d', new AbortController().signal)).toEqual({ revision: 1, document: 'a' })
  })

  it('stops on a failure that cannot be fixed by waiting, and retryNow tries again', async () => {
    const { control, transport } = flaky(createMemoryTransport())
    const { sync, time } = make(transport)
    control.failPut = new SyncTransportError('unauthorized', 'no', { status: 401 })
    sync.set('d', 'a'); await time.advance(1000)
    expect(sync.getState('d')).toMatchObject({ state: 'error', pending: true })
    expect(time.waiting).toBe(0)
    control.failPut = null
    sync.retryNow(); await settle()
    expect(sync.getState('d')).toMatchObject({ state: 'idle', pending: false })
  })

  it('does not call a write twice when the answer was lost but the server kept it', async () => {
    const { control, transport } = flaky(createMemoryTransport())
    const { sync, time } = make(transport)
    const events: string[] = []
    sync.on('conflict', () => events.push('conflict'))
    control.loseAnswer = true
    sync.set('d', 'a'); await time.advance(1000)
    expect(sync.getState('d').state).toBe('offline')
    await time.advance(1000)
    expect(events).toEqual([])
    expect(sync.getState('d')).toMatchObject({ state: 'idle', pending: false, revision: 1 })
  })

  it('treats a revision that does not go up as a broken server, not a save', async () => {
    const transport: SyncTransport = { get: async () => null, put: async () => ({ status: 'saved', revision: 0 }) }
    const { sync, time } = make(transport)
    sync.set('d', 'a'); await time.advance(1000)
    expect(sync.getState('d')).toMatchObject({ state: 'error', pending: true })
    expect(sync.getState('d').error?.kind).toBe('invalid-response')
  })

  it('reports a failed read without losing anything', async () => {
    const { control, transport } = flaky(createMemoryTransport())
    const { sync } = make(transport)
    control.failGet = new SyncTransportError('network', 'offline')
    const result = await sync.pull('d')
    expect(result.status).toBe('failed')
  })
})

describe('DocumentSync pull', () => {
  it('hands over the server document once, then reports it unchanged with its text', async () => {
    const remote = createMemoryTransport()
    await remote.put('d', 'server', 0, new AbortController().signal)
    const { sync } = make(remote)
    const seen: string[] = []
    sync.on('document', e => seen.push(`${e.reason}:${e.document}:${e.revision}`))
    expect(await sync.pull('d')).toEqual({ status: 'remote', document: 'server', revision: 1 })
    expect(await sync.pull('d')).toEqual({ status: 'unchanged', revision: 1, document: 'server' })
    expect(seen).toEqual(['pull:server:1'])
  })

  it('says empty when the server holds nothing', async () => {
    const { sync } = make(createMemoryTransport())
    expect(await sync.pull('d')).toEqual({ status: 'empty' })
  })

  it('keeps an unsaved edit and writes it when the server has not moved on', async () => {
    const remote = createMemoryTransport()
    await remote.put('d', 'server', 0, new AbortController().signal)
    const a = make(remote)
    await a.sync.pull('d')
    a.sync.set('d', 'mine')
    expect(await a.sync.pull('d')).toEqual({ status: 'pending' })
    await a.time.advance(0)
    expect(await remote.get('d', new AbortController().signal)).toEqual({ revision: 2, document: 'mine' })
  })

  it('raises a conflict when both sides changed, and overwrites nothing', async () => {
    const remote = createMemoryTransport()
    const a = make(remote), b = make(remote)
    a.sync.set('d', 'a1'); await a.time.advance(1000)
    await b.sync.pull('d')
    a.sync.set('d', 'a2'); await a.time.advance(1000)
    b.sync.set('d', 'b2')
    const conflicts: Array<{ local: string, remote: string | null, remoteRevision: number }> = []
    b.sync.on('conflict', c => conflicts.push(c))
    expect(await b.sync.pull('d')).toEqual({ status: 'conflict' })
    expect(conflicts).toEqual([{ id: 'd', local: 'b2', remote: 'a2', remoteRevision: 2 }])
    expect(await remote.get('d', new AbortController().signal)).toEqual({ revision: 2, document: 'a2' })
    expect(b.sync.getState('d')).toMatchObject({ state: 'conflict', pending: true })
  })
})

describe('DocumentSync conflicts', () => {
  async function conflicted (policy?: DocumentSyncOptions['conflict']) {
    const remote = createMemoryTransport()
    const a = make(remote), b = make(remote, policy === undefined ? {} : { conflict: policy })
    a.sync.set('d', 'a1'); await a.time.advance(1000)
    await b.sync.pull('d')
    a.sync.set('d', 'a2'); await a.time.advance(1000)
    b.sync.set('d', 'b2'); await b.time.advance(1000)
    return { remote, a, b }
  }
  const server = async (remote: SyncTransport) => await remote.get('d', new AbortController().signal)

  it('a write that loses the race is a conflict, with the server document in it', async () => {
    const { remote, b } = await conflicted()
    expect(b.sync.getState('d').state).toBe('conflict')
    expect(await server(remote)).toEqual({ revision: 2, document: 'a2' })
  })

  it("resolve('local') writes this device's document over the server's", async () => {
    const { remote, b } = await conflicted()
    expect(await b.sync.resolve('d', 'local')).toEqual({ status: 'saved', revision: 3 })
    expect(await server(remote)).toEqual({ revision: 3, document: 'b2' })
    expect(b.sync.getState('d')).toMatchObject({ state: 'idle', pending: false })
  })

  it("resolve('remote') drops this device's edit and hands over the server's document", async () => {
    const { remote, b } = await conflicted()
    const seen: string[] = []
    b.sync.on('document', e => seen.push(`${e.reason}:${e.document}`))
    await b.sync.resolve('d', 'remote')
    expect(seen).toEqual(['conflict-remote:a2'])
    expect(await server(remote)).toEqual({ revision: 2, document: 'a2' })
    expect(b.sync.getState('d')).toMatchObject({ state: 'idle', pending: false, revision: 2 })
  })

  it('a merge is saved on top of the server revision and shown', async () => {
    const { remote, b } = await conflicted()
    const seen: string[] = []
    b.sync.on('document', e => seen.push(`${e.reason}:${e.document}`))
    expect(await b.sync.resolve('d', 'a2+b2')).toEqual({ status: 'saved', revision: 3 })
    expect(seen).toEqual(['merged:a2+b2'])
    expect(await server(remote)).toEqual({ revision: 3, document: 'a2+b2' })
  })

  it("policy 'local' and 'remote' decide without asking", async () => {
    const local = await conflicted('local')
    expect(await server(local.remote)).toEqual({ revision: 3, document: 'b2' })
    const remote = await conflicted('remote')
    expect(await server(remote.remote)).toEqual({ revision: 2, document: 'a2' })
    expect(remote.b.sync.getState('d').pending).toBe(false)
  })

  it('a policy function can merge', async () => {
    const { remote, b } = await conflicted(c => `${c.remote ?? ''}|${c.local}`)
    expect(await server(remote)).toEqual({ revision: 3, document: 'a2|b2' })
    expect(b.sync.getState('d').state).toBe('idle')
  })

  it('a policy that throws, or answers null, asks instead', async () => {
    const thrown = await conflicted(() => { throw new Error('boom') })
    expect(thrown.b.sync.getState('d').state).toBe('conflict')
    const nothing = await conflicted(() => null)
    expect(nothing.b.sync.getState('d').state).toBe('conflict')
  })

  it('a policy that keeps losing the race stops after a few tries and asks', async () => {
    let revision = 1
    // A server that always says someone else just wrote.
    const transport: SyncTransport = { get: async () => ({ revision, document: 'x' }), put: async () => ({ status: 'conflict', current: { revision: ++revision, document: `x${revision}` } }) }
    const { sync, time } = make(transport, { conflict: 'local' })
    sync.set('d', 'mine'); await time.advance(1000)
    expect(sync.getState('d').state).toBe('conflict')
  })

  it('edits made during a conflict replace the held local document', async () => {
    const { remote, b } = await conflicted()
    b.sync.set('d', 'b3')
    await b.sync.resolve('d', 'local')
    expect(await server(remote)).toEqual({ revision: 3, document: 'b3' })
  })

  it('a server that deleted the document is a conflict with nothing remote, and local can recreate it', async () => {
    let stored: { revision: number, document: string } | null = { revision: 1, document: 'x' }
    const transport: SyncTransport = {
      get: async () => stored,
      put: async (_id, document, base): Promise<PutResult> => {
        if ((stored?.revision ?? 0) !== base) return { status: 'conflict', current: stored }
        stored = { revision: base + 1, document }; return { status: 'saved', revision: base + 1 }
      }
    }
    const { sync, time } = make(transport)
    await sync.pull('d')
    stored = null
    sync.set('d', 'mine'); await time.advance(1000)
    expect(sync.getState('d').state).toBe('conflict')
    expect(await sync.resolve('d', 'local')).toEqual({ status: 'saved', revision: 1 })
    expect(stored).toEqual({ revision: 1, document: 'mine' })
  })
})

describe('DocumentSync journal', () => {
  it('writes edits that were pending when the page was closed', async () => {
    const remote = createMemoryTransport(), saved = journal()
    const first = make(remote, { journal: saved, namespace: 'app' })
    first.sync.set('d', 'unsaved')
    expect(saved.rows.size).toBe(1)
    first.sync.dispose()
    const second = make(remote, { journal: saved, namespace: 'app' })
    expect(second.sync.getState('d').pending).toBe(false) // not read until the id is used
    await second.sync.pull('d')
    await second.time.advance(1000)
    expect(await remote.get('d', new AbortController().signal)).toEqual({ revision: 1, document: 'unsaved' })
    expect(saved.rows.size).toBe(0)
  })

  it('keeps two namespaces apart and ignores an unreadable row', async () => {
    const saved = journal()
    const a = make(createMemoryTransport(), { journal: saved, namespace: 'a' })
    a.sync.set('d', 'x')
    const b = make(createMemoryTransport(), { journal: saved, namespace: 'b' })
    expect((await b.sync.pull('d')).status).toBe('empty')
    const key = [...saved.rows.keys()][0]!
    saved.rows.set(key, '{not json')
    const c = make(createMemoryTransport(), { journal: saved, namespace: 'a' })
    expect((await c.sync.pull('d')).status).toBe('empty')
    expect(saved.rows.size).toBe(0)
  })

  it('does not lose the edit when the journal is full', () => {
    const full: SyncJournal = { getItem: () => null, setItem: () => { throw new Error('quota') }, removeItem: () => {} }
    const { sync } = make(createMemoryTransport(), { journal: full })
    sync.set('d', 'x')
    expect(sync.getState('d')).toMatchObject({ pending: true })
    expect(sync.getState('d').error?.message).toContain('journal')
  })
})

describe('DocumentSync lifecycle', () => {
  it('stops everything when disposed and refuses further use', async () => {
    const { sync, time } = make(createMemoryTransport())
    sync.set('d', 'x')
    sync.dispose()
    expect(time.waiting).toBe(0)
    expect(() => { sync.set('d', 'y') }).toThrow()
  })

  it('a listener that throws does not stop the sync', async () => {
    const remote = createMemoryTransport()
    const { sync, time } = make(remote)
    sync.on('state', () => { throw new Error('listener') })
    sync.set('d', 'x'); await time.advance(1000)
    expect(await remote.get('d', new AbortController().signal)).toEqual({ revision: 1, document: 'x' })
  })

  it('rejects options out of range', () => {
    expect(() => new DocumentSync({ transport: createMemoryTransport(), debounceMs: -1 })).toThrow(RangeError)
    expect(() => new DocumentSync({ transport: createMemoryTransport(), retryBaseMs: 5000, retryMaxMs: 1000 })).toThrow(RangeError)
    expect(() => new DocumentSync({ transport: {} as SyncTransport })).toThrow(TypeError)
  })
})
