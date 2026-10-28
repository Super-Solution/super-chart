import { describe, expect, it, vi } from 'vitest'

import { SuperChartEventBus } from './events'

describe('SC-108: SuperChartEventBus', () => {
  it('delivers the payload plus seq and ts to a subscriber', () => {
    const bus = new SuperChartEventBus()
    const seen: Array<{ symbol: { ticker: string }, seq: number, ts: number }> = []
    bus.on('symbolChange', e => { seen.push(e) })
    bus.emit('symbolChange', { symbol: { ticker: 'BTC' }, source: 'user' })
    expect(seen).toHaveLength(1)
    expect(seen[0].symbol.ticker).toBe('BTC')
    expect(seen[0].seq).toBeGreaterThan(0)
    expect(typeof seen[0].ts).toBe('number')
  })

  it('seq increases by one per event, across every type, and advances even with no listeners', () => {
    const bus = new SuperChartEventBus()
    const seqs: number[] = []
    bus.on('symbolChange', e => { seqs.push(e.seq) })
    bus.on('periodChange', e => { seqs.push(e.seq) })
    bus.emit('symbolChange', { symbol: { ticker: 'A' }, source: 'api' })
    bus.emit('dataLoaded', { symbol: { ticker: 'A' }, period: { multiplier: 1, timespan: 'hour', text: '1H' }, bars: 10, source: 'api' }) // no listener
    bus.emit('periodChange', { period: { multiplier: 1, timespan: 'hour', text: '1H' }, source: 'api' })
    expect(seqs).toEqual([1, 3])
  })

  it('the returned unsubscribe function stops delivery, and off() does the same', () => {
    const bus = new SuperChartEventBus()
    let a = 0
    let b = 0
    const unsub = bus.on('replayChange', () => { a++ })
    const fnB = (): void => { b++ }
    bus.on('replayChange', fnB)
    bus.emit('replayChange', { active: true, source: 'user' })
    unsub()
    bus.off('replayChange', fnB)
    bus.emit('replayChange', { active: false, source: 'user' })
    expect(a).toBe(1)
    expect(b).toBe(1)
  })

  it('a throwing listener is caught (via the warn hook) and does not stop other listeners or the caller', () => {
    const warn = vi.fn()
    const bus = new SuperChartEventBus(warn)
    let calledSecond = false
    bus.on('chartTypeChange', () => { throw new Error('boom') })
    bus.on('chartTypeChange', () => { calledSecond = true })
    expect(() => { bus.emit('chartTypeChange', { chartType: 'line', source: 'api' }) }).not.toThrow()
    expect(calledSecond).toBe(true)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('clear() drops every listener of every type', () => {
    const bus = new SuperChartEventBus()
    let count = 0
    bus.on('timezoneChange', () => { count++ })
    bus.on('themeChange', () => { count++ })
    bus.clear()
    bus.emit('timezoneChange', { timezone: 'UTC', source: 'api' })
    bus.emit('themeChange', { theme: 'dark', source: 'api' })
    expect(count).toBe(0)
  })

  it('emitting a type with no subscribers at all is a no-op, not a throw', () => {
    const bus = new SuperChartEventBus()
    expect(() => { bus.emit('drawingCreate', { id: 'x', name: 'line', source: 'user' }) }).not.toThrow()
  })
})
