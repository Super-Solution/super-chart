import { describe, expect, it } from 'vitest'
import { symbolKey, type WorkspaceEvents } from '@supersolutions/super-chart-core'
import { DocumentSync, createMemoryTransport, type SyncTransport } from '@supersolutions/super-chart-core/sync'
import { bindDrawingSync } from './syncEntry'
import type { ChartWorkspace } from './workspace'

const BTC = { ticker: 'BTC-USDT', exchange: 'OKX' }
const ETH = { ticker: 'ETH-USDT', exchange: 'OKX' }
const abort = (): AbortSignal => new AbortController().signal
const settle = async (): Promise<void> => { for (let i = 0; i < 30; i++) await Promise.resolve() }

/** The part of a workspace the binding uses: two methods, one state read and the event bus. */
function fakeWorkspace (symbol: typeof BTC | null = BTC, drawings = '{"version":1,"drawings":[]}') {
  const listeners = new Map<string, Set<(event: never) => void>>()
  const state = { symbol, drawings, imports: [] as string[] }
  const workspace = {
    on: (type: string, listener: (event: never) => void) => { const set = listeners.get(type) ?? new Set(); listeners.set(type, set); set.add(listener); return () => { set.delete(listener) } },
    getLoadState: () => ({ loaded: state.symbol === null ? null : { symbol: state.symbol, period: { text: '1h' } } }),
    getState: () => ({ drawings: { count: (JSON.parse(state.drawings) as { drawings: unknown[] }).drawings.length } }),
    exportDrawings: () => state.drawings,
    importDrawings: (json: string) => { state.imports.push(json); state.drawings = json }
  }
  const emit = <K extends keyof WorkspaceEvents>(type: K, event: WorkspaceEvents[K]): void => { for (const l of [...(listeners.get(type) ?? [])]) l(event as never) }
  return { workspace: workspace as unknown as ChartWorkspace, state, emit, listenerCount: () => [...listeners.values()].reduce((n, s) => n + s.size, 0) }
}
const doc = (...ids: string[]): string => JSON.stringify({ version: 1, drawings: ids.map(id => ({ id })) })
const manual = () => {
  const pending: Array<() => void> = []
  return { timers: { now: () => 0, setTimeout: (run: () => void) => { pending.push(run); return pending.length }, clearTimeout: () => {} }, fire: async () => { for (const run of pending.splice(0)) { run(); await settle() } } }
}
const edit = (key: string, count = 1) => ({ key, symbol: BTC, count, origin: 'edit' as const })

describe('bindDrawingSync', () => {
  it("saves the person's edits under the symbol's document id", async () => {
    const remote = createMemoryTransport(), time = manual()
    const sync = new DocumentSync({ transport: remote, timers: time.timers })
    const { workspace, state, emit } = fakeWorkspace()
    bindDrawingSync(workspace, sync, { automatic: false })
    state.drawings = doc('a')
    emit('drawingsChange', edit(symbolKey(BTC)))
    await time.fire()
    expect(await remote.get(`drawings/${symbolKey(BTC)}`, abort())).toEqual({ revision: 1, document: doc('a') })
  })

  it('ignores an edit event that arrives after the market changed', async () => {
    const remote = createMemoryTransport(), time = manual()
    const sync = new DocumentSync({ transport: remote, timers: time.timers })
    const { workspace, state, emit } = fakeWorkspace()
    bindDrawingSync(workspace, sync, { automatic: false })
    state.symbol = ETH
    emit('drawingsChange', edit(symbolKey(BTC)))
    await time.fire()
    expect(remote.size).toBe(0)
  })

  it('does not save what it just imported', async () => {
    const remote = createMemoryTransport(), time = manual()
    const sync = new DocumentSync({ transport: remote, timers: time.timers })
    const { workspace, emit } = fakeWorkspace()
    bindDrawingSync(workspace, sync, { automatic: false })
    emit('drawingsChange', { ...edit(symbolKey(BTC)), origin: 'imported' })
    await time.fire()
    expect(remote.size).toBe(0)
  })

  it("shows the server's drawings when the market has loaded", async () => {
    const remote = createMemoryTransport(), time = manual()
    await remote.put(`drawings/${symbolKey(BTC)}`, doc('remote'), 0, abort())
    const sync = new DocumentSync({ transport: remote, timers: time.timers })
    const { workspace, state } = fakeWorkspace()
    const binding = bindDrawingSync(workspace, sync, { automatic: false })
    expect((await binding.pull())?.status).toBe('remote')
    expect(state.drawings).toBe(doc('remote'))
  })

  it('pulls by itself when a market loads, and again for another market', async () => {
    const remote = createMemoryTransport(), time = manual()
    await remote.put(`drawings/${symbolKey(BTC)}`, doc('btc'), 0, abort())
    await remote.put(`drawings/${symbolKey(ETH)}`, doc('eth'), 0, abort())
    const sync = new DocumentSync({ transport: remote, timers: time.timers })
    const { workspace, state, emit } = fakeWorkspace()
    bindDrawingSync(workspace, sync)
    await settle()
    expect(state.drawings).toBe(doc('btc'))
    state.symbol = ETH
    emit('loadResult', { status: 'loaded', symbol: ETH, period: { text: '1h' } as never, bars: 10 })
    await settle()
    expect(state.drawings).toBe(doc('eth'))
  })

  it("shows a market's drawings again after leaving it, when the server has newer ones", async () => {
    const remote = createMemoryTransport(), time = manual()
    const key = `drawings/${symbolKey(BTC)}`
    await remote.put(key, doc('v1'), 0, abort())
    const sync = new DocumentSync({ transport: remote, timers: time.timers })
    const { workspace, state } = fakeWorkspace()
    const binding = bindDrawingSync(workspace, sync, { automatic: false })
    await binding.pull()
    await remote.put(key, doc('v2'), 1, abort())
    state.drawings = doc('stale') // what the workspace kept while the market was not shown
    await sync.pull(key) // another pull moved the sync on
    await binding.pull()
    expect(state.drawings).toBe(doc('v2'))
  })

  it('uploads drawings a device already had when the server holds none', async () => {
    const remote = createMemoryTransport(), time = manual()
    const sync = new DocumentSync({ transport: remote, timers: time.timers })
    const { workspace } = fakeWorkspace(BTC, doc('local'))
    const binding = bindDrawingSync(workspace, sync, { automatic: false })
    expect((await binding.pull())?.status).toBe('empty')
    await time.fire()
    expect(await remote.get(`drawings/${symbolKey(BTC)}`, abort())).toEqual({ revision: 1, document: doc('local') })
  })

  it('never writes over an unsaved edit with a pulled document', async () => {
    const remote = createMemoryTransport(), time = manual()
    await remote.put(`drawings/${symbolKey(BTC)}`, doc('remote'), 0, abort())
    const sync = new DocumentSync({ transport: remote, timers: time.timers })
    const { workspace, state, emit } = fakeWorkspace()
    const binding = bindDrawingSync(workspace, sync, { automatic: false })
    state.drawings = doc('mine'); emit('drawingsChange', edit(symbolKey(BTC)))
    await binding.pull()
    expect(state.imports).toEqual([])
    expect(state.drawings).toBe(doc('mine'))
  })

  it('shows the merged document after a conflict is settled', async () => {
    const remote = createMemoryTransport(), time = manual()
    const key = `drawings/${symbolKey(BTC)}`
    await remote.put(key, doc('a'), 0, abort())
    const sync = new DocumentSync({ transport: remote, timers: time.timers, conflict: c => `${c.remote ?? ''}+${c.local}` })
    const { workspace, state, emit } = fakeWorkspace()
    const binding = bindDrawingSync(workspace, sync, { automatic: false })
    await binding.pull()
    await remote.put(key, doc('a', 'b'), 1, abort())
    state.drawings = doc('c'); emit('drawingsChange', edit(symbolKey(BTC)))
    await time.fire()
    expect(state.imports.at(-1)).toBe(`${doc('a', 'b')}+${doc('c')}`)
  })

  it('reports a bad document from the server and leaves the chart alone', async () => {
    const remote = createMemoryTransport(), time = manual()
    await remote.put(`drawings/${symbolKey(BTC)}`, 'garbage', 0, abort())
    const sync = new DocumentSync({ transport: remote, timers: time.timers })
    const { workspace, state } = fakeWorkspace()
    const errors: unknown[] = []
    ;(workspace as unknown as { importDrawings: (json: string) => void }).importDrawings = () => { throw new TypeError('Invalid drawing document') }
    const binding = bindDrawingSync(workspace, sync, { automatic: false, onError: e => errors.push(e) })
    await binding.pull()
    expect(errors).toHaveLength(1)
    expect(state.drawings).toBe('{"version":1,"drawings":[]}')
  })

  it('reports a failing server through onError without throwing', async () => {
    const failing: SyncTransport = { get: async () => { throw new Error('down') }, put: async () => { throw new Error('down') } }
    const sync = new DocumentSync({ transport: failing, timers: manual().timers })
    const { workspace } = fakeWorkspace()
    const errors: unknown[] = []
    const binding = bindDrawingSync(workspace, sync, { automatic: false, onError: e => errors.push(e) })
    expect(await binding.pull()).toMatchObject({ status: 'failed' })
    expect(errors).toHaveLength(1)
  })

  it('does nothing before a market is shown, and uses the id the host chose', async () => {
    const remote = createMemoryTransport(), time = manual()
    const sync = new DocumentSync({ transport: remote, timers: time.timers })
    const idle = fakeWorkspace(null)
    expect(await bindDrawingSync(idle.workspace, sync, { automatic: false }).pull()).toBeNull()
    const { workspace, state, emit } = fakeWorkspace()
    bindDrawingSync(workspace, sync, { automatic: false, id: key => `panel-1/${key}` })
    state.drawings = doc('a'); emit('drawingsChange', edit(symbolKey(BTC)))
    await time.fire()
    expect((await remote.get(`panel-1/${symbolKey(BTC)}`, abort()))?.document).toBe(doc('a'))
  })

  it('stops listening when disposed', () => {
    const sync = new DocumentSync({ transport: createMemoryTransport(), timers: manual().timers })
    const fake = fakeWorkspace()
    const binding = bindDrawingSync(fake.workspace, sync, { automatic: false })
    expect(fake.listenerCount()).toBeGreaterThan(0)
    binding.dispose()
    expect(fake.listenerCount()).toBe(0)
  })
})
