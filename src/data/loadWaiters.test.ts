import { describe, expect, it } from 'vitest'

import type { Period, SymbolInfo } from '../types'

import type { FinalPair, LoadOutcome } from './loadWaiters'
import { LoadWaiterQueue } from './loadWaiters'

const sym = (ticker: string): SymbolInfo => ({ ticker })
const H1: Period = { multiplier: 1, timespan: 'hour', text: '1H' }
const H4: Period = { multiplier: 4, timespan: 'hour', text: '4H' }
const key = (symbol: SymbolInfo, period: Period): string => `${symbol.ticker}|${period.multiplier}:${period.timespan}`

/** A microtask scheduler the test drives by hand, for determinism. */
function manualScheduler (): { schedule: (fn: () => void) => void, flush: () => void, pendingCount: number } {
  let fns: Array<() => void> = []
  return {
    schedule: fn => { fns.push(fn) },
    flush: () => { const run = fns; fns = []; for (const fn of run) fn() },
    get pendingCount () { return fns.length }
  }
}

function setup (initialSymbol: SymbolInfo, initialPeriod: Period): {
  queue: LoadWaiterQueue
  scheduler: ReturnType<typeof manualScheduler>
  setFinal: (symbol: SymbolInfo, period: Period) => void
  final: () => FinalPair
} {
  const scheduler = manualScheduler()
  let current: FinalPair = { key: key(initialSymbol, initialPeriod), symbol: initialSymbol, period: initialPeriod }
  const queue = new LoadWaiterQueue(current.key, () => current, scheduler.schedule)
  return {
    queue,
    scheduler,
    setFinal: (symbol, period) => { current = { key: key(symbol, period), symbol, period } },
    final: () => current
  }
}

describe('SC-023: LoadWaiterQueue', () => {
  it('a single change becomes the active batch and stays pending until settle()', async () => {
    const t = setup(sym('A'), H1)
    t.setFinal(sym('B'), H1)
    const p = t.queue.wait()
    t.scheduler.flush()
    let settled = false
    void p.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    t.queue.settle(key(sym('B'), H1), { status: 'loaded', symbol: sym('B'), period: H1, bars: 10 })
    const outcome = await p
    expect(outcome).toEqual({ status: 'loaded', symbol: sym('B'), period: H1, bars: 10 })
  })

  it('two calls in the same tick (before the flush) share one outcome', async () => {
    const t = setup(sym('A'), H1)
    const p1 = t.queue.wait()
    t.setFinal(sym('B'), H1)
    const p2 = t.queue.wait()
    t.setFinal(sym('B'), H4) // e.g. setSymbol then setPeriod, coalesced
    expect(t.scheduler.pendingCount).toBe(1) // one microtask for the whole batch
    t.scheduler.flush()
    t.queue.settle(key(sym('B'), H4), { status: 'loaded', symbol: sym('B'), period: H4, bars: 5 })
    const [o1, o2] = await Promise.all([p1, p2])
    expect(o1).toEqual({ status: 'loaded', symbol: sym('B'), period: H4, bars: 5 })
    expect(o2).toEqual(o1)
  })

  it('a change followed by a change back to the original pair, same tick, resolves "unchanged"', async () => {
    const t = setup(sym('A'), H1)
    const p1 = t.queue.wait()
    t.setFinal(sym('B'), H1)
    const p2 = t.queue.wait()
    t.setFinal(sym('A'), H1) // back to where it started
    t.scheduler.flush()
    const [o1, o2] = await Promise.all([p1, p2])
    expect(o1).toEqual({ status: 'unchanged', symbol: sym('A'), period: H1 })
    expect(o2).toEqual(o1)
  })

  it('a call whose batch changes nothing resolves "unchanged" without waiting for settle()', async () => {
    const t = setup(sym('A'), H1)
    // final stays A/H1: e.g. setSymbol(sameSymbol) — no key change.
    const p = t.queue.wait()
    t.scheduler.flush()
    const outcome = await p
    expect(outcome).toEqual({ status: 'unchanged', symbol: sym('A'), period: H1 })
  })

  it('a later batch that starts before the active one lands supersedes it', async () => {
    const t = setup(sym('A'), H1)
    t.setFinal(sym('B'), H1)
    const first = t.queue.wait()
    t.scheduler.flush() // B/H1 becomes active
    t.setFinal(sym('C'), H1)
    const second = t.queue.wait()
    t.scheduler.flush() // C/H1 supersedes B/H1
    const firstOutcome = await first
    expect(firstOutcome).toEqual({ status: 'superseded', by: { symbol: sym('C'), period: H1 } })
    t.queue.settle(key(sym('C'), H1), { status: 'loaded', symbol: sym('C'), period: H1, bars: 1 })
    expect(await second).toEqual({ status: 'loaded', symbol: sym('C'), period: H1, bars: 1 })
  })

  it('settle() for a key that is not the active batch does nothing', async () => {
    const t = setup(sym('A'), H1)
    t.setFinal(sym('B'), H1)
    const p = t.queue.wait()
    t.scheduler.flush()
    t.queue.settle(key(sym('OTHER'), H1), { status: 'loaded', symbol: sym('OTHER'), period: H1, bars: 1 })
    let settled = false
    void p.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    t.queue.settle(key(sym('B'), H1), { status: 'error', symbol: sym('B'), period: H1, message: 'feed down', timeout: false })
    expect(await p).toEqual({ status: 'error', symbol: sym('B'), period: H1, message: 'feed down', timeout: false })
  })

  it('an error settle resolves with the error outcome, not a throw', async () => {
    const t = setup(sym('A'), H1)
    t.setFinal(sym('B'), H1)
    const p = t.queue.wait()
    t.scheduler.flush()
    t.queue.settle(key(sym('B'), H1), { status: 'error', symbol: sym('B'), period: H1, message: 'timed out', timeout: true })
    const outcome = await p
    expect(outcome).toEqual({ status: 'error', symbol: sym('B'), period: H1, message: 'timed out', timeout: true })
  })

  it('dispose() settles every pending and active waiter with "disposed", and never throws', async () => {
    const t = setup(sym('A'), H1)
    t.setFinal(sym('B'), H1)
    const active = t.queue.wait()
    t.scheduler.flush()
    t.setFinal(sym('C'), H1)
    const pendingP = t.queue.wait() // not flushed yet
    t.queue.dispose()
    expect(await active).toEqual({ status: 'disposed' })
    expect(await pendingP).toEqual({ status: 'disposed' })
  })

  it('a wait() call after dispose() resolves "disposed" immediately', async () => {
    const t = setup(sym('A'), H1)
    t.queue.dispose()
    const outcome: LoadOutcome = await t.queue.wait()
    expect(outcome).toEqual({ status: 'disposed' })
  })
})
