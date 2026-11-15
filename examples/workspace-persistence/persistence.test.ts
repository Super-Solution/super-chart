import { describe, expect, it } from 'vitest'
import { ENVELOPE_SCHEMA, createMemoryRemote, readEnvelope, restoreEnvelope, syncEnvelope, type Envelope } from './persistence'

const doc = (indicators: string[] = []): string => JSON.stringify({ version: 1, symbol: { ticker: 'AAA' }, period: { multiplier: 1, timespan: 'hour', text: '1h' }, indicators: indicators.map(name => ({ name })) })
const envelope = (revision: number, deviceId = 'a', document = doc()): Envelope => ({ schema: ENVELOPE_SCHEMA, document, savedAt: 1000 + revision, revision, deviceId })

describe('readEnvelope', () => {
  it('reads the current schema and upgrades schema 1', () => {
    expect(readEnvelope(JSON.stringify(envelope(3)))).toEqual(envelope(3))
    expect(readEnvelope(JSON.stringify({ schema: 1, document: doc(), savedAt: 5 }))).toEqual({ schema: 2, document: doc(), savedAt: 5, revision: 0, deviceId: 'unknown' })
  })
  it('refuses what it cannot trust without throwing', () => {
    expect(readEnvelope(null)).toBeNull()
    expect(readEnvelope('{not json')).toBeNull()
    expect(readEnvelope(JSON.stringify({ schema: 2, document: doc(), savedAt: 1 }))).toBeNull()
    expect(readEnvelope(JSON.stringify({ schema: 9, document: doc(), savedAt: 1 }))).toBe('newer-than-app')
  })
})

describe('restoreEnvelope', () => {
  const workspace = (registered: string[], seen: string[]): never => ({
    chart: { getRegisteredIndicatorNames: () => registered },
    restoreDocument: async (json: string) => { seen.push(json); return { status: 'loaded' } }
  }) as never
  it('drops indicators the app no longer registers and reports them', async () => {
    const seen: string[] = []
    const outcome = await restoreEnvelope(workspace(['MA'], seen), envelope(1, 'a', doc(['MA', 'GONE'])))
    expect(outcome).toEqual({ status: 'restored', droppedIndicators: ['GONE'] })
    expect(JSON.parse(seen[0]).indicators).toEqual([{ name: 'MA' }])
  })
  it('passes an intact document through byte for byte', async () => {
    const seen: string[] = []
    const original = envelope(1, 'a', doc(['MA']))
    await restoreEnvelope(workspace(['MA'], seen), original)
    expect(seen[0]).toBe(original.document)
  })
  it('does not touch the chart when the market is no longer available or the text is unreadable', async () => {
    const seen: string[] = []
    expect(await restoreEnvelope(workspace([], seen), envelope(1), { isMarketAvailable: () => false })).toEqual({ status: 'invalidated', reason: 'market-unavailable' })
    expect(await restoreEnvelope(workspace([], seen), envelope(1, 'a', '{oops'))).toEqual({ status: 'invalidated', reason: 'unreadable' })
    expect(seen).toEqual([])
  })
})

describe('syncEnvelope', () => {
  it('pushes the first save, then reports same', async () => {
    const remote = createMemoryRemote()
    expect(await syncEnvelope(remote, 'w', envelope(1), 0)).toMatchObject({ status: 'pushed' })
    expect(await syncEnvelope(remote, 'w', envelope(1), 1)).toEqual({ status: 'same' })
  })
  it('pulls what another device saved, and pushes what only this device changed', async () => {
    const remote = createMemoryRemote()
    await syncEnvelope(remote, 'w', envelope(1, 'phone'), 0)
    expect(await syncEnvelope(remote, 'w', envelope(1, 'phone'), 0)).toEqual({ status: 'same' })
    const phone = await syncEnvelope(remote, 'w', envelope(2, 'phone'), 1)
    expect(phone).toMatchObject({ status: 'pushed' })
    expect(await syncEnvelope(remote, 'w', envelope(1, 'laptop'), 1)).toMatchObject({ status: 'pulled', envelope: { revision: 2, deviceId: 'phone' } })
  })
  it('reports a conflict and overwrites neither side', async () => {
    const remote = createMemoryRemote()
    await syncEnvelope(remote, 'w', envelope(1, 'phone'), 0)
    await syncEnvelope(remote, 'w', envelope(2, 'phone'), 1)
    const outcome = await syncEnvelope(remote, 'w', envelope(2, 'laptop'), 1)
    expect(outcome).toMatchObject({ status: 'conflict', local: { deviceId: 'laptop' }, remote: { deviceId: 'phone' } })
    expect((await remote.get('w'))?.envelope.deviceId).toBe('phone')
  })
  it('retries when another device wrote between the read and the write', async () => {
    const real = createMemoryRemote()
    await real.put('w', envelope(1, 'phone'), null)
    let raced = false
    const racing = {
      get: real.get,
      put: async (id: string, value: Envelope, ifMatch: string | null) => {
        if (!raced) { raced = true; await real.put(id, envelope(2, 'phone'), ifMatch) }
        return await real.put(id, value, ifMatch)
      }
    }
    // Local changed (revision 2 on laptop) while the phone also saved revision 2: after the retry it is a conflict, not a lost write.
    expect(await syncEnvelope(racing, 'w', envelope(2, 'laptop'), 1)).toMatchObject({ status: 'conflict' })
    expect((await real.get('w'))?.envelope.deviceId).toBe('phone')
  })
})
