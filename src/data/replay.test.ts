import { describe, expect, it } from 'vitest'

import type { KLineData } from 'klinecharts'

import {
  mergeBar, prependReplay, replayApply, replayAtEnd, replayBars, startReplay, stepReplay, tickReplay
} from './replay'
import type { ReplayState } from './replay'
import { HOUR, T0, bar, hours } from './testkit'

/** startReplay over bars long enough that it cannot return null. */
function started (bars: KLineData[], at?: number): ReplayState {
  const state = startReplay(bars, at)
  if (state === null) throw new Error('too short to replay')
  return state
}

const at = (n: number, close = 100): ReturnType<typeof bar> => bar(T0 + n * HOUR, close)

describe('mergeBar (snapshot semantics)', () => {
  it('replaces the same timestamp, appends a newer bar, ignores an older one', () => {
    const list = [at(0), at(1)]
    expect(mergeBar(list, at(1, 5)).map(b => b.close)).toEqual([100, 5])
    expect(mergeBar(list, at(2)).length).toBe(3)
    expect(mergeBar(list, at(0, 7))).toBe(list)
    expect(list.map(b => b.close)).toEqual([100, 100]) // pure
    expect(mergeBar([], at(0)).length).toBe(1)
  })
})

describe('replay reducer', () => {
  it('starts 60% of the way in; too short a series has nothing to replay', () => {
    expect(startReplay(hours(100, T0))?.idx).toBe(60)
    expect(startReplay(hours(2, T0))).toBeNull()
    expect(startReplay(hours(10, T0), 99)?.idx).toBe(9)
  })

  it('steps clamp to the series and report the end', () => {
    let s = started(hours(5, T0), 3)
    s = stepReplay(s, 1)
    expect([s.idx, replayAtEnd(s)]).toEqual([4, true])
    expect(stepReplay(s, 1)).toBe(s)
    expect(stepReplay(s, -10).idx).toBe(0)
    expect(replayBars(stepReplay(s, -2)).length).toBe(3)
  })

  it('a tick is buffered into the series, and the head does not move', () => {
    const s = started(hours(5, T0), 2)
    const next = tickReplay(s, bar(T0 + HOUR, 1))
    expect(next.idx).toBe(2)
    expect(next.full.length).toBe(6)
    expect(replayAtEnd(next)).toBe(false)
    expect(tickReplay(s, bar(T0 - 10 * HOUR, 1))).toBe(s)
  })

  it('older history is prepended and the head stays on the same bar', () => {
    const s = started(hours(5, T0), 2)
    const head = s.full[s.idx].timestamp
    const next = prependReplay(s, hours(3, T0 - 5 * HOUR))
    expect(next.full.length).toBe(8)
    expect(next.full[next.idx].timestamp).toBe(head)
    expect(prependReplay(s, [])).toBe(s)
  })

  it('replayApply: one step forward from the shown head appends; anything else rebuilds', () => {
    const s = started(hours(10, T0), 4)
    const fwd = stepReplay(s, 1)
    expect(replayApply(s, fwd, s.full[4].timestamp)).toEqual({ kind: 'append', bar: s.full[5] })
    expect(replayApply(s, fwd, s.full[3].timestamp).kind).toBe('rebuild') // the chart shows something else
    expect(replayApply(s, stepReplay(s, -1), s.full[4].timestamp)).toEqual({ kind: 'rebuild', bars: s.full.slice(0, 4) })
    expect(replayApply(s, stepReplay(s, 2), s.full[4].timestamp).kind).toBe('rebuild')
    expect(replayApply(s, s, s.full[4].timestamp)).toEqual({ kind: 'none' })
  })
})
